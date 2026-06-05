import {
  IDLE_SETTLE_MS,
  USER_MESSAGE_IN_PROGRESS_WINDOW_MS,
} from "./constants.js";
import {
  createLoopStateController,
  type LoopStateController,
} from "./loop-state-controller.js";
import { getStatePath, readState, writeState } from "./storage.js";
import { invokeRunner } from "./runner-invoker.js";
import { buildContinuationPrompt } from "./continuation-prompt-builder.js";
import {
  detectCompletion,
  detectOverrideToken,
} from "./completion-detector.js";
import { latestAssistantTurnMadeNoProgress } from "./no-progress-detector.js";
import { hasRepeatedSameError } from "./same-error-detector.js";
import { resolveGateInstructions } from "./gate-instructions-resolver.js";
import { buildCompletionPrompt } from "./templates/continuation-prompt.js";
import { buildUltraworkVerificationPrompt } from "./templates/ultrawork-verification.js";
import { buildEpicStoryPrompt } from "./templates/epic-story-prompt.js";
import { buildEpicCompletionPrompt } from "./templates/epic-completion-prompt.js";
import { collectWatcherResult } from "./async-watcher-result-handler.js";
import {
  RunnerOutputSchema,
  type HarnessConfig,
  type HarnessLoopState,
  type RunnerOutput,
  type ParallelWatcherEntry,
  type RunnerStatus,
} from "./types.js";

export interface PluginContext {
  sessionId: string;
  projectRoot: string;
  getMessages(): Array<{ role: string; content: string }>;
  injectMessage(text: string): Promise<void>;
  showToast(message: string, variant: "info" | "warning" | "error"): void;
  hasActiveBackgroundTasks(): boolean;
  latestUserMessageTimestamp(): number;
  spawnWatcher?(
    gate: string,
    config: unknown,
    state: HarnessLoopState,
    taskId?: string
  ): Promise<string>;
  cancelBackgroundTask?(taskId: string): Promise<void>;
  collectBackgroundTaskResult?(taskId: string): Promise<string | null>;
}

const inFlightSessions = new Map<string, Promise<void>>();
const runtimeRetried = new Map<string, number>();
const zombieHintedSessions = new Set<string>();

interface HeartbeatHandle {
  stop(): void;
}

interface HeartbeatOptions {
  ctx: PluginContext;
  gate: string;
  intervalSeconds: number;
  maxHeartbeats: number;
}

function createHeartbeat(opts: HeartbeatOptions): HeartbeatHandle {
  let count = 0;
  let stopped = false;
  const interval = setInterval(() => {
    if (stopped) {
      return;
    }
    if (count >= opts.maxHeartbeats) {
      stop();
      return;
    }
    count += 1;
    const elapsed = count * opts.intervalSeconds;
    opts.ctx.showToast(
      `\u23F3 Still waiting for gate "${opts.gate}" (watcher active ~${elapsed}s)`,
      "info"
    );
  }, opts.intervalSeconds * 1000);
  interval.unref?.();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
  }

  return { stop };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCacheFresh(
  state: HarnessLoopState,
  gate: string,
  cacheTtlMinutes: number
): boolean {
  const checkpoint = state.checkpoints[gate];
  if (!checkpoint) return false;
  if (checkpoint.status !== "PASS") return false;

  const checkedAt = new Date(checkpoint.checked_at).getTime();
  const now = Date.now();
  const ttlMs = cacheTtlMinutes * 60 * 1000;

  return now - checkedAt < ttlMs;
}

function getNextGate(
  config: { gates: string[] },
  currentGate: string,
  runnerOutput: RunnerOutput | null
): string | null {
  if (runnerOutput?.next_gate && config.gates.includes(runnerOutput.next_gate)) {
    return runnerOutput.next_gate;
  }

  const currentIndex = config.gates.indexOf(currentGate);
  if (currentIndex === -1 || currentIndex >= config.gates.length - 1) {
    return null;
  }

  return config.gates[currentIndex + 1] ?? null;
}

function hasParallelTasks(gate: string, config: HarnessConfig): boolean {
  const parallel = config.gate_instructions[gate]?.parallel;
  return Array.isArray(parallel) && parallel.length > 0;
}

async function fanOutParallelWatchers(
  gate: string,
  config: HarnessConfig,
  state: HarnessLoopState,
  ctx: PluginContext
): Promise<void> {
  const tasks = config.gate_instructions[gate]!.parallel!;
  const statePath = getStatePath(ctx.projectRoot);

  for (const task of tasks) {
    const taskId = await ctx.spawnWatcher!(gate, config, state, task.id);
    state.loop.parallel_watchers[task.id] = {
      task_id: taskId,
      status: "pending",
      result: null,
      started_at: new Date().toISOString(),
    };
  }

  writeState(statePath, state);
  ctx.showToast(
    `\u2699\uFE0F Gate "${gate}": launched ${tasks.length} parallel tasks`,
    "info"
  );
}

async function collectAllWatchers(
  _gate: string,
  state: HarnessLoopState,
  ctx: PluginContext
): Promise<"all_done" | "partial" | "early_fail"> {
  const statePath = getStatePath(ctx.projectRoot);
  const watchers = state.loop.parallel_watchers;

  for (const [id, entry] of Object.entries(watchers)) {
    if (entry.status !== "pending") continue;

    const result = await collectWatcherResult(ctx, state, entry.task_id);
    if (result === null) continue;

    entry.status = "done";
    entry.result = result;

    if (
      result.status === "FAIL" ||
      result.status === "BLOCKED" ||
      result.status === "ERROR"
    ) {
      for (const [otherId, otherEntry] of Object.entries(watchers)) {
        if (otherId === id) continue;
        if (otherEntry.status !== "pending") continue;
        if (ctx.cancelBackgroundTask) {
          await ctx.cancelBackgroundTask(otherEntry.task_id);
        }
        otherEntry.status = "cancelled";
      }
      writeState(statePath, state);
      return "early_fail";
    }
  }

  writeState(statePath, state);

  const allSettled = Object.values(watchers).every(
    (w) => w.status === "done" || w.status === "cancelled"
  );
  return allSettled ? "all_done" : "partial";
}

const STATUS_PRECEDENCE: Record<RunnerStatus, number> = {
  BLOCKED: 6,
  FAIL: 5,
  ERROR: 4,
  PASS: 3,
  SKIP: 2,
  WAITING: 1,
};

function mergeParallelResults(
  gate: string,
  watchers: Record<string, ParallelWatcherEntry>
): RunnerOutput {
  const doneResults = Object.values(watchers)
    .filter((w) => w.status === "done" && w.result !== null)
    .map((w) => w.result!);

  if (doneResults.length === 0) {
    return RunnerOutputSchema.parse({
      gate,
      status: "ERROR",
      checks: [],
      rule_ids_violated: ["parallel-all-cancelled"],
      instructions_for_agent:
        "All parallel tasks were cancelled before completing",
    });
  }

  let worstStatus: RunnerStatus = "PASS";
  for (const r of doneResults) {
    if (
      STATUS_PRECEDENCE[r.status] > STATUS_PRECEDENCE[worstStatus]
    ) {
      worstStatus = r.status;
    }
  }

  const allChecks = doneResults.flatMap((r) => r.checks);
  const allRuleIds = [...new Set(doneResults.flatMap((r) => r.rule_ids_violated))];
  const allInstructions = doneResults
    .map((r) => r.instructions_for_agent)
    .filter((s): s is string => !!s);

  const passResult = doneResults.find((r) => r.status === "PASS");

  return RunnerOutputSchema.parse({
    gate,
    status: worstStatus,
    checks: allChecks,
    rule_ids_violated: allRuleIds,
    instructions_for_agent:
      allInstructions.length > 0
        ? allInstructions.join("\n\n---\n\n")
        : undefined,
    next_gate:
      worstStatus === "PASS" ? (passResult?.next_gate ?? null) : null,
  });
}

export async function handleSessionIdle(ctx: PluginContext): Promise<void> {
  const statePath = getStatePath(ctx.projectRoot);
  let state = readState(statePath);

  if (!state || !state.loop.active) {
    return;
  }

  if (state.loop.session_id !== ctx.sessionId) {
    if (!zombieHintedSessions.has(ctx.sessionId)) {
      zombieHintedSessions.add(ctx.sessionId);
      ctx.showToast(
        `⚠️ Harness loop active (session "${state.loop.session_id}" at gate "${state.loop.current_gate}"). Run /harness-on --resume to take over this session.`,
        "warning"
      );
    }
    return;
  }

  const existing = inFlightSessions.get(ctx.sessionId);
  if (existing) {
    await existing;
    return;
  }

  const inflight = (async () => {
    try {
      const now = Date.now();
      const lastUserMessage = ctx.latestUserMessageTimestamp();
      if (now - lastUserMessage < USER_MESSAGE_IN_PROGRESS_WINDOW_MS) {
        return;
      }

      if (ctx.hasActiveBackgroundTasks()) {
        return;
      }

      await sleep(IDLE_SETTLE_MS);

      state = readState(statePath);
      if (!state || !state.loop.active) {
        return;
      }
      if (state.loop.session_id !== ctx.sessionId) {
        return;
      }

      await processLoopIteration(ctx, state);
    } finally {
      inFlightSessions.delete(ctx.sessionId);
    }
  })();
  inFlightSessions.set(ctx.sessionId, inflight);
  await inflight;
}

async function processLoopIteration(
  ctx: PluginContext,
  state: HarnessLoopState
): Promise<void> {
  const controller = createLoopStateController(ctx.projectRoot);
  const config = state.loop.config_snapshot;
  const currentGate = state.loop.current_gate;
  const messages = ctx.getMessages();

  const completion = detectCompletion(
    messages,
    state,
    state.loop.last_runner_output,
    config
  );

  if (completion.source) {
    controller.completeLoop();
    ctx.showToast(
      `🎉 Harness loop complete! (${completion.source})`,
      "info"
    );
    await ctx.injectMessage(buildCompletionPrompt(completion.source));
    return;
  }

  if (completion.liedAboutCompletion) {
    const lastGate = config.gates[config.gates.length - 1];
    ctx.showToast(
      `⚠️ Premature <promise>${config.completion_promise}</promise> rejected: ${completion.lieReason}`,
      "warning"
    );
    await ctx.injectMessage(
      `[HARNESS] You emitted <promise>${config.completion_promise}</promise> but the loop is not actually complete: ${completion.lieReason}. Expected last gate "${lastGate}". Continue executing gate "${currentGate}" — do NOT emit the completion promise again until all gates have PASSed.`
    );
    return;
  }

  const override = detectOverrideToken(messages.slice(state.loop.message_count_at_start));
  if (override.found) {
    controller.setOverrideActive(true);
    controller.cancelLoop();
    ctx.showToast(
      `⏸️ Loop paused by override: ${override.reason ?? "user requested"}`,
      "warning"
    );
    return;
  }

  // When verification is pending, scan for VERIFIED before running runner
  if (state.loop.verification_pending) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant?.content.includes("VERIFIED")) {
      controller.setVerificationPending(false);
      const nextGate = getNextGate(config, currentGate, state.loop.last_runner_output!);
      if (nextGate) {
        controller.transitionToGate(nextGate);
        ctx.showToast(`✓ Gate "${currentGate}" VERIFIED → ${nextGate}`, "info");
      } else {
        controller.completeLoop();
        ctx.showToast(`🏁 All gates verified and complete`, "info");
      }
      return;
    }
    await ctx.injectMessage(buildUltraworkVerificationPrompt(currentGate));
    return;
  }

  const lastRunnerStatus = state.loop.last_runner_output?.status;
  const runnerMadeForwardProgress =
    lastRunnerStatus === "PASS" || lastRunnerStatus === "SKIP";
  if (
    latestAssistantTurnMadeNoProgress(messages) &&
    !runnerMadeForwardProgress
  ) {
    controller.incrementNoProgress();
    state = controller.getState()!;

    if (state.loop.no_progress_count >= 3) {
      controller.cancelLoop();
      ctx.showToast(
        "❌ Loop stopped: No progress detected for 3 consecutive turns",
        "error"
      );
      return;
    }
  } else {
    controller.resetNoProgress();
  }

  if (state.loop.total_iteration >= state.loop.max_total_iterations) {
    controller.cancelLoop();
    ctx.showToast(
      `❌ Loop stopped: Max total iterations (${state.loop.max_total_iterations}) reached`,
      "error"
    );
    return;
  }

  if (state.loop.gate_iteration >= state.loop.max_iterations_per_gate) {
    if (state.loop.epic?.enabled && state.loop.epic.failure_policy === "ask") {
      const currentStoryId = state.loop.epic.current_story_id;
      controller.pauseEpicForFailure(
        `max gate iterations exceeded on ${currentGate}`
      );
      ctx.showToast(
        `⏸️ Story "${currentStoryId}" PAUSED at gate "${currentGate}". Use /harness-on --epic --resume after fix.`,
        "warning"
      );
      return;
    }

    const failPolicy = config.fail_policy;

    if (failPolicy === "ask" || failPolicy === "hybrid") {
      controller.cancelLoop();
      ctx.showToast(
        `⏸️ Loop paused: Gate "${currentGate}" exceeded max iterations (${state.loop.max_iterations_per_gate})`,
        "warning"
      );
      return;
    }
  }

  if (hasRepeatedSameError(state, currentGate)) {
    controller.cancelLoop();
    ctx.showToast(
      `❌ Loop stopped: Same error repeated 3 times on gate "${currentGate}"`,
      "error"
    );
    return;
  }

  if (hasParallelTasks(currentGate, config)) {
    if (Object.keys(state.loop.parallel_watchers).length === 0) {
      if (!ctx.spawnWatcher) return;
      await fanOutParallelWatchers(currentGate, config, state, ctx);
      controller.incrementGateIteration();
      return;
    }

    const collectResult = await collectAllWatchers(currentGate, state, ctx);
    if (collectResult === "partial") {
      return;
    }

    const merged = mergeParallelResults(currentGate, state.loop.parallel_watchers);
    controller.clearWatcherTaskId();
    controller.recordRunnerOutput(merged);

    if (merged.rule_ids_violated.length > 0) {
      controller.recordSameErrorHistory(currentGate, merged.rule_ids_violated);
    }

    await handleRunnerOutput(ctx, controller, state, config, currentGate, merged);
    return;
  }

  const singleWatcher = state.loop.parallel_watchers["__single__"];
  if (singleWatcher && singleWatcher.status === "pending") {
    const watcherResult = await collectWatcherResult(
      ctx,
      state,
      singleWatcher.task_id
    );

    if (watcherResult === null) {
      return;
    }

    controller.clearWatcherTaskId();
    controller.recordRunnerOutput(watcherResult);

    if (watcherResult.rule_ids_violated.length > 0) {
      controller.recordSameErrorHistory(
        currentGate,
        watcherResult.rule_ids_violated
      );
    }

    await handleRunnerOutput(ctx, controller, state, config, currentGate, watcherResult);
    return;
  }

  const gateInstructions = resolveGateInstructions(
    config,
    currentGate,
    ctx.projectRoot
  );

  if (gateInstructions.isAsync && gateInstructions.asyncConfig) {
    if (ctx.spawnWatcher) {
      const taskId = await ctx.spawnWatcher(currentGate, config, state);
      controller.setWatcherTaskId(taskId);
      controller.incrementGateIteration();
      ctx.showToast(
        `\uD83D\uDD50 Watching gate "${currentGate}" via background subagent`,
        "info"
      );

      const maxWaitSeconds = gateInstructions.asyncConfig.maxWaitSeconds;
      const heartbeatsEnabled = config.async_heartbeats;

      if (heartbeatsEnabled) {
        const intervalSeconds = Math.max(
          60,
          Math.floor(maxWaitSeconds / 3)
        );
        const maxHeartbeats = 3;

        const heartbeat = createHeartbeat({
          ctx,
          gate: currentGate,
          intervalSeconds,
          maxHeartbeats,
        });

        const scheduledTaskId = taskId;
        const scheduledGate = currentGate;
        const graceTimeout = setTimeout(async () => {
          heartbeat.stop();

          const refreshedState = controller.getState();
          if (
            refreshedState == null ||
            !refreshedState.loop.active ||
            refreshedState.loop.current_gate !== scheduledGate
          ) {
            return;
          }

          const watcherStillActive = Object.values(
            refreshedState.loop.parallel_watchers
          ).some(
            (w) => w.task_id === scheduledTaskId && w.status === "pending"
          );
          if (!watcherStillActive) {
            return;
          }

          if (ctx.cancelBackgroundTask) {
            await ctx.cancelBackgroundTask(scheduledTaskId);
          }

          const timeoutOutput: RunnerOutput = {
            gate: scheduledGate,
            status: "FAIL",
            checks: [],
            rule_ids_violated: ["watcher-timeout"],
            instructions_for_agent: `Async watcher timed out after ${maxWaitSeconds}s`,
          };

          controller.clearWatcherTaskId();
          controller.recordRunnerOutput(timeoutOutput);

          const prompt = buildContinuationPrompt(
            refreshedState,
            timeoutOutput,
            config,
            ctx.projectRoot
          );
          await ctx.injectMessage(prompt);
          ctx.showToast(
            `\u23F0 Gate "${scheduledGate}" watcher timed out after ${maxWaitSeconds}s`,
            "warning"
          );
        }, (maxWaitSeconds + 30) * 1000);

        graceTimeout.unref?.();
      }

      return;
    }
  }

  const freshStateForCache = controller.getState() ?? state;
  const freshGate = freshStateForCache.loop.current_gate;
  if (
    isCacheFresh(
      freshStateForCache,
      freshGate,
      config.cache_ttl_minutes
    )
  ) {
    const nextGate = getNextGate(config, freshGate, null);

    if (nextGate) {
      controller.transitionToGate(nextGate);
      ctx.showToast(`✓ Gate "${freshGate}" cached PASS → ${nextGate}`, "info");
    } else {
      controller.completeLoop();
      ctx.showToast("🎉 Harness loop complete! (all gates cached PASS)", "info");
      await ctx.injectMessage(buildCompletionPrompt("structural"));
    }
    return;
  }

  const runnerOutput = await invokeRunner(
    config,
    currentGate,
    ctx.projectRoot,
    state.feature_id != null ? { featureId: state.feature_id } : {}
  );

  controller.recordRunnerOutput(runnerOutput);

  if (runnerOutput.rule_ids_violated.length > 0) {
    controller.recordSameErrorHistory(currentGate, runnerOutput.rule_ids_violated);
  }

  await handleRunnerOutput(ctx, controller, state, config, currentGate, runnerOutput);
}

async function handleRunnerOutput(
  ctx: PluginContext,
  controller: LoopStateController,
  state: HarnessLoopState,
  config: HarnessConfig,
  currentGate: string,
  runnerOutput: RunnerOutput
): Promise<void> {
  switch (runnerOutput.status) {
    case "PASS": {
      if (config.ultrawork_verify_gates.includes(currentGate)) {
        controller.setVerificationPending(true);
        await ctx.injectMessage(buildUltraworkVerificationPrompt(currentGate));
        ctx.showToast(
          `🔍 Gate "${currentGate}" PASS — Oracle verification requested`,
          "info"
        );
        return;
      }

      const nextGate = getNextGate(config, currentGate, runnerOutput);

      if (nextGate) {
        controller.transitionToGate(nextGate);
        ctx.showToast(`✓ Gate "${currentGate}" PASS → ${nextGate}`, "info");
      } else if (state.loop.epic?.enabled) {
        const prevId = state.loop.epic.current_story_id;
        const advanced = controller.completeStoryAndAdvance();
        if (advanced) {
          const refreshed = controller.getState()!;
          const done = refreshed.loop.epic!.story_progress.filter(
            (e) => e.status === "completed"
          ).length;
          const total = refreshed.loop.epic!.backlog_snapshot.stories.length;
          ctx.showToast(
            `✅ Story "${prevId}" done → next "${advanced.nextStoryId}" (${done}/${total})`,
            "info"
          );
          await ctx.injectMessage(
            buildEpicStoryPrompt(advanced.nextStoryId, refreshed)
          );
        } else {
          const refreshed = controller.getState()!;
          const done = refreshed.loop.epic!.story_progress.filter(
            (e) => e.status === "completed"
          ).length;
          const total = refreshed.loop.epic!.backlog_snapshot.stories.length;
          ctx.showToast(
            `🏆 Epic "${state.loop.epic.epic_id}" complete! ${done}/${total} stories.`,
            "info"
          );
          controller.completeLoop();
          await ctx.injectMessage(buildEpicCompletionPrompt(refreshed));
        }
      } else {
        controller.completeLoop();
        ctx.showToast("🎉 Harness loop complete!", "info");
        await ctx.injectMessage(buildCompletionPrompt("structural"));
      }
      break;
    }

    case "FAIL":
    case "ERROR": {
      controller.incrementGateIteration();
      controller.incrementTotalIteration();
      const failPrompt = buildContinuationPrompt(
        state,
        runnerOutput,
        config,
        ctx.projectRoot
      );
      await ctx.injectMessage(failPrompt);
      ctx.showToast(
        `❌ Gate "${currentGate}" ${runnerOutput.status} — fix instructions injected`,
        "warning"
      );
      break;
    }

    case "BLOCKED": {
      controller.cancelLoop();
      const blockedPrompt = buildContinuationPrompt(
        state,
        runnerOutput,
        config,
        ctx.projectRoot
      );
      await ctx.injectMessage(blockedPrompt);
      ctx.showToast(
        `⏸️ Gate "${currentGate}" BLOCKED — human input needed`,
        "warning"
      );
      break;
    }

    case "WAITING": {
      const waitSeconds = runnerOutput.wait_seconds ?? 30;
      ctx.showToast(
        `⏳ Gate "${currentGate}" WAITING — retry in ${waitSeconds}s`,
        "info"
      );
      await sleep(waitSeconds * 1000);
      break;
    }

    case "SKIP": {
      const nextGate = getNextGate(config, currentGate, runnerOutput);

      if (nextGate) {
        controller.transitionToGate(nextGate);
        ctx.showToast(`⏭️ Gate "${currentGate}" SKIP → ${nextGate}`, "info");
      } else if (state.loop.epic?.enabled) {
        const prevId = state.loop.epic.current_story_id;
        const advanced = controller.completeStoryAndAdvance();
        if (advanced) {
          const refreshed = controller.getState()!;
          const done = refreshed.loop.epic!.story_progress.filter(
            (e) => e.status === "completed"
          ).length;
          const total = refreshed.loop.epic!.backlog_snapshot.stories.length;
          ctx.showToast(
            `✅ Story "${prevId}" done → next "${advanced.nextStoryId}" (${done}/${total})`,
            "info"
          );
          await ctx.injectMessage(
            buildEpicStoryPrompt(advanced.nextStoryId, refreshed)
          );
        } else {
          const refreshed = controller.getState()!;
          const done = refreshed.loop.epic!.story_progress.filter(
            (e) => e.status === "completed"
          ).length;
          const total = refreshed.loop.epic!.backlog_snapshot.stories.length;
          ctx.showToast(
            `🏆 Epic "${state.loop.epic.epic_id}" complete! ${done}/${total} stories.`,
            "info"
          );
          controller.completeLoop();
          await ctx.injectMessage(buildEpicCompletionPrompt(refreshed));
        }
      } else {
        controller.completeLoop();
        ctx.showToast("🎉 Harness loop complete!", "info");
        await ctx.injectMessage(buildCompletionPrompt("structural"));
      }
      break;
    }
  }
}

export async function handleSessionError(
  ctx: PluginContext,
  error: Error
): Promise<void> {
  const statePath = getStatePath(ctx.projectRoot);
  const state = readState(statePath);

  if (!state || !state.loop.active) {
    return;
  }

  if (state.loop.session_id !== ctx.sessionId) {
    return;
  }

  const retryCount = runtimeRetried.get(ctx.sessionId) ?? 0;

  if (retryCount >= 3) {
    const controller = createLoopStateController(ctx.projectRoot);
    controller.cancelLoop();
    ctx.showToast(`❌ Loop stopped: Too many errors (${error.message})`, "error");
    runtimeRetried.delete(ctx.sessionId);
    return;
  }

  runtimeRetried.set(ctx.sessionId, retryCount + 1);
  ctx.showToast(
    `⚠️ Session error (retry ${retryCount + 1}/3): ${error.message}`,
    "warning"
  );
}

export async function handleSessionDeleted(
  ctx: PluginContext,
  deletedSessionId: string
): Promise<void> {
  const statePath = getStatePath(ctx.projectRoot);
  const state = readState(statePath);

  if (!state || !state.loop.active) {
    return;
  }

  if (state.loop.session_id === deletedSessionId) {
    const controller = createLoopStateController(ctx.projectRoot);
    controller.cancelLoop();
  }
}

import { loadConfig } from "../config-loader.js";
import {
  createLoopStateController,
  LoopAlreadyActiveError,
} from "../loop-state-controller.js";
import { validateAllGateInstructions } from "../gate-instructions-resolver.js";
import { buildOpeningPrompt } from "../templates/opening-prompt.js";
import { buildEpicStoryPrompt } from "../templates/epic-story-prompt.js";
import { createBacklogAdapter } from "../backlog-adapter.js";
import { topologicalSort } from "../topological-sort.js";
import { readState, getStatePath } from "../storage.js";
import type { ConfigOverrides } from "../types.js";
import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";

export interface HarnessOnContext {
  projectRoot: string;
  sessionId: string;
  getMessageCount(): number;
  injectMessage(text: string): Promise<void>;
  showToast(message: string, variant: "info" | "warning" | "error"): void;
}

export interface HarnessOnOptions {
  force?: boolean;
  maxIter?: number;
  skipGate?: string[];
  configPath?: string;
  featureId?: string;
  issueNumber?: number;
  story?: string;
  epic?: boolean;
  epicPath?: string;
  resume?: boolean;
  restart?: boolean;
}

function parseCliArgs(args: string[]): HarnessOnOptions {
  const options: HarnessOnOptions = {};

  for (const arg of args) {
    if (arg === "--force") {
      options.force = true;
    } else if (arg.startsWith("--max-iter=")) {
      options.maxIter = parseInt(arg.slice(11), 10);
    } else if (arg.startsWith("--skip-gate=")) {
      const gates = arg.slice(12).split(",");
      options.skipGate = (options.skipGate ?? []).concat(gates);
    } else if (arg.startsWith("--config=")) {
      options.configPath = arg.slice(9);
    } else if (arg.startsWith("--feature=")) {
      options.featureId = arg.slice(10);
    } else if (arg.startsWith("--issue=")) {
      options.issueNumber = parseInt(arg.slice(8), 10);
    } else if (arg.startsWith("--story=")) {
      options.story = arg.slice(8);
    } else if (arg === "--epic") {
      options.epic = true;
    } else if (arg.startsWith("--epic=")) {
      options.epic = true;
      options.epicPath = arg.slice(7);
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--restart") {
      options.restart = true;
    }
  }

  return options;
}

export async function handleHarnessOn(
  ctx: HarnessOnContext,
  args: string[] = []
): Promise<void> {
  const options = parseCliArgs(args);

  const cliOverrides: ConfigOverrides = {
    ...(options.force !== undefined && { force: options.force }),
    ...(options.maxIter !== undefined && { maxIter: options.maxIter }),
    ...(options.skipGate !== undefined && { skipGate: options.skipGate }),
    ...(options.configPath !== undefined && { configPath: options.configPath }),
  };

  let configResult;
  try {
    configResult = loadConfig(ctx.projectRoot, cliOverrides);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.showToast(`❌ ${message}`, "error");
    return;
  }

  const { config, overrideConsumed } = configResult;

  if (overrideConsumed) {
    ctx.showToast(
      "ℹ️ Applied and removed .opencode/harness.override.json",
      "info"
    );
  }

  const runnerPath = join(ctx.projectRoot, config.runner_path);
  if (!existsSync(runnerPath)) {
    ctx.showToast(`❌ Runner not found: ${config.runner_path}`, "error");
    return;
  }

  try {
    accessSync(runnerPath, constants.X_OK);
  } catch {
    ctx.showToast(
      `❌ Runner not executable: ${config.runner_path} — try \`chmod +x ${config.runner_path}\``,
      "error"
    );
    return;
  }

  const instructionValidation = validateAllGateInstructions(
    config,
    ctx.projectRoot,
    config.strict_instructions
  );

  if (!instructionValidation.valid) {
    ctx.showToast(
      `❌ Missing gate instruction docs:\n${instructionValidation.warnings.join("\n")}`,
      "error"
    );
    return;
  }

  if (instructionValidation.warnings.length > 0) {
    ctx.showToast(
      `⚠️ Some gates have no instruction docs:\n${instructionValidation.warnings.join("\n")}`,
      "warning"
    );
  }

  const controller = createLoopStateController(ctx.projectRoot);

  if (options.epic) {
    if (!config.epic) {
      ctx.showToast(
        "❌ Epic config block required for --epic. Add an 'epic' field to harness.config.json.",
        "error"
      );
      return;
    }

    const epicConfig = { ...config.epic };
    if (options.epicPath) {
      epicConfig.backlog_file = options.epicPath;
    }

    if (options.resume) {
      const statePath = getStatePath(ctx.projectRoot);
      const existingState = readState(statePath);

      if (!existingState?.loop.epic) {
        ctx.showToast(
          "❌ Cannot resume: no preserved epic state. Run /harness-on --epic to start fresh.",
          "error"
        );
        return;
      }

      if (existingState.loop.epic.current_story_id !== null) {
        const storyInBacklog = existingState.loop.epic.backlog_snapshot.stories.find(
          (s) => s.id === existingState.loop.epic!.current_story_id
        );
        if (!storyInBacklog) {
          ctx.showToast(
            `❌ Cannot resume: current story "${existingState.loop.epic.current_story_id}" is not in the preserved backlog`,
            "error"
          );
          return;
        }
      }

      existingState.loop.gate_iteration = 0;
      existingState.loop.active = true;
      existingState.loop.session_id = ctx.sessionId;

      const { writeState } = await import("../storage.js");
      writeState(statePath, existingState);

      const currentStoryId = existingState.loop.epic.current_story_id;
      const currentGate = existingState.loop.current_gate;
      ctx.showToast(
        `▶️ Resuming epic "${existingState.loop.epic.epic_id}" at story "${currentStoryId}" gate "${currentGate}".`,
        "info"
      );
      if (currentStoryId) {
        await ctx.injectMessage(
          buildEpicStoryPrompt(currentStoryId, existingState)
        );
      }
      return;
    }

    let backlog;
    try {
      const adapter = createBacklogAdapter(epicConfig);
      backlog = await adapter.load();
      topologicalSort(backlog.stories);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      ctx.showToast(`❌ ${message}`, "error");
      return;
    }

    try {
      const messageCount = ctx.getMessageCount();

      const state = controller.startLoop(
        ctx.sessionId,
        config,
        undefined,
        undefined,
        undefined,
        messageCount,
        backlog
      );

      const epic = state.loop.epic!;
      ctx.showToast(
        `🚀 Epic "${epic.epic_id}" started: ${epic.backlog_snapshot.stories.length} stories. First: "${epic.current_story_id}".`,
        "info"
      );

      await ctx.injectMessage(
        buildEpicStoryPrompt(epic.current_story_id!, state)
      );
    } catch (e) {
      if (e instanceof LoopAlreadyActiveError) {
        ctx.showToast(
          `❌ Loop already active in session ${e.existingSessionId}. Run /harness-off first.`,
          "error"
        );
      } else {
        throw e;
      }
    }
    return;
  }

  try {
    const messageCount = ctx.getMessageCount();

    controller.startLoop(
      ctx.sessionId,
      config,
      options.featureId,
      options.issueNumber,
      options.story,
      messageCount
    );

    ctx.showToast(
      `🚀 Harness loop started with ${config.gates.length} gates`,
      "info"
    );

    const openingPrompt = buildOpeningPrompt(config, options.featureId ?? null);
    await ctx.injectMessage(openingPrompt);
  } catch (e) {
    if (!(e instanceof LoopAlreadyActiveError)) {
      throw e;
    }

    if (options.resume) {
      controller.rebindSession(ctx.sessionId);
      ctx.showToast(
        `🔄 Resuming loop at gate "${e.existingGate}" (session rebound)`,
        "info"
      );
      return;
    }

    if (options.restart) {
      controller.cancelLoop();

      const messageCount = ctx.getMessageCount();
      controller.startLoop(
        ctx.sessionId,
        config,
        options.featureId,
        options.issueNumber,
        options.story,
        messageCount
      );

      ctx.showToast(
        `🚀 Harness loop restarted with ${config.gates.length} gates`,
        "info"
      );

      const openingPrompt = buildOpeningPrompt(
        config,
        options.featureId ?? null
      );
      await ctx.injectMessage(openingPrompt);
      return;
    }

    ctx.showToast(
      `❌ Loop already active in session ${e.existingSessionId} at gate "${e.existingGate}". Run /harness-on --resume to continue, or /harness-on --restart to wipe and start fresh.`,
      "error"
    );
  }
}

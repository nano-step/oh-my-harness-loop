import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DEFAULT_STATE_FILE_PATH } from "../constants.js";
import type { HarnessConfig, RunnerOutput } from "../types.js";

vi.mock("../runner-invoker.js", () => ({
  invokeRunner: vi.fn(),
}));

vi.mock("../continuation-prompt-builder.js", () => ({
  buildContinuationPrompt: vi.fn().mockReturnValue("fix this"),
}));

vi.mock("../gate-instructions-resolver.js", () => ({
  resolveGateInstructions: vi.fn().mockReturnValue({
    docPath: null,
    skills: [],
    warning: null,
    isAsync: false,
    asyncConfig: null,
  }),
}));

let mockCollectResult: RunnerOutput | null = null;
const collectCalls: string[] = [];

vi.mock("../async-watcher-result-handler.js", () => ({
  collectWatcherResult: vi.fn(async (_ctx: unknown, _state: unknown, taskId: string) => {
    collectCalls.push(taskId);
    return mockCollectResult;
  }),
}));

vi.mock("../templates/continuation-prompt.js", () => ({
  buildCompletionPrompt: vi.fn().mockReturnValue("loop complete"),
}));
vi.mock("../templates/ultrawork-verification.js", () => ({
  buildUltraworkVerificationPrompt: vi.fn().mockReturnValue("verify"),
}));
vi.mock("../templates/opening-prompt.js", () => ({
  buildOpeningPrompt: vi.fn().mockReturnValue("opening"),
}));

vi.mock("../storage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../storage.js")>();
  return {
    ...original,
    clearLoopBlock: (statePath: string) => {
      const state = original.readState(statePath);
      if (state === null) return;
      state.loop.active = false;
      state.loop.current_gate = "";
      state.loop.session_id = "";
      state.updated_at = new Date().toISOString();
      original.writeState(statePath, state);
    },
  };
});

import { handleSessionIdle, type PluginContext } from "../harness-loop-event-handler.js";
import { createLoopStateController } from "../loop-state-controller.js";
import { writeState, readState, getStatePath } from "../storage.js";
import { collectWatcherResult } from "../async-watcher-result-handler.js";
import { loadConfig } from "../config-loader.js";
import { HarnessConfigError } from "../types.js";

const mockedCollectWatcherResult = vi.mocked(collectWatcherResult);

const dirs: string[] = [];

function makeProjectRoot(): string {
  const dir = join(tmpdir(), `harness-parallel-test-${randomUUID()}`);
  mkdirSync(join(dir, ".opencode"), { recursive: true });
  dirs.push(dir);
  return dir;
}

function makeConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    runner_path: "./run.sh",
    gates: ["pre-work", "pre-merge", "post-merge"],
    fail_policy: "auto",
    rule_id_format: "{id}",
    max_total_iterations: 100,
    max_iterations_per_gate: 10,
    auto_fix_attempts: 3,
    cache_ttl_minutes: 0,
    runner_timeout_seconds: 300,
    completion_promise: "HARNESS-COMPLETE",
    ultrawork_verify_gates: [],
    state_file_path: DEFAULT_STATE_FILE_PATH,
    gate_instructions: {},
    phase_hooks: {},
    strict_instructions: false,
    async_heartbeats: false,
    ...overrides,
  };
}

let spawnCallCount = 0;

function makeContext(
  projectRoot: string,
  sessionId: string,
  messages: Array<{ role: string; content: string }> = []
): PluginContext {
  return {
    sessionId,
    projectRoot,
    getMessages: () => messages,
    injectMessage: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
    hasActiveBackgroundTasks: () => false,
    latestUserMessageTimestamp: () => Date.now() - 60_000,
    spawnWatcher: vi.fn(async (_gate: string, _config: unknown, _state: unknown, _taskId?: string) => {
      spawnCallCount += 1;
      return `bg-task-${spawnCallCount}`;
    }),
    cancelBackgroundTask: vi.fn().mockResolvedValue(undefined),
    collectBackgroundTaskResult: vi.fn().mockResolvedValue(null),
  };
}

function startLoop(projectRoot: string, sessionId: string, config: HarnessConfig) {
  return createLoopStateController(projectRoot).startLoop(sessionId, config);
}

function makePassOutput(gate: string, nextGate?: string | null): RunnerOutput {
  return {
    gate,
    status: "PASS",
    checks: [],
    rule_ids_violated: [],
    next_gate: nextGate === undefined ? null : nextGate,
  };
}

function makeFailOutput(gate: string): RunnerOutput {
  return {
    gate,
    status: "FAIL",
    checks: [{ id: "c1", name: "check1", status: "FAIL" }],
    rule_ids_violated: ["R1"],
    instructions_for_agent: "Fix the issue",
  };
}

function makeBlockedOutput(gate: string): RunnerOutput {
  return {
    gate,
    status: "BLOCKED",
    checks: [],
    rule_ids_violated: ["R-BLOCKED"],
    instructions_for_agent: "Blocked by external dep",
  };
}

async function runIdle(ctx: PluginContext): Promise<void> {
  vi.useFakeTimers();
  const p = handleSessionIdle(ctx);
  await vi.runAllTimersAsync();
  await p;
  vi.useRealTimers();
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mockCollectResult = null;
  collectCalls.length = 0;
  spawnCallCount = 0;
  for (const dir of dirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  dirs.length = 0;
});

describe("parallel gate — fan-out", () => {
  it("spawns N watchers and state has N pending entries", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-fanout";
    const config = makeConfig({
      gates: ["pre-merge"],
      gate_instructions: {
        "pre-merge": {
          doc: undefined,
          skills: [],
          async: false,
          async_max_wait_seconds: 1800,
          async_poll_interval_seconds: 60,
          async_subagent_type: "quick",
          force: false,
          parallel: [
            { id: "code-review", async: true, async_subagent_type: "oracle", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
            { id: "run-tests", async: true, async_subagent_type: "quick", async_max_wait_seconds: 180, async_poll_interval_seconds: 60, skills: [] },
          ],
        },
      },
    });

    startLoop(projectRoot, sessionId, config);
    const ctx = makeContext(projectRoot, sessionId);

    await runIdle(ctx);

    const state = readState(getStatePath(projectRoot))!;
    const watchers = state.loop.parallel_watchers;
    expect(Object.keys(watchers)).toHaveLength(2);
    expect(watchers["code-review"]?.status).toBe("pending");
    expect(watchers["run-tests"]?.status).toBe("pending");
    expect(ctx.spawnWatcher).toHaveBeenCalledTimes(2);
  });
});

describe("parallel gate — all-pass", () => {
  it("merges to PASS and advances gate when both watchers return PASS", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-allpass";
    const config = makeConfig({
      gates: ["pre-merge", "post-merge"],
      gate_instructions: {
        "pre-merge": {
          doc: undefined,
          skills: [],
          async: false,
          async_max_wait_seconds: 1800,
          async_poll_interval_seconds: 60,
          async_subagent_type: "quick",
          force: false,
          parallel: [
            { id: "A", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
            { id: "B", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
          ],
        },
      },
    });

    startLoop(projectRoot, sessionId, config);
    const ctx = makeContext(projectRoot, sessionId);

    await runIdle(ctx);

    const stateAfterFanOut = readState(getStatePath(projectRoot))!;
    expect(Object.keys(stateAfterFanOut.loop.parallel_watchers)).toHaveLength(2);

    let callIdx = 0;
    mockedCollectWatcherResult.mockImplementation(async (_ctx, _state, _taskId) => {
      callIdx += 1;
      return makePassOutput("pre-merge");
    });

    await runIdle(ctx);

    const stateAfterMerge = readState(getStatePath(projectRoot))!;
    expect(stateAfterMerge.loop.current_gate).toBe("post-merge");
    expect(stateAfterMerge.loop.parallel_watchers).toEqual({});
  });
});

describe("parallel gate — one-fail cancels others", () => {
  it("returns FAIL with A's checks when A fails and B is pending", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-onefail";
    const config = makeConfig({
      gates: ["pre-merge"],
      gate_instructions: {
        "pre-merge": {
          doc: undefined,
          skills: [],
          async: false,
          async_max_wait_seconds: 1800,
          async_poll_interval_seconds: 60,
          async_subagent_type: "quick",
          force: false,
          parallel: [
            { id: "A", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
            { id: "B", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
          ],
        },
      },
    });

    startLoop(projectRoot, sessionId, config);
    const ctx = makeContext(projectRoot, sessionId);

    await runIdle(ctx);

    let callCount = 0;
    mockedCollectWatcherResult.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return makeFailOutput("pre-merge");
      return null;
    });

    await runIdle(ctx);

    const state = readState(getStatePath(projectRoot))!;
    expect(state.loop.last_runner_output?.status).toBe("FAIL");
    expect(state.loop.last_runner_output?.checks).toHaveLength(1);
    expect(ctx.cancelBackgroundTask).toHaveBeenCalled();
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("FAIL"),
      "warning"
    );
  });
});

describe("parallel gate — early-blocked", () => {
  it("returns BLOCKED when A returns BLOCKED and B is cancelled", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-blocked";
    const config = makeConfig({
      gates: ["pre-merge"],
      gate_instructions: {
        "pre-merge": {
          doc: undefined,
          skills: [],
          async: false,
          async_max_wait_seconds: 1800,
          async_poll_interval_seconds: 60,
          async_subagent_type: "quick",
          force: false,
          parallel: [
            { id: "A", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
            { id: "B", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
          ],
        },
      },
    });

    startLoop(projectRoot, sessionId, config);
    const ctx = makeContext(projectRoot, sessionId);

    await runIdle(ctx);

    let callCount = 0;
    mockedCollectWatcherResult.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return makeBlockedOutput("pre-merge");
      return null;
    });

    await runIdle(ctx);

    const state = readState(getStatePath(projectRoot))!;
    expect(state.loop.active).toBe(false);
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("BLOCKED"),
      "warning"
    );
  });
});

describe("parallel gate — partial-collect", () => {
  it("returns partial on first call, merges on second when both are done", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-partial";
    const config = makeConfig({
      gates: ["pre-merge", "post-merge"],
      gate_instructions: {
        "pre-merge": {
          doc: undefined,
          skills: [],
          async: false,
          async_max_wait_seconds: 1800,
          async_poll_interval_seconds: 60,
          async_subagent_type: "quick",
          force: false,
          parallel: [
            { id: "A", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
            { id: "B", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
          ],
        },
      },
    });

    startLoop(projectRoot, sessionId, config);
    const ctx = makeContext(projectRoot, sessionId);

    await runIdle(ctx);

    let callIdx = 0;
    mockedCollectWatcherResult.mockImplementation(async (_ctx, _state, _taskId) => {
      callIdx += 1;
      if (callIdx === 1) return makePassOutput("pre-merge");
      return null;
    });

    await runIdle(ctx);

    const statePartial = readState(getStatePath(projectRoot))!;
    expect(statePartial.loop.current_gate).toBe("pre-merge");
    const aEntry = Object.values(statePartial.loop.parallel_watchers).find(
      (e) => e.status === "done"
    );
    expect(aEntry).toBeDefined();

    mockedCollectWatcherResult.mockImplementation(async () => {
      return makePassOutput("pre-merge");
    });

    await runIdle(ctx);

    const stateFinal = readState(getStatePath(projectRoot))!;
    expect(stateFinal.loop.current_gate).toBe("post-merge");
  });
});

describe("parallel gate — resume-after-crash", () => {
  it("re-collects only pending watcher and reuses done result", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-resume";
    const config = makeConfig({
      gates: ["pre-merge", "post-merge"],
      gate_instructions: {
        "pre-merge": {
          doc: undefined,
          skills: [],
          async: false,
          async_max_wait_seconds: 1800,
          async_poll_interval_seconds: 60,
          async_subagent_type: "quick",
          force: false,
          parallel: [
            { id: "A", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
            { id: "B", async: true, async_subagent_type: "quick", async_max_wait_seconds: 300, async_poll_interval_seconds: 60, skills: [] },
          ],
        },
      },
    });

    const controller = createLoopStateController(projectRoot);
    controller.startLoop(sessionId, config);
    const statePath = getStatePath(projectRoot);
    const state = readState(statePath)!;

    state.loop.parallel_watchers = {
      A: {
        task_id: "bg-A",
        status: "done",
        result: makePassOutput("pre-merge"),
        started_at: new Date().toISOString(),
      },
      B: {
        task_id: "bg-B",
        status: "pending",
        result: null,
        started_at: new Date().toISOString(),
      },
    };
    writeState(statePath, state);

    mockedCollectWatcherResult.mockImplementation(async (_ctx, _state, taskId) => {
      if (taskId === "bg-B") return makePassOutput("pre-merge");
      return null;
    });

    const ctx = makeContext(projectRoot, sessionId);
    await runIdle(ctx);

    const finalState = readState(statePath)!;
    expect(finalState.loop.current_gate).toBe("post-merge");
    expect(ctx.spawnWatcher).not.toHaveBeenCalled();
  });
});

describe("parallel gate — backward-compat migration", () => {
  it("migrates watcher_task_id to parallel_watchers.__legacy__", () => {
    const projectRoot = makeProjectRoot();
    const statePath = getStatePath(projectRoot);

    const rawState = {
      feature_id: null,
      issue_number: null,
      story: null,
      updated_at: new Date().toISOString(),
      checkpoints: {},
      loop: {
        active: false,
        current_gate: "pre-merge",
        gate_iteration: 1,
        total_iteration: 1,
        max_iterations_per_gate: 10,
        max_total_iterations: 100,
        started_at: new Date().toISOString(),
        session_id: "sess-legacy",
        config_snapshot: {
          runner_path: "./run.sh",
          gates: ["pre-merge"],
          fail_policy: "hybrid",
          rule_id_format: "{id}",
          max_total_iterations: 100,
          max_iterations_per_gate: 10,
          auto_fix_attempts: 3,
          cache_ttl_minutes: 30,
          runner_timeout_seconds: 300,
          completion_promise: "HARNESS-COMPLETE",
          ultrawork_verify_gates: [],
          state_file_path: ".opencode/harness-loop.local.json",
          gate_instructions: {},
          phase_hooks: {},
          strict_instructions: false,
          async_heartbeats: true,
        },
        last_runner_output: null,
        no_progress_count: 0,
        override_active: false,
        same_error_history: {},
        verification_pending: false,
        watcher_task_id: "task_xyz",
        message_count_at_start: 0,
      },
    };

    writeFileSync(statePath, JSON.stringify(rawState), "utf-8");

    const loaded = readState(statePath);
    expect(loaded).not.toBeNull();
    const legacy = loaded!.loop.parallel_watchers["__legacy__"];
    expect(legacy).toBeDefined();
    expect(legacy!.task_id).toBe("task_xyz");
    expect(legacy!.status).toBe("pending");
    expect((loaded!.loop as unknown as Record<string, unknown>)["watcher_task_id"]).toBeUndefined();
  });
});

describe("parallel gate — empty-parallel", () => {
  it("falls through to normal gate logic when parallel is empty array", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-empty";
    const config = makeConfig({
      gates: ["pre-merge"],
      gate_instructions: {
        "pre-merge": {
          doc: undefined,
          skills: [],
          async: false,
          async_max_wait_seconds: 1800,
          async_poll_interval_seconds: 60,
          async_subagent_type: "quick",
          force: false,
          parallel: [],
        },
      },
    });

    const { invokeRunner } = await import("../runner-invoker.js");
    const mockedRunner = vi.mocked(invokeRunner);
    mockedRunner.mockResolvedValueOnce(makePassOutput("pre-merge", null));

    startLoop(projectRoot, sessionId, config);
    const ctx = makeContext(projectRoot, sessionId);

    await runIdle(ctx);

    expect(mockedRunner).toHaveBeenCalled();
    expect(ctx.spawnWatcher).not.toHaveBeenCalled();
  });
});

describe("parallel gate — no-parallel key", () => {
  it("uses existing single-task path when gate has no parallel key", async () => {
    const projectRoot = makeProjectRoot();
    const sessionId = "sess-noparallel";
    const config = makeConfig({
      gates: ["pre-work"],
      gate_instructions: {},
    });

    const { invokeRunner } = await import("../runner-invoker.js");
    const mockedRunner = vi.mocked(invokeRunner);
    mockedRunner.mockResolvedValueOnce(makePassOutput("pre-work", null));

    startLoop(projectRoot, sessionId, config);
    const ctx = makeContext(projectRoot, sessionId);

    await runIdle(ctx);

    expect(mockedRunner).toHaveBeenCalledOnce();
    expect(ctx.spawnWatcher).not.toHaveBeenCalled();
    expect(readState(getStatePath(projectRoot))).toBeNull();
  });
});

describe("config-loader — parallel validation", () => {
  it("throws HarnessConfigError on duplicate parallel task IDs", () => {
    const dir = makeProjectRoot();
    writeFileSync(
      join(dir, ".opencode", "harness.config.json"),
      JSON.stringify({
        runner_path: "./run.sh",
        gates: ["pre-merge"],
        gate_instructions: {
          "pre-merge": {
            parallel: [
              { id: "dup", async: true },
              { id: "dup", async: true },
            ],
          },
        },
      }),
      "utf-8"
    );

    expect(() => loadConfig(dir)).toThrow(HarnessConfigError);
    expect(() => loadConfig(dir)).toThrow(/Duplicate parallel task id 'dup'/);
  });

  it("overrides async: false to true with a warning", () => {
    const dir = makeProjectRoot();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    writeFileSync(
      join(dir, ".opencode", "harness.config.json"),
      JSON.stringify({
        runner_path: "./run.sh",
        gates: ["pre-merge"],
        gate_instructions: {
          "pre-merge": {
            parallel: [{ id: "task-a", async: false }],
          },
        },
      }),
      "utf-8"
    );

    const result = loadConfig(dir);
    const gateConfig = result.config.gate_instructions["pre-merge"];
    expect(gateConfig).toBeDefined();
    const parallel = gateConfig!.parallel;
    expect(parallel).toBeDefined();
    expect(parallel![0]!.async).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("async: false")
    );
    warnSpy.mockRestore();
  });
});

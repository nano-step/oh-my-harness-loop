import {
  readState,
  writeState,
  clearLoopBlock,
  createInitialState,
  getStatePath,
} from "./storage.js";
import {
  SAME_ERROR_HISTORY_WINDOW,
} from "./constants.js";
import type {
  Backlog,
  HarnessConfig,
  HarnessLoopState,
  LoopMeta,
  RunnerOutput,
} from "./types.js";
import { topologicalSort } from "./topological-sort.js";
import { DEFAULT_MAX_ITERATIONS_PER_EPIC } from "./constants.js";

export class LoopAlreadyActiveError extends Error {
  constructor(
    public readonly existingSessionId: string,
    public readonly existingGate: string
  ) {
    super(
      `Loop already active in session ${existingSessionId} at gate ${existingGate}`
    );
    this.name = "LoopAlreadyActiveError";
  }
}

export interface LoopStateController {
  getState(): HarnessLoopState | null;
  isActive(): boolean;
  startLoop(
    sessionId: string,
    config: HarnessConfig,
    featureId?: string,
    issueNumber?: number,
    story?: string,
    messageCountAtStart?: number,
    epicBacklog?: Backlog
  ): HarnessLoopState;
  cancelLoop(opts?: { clean?: boolean }): void;
  completeStoryAndAdvance(): { nextStoryId: string } | null;
  pauseEpicForFailure(reason: string): void;
  incrementGateIteration(): void;
  incrementTotalIteration(): void;
  transitionToGate(nextGate: string): void;
  recordRunnerOutput(output: RunnerOutput): void;
  incrementNoProgress(): void;
  resetNoProgress(): void;
  recordSameErrorHistory(gate: string, ruleIds: string[]): void;
  setVerificationPending(pending: boolean): void;
  setWatcherTaskId(taskId: string | null): void;
  clearWatcherTaskId(): void;
  setOverrideActive(active: boolean): void;
  rebindSession(newSessionId: string): void;
}

export function createLoopStateController(
  projectRoot: string,
  customStatePath?: string
): LoopStateController {
  const statePath = getStatePath(projectRoot, customStatePath);

  function getState(): HarnessLoopState | null {
    return readState(statePath);
  }

  function isActive(): boolean {
    const state = getState();
    return state?.loop.active === true;
  }

  function startLoop(
    sessionId: string,
    config: HarnessConfig,
    featureId?: string,
    issueNumber?: number,
    story?: string,
    messageCountAtStart = 0,
    epicBacklog?: Backlog
  ): HarnessLoopState {
    let state = getState();

    if (state?.loop.active) {
      throw new LoopAlreadyActiveError(
        state.loop.session_id,
        state.loop.current_gate
      );
    }

    if (state === null) {
      state = createInitialState(
        featureId ?? null,
        issueNumber ?? null,
        story ?? null
      );
    } else {
      state.feature_id = featureId ?? state.feature_id;
      state.issue_number = issueNumber ?? state.issue_number;
      state.story = story ?? state.story;
    }

    const firstGate = config.gates[0];
    if (firstGate === undefined) {
      throw new Error("Config must have at least one gate");
    }

    const loopMeta: LoopMeta = {
      active: true,
      current_gate: firstGate,
      gate_iteration: 1,
      total_iteration: 1,
      max_iterations_per_gate: config.max_iterations_per_gate,
      max_total_iterations: config.max_total_iterations,
      started_at: new Date().toISOString(),
      session_id: sessionId,
      config_snapshot: config,
      last_runner_output: null,
      no_progress_count: 0,
      override_active: false,
      same_error_history: {},
      verification_pending: false,
      parallel_watchers: {},
      message_count_at_start: messageCountAtStart,
    };

    if (epicBacklog) {
      const sorted = topologicalSort(epicBacklog.stories);
      const sortedBacklog: Backlog = { ...epicBacklog, stories: sorted };
      const firstStory = sorted[0]!;

      loopMeta.epic = {
        enabled: true,
        epic_id: epicBacklog.epic_id,
        current_story_id: firstStory.id,
        story_progress: [
          {
            story_id: firstStory.id,
            status: "in_progress",
            started_at: new Date().toISOString(),
          },
        ],
        backlog_snapshot: sortedBacklog,
        failure_policy: "ask",
        max_iterations_per_epic:
          config.epic?.max_iterations_per_epic ?? DEFAULT_MAX_ITERATIONS_PER_EPIC,
        epic_iteration_total: 0,
      };

      state.feature_id = firstStory.feature_id ?? null;
      state.issue_number = firstStory.issue_number ?? null;
      state.story = firstStory.story ?? null;
      state.checkpoints = {};
    }

    state.loop = loopMeta;
    writeState(statePath, state);

    return state;
  }

  function cancelLoop(opts?: { clean?: boolean }): void {
    clearLoopBlock(statePath, opts);
  }

  function updateLoop(updater: (loop: LoopMeta) => void): void {
    const state = getState();
    if (state === null || !state.loop.active) {
      return;
    }

    updater(state.loop);
    writeState(statePath, state);
  }

  function incrementGateIteration(): void {
    updateLoop((loop) => {
      loop.gate_iteration += 1;
    });
  }

  function incrementTotalIteration(): void {
    updateLoop((loop) => {
      loop.total_iteration += 1;
    });
  }

  function transitionToGate(nextGate: string): void {
    updateLoop((loop) => {
      const previousGate = loop.current_gate;

      loop.current_gate = nextGate;
      loop.gate_iteration = 1;
      loop.total_iteration += 1;

      if (
        previousGate &&
        loop.same_error_history[previousGate] !== undefined
      ) {
        delete loop.same_error_history[previousGate];
      }

      loop.verification_pending = false;
      loop.parallel_watchers = {};
    });
  }

  function recordRunnerOutput(output: RunnerOutput): void {
    const state = getState();
    if (state === null || !state.loop.active) {
      return;
    }

    state.loop.last_runner_output = output;

    const gate = output.gate;
    if (!state.checkpoints[gate]) {
      state.checkpoints[gate] = {
        status: output.status,
        checked_at: new Date().toISOString(),
        checks: {},
      };
    } else {
      state.checkpoints[gate].status = output.status;
      state.checkpoints[gate].checked_at = new Date().toISOString();
    }

    writeState(statePath, state);
  }

  function incrementNoProgress(): void {
    updateLoop((loop) => {
      loop.no_progress_count += 1;
    });
  }

  function resetNoProgress(): void {
    updateLoop((loop) => {
      loop.no_progress_count = 0;
    });
  }

  function recordSameErrorHistory(gate: string, ruleIds: string[]): void {
    if (ruleIds.length === 0) {
      return;
    }

    updateLoop((loop) => {
      if (!loop.same_error_history[gate]) {
        loop.same_error_history[gate] = [];
      }

      loop.same_error_history[gate].push(ruleIds);

      if (loop.same_error_history[gate].length > SAME_ERROR_HISTORY_WINDOW) {
        loop.same_error_history[gate] = loop.same_error_history[gate].slice(
          -SAME_ERROR_HISTORY_WINDOW
        );
      }
    });
  }

  function setVerificationPending(pending: boolean): void {
    updateLoop((loop) => {
      loop.verification_pending = pending;
    });
  }

  function setWatcherTaskId(taskId: string | null): void {
    updateLoop((loop) => {
      if (taskId) {
        loop.parallel_watchers["__single__"] = {
          task_id: taskId,
          status: "pending",
          result: null,
          started_at: new Date().toISOString(),
        };
      } else {
        loop.parallel_watchers = {};
      }
    });
  }

  function clearWatcherTaskId(): void {
    updateLoop((loop) => {
      loop.parallel_watchers = {};
    });
  }

  function setOverrideActive(active: boolean): void {
    updateLoop((loop) => {
      loop.override_active = active;
    });
  }

  function rebindSession(newSessionId: string): void {
    updateLoop((loop) => {
      loop.session_id = newSessionId;
    });
  }

  function completeStoryAndAdvance(): { nextStoryId: string } | null {
    const state = getState();
    if (!state?.loop.active || !state.loop.epic?.enabled) return null;

    const epic = state.loop.epic;
    const completedAt = new Date().toISOString();

    const currentEntry = epic.story_progress.find(
      (e) => e.story_id === epic.current_story_id
    );
    if (currentEntry) {
      currentEntry.status = "completed";
      currentEntry.completed_at = completedAt;
      currentEntry.gate_reached = state.loop.current_gate;
    }

    if (epic.epic_iteration_total >= epic.max_iterations_per_epic) {
      pauseEpicForFailure("max_iterations_per_epic exceeded");
      return null;
    }

    const finishedIds = new Set(
      epic.story_progress
        .filter((e) => e.status === "completed")
        .map((e) => e.story_id)
    );
    const blockedIds = new Set(
      epic.story_progress
        .filter((e) => ["failed", "blocked", "skipped"].includes(e.status))
        .map((e) => e.story_id)
    );

    const nextStory = epic.backlog_snapshot.stories.find(
      (s) =>
        !finishedIds.has(s.id) &&
        !blockedIds.has(s.id) &&
        s.id !== epic.current_story_id &&
        s.depends_on.every((d) => finishedIds.has(d))
    );

    if (!nextStory) {
      writeState(statePath, state);
      return null;
    }

    state.loop.gate_iteration = 1;
    state.loop.current_gate = state.loop.config_snapshot.gates[0]!;
    state.loop.no_progress_count = 0;
    state.loop.same_error_history = {};
    state.loop.parallel_watchers = {};
    state.loop.last_runner_output = null;
    state.loop.verification_pending = false;

    state.loop.epic.epic_iteration_total += 1;

    state.loop.epic.current_story_id = nextStory.id;
    state.loop.epic.story_progress.push({
      story_id: nextStory.id,
      status: "in_progress",
      started_at: completedAt,
    });

    state.feature_id = nextStory.feature_id ?? null;
    state.issue_number = nextStory.issue_number ?? null;
    state.story = nextStory.story ?? null;
    state.checkpoints = {};

    writeState(statePath, state);
    return { nextStoryId: nextStory.id };
  }

  function pauseEpicForFailure(_reason: string): void {
    const state = getState();
    if (!state?.loop.epic) return;
    const entry = state.loop.epic.story_progress.find(
      (e) => e.story_id === state.loop.epic!.current_story_id
    );
    if (entry) {
      entry.status = "failed";
      entry.gate_reached = state.loop.current_gate;
    }
    state.loop.active = false;
    writeState(statePath, state);
  }

  return {
    getState,
    isActive,
    startLoop,
    cancelLoop,
    completeStoryAndAdvance,
    pauseEpicForFailure,
    incrementGateIteration,
    incrementTotalIteration,
    transitionToGate,
    recordRunnerOutput,
    incrementNoProgress,
    resetNoProgress,
    recordSameErrorHistory,
    setVerificationPending,
    setWatcherTaskId,
    clearWatcherTaskId,
    setOverrideActive,
    rebindSession,
  };
}

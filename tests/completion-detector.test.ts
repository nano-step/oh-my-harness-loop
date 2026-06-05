import { describe, it, expect } from "vitest";
import {
  detectCompletion,
  detectOverrideToken,
} from "../completion-detector.js";
import type { HarnessConfig, HarnessLoopState } from "../types.js";

function makeConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    runner_path: "./run.sh",
    gates: ["gate-a", "gate-b"],
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
    ...overrides,
  };
}

function makeState(overrides: Partial<HarnessLoopState["loop"]> = {}): HarnessLoopState {
  const loop = {
    active: true,
    current_gate: "gate-a",
    gate_iteration: 1,
    total_iteration: 1,
    max_iterations_per_gate: 10,
    max_total_iterations: 100,
    started_at: new Date().toISOString(),
    session_id: "sess-001",
    config_snapshot: makeConfig(),
    last_runner_output: null,
    no_progress_count: 0,
    override_active: false,
    same_error_history: {},
    verification_pending: false,
    parallel_watchers: {},
    message_count_at_start: 0,
    ...overrides,
  };
  return {
    feature_id: null,
    issue_number: null,
    story: null,
    updated_at: new Date().toISOString(),
    checkpoints: {},
    loop,
  };
}

function makeStateAtLastGateAllPassed(): HarnessLoopState {
  return {
    feature_id: null,
    issue_number: null,
    story: null,
    updated_at: new Date().toISOString(),
    checkpoints: {
      "gate-a": { status: "PASS", checked_at: new Date().toISOString(), checks: {} },
      "gate-b": { status: "PASS", checked_at: new Date().toISOString(), checks: {} },
    },
    loop: {
      active: true,
      current_gate: "gate-b",
      gate_iteration: 1,
      total_iteration: 2,
      max_iterations_per_gate: 10,
      max_total_iterations: 100,
      started_at: new Date().toISOString(),
      session_id: "sess-001",
      config_snapshot: makeConfig(),
      last_runner_output: {
        gate: "gate-b",
        status: "PASS",
        checks: [],
        next_gate: null,
        rule_ids_violated: [],
      },
      no_progress_count: 0,
      override_active: false,
      same_error_history: {},
      verification_pending: false,
      parallel_watchers: {},
      message_count_at_start: 0,
    },
  };
}

describe("detectCompletion — promise tag with structural guard", () => {
  it("returns 'promise_tag' source when tag present AND all gates passed AND at last gate AND runner PASS", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeStateAtLastGateAllPassed();
    const messages = [
      { role: "user", content: "please finish" },
      { role: "assistant", content: "Done! <promise>HARNESS-COMPLETE</promise>" },
    ];

    const result = detectCompletion(messages, state, state.loop.last_runner_output, config);

    expect(result.source).toBe("promise_tag");
    expect(result.liedAboutCompletion).toBe(false);
  });

  it("returns null source when promise tag is absent", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeState({ message_count_at_start: 0 });
    const messages = [
      { role: "assistant", content: "Still working..." },
    ];

    const result = detectCompletion(messages, state, null, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(false);
  });

  it("returns null source when promise tag is only in messages before messageCountAtStart", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeState({ message_count_at_start: 2 });
    const messages = [
      { role: "assistant", content: "<promise>HARNESS-COMPLETE</promise>" },
      { role: "user", content: "ok, continue" },
      { role: "assistant", content: "Starting new loop iteration." },
    ];

    const result = detectCompletion(messages, state, null, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(false);
  });

  it("REJECTS premature promise tag when not at last gate (sets liedAboutCompletion)", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeState({
      current_gate: "gate-a",
      message_count_at_start: 0,
    });
    const messages = [
      { role: "assistant", content: "Done! <promise>HARNESS-COMPLETE</promise>" },
    ];

    const result = detectCompletion(messages, state, null, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(true);
    expect(result.lieReason).toContain("gate-a");
    expect(result.lieReason).toContain("gate-b");
  });

  it("REJECTS premature promise tag when at last gate but not all gates passed", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeState({
      current_gate: "gate-b",
      message_count_at_start: 0,
      last_runner_output: {
        gate: "gate-b",
        status: "PASS",
        checks: [],
        next_gate: null,
        rule_ids_violated: [],
      },
    });
    const messages = [
      { role: "assistant", content: "<promise>HARNESS-COMPLETE</promise>" },
    ];

    const result = detectCompletion(messages, state, state.loop.last_runner_output, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(true);
    expect(result.lieReason).toContain("gate-a");
  });

  it("REJECTS promise tag when last_runner_output is stale (different gate)", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state: HarnessLoopState = {
      ...makeStateAtLastGateAllPassed(),
    };
    state.loop.last_runner_output = {
      gate: "gate-a",
      status: "PASS",
      checks: [],
      next_gate: null,
      rule_ids_violated: [],
    };
    const messages = [
      { role: "assistant", content: "<promise>HARNESS-COMPLETE</promise>" },
    ];

    const result = detectCompletion(messages, state, state.loop.last_runner_output, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(true);
    expect(result.lieReason).toContain("stale");
  });

  it("REJECTS promise tag when runnerOutput.status is FAIL", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeStateAtLastGateAllPassed();
    state.loop.last_runner_output = {
      gate: "gate-b",
      status: "FAIL",
      checks: [],
      next_gate: null,
      rule_ids_violated: ["R3.2"],
    };
    const messages = [
      { role: "assistant", content: "<promise>HARNESS-COMPLETE</promise>" },
    ];

    const result = detectCompletion(messages, state, state.loop.last_runner_output, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(true);
    expect(result.lieReason).toContain("FAIL");
  });

  it("REJECTS promise tag when runnerOutput.next_gate is non-null", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeStateAtLastGateAllPassed();
    state.loop.last_runner_output = {
      gate: "gate-b",
      status: "PASS",
      checks: [],
      next_gate: "extra-gate",
      rule_ids_violated: [],
    };
    const messages = [
      { role: "assistant", content: "<promise>HARNESS-COMPLETE</promise>" },
    ];

    const result = detectCompletion(messages, state, state.loop.last_runner_output, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(true);
    expect(result.lieReason).toContain("next_gate");
  });
});

describe("detectCompletion — structural completion", () => {
  it("returns 'structural' source when no tag but state at last gate with PASS runner output", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeStateAtLastGateAllPassed();
    const messages = [{ role: "assistant", content: "Working on it" }];

    const result = detectCompletion(messages, state, state.loop.last_runner_output, config);

    expect(result.source).toBe("structural");
    expect(result.liedAboutCompletion).toBe(false);
  });

  it("returns null source when runner has not yet produced PASS at last gate", () => {
    const config = makeConfig({ completion_promise: "HARNESS-COMPLETE" });
    const state = makeState({ current_gate: "gate-a" });
    const messages = [{ role: "assistant", content: "Working" }];

    const result = detectCompletion(messages, state, null, config);

    expect(result.source).toBeNull();
    expect(result.liedAboutCompletion).toBe(false);
  });
});

describe("detectOverrideToken", () => {
  it("returns found=true and extracts reason from last assistant message", () => {
    const messages = [
      { role: "user", content: "fix it" },
      { role: "assistant", content: "I tried but failed.\n[HARNESS-OVERRIDE]: blocked by external dependency" },
    ];

    const result = detectOverrideToken(messages);

    expect(result.found).toBe(true);
    expect(result.reason).toBe("blocked by external dependency");
  });

  it("returns found=false when no override token present", () => {
    const messages = [
      { role: "assistant", content: "All done, no issues." },
    ];

    const result = detectOverrideToken(messages);

    expect(result.found).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("finds override token in any assistant message, not just the last", () => {
    const messages = [
      { role: "assistant", content: "[HARNESS-OVERRIDE]: earlier override" },
      { role: "user", content: "ok" },
      { role: "assistant", content: "No override here." },
    ];

    const result = detectOverrideToken(messages);

    expect(result.found).toBe(true);
    expect(result.reason).toBe("earlier override");
  });

  it("returns found=false when message list is empty", () => {
    const result = detectOverrideToken([]);

    expect(result.found).toBe(false);
    expect(result.reason).toBeNull();
  });
});

describe("L1: detectOverrideToken — inline match + all-message scan", () => {
  it("matches override token inline (not just at start of line)", () => {
    const messages = [
      { role: "assistant", content: "Note: [HARNESS-OVERRIDE]: blocked by external dependency" },
    ];
    const result = detectOverrideToken(messages);
    expect(result.found).toBe(true);
    expect(result.reason).toBe("blocked by external dependency");
  });

  it("finds override in an earlier assistant message, not just the last one", () => {
    const messages = [
      { role: "assistant", content: "[HARNESS-OVERRIDE]: api is down" },
      { role: "user", content: "ok" },
      { role: "assistant", content: "Continuing work..." },
    ];
    const result = detectOverrideToken(messages);
    expect(result.found).toBe(true);
    expect(result.reason).toBe("api is down");
  });
});

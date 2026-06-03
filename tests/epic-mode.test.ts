import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DEFAULT_STATE_FILE_PATH } from "../constants.js";
import { topologicalSort } from "../topological-sort.js";
import { FileBacklogAdapter, createBacklogAdapter } from "../backlog-adapter.js";
import { createLoopStateController } from "../loop-state-controller.js";

import { buildEpicStoryPrompt } from "../templates/epic-story-prompt.js";
import {
  buildEpicCompletionPrompt,
  buildEpicPausePrompt,
} from "../templates/epic-completion-prompt.js";
import {
  HarnessConfigError,
  type HarnessConfig,
  type Backlog,
  type BacklogStory,
} from "../types.js";

const dirs: string[] = [];

function makeProjectRoot(): string {
  const dir = join(tmpdir(), `harness-epic-test-${randomUUID()}`);
  mkdirSync(join(dir, ".opencode"), { recursive: true });
  dirs.push(dir);
  return dir;
}

function makeConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    runner_path: "./run.sh",
    gates: ["pre-work", "in-progress", "pre-merge", "post-merge", "next-ready"],
    fail_policy: "hybrid",
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

function makeBacklog(overrides: Partial<Backlog> = {}): Backlog {
  return {
    epic_id: "EPIC-1",
    title: "Test Epic",
    stories: [
      { id: "S1", title: "Story 1", depends_on: [] },
      { id: "S2", title: "Story 2", depends_on: ["S1"] },
      { id: "S3", title: "Story 3", depends_on: ["S2"] },
    ],
    ...overrides,
  };
}

function writeBacklogFile(projectRoot: string, backlog: unknown, filename = ".opencode/harness.epic.json"): string {
  const filePath = join(projectRoot, filename);
  mkdirSync(join(projectRoot, ".opencode"), { recursive: true });
  writeFileSync(filePath, JSON.stringify(backlog), "utf-8");
  return filePath;
}

afterEach(() => {
  for (const dir of dirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  dirs.length = 0;
});

// =============================================================================
// Topological Sort
// =============================================================================

describe("topologicalSort", () => {
  it("sorts a linear chain correctly", () => {
    const stories: BacklogStory[] = [
      { id: "A", title: "A", depends_on: [] },
      { id: "B", title: "B", depends_on: ["A"] },
      { id: "C", title: "C", depends_on: ["B"] },
    ];
    const sorted = topologicalSort(stories);
    expect(sorted.map((s) => s.id)).toEqual(["A", "B", "C"]);
  });

  it("sorts a fan-in dependency correctly", () => {
    const stories: BacklogStory[] = [
      { id: "A", title: "A", depends_on: [] },
      { id: "B", title: "B", depends_on: [] },
      { id: "C", title: "C", depends_on: ["A", "B"] },
    ];
    const sorted = topologicalSort(stories);
    expect(sorted[sorted.length - 1]!.id).toBe("C");
    expect(sorted.length).toBe(3);
  });

  it("sorts a single node", () => {
    const stories: BacklogStory[] = [
      { id: "X", title: "X", depends_on: [] },
    ];
    const sorted = topologicalSort(stories);
    expect(sorted.map((s) => s.id)).toEqual(["X"]);
  });

  it("throws on cycle (A→B→A)", () => {
    const stories: BacklogStory[] = [
      { id: "A", title: "A", depends_on: ["B"] },
      { id: "B", title: "B", depends_on: ["A"] },
    ];
    expect(() => topologicalSort(stories)).toThrow(HarnessConfigError);
    expect(() => topologicalSort(stories)).toThrow(/cycle/i);
  });

  it("throws on missing dep reference", () => {
    const stories: BacklogStory[] = [
      { id: "A", title: "A", depends_on: ["NONEXISTENT"] },
    ];
    expect(() => topologicalSort(stories)).toThrow(HarnessConfigError);
    expect(() => topologicalSort(stories)).toThrow(/NONEXISTENT/);
  });
});

// =============================================================================
// FileBacklogAdapter
// =============================================================================

describe("FileBacklogAdapter", () => {
  it("loads a valid backlog file", async () => {
    const root = makeProjectRoot();
    const backlog = makeBacklog();
    writeBacklogFile(root, backlog);
    const adapter = new FileBacklogAdapter(join(root, ".opencode/harness.epic.json"));
    const result = await adapter.load();
    expect(result.epic_id).toBe("EPIC-1");
    expect(result.stories.length).toBe(3);
  });

  it("throws on missing file", async () => {
    const adapter = new FileBacklogAdapter("/nonexistent/path.json");
    await expect(adapter.load()).rejects.toThrow(HarnessConfigError);
    await expect(adapter.load()).rejects.toThrow(/not found/);
  });

  it("throws on malformed JSON", async () => {
    const root = makeProjectRoot();
    const filePath = join(root, ".opencode/harness.epic.json");
    writeFileSync(filePath, "not json{{{", "utf-8");
    const adapter = new FileBacklogAdapter(filePath);
    await expect(adapter.load()).rejects.toThrow(HarnessConfigError);
    await expect(adapter.load()).rejects.toThrow(/not valid JSON/);
  });

  it("throws on schema validation failure (empty stories)", async () => {
    const root = makeProjectRoot();
    writeBacklogFile(root, { epic_id: "E1", stories: [] });
    const adapter = new FileBacklogAdapter(join(root, ".opencode/harness.epic.json"));
    await expect(adapter.load()).rejects.toThrow(HarnessConfigError);
    await expect(adapter.load()).rejects.toThrow(/schema validation/i);
  });

  it("throws on duplicate story IDs", async () => {
    const root = makeProjectRoot();
    const backlog = {
      epic_id: "E1",
      stories: [
        { id: "DUP", title: "A", depends_on: [] },
        { id: "DUP", title: "B", depends_on: [] },
      ],
    };
    writeBacklogFile(root, backlog);
    const adapter = new FileBacklogAdapter(join(root, ".opencode/harness.epic.json"));
    await expect(adapter.load()).rejects.toThrow(HarnessConfigError);
    await expect(adapter.load()).rejects.toThrow(/Duplicate story id "DUP"/);
  });
});

describe("createBacklogAdapter", () => {
  it("creates FileBacklogAdapter for 'file' source", () => {
    const adapter = createBacklogAdapter({
      backlog_source: "file",
      backlog_file: "test.json",
      failure_policy: "ask",
      max_iterations_per_epic: 500,
    });
    expect(adapter).toBeInstanceOf(FileBacklogAdapter);
  });
});

// =============================================================================
// Loop State Controller — Epic methods
// =============================================================================

describe("LoopStateController epic methods", () => {
  it("startLoop with epicBacklog initializes epic state", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog();
    const state = controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    expect(state.loop.epic).toBeDefined();
    expect(state.loop.epic!.enabled).toBe(true);
    expect(state.loop.epic!.epic_id).toBe("EPIC-1");
    expect(state.loop.epic!.current_story_id).toBe("S1");
    expect(state.loop.epic!.story_progress).toHaveLength(1);
    expect(state.loop.epic!.story_progress[0]!.status).toBe("in_progress");
    expect(state.loop.epic!.epic_iteration_total).toBe(0);
    expect(state.feature_id).toBeNull();
  });

  it("startLoop with epicBacklog sets feature_id from first story", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog({
      stories: [
        { id: "S1", title: "Story 1", feature_id: "feat/s1", issue_number: 42, story: "Do the thing", depends_on: [] },
      ],
    });
    const state = controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);
    expect(state.feature_id).toBe("feat/s1");
    expect(state.issue_number).toBe(42);
    expect(state.story).toBe("Do the thing");
  });

  it("completeStoryAndAdvance advances to the next ready story", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog();
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    const result = controller.completeStoryAndAdvance();
    expect(result).not.toBeNull();
    expect(result!.nextStoryId).toBe("S2");

    const state = controller.getState()!;
    expect(state.loop.epic!.current_story_id).toBe("S2");
    expect(state.loop.epic!.story_progress).toHaveLength(2);
    expect(state.loop.epic!.story_progress[0]!.status).toBe("completed");
    expect(state.loop.epic!.story_progress[1]!.status).toBe("in_progress");
    expect(state.loop.gate_iteration).toBe(1);
    expect(state.loop.current_gate).toBe("pre-work");
    expect(state.loop.epic!.epic_iteration_total).toBe(1);
  });

  it("completeStoryAndAdvance returns null when backlog is drained", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog({
      stories: [{ id: "ONLY", title: "Only story", depends_on: [] }],
    });
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    const result = controller.completeStoryAndAdvance();
    expect(result).toBeNull();
  });

  it("completeStoryAndAdvance returns null when remaining stories blocked by failed dep", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog({
      stories: [
        { id: "A", title: "A", depends_on: [] },
        { id: "B", title: "B", depends_on: ["A"] },
      ],
    });
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    const r1 = controller.completeStoryAndAdvance();
    expect(r1!.nextStoryId).toBe("B");

    controller.pauseEpicForFailure("gate failed on B");

    const state = controller.getState()!;
    const bEntry = state.loop.epic!.story_progress.find((e) => e.story_id === "B");
    expect(bEntry!.status).toBe("failed");
  });

  it("pauseEpicForFailure marks story failed and deactivates loop", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog();
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    controller.pauseEpicForFailure("gate failed");

    const state = controller.getState()!;
    expect(state.loop.active).toBe(false);
    expect(state.loop.epic).toBeDefined();
    expect(state.loop.epic!.story_progress[0]!.status).toBe("failed");
    expect(state.loop.epic!.story_progress[0]!.gate_reached).toBe("pre-work");
  });

  it("cancelLoop() preserves epic state by default", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog();
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    controller.cancelLoop();

    const state = controller.getState()!;
    expect(state.loop.active).toBe(false);
    expect(state.loop.epic).toBeDefined();
    expect(state.loop.epic!.epic_id).toBe("EPIC-1");
  });

  it("cancelLoop({clean: true}) wipes epic state", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog();
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    controller.cancelLoop({ clean: true });

    const state = controller.getState()!;
    expect(state.loop.active).toBe(false);
    expect(state.loop.epic).toBeUndefined();
  });

  it("completeStoryAndAdvance pauses on max_iterations_per_epic cap", () => {
    const root = makeProjectRoot();
    const config = makeConfig({
      epic: {
        backlog_source: "file",
        backlog_file: "x",
        failure_policy: "ask",
        max_iterations_per_epic: 0,
      },
    });
    const controller = createLoopStateController(root);
    const backlog = makeBacklog();
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    const result = controller.completeStoryAndAdvance();
    expect(result).toBeNull();

    const state = controller.getState()!;
    expect(state.loop.active).toBe(false);
    expect(state.loop.epic!.story_progress[0]!.status).toBe("failed");
  });
});

// =============================================================================
// Templates
// =============================================================================

describe("epic templates", () => {
  it("buildEpicStoryPrompt includes required context", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog({
      stories: [
        { id: "S1", title: "Setup", feature_id: "feat/s1", issue_number: 10, story: "Do setup work", depends_on: [] },
        { id: "S2", title: "Build", depends_on: ["S1"] },
      ],
    });
    const state = controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    const prompt = buildEpicStoryPrompt("S1", state);
    expect(prompt).toContain("EPIC-1");
    expect(prompt).toContain("S1");
    expect(prompt).toContain("Setup");
    expect(prompt).toContain("feat/s1");
    expect(prompt).toContain("#10");
    expect(prompt).toContain("Do setup work");
    expect(prompt).toContain("gate cycle");
  });

  it("buildEpicStoryPrompt truncates long story body", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const longBody = "x".repeat(3000);
    const backlog = makeBacklog({
      stories: [{ id: "S1", title: "Long", story: longBody, depends_on: [] }],
    });
    const state = controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);
    const prompt = buildEpicStoryPrompt("S1", state);
    expect(prompt).toContain("...");
    expect(prompt.length).toBeLessThan(longBody.length);
  });

  it("buildEpicCompletionPrompt contains epic id and promise tag", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog({
      stories: [{ id: "S1", title: "Only", depends_on: [] }],
    });
    const state = controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    state.loop.epic!.story_progress[0]!.status = "completed";
    const prompt = buildEpicCompletionPrompt(state);
    expect(prompt).toContain("EPIC-1");
    expect(prompt).toContain("HARNESS-COMPLETE");
    expect(prompt).toContain("1/1");
  });

  it("buildEpicPausePrompt contains story and gate info", () => {
    const prompt = buildEpicPausePrompt("S2", "pre-merge", "max iterations");
    expect(prompt).toContain("S2");
    expect(prompt).toContain("pre-merge");
    expect(prompt).toContain("max iterations");
    expect(prompt).toContain("--resume");
  });
});

// =============================================================================
// depends_on satisfied progressively (3-story linear chain)
// =============================================================================

describe("epic story advancement — linear chain", () => {
  it("advances through 3 stories sequentially", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const backlog = makeBacklog();
    controller.startLoop("sess-1", config, undefined, undefined, undefined, 0, backlog);

    const r1 = controller.completeStoryAndAdvance();
    expect(r1!.nextStoryId).toBe("S2");

    const r2 = controller.completeStoryAndAdvance();
    expect(r2!.nextStoryId).toBe("S3");

    const r3 = controller.completeStoryAndAdvance();
    expect(r3).toBeNull();

    const state = controller.getState()!;
    expect(state.loop.epic!.story_progress.filter((e) => e.status === "completed")).toHaveLength(3);
    expect(state.loop.epic!.epic_iteration_total).toBe(2);
  });
});

// =============================================================================
// Non-epic regression
// =============================================================================

describe("non-epic regression", () => {
  it("startLoop without epicBacklog has no epic field", () => {
    const root = makeProjectRoot();
    const config = makeConfig();
    const controller = createLoopStateController(root);
    const state = controller.startLoop("sess-1", config, "feat/x", 99, "a story");
    expect(state.loop.epic).toBeUndefined();
    expect(state.feature_id).toBe("feat/x");
    expect(state.issue_number).toBe(99);
  });
});

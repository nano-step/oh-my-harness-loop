# harness-loop-state — Delta for epic-mode

## ADDED Requirements

### Requirement: LoopMeta SHALL support an optional epic block

When epic mode is active, `state.loop` SHALL contain an `epic` object that tracks story-queue state. When `epic` is absent, the existing single-story behavior is preserved unchanged.

#### Scenario: Single-story mode produces no epic block
- **WHEN** `/harness-on` is invoked without `--epic`
- **THEN** the state file `loop.epic` field SHALL be absent (or undefined), and all existing fields (`active`, `current_gate`, `gate_iteration`, etc.) SHALL behave exactly as in pre-epic-mode versions

#### Scenario: Epic mode initializes the epic block at startLoop
- **WHEN** `/harness-on --epic <path>` succeeds in loading and topo-sorting a backlog
- **THEN** the state file `loop.epic` SHALL contain `enabled: true`, `epic_id` (from backlog), `current_story_id` (first ready story id), `story_progress` (array with one `in_progress` entry for the first story), `backlog_snapshot` (the parsed and sorted backlog), `failure_policy: "ask"`, `max_iterations_per_epic`, and `epic_iteration_total: 0`

#### Scenario: Old state files lacking epic field parse without migration
- **WHEN** the plugin reads a state file written by a pre-epic-mode version (no `loop.epic`)
- **THEN** the file SHALL parse successfully via Zod's `.optional()` and the loop SHALL run in single-story mode

### Requirement: Story advancement SHALL reset per-story counters and persist atomically

When the current story completes (`next-ready` PASS with `next_gate: null`) and epic mode is active, the plugin SHALL advance to the next ready story (deps satisfied), reset per-story counters, and write state atomically.

#### Scenario: completeStoryAndAdvance resets gate_iteration to 1 and current_gate to first gate
- **WHEN** a story completes and there exists at least one ready next story
- **THEN** the state SHALL have `gate_iteration: 1`, `current_gate: gates[0]`, `no_progress_count: 0`, `same_error_history: {}`, `parallel_watchers: {}`, `last_runner_output: null`, `verification_pending: false`, and `checkpoints: {}` — all reset to fresh values

#### Scenario: completeStoryAndAdvance increments epic_iteration_total
- **WHEN** a story advances to the next
- **THEN** `state.loop.epic.epic_iteration_total` SHALL increase by exactly 1

#### Scenario: completeStoryAndAdvance preserves epic-level state
- **WHEN** a story advances
- **THEN** `state.loop.epic.epic_id`, `backlog_snapshot`, `failure_policy`, `max_iterations_per_epic`, and `config_snapshot` SHALL remain unchanged

#### Scenario: Story advancement updates top-level feature fields
- **WHEN** the next story's `feature_id`, `issue_number`, or `story` differ from the previous story
- **THEN** `state.feature_id`, `state.issue_number`, and `state.story` at the top level of the state file SHALL be updated to the new story's values so the runner receives the correct `--feature=<id>` argument

### Requirement: Story failure SHALL pause epic and preserve resumable state

When the current story exceeds `max_iterations_per_gate` and `epic.failure_policy === "ask"`, the plugin SHALL pause the epic (set `loop.active = false`) while preserving all epic-level state for `--resume`.

#### Scenario: pauseEpicForFailure marks current story failed
- **WHEN** a story exhausts retries on a gate
- **THEN** the matching entry in `epic.story_progress` SHALL have `status: "failed"` and `gate_reached: <current_gate>`

#### Scenario: pauseEpicForFailure exits loop without wiping epic
- **WHEN** a story is paused
- **THEN** `loop.active` SHALL be `false`, `loop.epic` SHALL remain populated, and the state file SHALL persist to disk before the loop exits

#### Scenario: Epic-wide iteration cap pauses with same semantics
- **WHEN** `epic.epic_iteration_total >= epic.max_iterations_per_epic`
- **THEN** `pauseEpicForFailure` SHALL fire with reason `"max_iterations_per_epic exceeded"` and emit a toast naming the cap value

### Requirement: /harness-off SHALL preserve epic state unless --clean is passed

The `/harness-off` command SHALL default to preserving `loop.epic` (allowing `--resume`). Only when `--clean` is passed SHALL the full state block (including `epic`) be wiped.

#### Scenario: /harness-off preserves epic block
- **WHEN** `/harness-off` is invoked during an active epic
- **THEN** `loop.active` SHALL be set to `false`, in-flight watchers SHALL be cancelled, but `loop.epic` SHALL remain in the state file

#### Scenario: /harness-off --clean wipes everything
- **WHEN** `/harness-off --clean` is invoked
- **THEN** the existing `clearLoopBlock()` behavior SHALL run: `loop` reset to inactive defaults AND `loop.epic` removed

### Requirement: Crash recovery SHALL re-run the current gate from iteration 0

When `/harness-on --epic --resume` is invoked against a preserved epic state, the plugin SHALL validate the state and re-run the current gate from iteration 0. Gates are required to be idempotent.

#### Scenario: --resume validates current_story_id is in backlog
- **WHEN** `/harness-on --epic --resume` is invoked and `epic.current_story_id` is NOT present in `epic.backlog_snapshot.stories`
- **THEN** the plugin SHALL refuse to resume with `HarnessConfigError("Cannot resume: current story <id> is not in the preserved backlog")`

#### Scenario: --resume requires preserved epic state
- **WHEN** `/harness-on --epic --resume` is invoked and `loop.epic` is absent
- **THEN** the plugin SHALL refuse with `HarnessConfigError("Cannot resume: no preserved epic state. Run /harness-on --epic to start fresh.")`

#### Scenario: --resume resets gate_iteration to 0 on the current gate
- **WHEN** `/harness-on --epic --resume` validates successfully and `current_gate = "pre-merge"`, `gate_iteration = 3`
- **THEN** the plugin SHALL set `gate_iteration: 0` and proceed to re-run `pre-merge` from scratch

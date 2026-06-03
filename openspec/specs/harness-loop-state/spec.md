# harness-loop-state Specification

## Purpose
TBD - created by archiving change add-harness-loop-plugin. Update Purpose after archive.
## Requirements
### Requirement: State SHALL persist to a single JSON file at a configurable path

The harness loop state SHALL live in one JSON file (default `.opencode/harness-loop.local.json`, overridable via config `state_file_path`). The file SHALL be in `.gitignore`.

#### Scenario: First-ever loop start with no existing state file
- **WHEN** `/harness-on` is invoked and the state file does not exist
- **THEN** the plugin SHALL create the file with mode 0644, populate the schema with initial values, and atomically write via temp-file-then-rename

#### Scenario: Subsequent loop iteration writes
- **WHEN** any state mutation occurs (iteration increment, gate transition, runner output cache)
- **THEN** the plugin SHALL serialize the entire state object to a `.tmp` sibling file, fsync, then `rename()` over the live file to guarantee atomicity

#### Scenario: State file corrupted on read
- **WHEN** the plugin attempts to read the state file and JSON parsing fails
- **THEN** the plugin SHALL log the error, treat the file as if absent (no active loop), and refuse to start a new loop without explicit user confirmation via the question tool

### Requirement: State schema SHALL include both capyhome-compat checkpoints block and plugin-private loop block

The state file SHALL contain a top-level `checkpoints` object (using capyhome's exact format) and a top-level `loop` object (plugin-private metadata). The plugin SHALL NOT modify fields inside `checkpoints` directly; only the runner writes to it.

#### Scenario: State schema contains both blocks
- **WHEN** the state file is read at any point during an active loop
- **THEN** the parsed object SHALL contain keys `feature_id` (string|null), `issue_number` (number|null), `story` (string|null), `updated_at` (ISO 8601 string), `checkpoints` (object — runner-owned), and `loop` (object — plugin-owned)

#### Scenario: Loop block contains required fields
- **WHEN** `loop.active=true`
- **THEN** the `loop` object SHALL contain `active`, `current_gate`, `gate_iteration`, `total_iteration`, `max_iterations_per_gate`, `max_total_iterations`, `started_at`, `session_id`, `config_snapshot`, `last_runner_output`, `no_progress_count`, `override_active`, and `watcher_task_id` (nullable, set only when an async watcher is currently active for the current gate) fields

#### Scenario: Capyhome's harness-state.py reads the file without error
- **WHEN** capyhome's existing `harness-state.py read --checkpoint <name>` is run against a state file produced by this plugin
- **THEN** the script SHALL succeed and return the checkpoint data (proves backward-compat with capyhome tooling)

### Requirement: State SHALL cache runner results with TTL

The plugin SHALL cache the last runner output per gate in `checkpoints.<gate>.checked_at` and skip re-invocation when the cached result is fresh (PASS and within TTL).

#### Scenario: Cached gate result is fresh
- **WHEN** the plugin needs to invoke gate G, and `checkpoints[G].status == "PASS"` and `now - checked_at < cache_ttl_minutes` (default 30 minutes from config)
- **THEN** the plugin SHALL skip runner invocation, reuse the cached result, and advance to the next gate

#### Scenario: Cached gate result is stale (TTL expired)
- **WHEN** the cached result exists with status PASS but `now - checked_at >= cache_ttl_minutes`
- **THEN** the plugin SHALL invoke the runner fresh and overwrite the cache entry

#### Scenario: Cached gate result is FAIL
- **WHEN** the cached result is `FAIL` or `BLOCKED`, regardless of age
- **THEN** the plugin SHALL invoke the runner (never trust a stale failure to remain a failure)

#### Scenario: User passes --force to /harness-on
- **WHEN** `/harness-on --force` is invoked
- **THEN** the plugin SHALL bypass all cache checks and re-invoke every gate from scratch

### Requirement: State SHALL support crash recovery via resume semantics

If OpenCode crashes or the host reboots mid-loop, restarting OpenCode and invoking `/harness-on` again SHALL resume at the same gate without losing progress.

#### Scenario: Crash mid-iteration, restart, /harness-on
- **WHEN** the state file contains `loop.active=true` from a prior session and the user invokes `/harness-on`
- **THEN** the plugin SHALL detect the existing active state, prompt the user via question tool "Resume loop at gate <current> iteration <N>? [resume | cancel-and-restart | abort]"

#### Scenario: User chooses resume
- **WHEN** user selects "resume" in the recovery prompt
- **THEN** the plugin SHALL re-bind the `loop.session_id` to the current session, re-invoke the runner for `current_gate`, and continue normally

#### Scenario: User chooses cancel-and-restart
- **WHEN** user selects "cancel-and-restart"
- **THEN** the plugin SHALL clear the state file's `loop` block (but preserve `checkpoints` cache), then start a new loop from the first gate

### Requirement: State SHALL track no-progress count and same-error count for anti-stuck

The state SHALL maintain counters that the anti-stuck guards consume.

#### Scenario: No-progress counter increments on zero-token turn
- **WHEN** an iteration completes and the latest assistant turn produced zero tokens
- **THEN** `loop.no_progress_count` SHALL increment by 1

#### Scenario: No-progress counter resets on productive turn
- **WHEN** an iteration completes and the latest assistant turn produced > 0 tokens
- **THEN** `loop.no_progress_count` SHALL reset to 0

#### Scenario: Same-error history tracked per gate
- **WHEN** the runner returns `rule_ids_violated: ["R29"]` for the current gate
- **THEN** the plugin SHALL append the rule_ids array to `loop.same_error_history[current_gate]` (sliding window of last 5 iterations)

#### Scenario: watcher_task_id set on watcher spawn
- **WHEN** the plugin spawns a watcher subagent for an async gate
- **THEN** `loop.watcher_task_id` SHALL be set to the returned subagent task_id

#### Scenario: watcher_task_id cleared on watcher completion or cancellation
- **WHEN** the watcher subagent completes (any status) OR `/harness-off` cancels the watcher OR the outer grace timeout fires
- **THEN** `loop.watcher_task_id` SHALL be cleared to `null`

#### Scenario: watcher_task_id absent when no async gate active
- **WHEN** the loop is on a synchronous gate (no `async: true` in config)
- **THEN** `loop.watcher_task_id` SHALL be `null` (no leftover ids from previous async gates)

#### Scenario: Same-error trigger fires
- **WHEN** the last 3 entries in `loop.same_error_history[current_gate]` are identical and non-empty
- **THEN** the anti-stuck guard SHALL trip (per harness-loop-plugin spec)

### Requirement: State writes SHALL be observable for debugging

A human SHALL be able to inspect the state file with `cat` or `jq` at any time and understand the loop's current position.

#### Scenario: Human inspects state during active loop
- **WHEN** a human runs `cat .opencode/harness-loop.local.json | jq .loop` during an active loop
- **THEN** the output SHALL show all fields with human-readable values: ISO timestamps, gate names, iteration counts, last runner output JSON

#### Scenario: State diff between iterations is small
- **WHEN** consecutive iterations write to the state file
- **THEN** the JSON diff SHALL be limited to: `updated_at`, `loop.gate_iteration`, `loop.total_iteration`, `loop.last_runner_output`, `loop.no_progress_count`, and optionally `loop.same_error_history[<gate>]` — no full-file rewrites of unrelated data

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


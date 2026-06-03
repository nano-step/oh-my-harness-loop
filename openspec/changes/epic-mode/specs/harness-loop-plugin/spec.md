# harness-loop-plugin — Delta for epic-mode

## ADDED Requirements

### Requirement: /harness-on SHALL accept --epic and --resume flags

The `/harness-on` command SHALL be extended with `--epic [path]` and `--resume` flags. The flags activate epic mode and resume behavior respectively.

#### Scenario: /harness-on without --epic preserves single-story behavior
- **WHEN** `/harness-on` is invoked without `--epic`
- **THEN** the plugin SHALL execute the existing single-story flow with zero behavioral change (all pre-epic-mode tests pass unchanged)

#### Scenario: /harness-on --epic uses default backlog path
- **WHEN** `/harness-on --epic` is invoked without an explicit path
- **THEN** the plugin SHALL load the backlog from `config.epic.backlog_file` (default `.opencode/harness.epic.json`)

#### Scenario: /harness-on --epic=<path> overrides config backlog path
- **WHEN** `/harness-on --epic=./custom-backlog.json` is invoked
- **THEN** the plugin SHALL load the backlog from `./custom-backlog.json` regardless of `config.epic.backlog_file`

#### Scenario: /harness-on --epic --resume continues from preserved state
- **WHEN** `/harness-on --epic --resume` is invoked and a valid preserved epic state exists
- **THEN** the plugin SHALL re-run the current gate from iteration 0 and continue the epic without re-loading the backlog file (snapshot is read from state)

### Requirement: Story PASS with no next gate SHALL advance epic instead of stopping

When `epic.enabled === true` and the `next-ready` gate returns PASS with `next_gate: null`, the plugin SHALL invoke `completeStoryAndAdvance()` instead of `cancelLoop()`.

#### Scenario: Last gate PASS advances to next ready story
- **WHEN** the `next-ready` runner output is `{ status: "PASS", next_gate: null }` AND `epic.enabled === true` AND there exists at least one ready next story (deps satisfied, not failed/skipped)
- **THEN** the plugin SHALL emit a toast `✅ Story "<prev-id>" done → next "<next-id>" (N/M)`, inject an epic-story prompt for the next story, and let `session.idle` re-fire the loop with the new story context

#### Scenario: Last gate PASS with empty backlog completes the epic
- **WHEN** the `next-ready` runner output is `{ status: "PASS", next_gate: null }` AND `epic.enabled === true` AND no ready next story exists (backlog drained or remaining blocked by failed deps)
- **THEN** the plugin SHALL emit `🏆 Epic "<id>" complete! N/M stories done.`, call `cancelLoop()`, and inject the `HARNESS-COMPLETE` completion prompt

#### Scenario: Last gate PASS in single-story mode behaves as before
- **WHEN** the `next-ready` runner output is `{ status: "PASS", next_gate: null }` AND `epic.enabled !== true`
- **THEN** the plugin SHALL call `cancelLoop()` and emit `🎉 Harness loop complete!` (unchanged behavior)

### Requirement: Story FAIL in epic mode with ask policy SHALL pause epic

When the current story exhausts `max_iterations_per_gate` AND `epic.enabled === true` AND `epic.failure_policy === "ask"`, the plugin SHALL pause the epic without resetting state.

#### Scenario: Story fails on gate, epic paused
- **WHEN** `state.loop.gate_iteration >= state.loop.max_iterations_per_gate` AND `epic.enabled === true` AND `epic.failure_policy === "ask"`
- **THEN** the plugin SHALL call `pauseEpicForFailure()`, mark the current story `failed`, set `loop.active = false`, persist state, and emit toast `⏸️ Story "<id>" PAUSED at gate "<gate>". Use /harness-on --epic --resume after fix.`

### Requirement: Per-story prompt SHALL include story context

The plugin SHALL inject a per-story opening prompt at every story transition (initial story start AND every advance).

#### Scenario: Epic story prompt contains required context
- **WHEN** a new story is set as current (either initial or via advance)
- **THEN** the injected prompt SHALL include the epic id, story id, story title, feature_id (if present), issue_number (if present), the story body (truncated to 2000 chars), the count of completed vs total stories, and an instruction to begin the gate cycle

### Requirement: Epic completion prompt SHALL signal the agent

When the backlog is fully drained or only blocked stories remain, the plugin SHALL inject a final completion prompt that signals the agent to emit `HARNESS-COMPLETE`.

#### Scenario: Epic completion prompt content
- **WHEN** the epic completes
- **THEN** the injected prompt SHALL include the epic id, N/M story counts, the list of completed story ids, and the instruction to emit `<promise>HARNESS-COMPLETE</promise>`

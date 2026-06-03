# harness-loop-config — Delta for epic-mode

## ADDED Requirements

### Requirement: HarnessConfig SHALL support an optional epic block

The `HarnessConfigSchema` SHALL be extended with an optional top-level `epic` object containing epic-mode configuration. When absent, epic mode is unavailable and the plugin operates exclusively in single-story mode.

#### Scenario: Config without epic block parses successfully
- **WHEN** a `harness.config.json` lacks the `epic` field
- **THEN** the Zod parse SHALL succeed and `config.epic` SHALL be `undefined`

#### Scenario: Config with valid epic block parses successfully
- **WHEN** a `harness.config.json` contains `{ "epic": { "backlog_source": "file", "backlog_file": ".opencode/harness.epic.json", "failure_policy": "ask", "max_iterations_per_epic": 500 } }`
- **THEN** the Zod parse SHALL succeed and all fields SHALL be populated with the provided values

#### Scenario: Config defaults are applied for omitted epic fields
- **WHEN** a `harness.config.json` contains `{ "epic": {} }`
- **THEN** Zod defaults SHALL apply: `backlog_source: "file"`, `backlog_file: ".opencode/harness.epic.json"`, `failure_policy: "ask"`, `max_iterations_per_epic: 500`

### Requirement: --epic flag SHALL require config.epic to be present

The `/harness-on --epic` command SHALL refuse to start if the loaded config does not contain an `epic` block, with an actionable error.

#### Scenario: --epic without config.epic block
- **WHEN** `/harness-on --epic` is invoked and `config.epic` is `undefined`
- **THEN** the plugin SHALL throw `HarnessConfigError("Epic config block required for --epic. Add an 'epic' field to harness.config.json.")` BEFORE any loop state is created

### Requirement: Backlog file SHALL validate against BacklogSchema with unique story IDs

The `FileBacklogAdapter` SHALL load and validate the backlog file at `/harness-on --epic` start (before any gate runs).

#### Scenario: Backlog file missing
- **WHEN** the configured `backlog_file` does not exist on disk
- **THEN** the plugin SHALL throw `HarnessConfigError("Epic backlog file not found: <path>")` and the loop SHALL NOT start

#### Scenario: Backlog file is malformed JSON
- **WHEN** the backlog file exists but `JSON.parse` throws
- **THEN** the plugin SHALL throw `HarnessConfigError` whose message includes the file path and the underlying parse error message

#### Scenario: Backlog file fails BacklogSchema validation
- **WHEN** the backlog file parses as JSON but fails Zod schema validation (e.g., missing `epic_id`, empty `stories` array, story missing `id`)
- **THEN** the plugin SHALL throw `HarnessConfigError` whose message includes the Zod error details

#### Scenario: Backlog with duplicate story IDs is rejected
- **WHEN** two entries in `stories[]` share the same `id`
- **THEN** the plugin SHALL throw `HarnessConfigError("Duplicate story id '<id>' in backlog <path>")`

#### Scenario: Backlog with depends_on cycle is rejected
- **WHEN** the topological sort detects a cycle among stories
- **THEN** the plugin SHALL throw `HarnessConfigError("Dependency cycle detected among stories: <id1>, <id2>, ...")` listing the unresolved story IDs

#### Scenario: Backlog with depends_on referencing a missing story is rejected
- **WHEN** a story's `depends_on` references an id not present in `stories[]`
- **THEN** the plugin SHALL throw `HarnessConfigError("Story '<id>' depends on '<missing>' which does not exist in the backlog")`

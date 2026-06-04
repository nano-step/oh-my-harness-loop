# Spec Delta: harness-loop-plugin

## ADDED Requirements

### Requirement: Plugin SHALL expose `/harness-team` slash command

The plugin SHALL register a new slash command `harness-team` via the `command.execute.before` hook. The command supports two modes:
- **Default** (no args): start the full team-architecture-factory workflow
- **`--audit`**: run Phase 0 (audit) only; report-only mode without file generation

#### Scenario: User invokes `/harness-team` with no arguments

- **WHEN** the user runs `/harness-team` in an OpenCode chat session
- **THEN** the plugin SHALL:
  1. Emit a toast `🏗️ Starting team architecture factory...` at `info` severity
  2. Inject a chat message containing the project root, instructions to load the `team-architecture-factory` skill, and a directive to begin Phase 0 (audit)
  3. Not modify any files in the user's project
  4. Not read or write `.opencode/harness-loop.local.json`

#### Scenario: User invokes `/harness-team --audit`

- **WHEN** the user runs `/harness-team --audit`
- **THEN** the plugin SHALL:
  1. Emit a toast `🔍 Auditing existing agent team...` at `info` severity
  2. Inject a chat message instructing the agent to run Phase 0 only and produce a status report
  3. Not modify any files
  4. The injected prompt SHALL contain the substring `Report only` and SHALL NOT instruct the agent to enter Phase 1 or later

### Requirement: Plugin SHALL ship four pre-installed slash command shims after this change

The `postinstall.js` script SHALL create five (5) slash command shim files in the consumer project's `.opencode/commands/` directory:
1. `harness-on.md`
2. `harness-off.md`
3. `harness-init.md`
4. `harness-check.md`
5. `harness-team.md` (NEW)

#### Scenario: `npm install @nano-step/oh-my-harness` on a fresh consumer project

- **WHEN** the consumer runs `npm install @nano-step/oh-my-harness@latest` in a project with no existing `.opencode/commands/` directory
- **THEN** the postinstall script SHALL create all five shim files
- **AND** the toast/log SHALL report `5 created` instead of the previous `4 created`

#### Scenario: `npm install` on a project with existing shims

- **WHEN** the consumer runs `npm install @nano-step/oh-my-harness@latest` AND `.opencode/commands/harness-on.md` already exists
- **THEN** the postinstall script SHALL preserve existing files unchanged
- **AND** SHALL create only the missing shims (typically `harness-team.md`)
- **AND** the toast/log SHALL report the actual delta (e.g., `1 created, 4 already present`)

### Requirement: `/harness-init` SHALL reference `/harness-team` in its report

After this change, the `/harness-init` report message SHALL include a one-line cross-reference suggesting `/harness-team` for team-architecture generation, distinct from the gate-loop setup that `/harness-init` performs.

#### Scenario: User runs `/harness-init` after this change

- **WHEN** the user runs `/harness-init` and the report is built
- **THEN** the injected message SHALL contain the substring `/harness-team`
- **AND** the message SHALL clearly distinguish the gate-loop setup from the team-architecture factory

### Requirement: Skill files SHALL ship in the npm tarball

The `package.json` `files` array SHALL include `"skills"` so that `skills/team-architecture-factory/SKILL.md`, all six reference docs, and attribution assets are published to npm and unpacked in the consumer's `node_modules/@nano-step/oh-my-harness/skills/team-architecture-factory/`.

#### Scenario: `npm pack --dry-run` after this change

- **WHEN** the maintainer runs `npm pack --dry-run` on the package
- **THEN** the output SHALL list:
  - `skills/team-architecture-factory/SKILL.md`
  - All six files under `skills/team-architecture-factory/references/`
  - `skills/team-architecture-factory/assets/LICENSE-UPSTREAM`
  - `skills/team-architecture-factory/assets/NOTICE`
  - `skills/team-architecture-factory/assets/CHANGELOG-UPSTREAM.md`

### Requirement: Team-architecture skill files SHALL NOT contain Claude Code primitives

The skill bundle at `skills/team-architecture-factory/` is a port to OpenCode. It SHALL NOT contain references to Claude Code-specific primitives. Forbidden patterns (in prose, not in translation tables): `TeamCreate`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TeamDelete`, `Agent(`, `model: "opus"`, `.claude/`.

#### Scenario: Pre-merge grep audit

- **WHEN** the integration test at `tests/integration/team-factory-skill.test.ts` runs
- **THEN** for each forbidden pattern, the test SHALL find zero occurrences outside markdown table rows (lines starting with `|`)
- **AND** the test SHALL fail with a clear message naming the offending file and pattern if any leak is detected

### Requirement: `/harness-team` SHALL operate independently of the gate-loop state

The `/harness-team` command SHALL NOT read or modify `.opencode/harness-loop.local.json`, `.opencode/harness.config.json`, or any other gate-loop state file. The two features SHALL share zero state.

#### Scenario: `/harness-team` invoked during an active gate-loop

- **GIVEN** a harness gate-loop is active (state file has `"active": true`)
- **WHEN** the user runs `/harness-team`
- **THEN** the gate-loop state SHALL be unmodified after the command returns
- **AND** the command SHALL still emit its toast and inject its prompt normally

#### Scenario: `/harness-team --audit` does not interfere with cache

- **WHEN** the user runs `/harness-team --audit` while a harness gate's cache TTL is active
- **THEN** the gate cache state SHALL be unaffected
- **AND** subsequent `/harness-on` invocations SHALL behave as if `/harness-team` had not been called

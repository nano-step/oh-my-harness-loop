# Proposal: Team Architecture Factory Skill

**Date:** 2026-06-03
**Status:** Draft (awaiting Momus review + operator approval)
**Lane:** normal — additive `files[]` entry + new slash command; zero schema changes; zero new runtime deps

## Why

Operator asked to mimic `revfactory/harness` for OpenCode. After two parallel architecture-inventory subagents + Metis + Oracle deep-design, the conclusion is: the upstream is a **pure markdown skill bundle** (no runtime code) that turns a domain description into agent + skill scaffolding using six well-defined team-architecture patterns. It is **orthogonal** to our existing harness gate-loop feature — different layer, different concerns, different state.

Porting it is 95% translation work (Korean→English, `.claude/`→`.opencode/`, Claude Code primitives→OpenCode `task()`) and 5% TypeScript glue (one slash command handler). Shipping it inside `@nano-step/oh-my-harness` v1.1.0 lets one npm install give users both:

- **L2 gate-loop** (`/harness-on`, `/harness-off`, `/harness-init`, `/harness-check`)
- **L3 team factory** (`/harness-team` — generates agents + skills from domain prose)

## What Changes

| Area | Change |
|------|--------|
| `skills/team-architecture-factory/SKILL.md` (NEW) | Main skill prompt (~450 lines). 7-phase workflow translated from `revfactory/harness/skills/harness/SKILL.md`. Frontmatter triggers in English, Korean (preserved from upstream), and Vietnamese (new). |
| `skills/team-architecture-factory/references/*.md` (6 NEW) | All six upstream reference docs translated: `agent-design-patterns.md`, `orchestrator-template.md`, `skill-writing-guide.md`, `skill-testing-guide.md`, `team-examples.md`, `qa-agent-guide.md`. ~1,750 lines total. |
| `skills/team-architecture-factory/assets/{LICENSE-UPSTREAM,NOTICE,CHANGELOG-UPSTREAM.md}` (3 NEW) | Apache-2.0 attribution per upstream license terms. |
| `commands/harness-team.ts` (NEW) | Slash command handler (~85 lines). Args: `--audit`. Behavior: emit toast + inject prompt telling agent to load the skill and begin the 7-phase workflow. |
| `index.ts` (MODIFIED) | Wire `harness-team` into `command.execute.before` switch (+15 lines). Add `buildHarnessTeamContext` helper. |
| `scripts/postinstall.js` (MODIFIED) | Add `harness-team.md` to the `SHIMS` array (+6 lines). |
| `templates/init/.opencode/commands/harness-team.md` (NEW) | Slash command shim. |
| `commands/harness-init.ts` (MODIFIED) | Add one cross-reference line: "💡 Want to generate a full agent team for your domain? Try `/harness-team`." |
| `package.json` `files[]` (MODIFIED) | Add `"skills"` so the skill ships in the published npm tarball. |
| `README.md` (MODIFIED) | New "Team Architecture Factory" section (~35 lines). Clear separation from gate-loop docs. |
| `AGENTS.md` (MODIFIED) | Add `/harness-team` to the commands inventory. |
| `tests/commands/harness-team.test.ts` (NEW) | Unit tests for the command handler (~80 lines). |
| `tests/integration/team-factory-skill.test.ts` (NEW) | Frontmatter validation + reference-file-existence + no-`.claude/`-leak checks (~80 lines). |

## What Does NOT Change

- **Existing gate-loop feature** — `/harness-on`, `/harness-off`, `/harness-init`, `/harness-check` behaviors are bit-identical
- **State file `.opencode/harness-loop.local.json`** — never read or written by `/harness-team`
- **`harness.config.json` schema** — no changes
- **`RunnerOutputSchema`, `LoopMetaSchema`, etc.** — zero Zod schema changes
- **`package.json` `name`, `version`, `main`, `types`, `exports`** — only `files[]` adds one entry
- **Runtime dependencies** — `zod` stays; nothing else added
- **Public TypeScript API** — the plugin's default export signature is identical
- **Postinstall behavior for existing 4 shims** — `harness-team` is added as a 5th entry; existing shims behave identically (idempotent, preserve user customization)

## Locked Decisions (post deep-design)

These were resolved by the synthesis doc + Metis + Oracle and are not re-litigated in implementation:

| # | Decision | Value |
|---|---|---|
| 1 | Distribution | Bundled inside `@nano-step/oh-my-harness` (no new npm package) |
| 2 | Slash command name | `/harness-team` (short, namespace-consistent) |
| 3 | Skill ID (directory name) | `team-architecture-factory` (matches upstream's L3 sub-layer name) |
| 4 | Live agent-team messaging (Gap 1) | Dropped in v1. Workspace-file protocol covers the same orchestration patterns at the cost of real-time challenge. |
| 5 | Progressive Disclosure | Authoring pattern only (no runtime mechanism). SKILL.md body < 500 lines; details in `references/`. |
| 6 | Auto-trigger discovery | Slash command + skill-description matching. No Claude-Code-style auto-discovery. |
| 7 | Generated artifacts location | Project-local `.opencode/agents/`, `.opencode/skills/`, append-to `AGENTS.md` (not user-global) |
| 8 | License | Apache-2.0 inherited for the skill files. Our TS code stays MIT. `LICENSE-UPSTREAM` + `NOTICE` shipped with attribution per Apache-2.0 §4. |
| 9 | Slash command behavior | **Option A: No-op trigger.** Command emits toast + injects prompt; agent does the real work using the loaded skill. No file I/O in the command handler itself. |
| 10 | Orchestrator pattern in generated teams | Subagent mode via `task(run_in_background=True)` with workspace-file coordination. Document live-team-messaging as out-of-scope. |
| 11 | Vietnamese trigger phrases | Add: `"tạo team agent"`, `"thiết kế kiến trúc agent"`, `"xây dựng harness"`, `"kiểm tra agent team"`. |
| 12 | Reference-doc translation policy | Keep Korean text inline with English translations alongside (preserve author attribution). |
| 13 | `_workspace/` directory | Document the pattern in orchestrator references; not required by the tool. User project decides. |
| 14 | Dry-run mode | Deferred to v1.2.0. v1.1.0 ships default + `--audit` flag only. |

## Pre-implementation verification (open question, must resolve before T9)

**Critical assumption A3/A4 from Metis analysis** — does OpenCode actually:
1. Read `.opencode/agents/*.md` as custom agent definitions (so `task(subagent_type="my-agent")` resolves)?
2. Discover `.opencode/skills/<name>/SKILL.md` from project-local paths?

**Verification step (must run before T9):** Create a trivial `.opencode/agents/test-agent.md` with frontmatter `name: test-agent` + `description: "Test agent for verification"`. From an OpenCode chat session, run `task(subagent_type="test-agent", prompt="Echo: hello")` and observe whether the agent definition is loaded.

If either answer is "no," **Frame A collapses to Frame B** (skill content embedded in command handler prompt injection instead of loaded from disk). Frame B requires changes to T9/T10/T11/T12 — see `design.md` § "Frame B fallback" for details.

## Acceptance Criteria

A1. `/harness-team` (no args) emits toast `🏗️ Starting team architecture factory...` and injects a prompt telling the agent to load `team-architecture-factory` skill and begin Phase 0 (audit) → full 7-phase workflow.

A2. `/harness-team --audit` emits toast `🔍 Auditing existing agent team...` and injects a prompt instructing the agent to run Phase 0 only (status audit of `.opencode/agents/`, `.opencode/skills/`, `AGENTS.md`).

A3. After running `/harness-team` in a project with no existing harness, the generated artifacts include: at least one `.opencode/agents/{name}.md` with valid frontmatter, at least two `.opencode/skills/{name}/SKILL.md` (one orchestrator + ≥1 domain skill), and an appended `## Harness: {domain}` section in `AGENTS.md` with trigger rule + change-log table.

A4. Zero references to Claude Code primitives (`TeamCreate`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TeamDelete`, `Agent(`, `model: "opus"`, `.claude/`) appear in any file under `skills/team-architecture-factory/`. Verified by `grep -r <pattern> skills/team-architecture-factory/`.

A5. `skills/team-architecture-factory/SKILL.md` body is ≤ 500 lines (Progressive Disclosure threshold from upstream guide).

A6. All six reference docs at `skills/team-architecture-factory/references/*.md` are present and load when the agent reads them.

A7. The shim file `.opencode/commands/harness-team.md` is created by `scripts/postinstall.js` on `npm install @nano-step/oh-my-harness@latest` in a consumer project (alongside the existing four shims).

A8. `npm pack --dry-run` lists `skills/team-architecture-factory/SKILL.md` and all six reference files in the published tarball.

A9. `LICENSE-UPSTREAM` + `NOTICE` files are present under `skills/team-architecture-factory/assets/`. Both ship in the npm package.

A10. Calling `/harness-team` does NOT read or write `.opencode/harness-loop.local.json` (verified by test: pre-call and post-call file mtime equal, content equal).

A11. Running `/harness-init` (existing command) injects an updated message that contains a one-line cross-reference to `/harness-team`.

A12. `tsc --noEmit && npx vitest run` passes with all new tests green (existing 192 + new ~12 = ≥204).

A13. `./scripts/harness-check.sh pre-merge --json` returns `"status":"PASS"` for all four checks.

## Out of Scope

| Item | Reason | Tracked for |
|------|--------|------------|
| Live multi-agent messaging (Claude Code's `SendMessage`) | OpenCode has no IPC between subagents; would require new architecture | v1.3.0+ |
| Persistent team state across sessions | Upstream's optional v1.2.0 feature; not core | v1.3.0+ |
| Runtime Progressive Disclosure | Authoring pattern survives without runtime support | not planned |
| `--dry-run` flag | Skill already shows Phase 0-2 output before writing; redundant for v1 | v1.2.0 |
| Domain-specific template library (pre-built teams) | Skill can generate from scratch; templates are nice-to-have | v1.2.0 |
| Full Vietnamese translation of reference docs | Korean+English bilingual ships in v1.1.0; Vietnamese is incremental | v1.2.0+ |
| Integration with harness-loop (`/harness-team` aware of gate config) | Cross-feature work; each feature should prove independent first | v1.3.0+ |
| Claude Code marketplace integration | We use npm; settled | not planned |

## Risks (top 5, mitigated)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Claude Code primitive leakage in translation (missing `TeamCreate`, `.claude/`, `model: "opus"`, etc.) | HIGH | Pre-merge grep automated in T17; integration test in T16; translation table in `design.md` |
| OpenCode does not actually read `.opencode/agents/*.md` (Assumption A3/A4 wrong) | HIGH if true | Verification step required before T9; fallback Frame B documented in `design.md` |
| Apache-2.0 attribution non-compliance | HIGH | T1 ships LICENSE-UPSTREAM + NOTICE; provenance noted in SKILL.md header |
| User confusion (two features in one package) | MEDIUM | Clear README separation; distinct command namespaces; explicit "NOT for harness gate-loop operations" in skill description |
| Generated teams of low quality due to translation drift | MEDIUM | Operator review of all reference docs before merge; smoke test that runs `/harness-team` against a known domain post-merge |

## Phasing

- **v1.1.0 (this proposal)**: SKILL.md + 6 references + `/harness-team` + `--audit` + tests + docs
- **v1.2.0**: `--dry-run`, Vietnamese reference doc translations, domain template library
- **v1.3.0+**: harness-loop integration, persistent team state, live agent messaging (if user demand)

# Upstream Changelog (Snapshot — English Translation)

> **Snapshot taken 2026-06-03 from revfactory/harness v1.2.0.**
> This file is an English translation of the upstream Korean changelog.
> For the original (Korean) source, see https://github.com/revfactory/harness/blob/main/CHANGELOG.md.

This file preserves the upstream changelog for traceability. We do not maintain this file — it exists only to give consumers a record of what changed in revfactory/harness prior to our v1.2.0 snapshot.

---

# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- New pre-creation duplicate review stage (Phase 3-0, Phase 4-0)
- "Agent reuse design" section in `references/agent-design-patterns.md`
- "Skill reuse design" §9 in `references/skill-writing-guide.md`

### Changed
- Phase selection matrix now explicitly lists 3-0/4-0
- Pointer to reuse review stage added in Phase 2-3
- 2 reuse review items added to output checklist

---

## [1.2.1] - 2026-04-18

### Fixed

- **Version consistency sync** — README.md / README_KO.md / README_JA.md badges were `v1.0.1`, `.claude-plugin/marketplace.json` was `1.1.0`, `.claude-plugin/plugin.json` was `1.2.0` (3-way inconsistency) → unified to **v1.2.0** (per plugin.json)
- **Tagged-release zero-state resolution prep** — backfill tag plan for v1.0.0 / v1.0.1 / v1.1.0 / v1.2.0 (see `_workspace/release/audit-2026-04-18.md` §4)

### Added

- **Positioning statement: "harness factory"** — category self-description added at top of README. "A harness factory that produces agents + skills per domain" — category claimed vs single-agent/prompt frameworks
- **CONTRIBUTING.md** — contribution guide + SLA (PR first response 72h, Issue triage 48h). Lowers community onboarding barrier
- **docs/ directory** — new home for long-term docs (architecture, migration, pattern catalog). Prevents README bloat; improves searchability
- **Issue #3 response policy** — official response template + triage process for community issues

### Changed

- `.claude-plugin/marketplace.json` version: `1.1.0` → `1.2.0`
- README badges (EN/KO/JA 3 variants): `Version-1.0.1` → `Version-1.2.0`
- **`.claude-plugin/plugin.json` description rewrite** — `"Agent Team & Skill Architect — Meta-skill that designs..."` → `"The team-architecture factory for Claude Code — a meta-skill that turns a domain description into an agent team and the skills they use, with six pre-defined team-architecture patterns..."` (EN+KO, L3 Meta-Factory positioning)
- **`.claude-plugin/plugin.json` keywords expansion** — 5 → 17 (`harness-factory`, `team-architecture-factory`, `claude-code-plugin`, `agent-scaffolding`, `multi-agent`, 6 new pattern keywords)

## [1.2.0] - 2026-04-08

### Changed

- **CLAUDE.md registration policy simplified (de-duplication)** — Phase 5-4 "context registration" changed to "pointer registration". Agent list, skill list, directory structure, execution rule details removed from CLAUDE.md; only **trigger rules + change history** remain. Agent/skill lists are managed from `.claude/agents/`, `.claude/skills/`, and the orchestrator skill (single source of truth)
- **Phase 3/4 ad-hoc sync stage removed** — Phase 3/4 ad-hoc sync instructions removed to reduce CLAUDE.md sync overhead. Final pointer registration is done only once at Phase 5-4
- **Core principle #3 redefined** — "register harness context in CLAUDE.md" → "register harness pointer in CLAUDE.md"
- **CLAUDE.md vs orchestrator role split table removed** — pointer policy simplifies things; the table itself is no longer needed

### Added

- **Phase 2-1: Hybrid execution mode** — in addition to agent team / sub-agent, a hybrid pattern that mixes modes per Phase. Common combinations (parallel collection → consensus integration, team creation → verification, team reconfiguration between Phases) specified
- **Phase 2-1 execution mode comparison table** — 3-mode characteristics (team/sub/hybrid) + 3-step decision order
- **Phase 5-0 hybrid orchestrator pattern** — rule to declare execution mode at the top of each Phase when in hybrid mode
- **Phase 5-1 return-value-based data passing** — sub-agent-mode-only data passing strategy added (in addition to existing message/task/file + return value)
- **Phase 5-1 recommended combinations (sub/hybrid)** — recommended data passing combinations in sub and hybrid modes (besides team mode)

## [1.1.0] - 2026-04-05

### Added

- **Phase 0: Current-state audit** — on trigger, first check existing harness state and route to one of 3 branches: new build / existing extension / ops-maintenance
- **Existing extension Phase selection matrix** — decision table for which Phases are needed per type of change (add agent / add skill / architecture change)
- **Phase 3/4 CLAUDE.md ad-hoc sync** — immediately reflect in CLAUDE.md after agent/skill creation (session-disruption resilience)
- **Phase 5-4: CLAUDE.md harness context registration** — record agent team structure, skill list, execution rules, directory structure, change history. Includes CLAUDE.md vs orchestrator role split table
- **Phase 5-5: Follow-up work support** — orchestrator description MUST include follow-up keywords; Phase 0 context-check stage auto-classifies initial/partial-re-run/new-run
- **Phase 5 orchestrator modification path** — guide to modify (not create new) orchestrator for existing extensions
- **Phase 7: Harness evolution mechanism** — post-run feedback collection → feedback-type → modification-target mapping → change history → auto-evolution trigger
- **Phase 7-5: Operations/maintenance workflow** — 4 stages: current-state audit → incremental modification → CLAUDE.md sync → change verification
- **Operations/maintenance triggers in description** — keywords: 'harness audit', 'harness check', 'harness status', 'agent/skill sync'
- **Output checklist strengthening** — CLAUDE.md sync complete, change history recorded, Phase 0 context check items added
- Phase 0 (context check) added to orchestrator template — applies to both agent team and sub-agent modes
- Follow-up keyword pattern included in orchestrator description template

### Changed

- Core principles expanded from 2 to 4 (added CLAUDE.md registration, evolution system)
- **"Evolution log" → "change history" unified** — name and schema (4 columns: date/change/target/reason) unified across all sections
- **Phase 1 Step 3** — changed to base conflict analysis on Phase 0 audit result (de-duplication)
- **5-4 CLAUDE.md template code block** — fixed nested-render breakage (3-backtick → 4-backtick)
- **Role split table expanded** — skill list, directory structure, change history rows added
- **Orchestrator template** — added Phase 0 context-check stage, follow-up keyword guide

## [1.0.1] - 2026-03-28

### Changed

- Removed duplicate content between SKILL.md and references (330 lines → 285 lines)
  - Phase 2-1: execution mode table/bullets → core principles + agent-design-patterns.md pointer
  - Phase 2-3: agent-separation criteria bullets → 4-axis summary + agent-design-patterns.md pointer
  - Phase 3: agent definition template code block → required section list + references pointer
  - Phase 5-2: error-handling 5-row table → core principles + orchestrator-template.md pointer

## [1.0.0] - 2026-03-27

### Added

- 6-Phase workflow-based harness composition meta-skill
- 6 agent architecture patterns (pipeline, fan-out/fan-in, expert pool, producer-reviewer, supervisor, hierarchical delegation)
- Agent team / sub-agent execution mode support
- Progressive Disclosure-based skill authoring guide
- Orchestrator template (agent team mode + sub-agent mode)
- QA agent integration guide (based on 7 real-project bug cases)
- Skill testing/evaluation methodology (with-skill vs without-skill comparison)
- 5 real-world team-composition examples (research, novel, webtoon, code review, migration)

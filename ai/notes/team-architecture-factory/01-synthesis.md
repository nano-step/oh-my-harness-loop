# Phase 2.3 — Synthesis: revfactory/harness → @nano-step/oh-my-harness port

Date: 2026-06-03
Inputs: Two parallel explore subagents (bg_ff18534e architecture inventory, bg_2d7da3a6 primitive mapping).

## TL;DR

`revfactory/harness` is a **Claude Code skill** (pure markdown, no code) that generates **agent teams + skill scaffolding** from a domain description. It's an L3 "meta-factory" — it doesn't run the agents; it creates their definition files and the orchestrator skill that does run them.

Porting it to OpenCode is **mostly a text-translation exercise** with **3 hard architecture gaps** to design around. The current `@nano-step/oh-my-harness` v1.0.0 plugin (TS code + slash commands) is **orthogonal** to revfactory/harness (markdown-only skill). The port should ship as a **new skill** inside the existing package, not replace it.

## Concept alignment

| | revfactory/harness | @nano-step/oh-my-harness (today) |
|---|---|---|
| **Layer** | L3 Meta-Factory (Team-Architecture) | L2 Cross-Harness Workflow (Gate-Loop) |
| **What it does** | Reads domain prose → generates `.claude/agents/*.md` + `.claude/skills/*/SKILL.md` + CLAUDE.md pointer | Drives a feature through 5 gates (pre-work → in-progress → pre-merge → post-merge → next-ready) via runner contract |
| **Persistence model** | Files in the user's repo, namespace `.claude/` | State file `.opencode/harness-loop.local.json` |
| **Lifecycle** | One-shot generation, optional Phase 7 evolution feedback | Continuous loop until HARNESS-COMPLETE |
| **Activation** | "하네스 구성해줘" / "Build a harness for this project" (skill trigger) | `/harness-on`, `/harness-off`, `/harness-init`, `/harness-check` slash commands |
| **Code** | Zero — pure Markdown skill files | ~3000 LOC TypeScript (state machine, gates, parallel watchers, epic mode) |

**Net:** They are different layers solving different problems. Adding revfactory's concept to our package means **adding a `team-architecture-factory` skill** that is **completely independent** of the gate loop. Users can use either, both, or neither.

## What we get for free (Bucket A)

These port 1:1 with text-translation only:

| Item | Path in upstream | Path in port |
|---|---|---|
| Main skill prompt | `skills/harness/SKILL.md` | `skills/team-architecture-factory/SKILL.md` |
| 6 pattern reference docs | `skills/harness/references/agent-design-patterns.md` | same path in port |
| Orchestrator template | `skills/harness/references/orchestrator-template.md` | same |
| Skill writing guide | `skills/harness/references/skill-writing-guide.md` | same |
| Skill testing guide | `skills/harness/references/skill-testing-guide.md` | same |
| Team examples | `skills/harness/references/team-examples.md` | same |
| QA agent guide | `skills/harness/references/qa-agent-guide.md` | same |

All 1,753+ lines of reference docs port as-is after `s/.claude/.opencode/g` and Korean-section preservation.

## What needs adaptation (Bucket B)

| Concept | Translation rule |
|---|---|
| `.claude/agents/<name>.md` files | Generate to `.opencode/agents/<name>.md`. Frontmatter preserved: `name`, `description`. Drop `color`, `model` if present (OpenCode has neither at agent-file level). |
| `.claude/skills/<name>/SKILL.md` | Generate to project's `.opencode/skills/<name>/SKILL.md`. Frontmatter same. |
| `CLAUDE.md` pointer registration | Append to project's `AGENTS.md` (or create one). Format: `## Harness: <domain>` section with trigger + change log table. |
| Plan-approval gates | Use the existing harness-loop plugin's gate-runner if user wants validation gates; otherwise document as "out of scope for the generator". |
| Agent communication ("TeamCreate" + "SendMessage") | Generated agents communicate via `task()` subagent return values and shared workspace files in `_workspace/`. Document the pattern in `orchestrator-template.md`. |
| `TaskCreate` / `TaskUpdate` shared list | Use workspace file `_workspace/tasks.json` with controller helpers; lighter than the Claude Code primitive but functional. |

## Hard gaps (Bucket C) — must design

### Gap 1: Live agent-team conversation

**Upstream feature:** Claude Code's Agent Teams have persistent agent processes with bidirectional `SendMessage`. Agents can challenge each other mid-task.

**OpenCode reality:** `task()` is fire-and-forget per call. No back-channel between live agents in the same session.

**Resolution:** Two options.
- **B1 (recommended for v1):** Drop the "live conversation" affordance. Generated orchestrator runs agents sequentially or in parallel batches via `task(run_in_background=True)`. Cross-agent feedback happens through shared workspace files. This matches what the Fan-out/Fan-in, Expert Pool, Producer-Reviewer, and Supervisor patterns actually need.
- **B2 (deferred to v2):** Implement a polling-based message bus. Out of scope for the port MVP.

**Cost of gap:** Loses ~10% of upstream capability (real-time inter-agent challenge), retains 90% (orchestration patterns).

### Gap 2: Progressive Disclosure (lazy skill loading)

**Upstream feature:** Claude Code auto-loads only the SKILL.md body at trigger, and `references/*.md` only when the running skill references them. Token-frugal.

**OpenCode reality:** Skills are listed in `load_skills=[]` at task spawn; entire skill block injected upfront.

**Resolution:** **B1 (recommended for v1):** Document Progressive Disclosure as a *content design* pattern (keep SKILL.md < 500 lines, push detail to `references/`). The skill author still benefits from token efficiency because OpenCode agents `Read` references on demand using the file tool. No runtime mechanism needed.

**Cost of gap:** None functionally; the pattern survives at the authoring level.

### Gap 3: Auto-trigger from natural language

**Upstream feature:** Claude Code auto-detects "하네스 구성해줘" → invokes the harness skill without explicit `/skill-name`.

**OpenCode reality:** User must either `/team-architecture-factory` slash command OR call out the skill by name in chat.

**Resolution:** Ship a thin `/team-architecture-factory` slash command (matches our `/harness-init`-style pattern) **plus** rely on OpenCode's existing skill-discovery via the agent's instructions to invoke the skill when the user's request matches the description. Author the description with explicit Vietnamese + English triggers.

**Cost of gap:** User needs to type 1 slash command or use trigger phrases that match the agent's loaded-skill list. Acceptable.

## Architectural decision summary

| Aspect | Decision |
|---|---|
| Distribution | Bundle as **a new skill** inside the existing `@nano-step/oh-my-harness` package, not a separate npm package. Same install command. |
| Slash command | Add `/harness-team` (or `/harness-init-team`) that triggers the skill. Shim shipped via existing postinstall mechanism. |
| Code/markdown ratio | **~95% markdown, ~5% TS code** (just the slash command wiring, no domain logic). Most of the value is in the skill prompts. |
| Backward compat | Zero impact on existing loop-plugin features. Independent skill. |
| Lane | **normal** for OpenSpec proposal (additive skill, no schema/manifest change beyond adding a slash command shim). |
| Effort | ~1 day implementation (heavy reading/translation, light coding) once design approved. |

## Out-of-scope deliberately

- Live multi-agent messaging (Gap 1, option B2)
- Persistent team state across sessions (mentioned in upstream but optional in v1.2.0)
- Claude Code marketplace integration (we use npm; that's settled)
- Bundled binary assets (PNG icons, etc.) — port concept-only, not branding

## Open questions for operator (will be in OpenSpec proposal)

1. **Skill ID:** `team-architecture-factory`, `harness-team`, `harness-factory`, or something simpler? Default proposed: `team-architecture-factory` (matches upstream's L3 sub-layer name).
2. **Slash command:** `/harness-team` (short) vs `/team-architecture-factory` (verbose, matches skill name)? Default: `/harness-team`.
3. **Generated artifacts location:** `.opencode/agents/`, `.opencode/skills/` (project-local) vs `~/.config/opencode/agents/`, `~/.config/opencode/skills/` (user-global)? Default: project-local for portability + repo-trackable.
4. **Multilingual triggers:** keep upstream's Korean/Japanese/English in skill description, add Vietnamese? Operator is Vietnamese-fluent; recommend adding.
5. **Reference doc translation:** keep references in original Korean/English mix or translate Korean → English for our audience? Default: leave Korean inline with English translations alongside (preserve author attribution).
6. **`_workspace/` directory:** generate in user repo or gitignore by default? Default: generate + add to project `.gitignore` (per existing template pattern).

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Upstream license (Apache-2.0) requires attribution | Medium | Include NOTICE + LICENSE-UPSTREAM in our repo. Mention provenance in the skill itself. |
| Korean text mistranslation by us | Low | Keep original Korean alongside English; mark translations as "machine-assisted, please verify". |
| Confusion: 2 distinct features in one package (loop + team-factory) | Medium | Clear README section separation; distinct slash commands; don't auto-trigger team-factory from loop. |
| Upstream evolves (v1.3+, new patterns) | Low | Port v1.2.x snapshot; document the version we forked from; review upstream changelog quarterly. |
| Gap 1 reduces feature parity | Low | Document the limitation explicitly in the skill. Most patterns don't need real-time messaging. |

## Next step

Phase 2.4: write `openspec/changes/team-architecture-factory/proposal.md` + `design.md` + `tasks.md` + spec deltas.

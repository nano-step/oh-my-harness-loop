---
name: team-architecture-factory
description: >-
  Agent team architecture factory — generates specialized agent definitions
  (.opencode/agents/) and skills (.opencode/skills/) from a domain description
  using 6 pre-defined team-architecture patterns (Pipeline, Fan-out/Fan-in,
  Expert Pool, Producer-Reviewer, Supervisor, Hierarchical Delegation).
  Use when: (1) "build a team for this project", "set up agent team",
  "design an agent architecture", "generate orchestrator skill",
  (2) "tạo team agent", "thiết kế kiến trúc agent", "xây dựng harness",
  "kiểm tra agent team",
  (3) "build a harness", "set up harness", "audit harness",
  (4) /harness-team slash command,
  (5) extending or auditing an existing agent team (".opencode/agents/"
  inventory check, agent dedup review).
  Generates: agent definitions, skill files, orchestrator skill, AGENTS.md
  pointer. Does NOT operate the harness gate-loop — for that use /harness-on.
---

# Team Architecture Factory

> Adapted from revfactory/harness (Apache-2.0). Upstream version: v1.2.0.
> See `assets/LICENSE-UPSTREAM` + `assets/NOTICE` for attribution.
> Provenance: https://github.com/revfactory/harness

Configures an agent team for a domain/project: defines each agent's role and generates the skills those agents will use. This is a **meta-skill** — its output is other agent/skill files in the consumer project, not direct work product.

**Core Principles:**
1. Generate agent definitions (`.opencode/agents/`) and skills (`.opencode/skills/`).
   EN: Create agent definitions (`.opencode/agents/`) and skills (`.opencode/skills/`).
2. **Use `task()` subagents as the default execution mode.**
   EN: Use the agent-team as the default execution mode — OpenCode has no real-time inter-agent messaging runtime, so `task()` subagents produce the same effect.
3. **Register a harness pointer in `AGENTS.md`** — record only the minimum pointer (trigger rules + change history) so the orchestrator skill auto-triggers in new sessions.
   EN: Record only minimal pointers (trigger rules + change history) in `AGENTS.md` so the orchestrator skill triggers in new sessions.
4. **A harness is not a static artifact — it evolves.** Reflect feedback after every run, continuously update agents, skills, and `AGENTS.md`.
   EN: A harness is not a fixture but an evolving system.

## Execution mode translation

| Upstream concept         | OpenCode equivalent                                       |
|--------------------------|-----------------------------------------------------------|
| `.claude/agents/`        | `.opencode/agents/`                                       |
| `.claude/skills/`        | `.opencode/skills/`                                       |
| `.claude/commands/`      | `.opencode/commands/` (only the team-architecture shim)   |
| `CLAUDE.md`              | `AGENTS.md`                                               |
| `TeamCreate(...)`        | `task(run_in_background=True)` + workspace files           |
| `SendMessage({to: ...})` | Workspace file at `_workspace/{phase}_{agent}.md`         |
| `TaskCreate/Update`      | `_workspace/tasks.json` (optional)                        |
| `Agent(prompt, type)`    | `task(subagent_type=..., prompt=...)`                     |
| `model: "opus"`          | (omit — OpenCode controls model selection)                |

**Why `task()` subagents are the default**: OpenCode does **not** ship a live multi-agent messaging channel between subagents. Workspace files at `_workspace/{phase}_{agent}.md` cover the same orchestration patterns (data handoff, intermediate artifacts, audit trail) without the missing runtime. This is a deliberate trade-off: drop live inter-agent messaging, keep the file-based coordination contract that the upstream patterns depend on.

## Workflow

### Phase 0: Audit existing state

When this skill triggers, the very first action is to read the existing harness state.

1. Read `.opencode/agents/`, `.opencode/skills/`, `AGENTS.md` (project root paths).
2. Branch on findings:
   - **New build**: agent/skill directories missing or empty → execute Phases 1-7 from start.
   - **Extend existing**: harness exists, new agent/skill requested → use the Phase Selection Matrix below to run only required phases.
   - **Maintenance**: explicit audit/sync request → jump to Phase 7-5 maintenance workflow.

   **Phase Selection Matrix (when extending):**
   | Change type       | Phase 1 | Phase 2        | Phase 3         | Phase 4                | Phase 5              | Phase 6 |
   |-------------------|---------|----------------|-----------------|------------------------|----------------------|---------|
   | Add agent         | skip    | placement only | required (3-0)  | if dedicated skill (4-0) | update orchestrator  | required |
   | Add/modify skill  | skip    | skip           | skip            | required (4-0)         | if wiring changes    | required |
   | Architecture change | skip  | required       | only affected (3-0) | only affected (4-0) | required           | required |
3. Compare the existing agent/skill list with the `AGENTS.md` pointer to detect drift.
4. Summarize audit findings to the user and confirm the execution plan before proceeding.

### Phase 1: Domain analysis

1. Extract domain/project from the user request.
2. Identify core task types (create, verify, edit, analyze, etc.).
3. Based on Phase 0 results, analyze conflicts/duplicates with existing agents/skills.
4. Explore the project codebase — tech stack, data models, key modules.
5. **Detect user proficiency level** — use context clues (terminology, question depth) to gauge technical level. For non-coder users, don't use terms like "assertion" or "JSON schema" without explanation.

### Phase 2: Team architecture design

#### 2-1. Execution mode selection

**`task()` subagents are the priority default.** Whenever 2+ agents need to collaborate, design the team using `task()` first. Subagents share intermediate artifacts via workspace files (`_workspace/`), which provides result-quality benefits comparable to live messaging (shared discoveries, conflicting-data resolution, gap coverage).

| Mode                  | When to use                                                  | Characteristics                                         |
|-----------------------|--------------------------------------------------------------|---------------------------------------------------------|
| **Subagents** (default) | 2+ collaborators, parallel/sequential coordination, intermediate artifact handoff | `task(subagent_type=..., prompt=...)` per agent; results via workspace files |
| **Single subagent** (alternative) | One-shot task, result-only needed, no inter-agent handoff | `task()` direct call; minimum overhead |
| **Hybrid**            | Each phase has different characteristics — e.g., parallel collection (subagents) → consensus integration (subagents with shared review) | Phase-by-phase mode declared in orchestrator |

**Decision order:**
1. First consider subagent design — if 2+ agents, default to it.
2. If inter-agent handoff is structurally unnecessary (just result pass-through) and overhead would outweigh gain, choose single subagent.
3. If phases differ sharply, consider hybrid — declare each phase's mode in the orchestrator.

> Detailed comparison tables and pattern-specific decision trees: see `references/agent-design-patterns.md` → "Execution modes".

#### 2-2. Architecture pattern selection

1. Decompose work into specialist domains.
2. Decide subagent structure (architecture pattern; see `references/agent-design-patterns.md`):
   - **Pipeline** (pipeline) — sequential dependent stages.
   - **Fan-out/Fan-in** (fan-out/fan-in) — parallel independent work.
   - **Expert Pool** (expert pool) — context-routed specialist selection.
   - **Producer-Reviewer** (producer-reviewer) — generate then quality-gate.
   - **Supervisor** (supervisor) — central agent manages state and dynamic dispatch.
   - **Hierarchical Delegation** (hierarchical delegation) — top-down recursive decomposition.

#### 2-3. Agent separation criteria

Decide on 4 axes: expertise, parallelism, context, reusability. Detailed criteria table: `references/agent-design-patterns.md` → "Agent separation criteria". Overlap and reuse with existing agents is handled in Phase 3-0.

### Phase 3: Agent definition generation

#### 3-0. Existing agent overlap check

Before creating a new agent, check `.opencode/agents/` for overlap. Repeated harness builds tend to accumulate agents with overlapping roles under different names.

> Overlap classification + reuse design: `references/agent-design-patterns.md` → "Agent reuse design".

**Every agent MUST be defined as a file at `.opencode/agents/{name}.md`.** Pasting a role directly into a `task()` call's prompt without a corresponding agent file is forbidden. Reasons:
- File-based agent definitions are reusable across sessions.
- Inter-agent protocol is explicit, which guarantees collaboration quality.
- The core value of the harness is the separation of "who" (agent) from "how" (skill).

Even when using built-in subagent types (`general`, `explore`, `plan`, etc.), create an agent definition file. Built-in types are specified via `task()`'s `subagent_type` parameter; the agent file contains role + principles + protocol.

**Model configuration:** Omit model specification entirely — OpenCode controls model selection per agent (see `opencode.json` config). Do not hardcode any specific model id in agent files.

**Team restructuring:** If pipeline-like patterns need different specialist combinations per phase, save the previous phase's output to files, then construct new subagent calls for the next phase. OpenCode's `task()` is stateless between calls; state lives in workspace files.

Define each agent at `.opencode/agents/{name}.md`. Required sections: core role, working principles, input/output protocol, error handling, collaboration. For multi-agent phases, add `## Inter-agent protocol` section specifying handoff targets, message receipt, and task-request scope.

> Definition templates and full file examples: `references/agent-design-patterns.md` → "Agent definition structure" + `references/team-examples.md`.

**QA agent requirements (when included):**
- Use `general` subagent type for QA — `explore` is read-only and cannot execute verification scripts.
- QA's core is **"boundary-mismatch detection"** — read API responses and frontend hooks simultaneously, compare shapes.
- QA runs **incrementally** after each module, not once at the end.
- Detailed guide: `references/qa-agent-guide.md`.

### Phase 4: Skill generation

Generate skills each agent will use at `.opencode/skills/{name}/SKILL.md`. Detailed authoring guide: `references/skill-writing-guide.md`.

#### 4-0. Existing skill overlap check

Before creating a new skill, check `.opencode/skills/` for overlap. Repeated harness builds tend to accumulate functionally-overlapping skills under different names.

> Overlap classification + generalization patterns: `references/skill-writing-guide.md` → "Skill reuse design".

#### 4-1. Skill structure

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown body
└─ Bundled Resources (optional)
    ├── scripts/    - executable code for repetitive/deterministic tasks
    ├── references/ - on-demand reference docs (loaded when relevant)
    └── assets/     - files used in output (templates, images, etc.)
```

#### 4-2. Description writing — pushy triggers

Description is the only trigger mechanism. LLMs tend to judge triggers conservatively, so write descriptions **"pushy"** — both what the skill does AND when to use it.

**Bad:** `"A skill for processing PDF documents"`
**Good:** `"Read PDF files, extract text/tables, merge, split, rotate, watermark, encrypt, OCR, and all other PDF operations. When any .pdf file is mentioned or PDF output is requested, you MUST use this skill."`

Key: skill purpose + concrete trigger situations + distinction from similar but non-trigger cases.

#### 4-3. Body writing principles

| Principle | Description |
|-----------|-------------|
| **Explain WHY** | Don't use coercive "ALWAYS/NEVER" — explain the reason. LLMs that understand the reason decide correctly in edge cases. |
| **Stay lean** | Context window is a public good. Target ≤500 lines for SKILL.md body; move details to `references/`. |
| **Generalize** | Prefer rules that explain a principle over narrow rules that fit only one example. No overfitting. |
| **Bundle repeated code** | When agents repeatedly generate common scripts in tests, pre-bundle them in `scripts/`. |
| **Use imperative mood** | "do X" imperative form. |

#### 4-4. Progressive Disclosure (authoring pattern)

Skills use a 3-stage loading system to manage context:

| Stage                       | Load timing                  | Size target    |
|-----------------------------|------------------------------|----------------|
| **Metadata** (name + description) | always in context         | ~100 words     |
| **SKILL.md body**           | when skill triggers          | <500 lines     |
| **references/**             | only when needed             | unlimited (scripts run without loading) |

**Size management rules:**
- When SKILL.md nears 500 lines, split details into `references/` and leave a "when to read this file" pointer in the body.
- Reference files >300 lines include a **Table of Contents** at the top.
- For domain/framework variants, split under `references/` by domain so only relevant files load.

```
cloud-deploy/
├── SKILL.md (workflow + selection guide)
└── references/
    ├── aws.md    ← load only when AWS selected
    ├── gcp.md
    └── azure.md
```

#### 4-5. Skill-agent binding

- 1 agent ↔ 1..N skills (1:1 or 1:many).
- Multiple agents can share a single skill.
- Skills hold "how" (procedural knowledge); agents hold "who" (role/responsibility).

> Detailed patterns, examples, and data schema standards: `references/skill-writing-guide.md`.

### Phase 5: Integration & orchestration

The orchestrator is a special form of skill that ties individual agents and skills into a single workflow. Where Phase 4 skills define "what each agent does and how", the orchestrator defines "who collaborates with whom, in what order". Concrete templates: `references/orchestrator-template.md`.

**Modifying an existing orchestrator:** When extending (not new build), modify the existing orchestrator rather than creating a new one. Reflect new agents in team composition, task assignment, and data flow; add new agent-related trigger keywords to the description.

#### 5-0. Orchestrator patterns (per mode)

**Subagent pattern (default):**
Orchestrator calls `task(subagent_type=..., prompt=...)` for each specialist. Parallel execution via `run_in_background=True`; results return to orchestrator only.

```
[Orchestrator]
    ├── task(agent-1, run_in_background=true)
    ├── task(agent-2, run_in_background=true)
    ├── await results, collect
    └── integrate outputs
```

**Single-subagent pattern (alternative):**
One-shot `task()` direct call. No orchestration overhead.

**Hybrid pattern:**
Mix modes per phase. Common combinations:
- **Parallel collection (subagents) → Consensus integration (subagents with shared review)**: Phase 2 collects independent material via parallel subagents; Phase 3 calls review subagents on the combined artifact.
- **Team creation (subagents) → Verification (single subagent)**: Phase 2 generates drafts via subagents; Phase 3 has one verification subagent independently verify.
- **Phase-by-phase reconstruction**: Each phase creates a fresh subagent group; prior outputs become input files for the next phase.

For hybrid, declare each phase's execution mode at the top of that phase's section in the orchestrator (e.g., `**Execution mode:** subagents`).

#### 5-1. Data passing protocol

Declare how agents exchange data within the orchestrator:

| Strategy             | Mechanism                                                | Mode          | Best for                                          |
|----------------------|----------------------------------------------------------|---------------|---------------------------------------------------|
| **File-based**       | Write/read at agreed paths                               | subagent+single | Large data, structured artifacts, audit trail   |
| **Task-based**       | `_workspace/tasks.json` (read/update task state)         | subagent      | Progress tracking, dependency mgmt               |
| **Message-based**    | Workspace file at `_workspace/{phase}_{...}.md`           | subagent      | Lightweight state, real-time coordination         |
| **Return-value**     | `task()` return message to orchestrator                  | single        | Subagent result direct collection                 |

**Recommended subagent combo:** task-based (coordination) + file-based (artifacts) + message-based (lightweight real-time).
**Recommended single combo:** return-value-based (collection) + file-based (large data).
**Hybrid:** apply per phase.

File-based passing rules:
- Create `_workspace/` under the work directory for intermediate artifacts.
- Filename convention: `{phase}_{agent}_{artifact}.{ext}` (e.g., `01_analyst_requirements.md`).
- Only final outputs go to user-specified paths; intermediate files (`_workspace/`) are preserved (post-verification + audit).

#### 5-2. Error handling

Include error handling policy in the orchestrator. Core principle: 1 retry, then proceed without the failed result (note omission in report); conflicting data is not deleted but annotated with sources.

> Per-error-type strategy table and implementation: `references/orchestrator-template.md` → "Error handling".

#### 5-3. Team size guidelines

| Work scale                  | Recommended team size | Tasks per member |
|-----------------------------|----------------------|------------------|
| Small (5-10 tasks)          | 2-3                  | 3-5              |
| Medium (10-20 tasks)        | 3-5                  | 4-6              |
| Large (20+ tasks)           | 5-7                  | 4-5              |

> More team members = more coordination overhead. 3 focused members beat 5 scattered ones.

#### 5-4. AGENTS.md harness pointer registration

After harness assembly, register a minimal pointer in the project's `AGENTS.md`. `AGENTS.md` is loaded every new session, so recording the harness existence and trigger rules is enough for the orchestrator skill to handle the rest.

**`AGENTS.md` template:**

````markdown
## Harness: {domain-name}

**Goal:** {one-line harness goal}

**Trigger:** For {domain}-related work requests, use the `{orchestrator-skill-name}` skill. Simple questions can be answered directly.

**Change history:**
| Date       | Change          | Scope  | Reason |
|------------|-----------------|--------|--------|
| {YYYY-MM-DD} | Initial setup | entire | - |
````

**What NOT to put in `AGENTS.md`:** agent list, skill list, directory structure, detailed execution rules. Reason: agent/skill list is managed by the orchestrator skill and `.opencode/agents/`, `.opencode/skills/`. Directory structure is directly checkable from the file system. `AGENTS.md` holds **only the pointer (trigger rules) + change history**.

#### 5-5. Follow-up support

The orchestrator handles not just initial execution but follow-up work too. Guarantee these three:

**1. Orchestrator description includes follow-up keywords:**
Initial-creation keywords alone won't trigger follow-up requests. Required follow-up expressions:
- "rerun", "re-execute", "update", "fix", "enhance"
- "rerun only the {partial task} of {domain}"
- "based on previous results", "improve the result"

**2. Orchestrator Phase 1 includes a context check step:**
At workflow start, check existing artifacts to decide execution mode:
- `_workspace/` exists + user requests partial modification → **partial re-execution** (call only the relevant agent)
- `_workspace/` exists + user provides new input → **new execution** (move existing `_workspace/` to `_workspace_prev/`)
- `_workspace/` missing → **initial execution**

**3. Agent definition includes re-invocation instructions:**
Each agent `.md` specifies "behavior when previous output exists":
- If previous result file exists, read it and reflect improvements.
- If user feedback is given, modify only that part.

> Orchestrator template "Phase 0: context check" section: `references/orchestrator-template.md`.

### Phase 6: Validation & testing

Validate the generated harness. Detailed testing methodology: `references/skill-testing-guide.md`.

#### 6-1. Structural validation
- All agent files in correct locations.
- Skill frontmatter (name, description) valid.
- Inter-agent reference consistency.
- No command files generated.

#### 6-2. Mode-specific validation
- **Subagents**: handoff paths between agents, task dependencies, team size appropriate.
- **Single subagent**: input/output wiring, `run_in_background` setting, result-collection logic.
- **Hybrid**: each phase's mode declared in orchestrator, data handoff at phase boundaries not broken.

#### 6-3. Skill execution testing
For each generated skill:
1. **Write test prompts** (2-3 realistic ones) — concrete, natural sentences a real user might input.
2. **With-skill vs Without-skill comparison** — run in parallel where possible; spawn two subagents per test:
   - **With-skill**: read skill, then perform task.
   - **Without-skill (baseline)**: same prompt, no skill.
3. **Result evaluation** — qualitative (user review) + quantitative (assertion-based) where objectively verifiable.
4. **Iterative improvement loop** — when issues found:
   - **Generalize** the feedback to fix the skill (no narrow one-example fixes).
   - Re-test.
   - Repeat until user is satisfied or no meaningful improvement remains.
5. **Bundle repeated patterns** — common helper scripts generated across tests get pre-bundled to `scripts/`.

#### 6-4. Trigger validation
Verify each skill's description triggers correctly:
1. **Should-trigger queries** (8-10) — various expressions (formal/casual, explicit/implicit) that should trigger.
2. **Should-NOT-trigger queries** (8-10) — near-miss queries where similar keywords would suggest a different tool/skill.

**Near-miss test value:** "Write a fibonacci function" is obviously unrelated — worthless as a test. "Extract the chart from this xlsx file to PNG" (xlsx skill vs image conversion) — **ambiguous boundary** makes a good test case.

#### 6-5. Dry-run testing
- Orchestrator skill's phase order is logical.
- No dead links in data passing paths.
- Every agent's input matches the prior phase's output.
- Per-error-scenario fallback paths are executable.

#### 6-6. Test scenarios
Add a `## Test scenarios` section to the orchestrator skill — at least 1 happy-path + 1 error-path.

### Phase 7: Harness evolution

A harness is not a one-time static artifact. It evolves continuously with user feedback.

#### 7-1. Post-run feedback collection
After every harness run, ask the user:
- "Is there anything to improve in the result?"
- "Anything to change in the agent team composition or workflow?"

Don't force it, but always offer the opportunity.

#### 7-2. Feedback reflection paths

| Feedback type        | Modify target         | Example                                |
|----------------------|----------------------|----------------------------------------|
| Output quality       | The relevant agent's skill | "Analysis too shallow" → add depth criteria |
| Agent role           | Agent definition `.md` | "Need security review too" → add new agent |
| Workflow order       | Orchestrator skill    | "Verify first" → reorder phases        |
| Team composition     | Orchestrator + agents | "These two could merge" → merge agents |
| Missing trigger      | Skill description     | "This phrase doesn't work" → expand description |

#### 7-3. Change history
Record all changes in `AGENTS.md`'s **change history** table (same table as Phase 5-4 template):

```markdown
**Change history:**
| Date       | Change         | Scope  | Reason |
|------------|----------------|--------|--------|
| 2026-04-05 | Initial setup  | entire | - |
| 2026-04-07 | Added QA agent | agents/qa.md | Output quality verification gap from feedback |
| 2026-04-10 | Added tone guide | skills/content-creator | "Too stiff" feedback |
```

This history tracks evolution direction and prevents regressions.

#### 7-4. Evolution triggers
Beyond explicit "modify the harness" requests, propose evolution when:
- Same feedback type repeats 2+ times.
- Agents repeatedly fail in the same pattern.
- User is observed bypassing the orchestrator to work manually.

#### 7-5. Operations/maintenance workflow
Systematic inspection/modification/sync of an existing harness. Entered when Phase 0 branches to "maintenance".

**Step 1: Audit**
- Compare `.opencode/agents/` file list vs orchestrator skill's agent composition → generate mismatch list.
- Compare `.opencode/skills/` directory list vs orchestrator skill's skill composition → generate mismatch list.
- Report audit results to user.

**Step 2: Incremental add/modify**
- Per user request, add/modify/delete agents, add/modify/delete skills.
- One change at a time, immediately run Step 3 (sync) after each.

**Step 3: Update `AGENTS.md` change history**
- Record date, change, scope, reason in the change history table.

**Step 4: Validate changes**
- Structural validation of modified agent/skill (per Phase 6-1).
- If change scope affects triggers, trigger validation (per Phase 6-4).
- Large changes (architecture, 3+ agents added/removed): run Phase 6-3 (execution tests), 6-5 (dry-run).
- Final consistency check: `AGENTS.md` vs actual files.

## Deliverable checklist

After generation, verify:
- [ ] `.opencode/agents/` — **agent definition files required** (even for built-in types, files must exist)
- [ ] `.opencode/skills/` — skill files (SKILL.md + references/)
- [ ] Orchestrator skill 1 (data flow + error handling + test scenarios included)
- [ ] Execution mode declared (subagent / single subagent / hybrid; for hybrid, mode per phase)
- [ ] No hardcoded model ids in agent files
- [ ] New agent creation: existing agent overlap check done (Phase 3-0)
- [ ] New skill creation: existing skill overlap check done (Phase 4-0)
- [ ] `.opencode/commands/` — no harness-related commands generated (the `/harness-team` shim is shipped by the plugin, not by this skill)
- [ ] No conflict with existing agents/skills
- [ ] Skill descriptions are "pushy" — **including follow-up keywords**
- [ ] SKILL.md body ≤500 lines; excess split to `references/`
- [ ] Test prompts 2-3 run as execution verification
- [ ] Trigger validation (should-trigger + should-NOT-trigger) done
- [ ] **`AGENTS.md` harness pointer registered** (trigger rules + change history)
- [ ] **`AGENTS.md` change history records agent/skill add/remove/modify**
- [ ] **Orchestrator Phase 1 has context check** (initial / follow-up / partial re-execution)

## References

- `references/agent-design-patterns.md` — 6 patterns + execution modes + agent separation criteria
- `references/orchestrator-template.md` — orchestrator scaffolds (subagent / single / hybrid)
- `references/team-examples.md` — 5 real-world domain examples (research, novel, webtoon, code review, migration)
- `references/skill-writing-guide.md` — Progressive Disclosure + body rules + generalization patterns
- `references/skill-testing-guide.md` — with/without-skill A/B methodology
- `references/qa-agent-guide.md` — boundary-mismatch detection + 7 documented bug patterns

## OpenCode-specific notes

- **Skill loading mechanism:** OpenCode reads `.opencode/agents/*.md` (plural) and `.opencode/skills/<name>/SKILL.md` from the project root as first-class conventions. The `mode: subagent` frontmatter in agent files marks them as invocable via `task(subagent_type=...)`. Reference docs (`references/*.md`) are loaded on demand by the agent.
- **Distribution:** This skill is shipped as a npm-bundled `skills/team-architecture-factory/` directory inside `@nano-step/oh-my-harness`. Activation is the `/harness-team` slash command, which injects a prompt that tells the in-session agent to load and execute this skill. No state file is read or written.
- **No live inter-agent messaging:** Unlike upstream Claude Code, OpenCode does not expose an inter-agent message channel between subagents. This is why workspace files (`_workspace/`) are the orchestration substrate throughout this skill. The 6 architecture patterns still apply; only the transport changes.
- **Model selection:** OpenCode controls model selection per agent (via `opencode.json`'s `agent.<name>.model` field). Do NOT hardcode any specific model id in agent files — let the project's `opencode.json` decide.
- **Orthogonal to the gate-loop plugin:** This skill writes to `.opencode/agents/` and `.opencode/skills/`. It NEVER touches `.opencode/harness-loop.local.json`, `.opencode/harness.config.json`, or any file under `docs/harness/`. Those are the gate-loop plugin's files (managed by `/harness-on`/`/harness-off`/`/harness-check`/`/harness-init`).
- **Verification status:** T0 pre-implementation verification (does OpenCode load `.opencode/agents/*.md` files) **PASSED** on opencode 1.15.10. Confirmed against `https://opencode.ai/docs/config/` documentation: agents and skills use plural directory names by convention.

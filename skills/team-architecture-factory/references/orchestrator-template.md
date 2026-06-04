# Orchestrator Skill Template

> Adapted from revfactory/harness (Apache-2.0). Upstream version: v1.2.0.

The orchestrator is the higher-level skill that coordinates the whole team. Provides 3 templates per execution mode:

- **Template A: subagent-group mode (default)** — first choice for 2+ collaborator scenarios
- **Template B: single-subagent mode (alternative)** — when team communication is not needed
- **Template C: hybrid mode** — mix modes per Phase


---

## Template A: subagent-group mode (default · first choice)

When 2+ agents collaborate, **first review this default mode**. Spawn subagents via `task()` and coordinate via shared workspace files.


```markdown
---
name: {domain}-orchestrator
description: "{Domain} agent team orchestrator. {Initial trigger keywords}. Follow-up keywords: re-run, update, refine, partial re-run, modify, supplement, improve, iterate."
---

# {Domain} Orchestrator

Integrative skill that coordinates the {domain} agent team to produce {final artifact}.

## Execution mode: subagent group

## Agent composition

| Member | Agent type | Role | Skill | Output |
|--------|-----------|------|-------|--------|
| {teammate-1} | {custom or built-in} | {role} | {skill} | {output-file} |
| {teammate-2} | {custom or built-in} | {role} | {skill} | {output-file} |
| ... | | | | |

## Workflow

### Phase 0: Context check (follow-up support)

Check existing artifacts to decide execution mode:

1. Check whether `_workspace/` directory exists
2. Decide execution mode:
   - **`_workspace/` does NOT exist** → initial run. Proceed to Phase 1
   - **`_workspace/` exists + user requests partial modification** → partial re-run. Re-invoke only the relevant subagent; overwrite only the targeted artifact
   - **`_workspace/` exists + new input provided** → new run. Move existing `_workspace/` to `_workspace_{YYYYMMDD_HHMMSS}/` and proceed with Phase 1
3. For partial re-run: include previous artifact path in subagent prompt, instruct subagent to read existing result and reflect feedback

### Phase 1: Preparation
1. Parse user input — {what to extract}
2. Create `_workspace/` in working directory
   - **Initial run**: create new `_workspace/`
   - **New run**: move existing `_workspace/` to `_workspace_{YYYYMMDD_HHMMSS}/` immediately, then create new `_workspace/`
3. Save input data to `_workspace/00_input/`

### Phase 2: Spawn subagents

1. Spawn subagents (parallel via `run_in_background=true`):
   ```
   task(subagent_type="{teammate-1}", prompt="{role and instructions}", run_in_background=true)
   task(subagent_type="{teammate-2}", prompt="{role and instructions}", run_in_background=true)
   ...
   ```

2. Register tasks in `_workspace/tasks.json`:
   ```
   tasks: [
     { title: "{task-1}", description: "{detail}", assignee: "{teammate-1}" },
     { title: "{task-2}", description: "{detail}", assignee: "{teammate-2}" },
     { title: "{task-3}", description: "{detail}", depends_on: ["{task-1}"] },
     ...
   ]
   ```

   > 5-6 tasks per subagent is the sweet spot. Express dependencies with `depends_on`.


### Phase 3: {Main work — e.g., research/generation/analysis}

**Execution:** subagents self-coordinate via workspace files.

Subagents claim tasks from `_workspace/tasks.json` and work independently. Leader monitors progress and intervenes as needed.

**Inter-subagent rules:**
- {teammate-1} writes a note at `{workspace}/notes/for_{teammate-2}.md` to share {what info}
- {teammate-2} writes its result to file and notifies leader by completing its task in `tasks.json`
- If a subagent needs another subagent's result, it reads from `_workspace/`

**Artifact storage:**

| Member | Output path |
|--------|-------------|
| {teammate-1} | `_workspace/{phase}_{teammate-1}_{artifact}.md` |
| {teammate-2} | `_workspace/{phase}_{teammate-2}_{artifact}.md` |

**Leader monitoring:**
- Subagent idle notification received automatically when `run_in_background=true` task completes
- If a subagent is stuck, write a directive note to its workspace or reassign the task in `tasks.json`
- Overall progress: read `tasks.json` to check status


### Phase 4: {Follow-up work — e.g., verification/integration}
1. Await all subagents' task completion (check `tasks.json` status)
2. Read each subagent's artifact via `Read`
3. {Integration / verification logic}
4. Final artifact: `{output-path}/{filename}`

### Phase 5: Cleanup
1. Subagent calls complete naturally (no explicit teardown needed)
2. `_workspace/` directory preserved (do NOT delete intermediate artifacts — for post-verification + audit)
3. Report result summary to user

> **Team reconfiguration between phases:** If different expert mixes are needed across phases, await all current subagent completions, then spawn new subagents for the next Phase. Previous outputs preserved in `_workspace/`, new subagents can `Read` them.
>
> EN: If different expert mixes are needed across Phases, wait for current subagent completions then spawn new subagents. Previous outputs preserved in `_workspace/`, new subagents can `Read` them.

## Data flow

```
[Leader] → task() × N (run_in_background) → [subagent-1] ←workspace note→ [subagent-2]
                                  │                                │
                                  ↓                                ↓
                            artifact-1.md                  artifact-2.md
                                  │                                │
                                  └────────── Read ────────────────┘
                                            ↓
                                   [Leader: integrate]
                                            ↓
                                       final artifact
```

## Error handling

| Situation | Strategy |
|-----------|----------|
| 1 subagent fails/halts | Leader detects via timeout → writes status check note → restart or spawn replacement |
| >50% subagents fail | Notify user and ask whether to continue |
| Timeout | Use partial results collected so far, terminate incomplete subagents |
| Inter-subagent data conflict | Note sources side by side, do NOT delete |
| Task status lagging | Leader reads `tasks.json` to check, manually updates if needed |

## Test scenarios

### Normal flow
1. User provides {input}
2. Phase 1 derives {analysis result}
3. Phase 2 spawns ({N} subagents + {M} tasks)
4. Phase 3 subagents self-coordinate and perform work
5. Phase 4 integrates artifacts, produces final result
6. Phase 5 cleanup
7. Expected: `{output-path}/{filename}` created

### Error flow
1. Phase 3: {teammate-2} halts due to error
2. Leader receives idle notification
3. Writes status check note → attempts restart
4. Restart fails → reassigns {teammate-2}'s work to {teammate-1}
5. Proceeds to Phase 4 with remaining results
6. Final report notes "{teammate-2}'s area partially uncollected"

---

## Template B: single-subagent mode (alternative)

When team-communication overhead is unnecessary. Call directly via `task()` and collect results from return values.


```markdown
---
name: {domain}-orchestrator
description: "{Domain} agent orchestrator. {Initial trigger keywords}. Includes follow-up keywords."
---

## Execution mode: single subagent

## Agent composition

| Agent | subagent_type | Role | Skill | Output |
|-------|--------------|------|-------|--------|
| {agent-1} | {built-in or custom} | {role} | {skill} | {output-file} |
| {agent-2} | ... | ... | ... | ... |

## Workflow

### Phase 0: Context check
(Same as Template A — branch on `_workspace/` existence)

### Phase 1: Preparation
1. Parse input
2. Create `_workspace/` (initial run, or move existing to backup dir on new run)

### Phase 2: Parallel execution

In a single message, call N `task()` invocations concurrently:

| Agent | Input | Output | run_in_background |
|-------|-------|--------|-------------------|
| {agent-1} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` | true |
| {agent-2} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` | true |

### Phase 3: Integration
1. Collect each agent's return value
2. File-based artifacts collected via `Read`
3. Apply integration logic → final artifact

### Phase 4: Cleanup
1. Preserve `_workspace/`
2. Report result summary

## Error handling
- 1 agent fails: 1 retry. If retry fails, note the gap and continue
- >50% fail: notify user and ask whether to continue
- Timeout: use partial results collected so far
```

---

## Template C: hybrid mode

Use different execution modes per Phase. Declare `**Execution mode:** {group | single}` at the top of each Phase.

```markdown
---
name: {domain}-orchestrator
description: "{Domain} orchestrator (hybrid). {Keywords}. Includes follow-up keywords."
---

## Execution mode: hybrid

| Phase | Mode | Reason |
|-------|------|--------|
| Phase 2 (parallel collection) | Single subagent | Independent data collection, no group coordination needed |
| Phase 3 (consensus integration) | Subagent group | Conflict discussion + consensus needed |
| Phase 4 (independent verification) | Single subagent | One QA subagent does objective verification |

## Workflow

### Phase 2: Parallel data collection
**Execution mode:** single subagent

In a single message, N `task()` calls in parallel (`run_in_background=true`).
Each result saved at `_workspace/02_{agent}_raw.md`.

### Phase 3: Consensus-based integration
**Execution mode:** subagent group

1. Spawn integration group via `task()` (editor + fact-checker + synthesizer), all with `run_in_background=true`
2. Distribute tasks in `_workspace/tasks.json` — all subagents Read Phase 2's `_workspace/02_*` files
3. Subagents discuss conflicts via workspace notes, derive consensus in files
4. Final integrated document at `_workspace/03_integrated.md`
5. (Subagent calls complete naturally — no explicit teardown)

### Phase 4: Independent verification
**Execution mode:** single subagent

A single QA subagent reads `_workspace/03_integrated.md` and produces a verification report.
```

**Hybrid transition rules:**
- Group → Single: await all current subagent completions, then call `task()` for next single subagent
- Single → Group: pass single-subagent's file artifacts as `Read` paths to new group members
- Group → Group: await current subagents, spawn new group for next Phase

---

## Authoring principles

1. **Declare execution mode first** — orchestrator top states "subagent group" / "single subagent" / "hybrid". If hybrid, per-Phase mode table is required
2. **Group mode documents `task()` usage concretely** — subagent spec, task registration, coordination rules
3. **Single mode documents `task()` parameters fully** — subagent_type, prompt, run_in_background
4. **File paths are absolute** — no relative paths, clear paths relative to `_workspace/`
5. **Inter-Phase dependencies declared** — which Phase depends on which Phase's output. Hybrid especially emphasizes mode-switch points
6. **Error handling is realistic** — don't assume "everything succeeds"
7. **Test scenarios are mandatory** — at least 1 normal + 1 error

## Follow-up keywords for description

The orchestrator's `description` field needs more than just initial-trigger keywords. The following follow-up expressions MUST be included:

- Re-run / re-execute / update / modify / refine
- "Only redo {part} of {domain}"
- "Based on previous result", "improve result"
- Domain-related daily requests (e.g., for a launch strategy harness: "launch", "promotion", "trending", etc.)


Without follow-up keywords, the harness becomes dead code after first execution.

## Real orchestrator references

Fan-out/Fan-in pattern orchestrator base structure:
prepare → Phase 0 (context check) → spawn subagents + register tasks → N subagents parallel execution → Read + integrate → cleanup.
See `references/team-examples.md` for the research-team example.


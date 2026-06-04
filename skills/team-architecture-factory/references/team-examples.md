# Agent Team Examples

> Adapted from revfactory/harness (Apache-2.0). Upstream version: v1.2.0.

---

## Example 1: Research team (subagent mode — adapted from upstream agent-team mode)

### Team architecture: Fan-out/Fan-in
### Execution mode: subagents

```
[Leader/Orchestrator]
    ├── task(official-researcher, run_in_background=true)
    ├── task(media-researcher, run_in_background=true)
    ├── task(community-researcher, run_in_background=true)
    ├── task(background-researcher, run_in_background=true)
    ├── collect results (Read _workspace/)
    └── compose integrated report
```


### Agent composition

| Member | Agent type | Role | Output |
|--------|-----------|------|--------|
| official-researcher | `general` | Official docs/blogs | `_workspace/01_research_official.md` |
| media-researcher | `general` | Media/investment | `_workspace/01_research_media.md` |
| community-researcher | `general` | Community/SNS | `_workspace/01_research_community.md` |
| background-researcher | `general` | Background/competition/academic | `_workspace/01_research_background.md` |
| (Leader = orchestrator) | — | Integrated report | `final_report.md` |

> Research agents use the `general` built-in subagent type, but MUST be defined as `.opencode/agents/{name}.md` files. The file declares role, research scope, and inter-agent protocol to ensure reusability and collaboration quality.

### Orchestrator workflow (subagent mode)

```
Phase 1: Preparation
  - Parse user input (topic, research mode)
  - Create _workspace/

Phase 2: Spawn subagents (parallel)
  - task(subagent_type="official", prompt="Investigate official channels...", run_in_background=true)
  - task(subagent_type="media", prompt="Media/investment trends...", run_in_background=true)
  - task(subagent_type="community", prompt="Community reactions...", run_in_background=true)
  - task(subagent_type="background", prompt="Background/competition...", run_in_background=true)
  - Each writes output to _workspace/01_research_{scope}.md

Phase 3: Coordination via workspace files
  - Researchers read each other's drafts in _workspace/ to spot conflicts
  - Conflicting info is annotated in-place (sources noted, neither deleted)
  - Each researcher completes by writing file + notifying leader

Phase 4: Integration
  - Leader reads the 4 outputs from _workspace/
  - Composes integrated report
  - Conflicting data: sources noted side by side

Phase 5: Cleanup
  - Subagent calls complete naturally
  - _workspace/ preserved (post-verification + audit)
```

### Coordination pattern (workspace-file substitute for live messaging)

```
official ──reads──→ background  (when official announcement is discovered,
                                 researcher writes a note at top of their
                                 _workspace file pointing to background's draft)
media ────reads──→ background   (investment/M&A info: read cross-section)
community ─reads─→ media        (community reactions relevant to media)
all members ─update─→ _workspace/tasks.json  (progress updates)
leader ←──── idle notification ──── completed members  (automatic)
```


---

## Example 2: SF novel writing team (subagent mode)

### Team architecture: Pipeline + Fan-out
### Execution mode: subagents (hybrid per phase)

```
Phase 1 (parallel — subagents): worldbuilder + character-designer + plot-architect
  → coordinate via _workspace/ notes (consistency)
Phase 2 (sequential): prose-stylist (writing)
Phase 3 (parallel — subagents): science-consultant + continuity-manager (review)
  → coordinate via _workspace/ notes (discovery sharing)
Phase 4 (sequential): prose-stylist (incorporates review feedback)
```


### Agent composition

| Member | Agent type | Role | Skill |
|--------|-----------|------|-------|
| worldbuilder | custom | World-building | world-setting |
| character-designer | custom | Character design | character-profile |
| plot-architect | custom | Plot structure | outline |
| prose-stylist | custom | Style editing + writing | write-scene, review-chapter |
| science-consultant | custom | Science verification | science-check |
| continuity-manager | custom | Continuity verification | consistency-check |

### Agent file example: `worldbuilder.md`

```markdown
---
name: worldbuilder
description: "SF novel world-building specialist. Designs physics, social structure, tech level, history."
---

# Worldbuilder — SF World-Design Specialist

You are an SF novel world-design specialist. Building on scientific fact while extending imagination, you construct the physical, social, and technological foundation of the story's world.


## Core role
1. Define the world's physics and tech level
2. Design social structure, political system, economic system
3. Establish historical context and current conflict structure
4. Describe per-location environment and atmosphere

## Working principles
- Internal consistency is highest priority — no contradictions between settings
- "If this tech exists, then..." chain questions to infer cascading effects
- World-building serves the story — avoid excessive detail that disrupts the plot

## Input/output protocol
- Input: user's world concept, genre requirements
- Output: `_workspace/01_worldbuilder_setting.md`
- Format: markdown, sectioned (physics / society / technology / history / locations)

## Inter-agent protocol (via workspace files)
- To character-designer: write social structure / class system / occupations to shared note
- To plot-architect: write main conflicts and crisis elements to shared note
- From science-consultant: read feedback notes, update settings accordingly
- When world changes, broadcast via fresh note in _workspace/

## Error handling
- If concept is ambiguous, propose 3 directions and request selection
- On scientific error detection, present alternative together

## Collaboration
- Provide social structure info to character-designer
- Provide conflict structure info to plot-architect
- Reflect science-consultant's feedback into settings
```

### Team workflow detail

```
Phase 1: task(subagent_type="worldbuilder", prompt="..."),
         task(subagent_type="character-designer", prompt="..."),
         task(subagent_type="plot-architect", prompt="...")
         (run_in_background=true for parallel)
         → subagents work in parallel
         → worldbuilder finishes social structure → writes note in _workspace/
         → character-designer reads that note, designs protagonist → writes note
         → plot-architect reads both, designs plot

Phase 2: Wait for Phase 1; cleanup (subagent calls complete naturally)
         task(subagent_type="prose-stylist", prompt="Write from _workspace/*.md")
         → result saved at _workspace/02_prose_draft.md

Phase 3: New subagent group — task(subagent_type="science-consultant", ...),
                              task(subagent_type="continuity-manager", ...)
         (Note: in OpenCode, no team disambiguation needed; just new task calls)
         → both reviewers read draft, share discoveries via _workspace/ notes
         → science-consultant finds physics error → also writes to continuity-manager's review file
         → review complete

Phase 4: task(subagent_type="prose-stylist", prompt="Apply review from _workspace/reviews/")
         → final draft at _workspace/03_prose_final.md
```


---

## Example 3: Webtoon production team (single subagent mode)

### Team architecture: Producer-Reviewer
### Execution mode: single subagent

> In Producer-Reviewer patterns, 2 agents and result-passing is the core, so single subagent (sequential task calls) fits.
>
> EN: In the Producer-Reviewer pattern there are only 2 agents, and result-passing matters more than communication, so single subagent fits.

```
Phase 1: task(subagent_type="webtoon-artist", prompt="...") → generate panels
Phase 2: task(subagent_type="webtoon-reviewer", prompt="...") → review
Phase 3: task(subagent_type="webtoon-artist", prompt="Regenerate per _workspace/review_report.md") (up to 2 retries)
```


### Agent composition

| Agent | subagent_type | Role | Skill |
|-------|--------------|------|-------|
| webtoon-artist | custom | Panel image generation | generate-webtoon |
| webtoon-reviewer | custom | Quality review | review-webtoon, fix-webtoon-panel |

### Agent file example: `webtoon-reviewer.md`

```markdown
---
name: webtoon-reviewer
description: "Webtoon panel quality reviewer. Evaluates composition, character consistency, text readability, direction."
---

# Webtoon Reviewer — Webtoon Quality Review Specialist

You are a webtoon panel quality reviewer. Evaluate panels on visual completeness, story delivery, and character consistency.


## Core role
1. Evaluate each panel's composition and visual completeness
2. Verify character appearance consistency across panels
3. Evaluate speech-bubble text readability and placement
4. Review overall episode direction and pacing

## Working principles
- Verdict in 3 levels: PASS / FIX / REDO
- FIX = partial modification; REDO = full regeneration
- Judge on objective criteria (consistency, readability, composition), not subjective taste

## Input/output protocol
- Input: panel images at `_workspace/panels/`
- Output: `_workspace/review_report.md`
- Format:
  ```
  ## Panel {N}
  - Verdict: PASS | FIX | REDO
  - Reason: [concrete reason]
  - Fix instruction: [concrete fix direction if FIX/REDO]
  ```

## Error handling
- Image load failure → verdict REDO for that panel
- 2 regen cycles still REDO → force PASS with warning

## Collaboration
- Send fix instructions to webtoon-artist (via result file)
- Re-review regenerated panels (up to 2-cycle loop)
```

### Error handling

```
Retry policy:
- REDO-verdict panel → regeneration request to artist (with concrete fix instructions)
- Force PASS after 2 retry cycles
- If 50%+ of panels are REDO → suggest user modify prompt
```


---

## Example 4: Code review team (subagent mode)

### Team architecture: Fan-out/Fan-in + discussion
### Execution mode: subagents

> Code review is the canonical example where subagents shine. Reviewers with different perspectives share findings and challenge each other for deeper review.
>
> EN: Code review is the canonical example where subagents shine. Reviewers with different perspectives share findings and challenge each other for deeper review.

```
[Leader] → spawn 3 reviewers in parallel
    ├── security-reviewer: security vulnerability scan
    ├── performance-reviewer: performance impact analysis
    └── test-reviewer: test coverage verification
    → reviewers share findings via _workspace/ notes
    → leader synthesizes results
```

### Coordination pattern (workspace-file substitute)

```
security ──note at──→ performance  ("SQL injection possible; please verify perf impact")
performance ──note at──→ test      ("N+1 query found; check related tests?")
test ────note at──→ security      ("auth module untested; security priority?")
```


Key: reviewers coordinate **without going through the leader** for cross-area issues, fast-catch.

---

## Example 5: Supervisor pattern — code migration team (subagent mode)

### Team architecture: Supervisor
### Execution mode: subagents (with shared _workspace/tasks.json)

```
[supervisor/leader] → file list analysis → batch assignment
    ├→ [migrator-1] (batch A)
    ├→ [migrator-2] (batch B)
    └→ [migrator-3] (batch C)
    ← tasks.json update → additional batch or reassignment
```


### Agent composition

| Member | Role |
|--------|------|
| (Leader = migration-supervisor) | File analysis, batch distribution, progress management |
| migrator-1~3 | Migrate assigned file batches |

### Supervisor's dynamic distribution logic (subagent utilization)

```
1. Collect full target file list
2. Estimate complexity (file size, import count, dependencies)
3. Register file batches as tasks in _workspace/tasks.json (with dependencies)
4. Subagents "claim" tasks by updating tasks.json
5. When a subagent marks task complete in tasks.json:
   - success → supervisor claims next task
   - failure → supervisor writes cause note to tasks.json, reassigns to another subagent
6. All tasks complete → supervisor runs integration tests
```


---

## Output pattern summary

### Agent definition files
Location: `.opencode/agents/{agent-name}.md`
Required sections: core role, working principles, input/output protocol, error handling, collaboration
For multi-agent phases, add **Inter-agent protocol** section (workspace-file targets, scope)

### Skill file structure
Location: `.opencode/skills/{skill-name}/SKILL.md` (project level)
or: `~/.config/opencode/skills/{skill-name}/SKILL.md` (global level)

### Integration skill (orchestrator)
Higher-level skill that coordinates the whole team. Defines per-scenario agent composition and workflow.
Template: `references/orchestrator-template.md`.
**Execution mode MUST be declared** — subagent (default) or single subagent.

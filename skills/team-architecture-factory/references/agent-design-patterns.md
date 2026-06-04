# Agent Team Design Patterns

> Adapted from revfactory/harness (Apache-2.0). Upstream version: v1.2.0.
>
> EN: The original describes Claude Code's two modes: "agent team" and "sub-agent". OpenCode lacks live messaging and shared task-list primitives, so all coordination is replaced with `_workspace/` file-based primitives.

## Execution mode: subagent group vs single subagent


### Subagent group (formerly "agent team") — default mode

Orchestrator spawns multiple subagents via `task(subagent_type=..., run_in_background=true)`. Each subagent is an independent OpenCode session. Subagents coordinate via shared `_workspace/` files (no live messaging).


```
[Leader] ←→ [Subagent A] ←→ [Subagent B]
  ↕             ↕                ↕
  └──── shared _workspace/ + _workspace/tasks.json ────┘
```

**Core tools:**

| Pattern | OpenCode primitive |
|---------|-------------------|
| Spawn team | `task(subagent_type=team_name, run_in_background=true)` per member |
| Direct message | Write to `_workspace/{phase}_{recipient}.md` |
| Broadcast | Write to `_workspace/notes/all_members.md` (high cost, rare) |
| Shared work list | Read/write `_workspace/tasks.json` |


**Characteristics:**

- Subagents can challenge, verify, and discover each other via workspace notes
- Information exchanged between subagents without going through the leader
- Self-coordination via shared workspace files (subagents can claim work)
- Idle subagents notify the leader automatically (when leader awaits results)
- Plan-approval mode can review risky work beforehand


**Constraints:**

- All subagents in a phase must be active simultaneously (clean up by awaiting all completions)
- Nesting not possible (a subagent cannot spawn its own subagent unless itself an orchestrator)
- Leader role is fixed (cannot be transferred)
- Token cost high (each subagent has its own context)


**Team reconfiguration pattern (between phases):**

If different expert mixes are needed across phases, save previous phase's outputs to `_workspace/`, await all subagents to complete, then spawn new subagents. Previous outputs preserved in `_workspace/`, new subagents can `Read` them.


### Single subagent (formerly "sub-agents") — lightweight mode

The main agent spawns one subagent via `task(subagent_type=..., prompt=...)`. The subagent returns its result to the main agent only; no inter-subagent communication.


```
[Main] → [Sub A] → result returned
      → [Sub B] → result returned
      → [Sub C] → result returned
```

**Core tools:**

- `task(subagent_type, prompt, run_in_background)`: spawn subagent (returns JSON result)

**Characteristics:**

- Lightweight, fast
- Result summarized and returned to main context
- Token-efficient

**Constraints:**

- Subagents cannot communicate with each other
- Main agent does all coordination
- No real-time collaboration / challenge

### Mode selection decision tree

```
Are 2+ subagents needed?
├── Yes → Do they need to coordinate?
│         ├── Yes → Subagent group (default)
│         │         Cross-verification, discovery sharing, real-time feedback → quality up.
│         │
│         └── No → Single subagent is fine
│                  Producer-Reviewer, expert pool, result-passing only.
│
└── No (1) → Single subagent
            Single subagent doesn't need a group.
```

> **Core principle:** subagent group is the default. When choosing single subagent, ask "is inter-subagent coordination truly unnecessary?"
>
> EN: Core principle — subagent group is the default. When choosing single subagent, ask "is inter-subagent coordination truly unnecessary?"

---

## Subagent group architecture types

### 1. Pipeline

Sequential work flow. Output of one subagent is input of the next.

```
[Analyze] → [Design] → [Implement] → [Verify]
```

| When it fits | Example | Caveat |
|--------------|---------|--------|
| Each step strongly depends on previous step's output | Novel writing — world → characters → plot → writing → editing | Bottleneck delays entire pipeline; design each step as independent as possible |

**Subagent group suitability:** Strong sequential dependency limits subagent-group benefits. But if pipeline has parallel segments, subagent group is useful.

### 2. Fan-out/Fan-in

Parallel processing then integration. Independent work done simultaneously.

```
            ┌→ [Expert A] ─┐
[Distribute] → ├→ [Expert B] ─┼→ [Integrate]
            └→ [Expert C] ─┘
```

| When it fits | Example | Caveat |
|--------------|---------|--------|
| Same input needs different perspectives/domains | Comprehensive research — official/media/community/background surveyed in parallel → integrated report | Integration stage quality determines overall quality |

**Subagent group suitability:** The most natural pattern for subagent groups. **MUST be configured as a subagent group.** Subagents share findings and challenge each other; one subagent's discovery can real-time update another subagent's investigation direction → quality vastly higher than solo.


### 3. Expert Pool

Selectively call appropriate experts based on situation.

```
[Router] → { Expert A | Expert B | Expert C }
```

| When it fits | Example | Caveat |
|--------------|---------|--------|
| Different processing per input type | Code review — only relevant specialist (security/perf/architecture) is called | Router's classification accuracy is the key |

**Subagent group suitability:** Single subagent is better. Only the needed expert is called, no standing group required.

### 4. Producer-Reviewer

A producer subagent and a reviewer subagent operate as a pair.

```
[Produce] → [Review] → (on problem) → [Produce] re-run
```

| When it fits | Example | Caveat |
|--------------|---------|--------|
| Output quality is critical and objective verification criteria exist | Webtoon — artist generates → reviewer inspects → problem panels regenerate | Must set max retries (2-3) to prevent infinite loops |

**Subagent group suitability:** Subagent group is useful. Real-time feedback between producer↔reviewer via workspace notes.

### 5. Supervisor

A central subagent manages work state and dynamically distributes work to subordinates.

```
           ┌→ [Worker A]
[Supervisor] ─┼→ [Worker B]   ← supervisor sees state, redistributes
           └→ [Worker C]
```

| When it fits | Example | Caveat |
|--------------|---------|--------|
| Workload variable or runtime distribution decisions needed | Large-scale code migration — supervisor analyzes file list, assigns batches to workers | Set delegation unit large enough so supervisor isn't the bottleneck |

**Difference from Fan-out:** Fan-out fixes distribution ahead; supervisor adjusts dynamically as progress comes in.

**Subagent group suitability:** Subagent group's shared workspace (`_workspace/tasks.json`) naturally matches supervisor pattern. Workers register claims in tasks.json.

### 6. Hierarchical Delegation

Upper subagent recursively delegates to lower. Decompose complex problems stepwise.

```
[Top] → [Manager A] → [Worker A1]
                    → [Worker A2]
       → [Manager B] → [Worker B1]
```

| When it fits | Example | Caveat |
|--------------|---------|--------|
| Problem naturally decomposes hierarchically | Full-stack app — top → FE manager → (UI/logic/test) + BE manager → (API/DB/test) | Depth 3+ causes big latency + context loss; recommend ≤2 levels |

**Subagent group suitability:** Subagent groups cannot nest (a subagent cannot create a group). Implement Level 1 as subagent group, Level 2 as nested single-subagent calls, or flatten to a single group.


## Composite patterns

In practice, composite patterns are more common than single patterns:

| Composite pattern | Composition | Example |
|-------------------|-------------|---------|
| **Fan-out + Producer-Reviewer** | Parallel production then per-item review | Multilingual translation — 4 languages parallel translate → each native reviewer inspects |
| **Pipeline + Fan-out** | Sequential stage with parallel sub-segments | Analyze (sequential) → Implement (parallel) → Integration test (sequential) |
| **Supervisor + Expert Pool** | Supervisor dynamically dispatches experts | Customer inquiry — supervisor classifies inquiry, dispatches suitable expert |

### Execution mode for composite patterns

**Default: use subagent group for all composite patterns.** Active communication between subagents is the key driver of result quality.

| Scenario | Recommended mode | Reason |
|----------|-----------------|--------|
| **Research + analysis** | Subagent group | Surveyors share findings, discuss conflicts in real-time |
| **Design + implement + verify** | Subagent group | Designer↔implementer↔verifier feedback loop |
| **Supervisor + worker** | Subagent group | Dynamic assignment via shared task list, progress shared between workers |
| **Produce + verify** | Subagent group | Real-time feedback between producer↔reviewer minimizes rework |

> Mixing in single-subagent only when a single subagent performs a fully isolated one-shot task.
>
> EN: Mixing in single subagent only when a single subagent performs a fully isolated one-shot task.

## Agent type selection

When calling a subagent, set the `subagent_type` parameter. Subagent-group members can also use custom agent definitions.

### Built-in types

| Type | Tool access | Suitable for |
|------|-------------|--------------|
| `general` | All (Read, Write, Edit, Bash, etc.) | General tasks, mixed work |
| `explore` | Read-only (no Edit/Write) | Codebase exploration, analysis |
| `plan` | Read-only (no Edit/Write) | Architecture design, planning |

> Note: OpenCode built-in types differ from Claude Code. Claude Code has `general-purpose`; OpenCode uses `general`. The `Explore` and `Plan` types are lowercase (`explore`, `plan`).
>
> EN: OpenCode built-in types differ from Claude Code — `general-purpose` → `general`, `Explore` → `explore`, `Plan` → `plan`.

### Custom types

Define a subagent in `.opencode/agents/{name}.md`, then invoke it with `subagent_type: "{name}"`. Custom subagents have full tool access.


### Selection criteria

| Situation | Recommended | Reason |
|-----------|-------------|--------|
| Complex role, reused across sessions | **Custom type** (`.opencode/agents/`) | Persona + working principles managed in file |
| Simple survey/collection, prompt alone suffices | **`general`** + detailed prompt | No agent file needed, instructions in prompt |
| Read-only code work (analysis/review) | **`explore`** | Prevents accidental file modification |
| Design/planning only | **`plan`** | Focused analysis, prevents code changes |
| Implementation work that needs file modification | **Custom type** | Full tool access + specialized instructions |

**Principle:** every subagent MUST be defined as `.opencode/agents/{name}.md` file. Even built-in types should have a corresponding agent file declaring role, principles, protocol. The file must exist for cross-session reuse and inter-agent protocol to ensure collaboration quality.


**Model:** OpenCode uses default model for subagent calls; explicit `model` parameter rarely needed. If model override is critical, set it in the custom agent file's frontmatter.

## Agent definition structure

```markdown
---
name: agent-name
description: "1-2 sentence role description. Trigger keywords."
---

# Agent Name — One-line role summary

You are a [domain] [role] specialist.

## Core role
1. Role 1
2. Role 2

## Working principles
- Principle 1
- Principle 2

## Input/output protocol
- Input: [where and what]
- Output: [where and what]
- Format: [file format, structure]

## Inter-agent protocol (subagent-group mode)
- Message receipt: [from whom, what messages]
- Message sending: [to whom, what messages]
- Work request: [what types of work to request from shared task list]

## Error handling
- [Action on failure]
- [Action on timeout]

## Collaboration
- Relationship with other agents
```

## Agent separation criteria

| Criterion | Separate | Integrate |
|-----------|----------|-----------|
| Expertise | Different domains → separate | Overlapping domains → integrate |
| Parallelism | Can run independently → separate | Sequential dependency → consider integrating |
| Context | High context burden → separate | Lightweight, fast → integrate |
| Reusability | Used in other teams → separate | Used only in this team → consider integrating |

## Agent reuse design

Before creating a new agent, check for duplication with existing agents. When building harnesses repeatedly, role-overlapping agents tend to accumulate under different names.

| Situation | Action |
|-----------|--------|
| Existing agent fully covers new role | Forbid new creation — reuse existing |
| Existing agent partially covers and can generalize | Generalize existing agent to extend |
| Intentional domain-specific partial overlap | Proceed with new creation — keep as separate agent |
| Role scope completely different | Proceed with new creation |

**Principle:** the more an agent focuses on a single role, the higher its reusability and the lower the duplication. If the role has 2+ aspects, first check if it can be split.


**When generalizing an existing agent:** Orchestrators/team configurations that depend on it may change. Check dependencies before extending; after generalizing, dry-run to confirm existing behavior is preserved.

## Skill vs Agent distinction

| Aspect | Skill | Agent |
|--------|-------|-------|
| Definition | Procedural knowledge + tool bundle | Specialist persona + behavior principles |
| Location | `.opencode/skills/` | `.opencode/agents/` |
| Trigger | User request keyword match | Explicit invocation via `task()` |
| Size | Small to large (workflow) | Small (role definition) |
| Purpose | "How to do it" | "Who does it" |

Skills are **procedural guides** that agents reference when doing work.
Agents are **specialist role definitions** that use skills.


## Skill ↔ Agent linking patterns

3 ways an agent uses a skill:

| Pattern | Implementation | When to use |
|---------|----------------|-------------|
| **Skill tool call** | Agent prompt says "call skill via /skill-name" | Skill is independent workflow and user-callable |
| **Inline in prompt** | Skill content directly embedded in agent definition | Skill is short (≤50 lines) and dedicated to this agent |
| **Reference load** | `Read` skill's `references/` files on demand | Skill is large and conditionally needed |

Recommendation: high reusability → Skill tool; dedicated → inline; large → reference load.

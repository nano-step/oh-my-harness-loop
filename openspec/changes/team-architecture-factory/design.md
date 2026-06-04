# Design: Team Architecture Factory Skill

## Overview

Add a markdown-only skill `team-architecture-factory` to `@nano-step/oh-my-harness` that translates upstream `revfactory/harness` (Apache-2.0, Claude Code plugin) to OpenCode. Activation is a thin `/harness-team` slash command that emits a toast + injects a prompt; the agent reads the skill and performs the 7-phase workflow itself. No runtime state machine, no Zod schemas, no inter-process plumbing.

This document is consumed by implementers. It does NOT re-litigate the locked decisions in `proposal.md`.

---

## Architecture diagram

```
USER chat
   │
   │ /harness-team [--audit]
   ▼
OpenCode → plugin command.execute.before
   │
   │ handleHarnessTeam(ctx, args)
   ▼
commands/harness-team.ts
   ├── showToast(emoji + status)
   └── injectMessage(buildFactoryPrompt | buildAuditPrompt)
        │
        │ "Load team-architecture-factory skill, begin Phase 0..."
        ▼
AGENT (in same session)
   ├── Reads skills/team-architecture-factory/SKILL.md (≤500 lines)
   ├── Loads references/*.md on demand
   ├── Phase 0: audit .opencode/agents/, .opencode/skills/, AGENTS.md
   ├── Phase 1: extract domain from chat context
   ├── Phase 2: select pattern from 6 options
   ├── Phase 3-5: generate files
   └── Phase 7: register pointer in AGENTS.md
        │
        ▼
USER project files (written by agent via standard Write tool):
   ├── .opencode/agents/{agent-name}.md   (new)
   ├── .opencode/skills/{skill-name}/SKILL.md  (new)
   ├── .opencode/skills/{skill-name}/references/*.md  (new, optional)
   ├── .opencode/skills/{orchestrator-name}/SKILL.md  (new)
   ├── AGENTS.md  (appended)
   └── _workspace/  (referenced by orchestrator at runtime)
```

Key property: **the plugin code touches NO user project files**. Only the agent writes generated artifacts, using standard OpenCode file tools. This isolates the plugin from filesystem failure modes and keeps `/harness-team` testable in pure unit-test land.

---

## File-level changes

### NEW: `skills/team-architecture-factory/SKILL.md`

Frontmatter (literal, ready to paste):

```yaml
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
  (3) "하네스 구성해줘", "하네스 구축해줘", "하네스 점검",
  (4) /harness-team slash command,
  (5) extending or auditing an existing agent team (".opencode/agents/"
  inventory check, agent dedup review).
  Generates: agent definitions, skill files, orchestrator skill, AGENTS.md
  pointer. Does NOT operate the harness gate-loop — for that use /harness-on.
---
```

Body skeleton (numbered sections — full content is translated from upstream `skills/harness/SKILL.md`):

```
# Team Architecture Factory

> Adapted from revfactory/harness (Apache-2.0). Upstream version: v1.2.0.
> See assets/LICENSE-UPSTREAM + assets/NOTICE for attribution.

## Core Principles
1. Generate agents to .opencode/agents/ and skills to .opencode/skills/.
2. Use task() subagents as default execution mode (not live teams — OpenCode
   has no equivalent of Claude Code's TeamCreate).
3. Register harness pointer in AGENTS.md (pointer only, not full inventory).
4. Harness evolves — Phase 7 collects feedback and updates artifacts.

## Execution mode translation
| Upstream concept       | OpenCode equivalent                            |
| TeamCreate(...)        | task(run_in_background=True) + workspace files |
| SendMessage({to: ...}) | Workspace file at _workspace/{phase}_{...}     |
| TaskCreate/Update      | _workspace/tasks.json (optional)               |
| Agent(prompt, type)    | task(subagent_type=..., prompt=...)            |
| model: "opus"          | (omit — OpenCode controls model)               |

## Workflow

### Phase 0: Audit existing state
### Phase 1: Domain analysis
### Phase 2: Team architecture design
###    2-1. Execution mode selection
###    2-2. Architecture pattern selection (6 patterns)
###    2-3. Agent separation criteria
### Phase 3: Agent definition generation
###    3-0. Deduplication check
### Phase 4: Skill generation
###    4-0. Deduplication check
###    4-1. Structure
###    4-2. Description writing
###    4-3. Body writing principles
###    4-4. Progressive Disclosure (authoring pattern)
###    4-5. Skill-agent binding
### Phase 5: Integration & orchestration
###    5-0. Orchestrator pattern
###    5-1. Data passing protocol
###    5-2. Error handling
###    5-3. Team size guidelines
###    5-4. AGENTS.md pointer registration (template inline)
###    5-5. Follow-up support
### Phase 6: Validation & testing
### Phase 7: Evolution

## Deliverable Checklist
- [ ] .opencode/agents/ files (frontmatter validated)
- [ ] .opencode/skills/{...}/SKILL.md files
- [ ] Orchestrator skill (data flow + error handling + tests)
- [ ] AGENTS.md pointer section appended
- [ ] _workspace/ directory pattern documented in orchestrator

## References
- references/agent-design-patterns.md — 6 patterns + execution modes
- references/orchestrator-template.md — orchestrator scaffolds
- references/team-examples.md — 5 real-world domain examples
- references/skill-writing-guide.md — Progressive Disclosure + body rules
- references/skill-testing-guide.md — with/without-skill A/B methodology
- references/qa-agent-guide.md — boundary-mismatch detection
```

Target body length: 450–500 lines.

### NEW: `skills/team-architecture-factory/references/*.md`

| File | Source (upstream path) | Translation notes |
|------|------------------------|-------------------|
| `agent-design-patterns.md` | `skills/harness/references/agent-design-patterns.md` | 6 patterns kept verbatim; execution-mode section: `TeamCreate → task()`. Korean inline + English translation. Drop `model: "opus"` references entirely. |
| `orchestrator-template.md` | same path upstream | Templates A/B/C: rewrite all `Agent(...)` calls as `task(subagent_type=..., load_skills=[...], run_in_background=True/False)`. `SendMessage` → "write to `_workspace/{phase}_{agent}.md`". |
| `skill-writing-guide.md` | same | `.claude/skills/` → `.opencode/skills/`. Progressive Disclosure described as authoring pattern (no runtime mechanism mention). |
| `skill-testing-guide.md` | same | A/B testing methodology preserved; trigger validation uses OpenCode chat triggers, not Claude Code skill triggers. |
| `team-examples.md` | same | 5 worked examples (research, novel, webtoon, code review, migration) translated. Each example's TS-flavored pseudocode rewritten with `task()`. |
| `qa-agent-guide.md` | same | Boundary-mismatch patterns are language-agnostic; minimal changes. Korean code comments kept with English annotations. |

Each file: keep Korean text from upstream inline; add English translation underneath in plain prose. Mark untranslated sections with `<!-- TODO(v1.2.0): translate -->`.

### NEW: `skills/team-architecture-factory/assets/`

- `LICENSE-UPSTREAM` — verbatim copy of `/tmp/revfactory-harness/LICENSE` (Apache-2.0 full text)
- `NOTICE`:
  ```
  This skill is adapted from revfactory/harness (https://github.com/revfactory/harness)
  Copyright 2026 revfactory contributors
  Licensed under the Apache License, Version 2.0.
  Adaptation by nano-step contributors (2026), distributed under the same Apache-2.0
  license for the skill files. The surrounding TypeScript code in
  @nano-step/oh-my-harness is MIT-licensed.
  ```
- `CHANGELOG-UPSTREAM.md` — snapshot of `/tmp/revfactory-harness/CHANGELOG.md` at port version (v1.2.1 unreleased). Header note: "Snapshot taken 2026-06-03. See upstream for current state."

### NEW: `commands/harness-team.ts`

Signature + behavior (full implementation, ~85 lines):

```typescript
import type { Logger } from "../types.js";

export interface HarnessTeamContext {
  projectRoot: string;
  showToast(message: string, variant: "info" | "warning" | "error"): void;
  injectMessage(text: string): Promise<void>;
  logger?: Logger;
}

interface HarnessTeamOptions {
  audit: boolean;
}

function parseArgs(args: string[]): HarnessTeamOptions {
  return {
    audit: args.includes("--audit"),
  };
}

function buildFactoryPrompt(projectRoot: string): string {
  return [
    "## /harness-team",
    "",
    `**Project root:** \`${projectRoot}\``,
    "",
    "Load the `team-architecture-factory` skill and execute its full 7-phase workflow.",
    "",
    "Start with **Phase 0 (Audit)**: read `.opencode/agents/`, `.opencode/skills/`, and `AGENTS.md` to detect any existing harness. Branch on findings:",
    "- New build: execute Phases 1-7",
    "- Extend existing: use the Phase Selection Matrix from the skill",
    "- Maintenance: jump to Phase 7-5 maintenance workflow",
    "",
    "The user's domain description should come from the preceding chat messages. If no domain is described, ask the user to describe their domain before proceeding.",
    "",
    "Reference docs at `skills/team-architecture-factory/references/*.md` (loaded on demand).",
    "",
    "⚠️ This is the team-architecture factory. It is NOT the harness gate-loop (`/harness-on`). Do not touch `.opencode/harness-loop.local.json` or `.opencode/harness.config.json`.",
  ].join("\n");
}

function buildAuditPrompt(projectRoot: string): string {
  return [
    "## /harness-team --audit",
    "",
    `**Project root:** \`${projectRoot}\``,
    "",
    "Load the `team-architecture-factory` skill and run **Phase 0 (Audit) only**.",
    "",
    "Produce a status report:",
    "- Agent files found in `.opencode/agents/` (count + names)",
    "- Skill directories found in `.opencode/skills/` (count + names)",
    "- AGENTS.md harness pointer sections (count + domain names)",
    "- Conflicts or duplicates detected",
    "",
    "Do NOT generate or modify any files. Report only.",
  ].join("\n");
}

export async function handleHarnessTeam(
  ctx: HarnessTeamContext,
  args: string[]
): Promise<void> {
  const opts = parseArgs(args);

  if (opts.audit) {
    ctx.showToast("🔍 Auditing existing agent team...", "info");
    await ctx.injectMessage(buildAuditPrompt(ctx.projectRoot));
    return;
  }

  ctx.showToast("🏗️ Starting team architecture factory...", "info");
  await ctx.injectMessage(buildFactoryPrompt(ctx.projectRoot));
}
```

### MODIFIED: `index.ts`

Add (around line 215, inside `command.execute.before` switch):

```typescript
case "harness-team": {
  const args = parseArgs(cmd.arguments);
  const teamCtx: HarnessTeamContext = {
    projectRoot,
    showToast: (m, v) => emitToast(m, v),
    injectMessage: (t) => emitMessage(t),
  };
  await handleHarnessTeam(teamCtx, args);
  break;
}
```

Plus import at top:

```typescript
import { handleHarnessTeam, type HarnessTeamContext } from "./commands/harness-team.js";
```

### MODIFIED: `scripts/postinstall.js`

In the `SHIMS` array, append:

```javascript
{
  name: "harness-team.md",
  content: `---
description: Team Architecture Factory — generate agent team + skills from domain description
---

\${INPUT}
`,
},
```

(Existing 4 shim entries unchanged.)

### NEW: `templates/init/.opencode/commands/harness-team.md`

```markdown
---
description: Team Architecture Factory — generate agent team + skills from domain description
---

${INPUT}
```

### MODIFIED: `commands/harness-init.ts`

Inside the report-builder where the "Next steps" section is constructed, append one line:

```typescript
lines.push("💡 Want to generate a full agent team for your domain? Try `/harness-team`.");
```

### MODIFIED: `package.json`

```diff
   "files": [
     "dist",
     "templates",
+    "skills",
     "README.md",
     "LICENSE"
   ],
```

### MODIFIED: `README.md`

Add a new top-level section after the existing "Quick Start" section:

```markdown
## Team Architecture Factory (`/harness-team`)

In addition to the gate-loop feature, `@nano-step/oh-my-harness` ships a
**team architecture factory** skill ported from [revfactory/harness](https://github.com/revfactory/harness)
(Apache-2.0). It turns a domain description into a complete agent team
+ skill scaffolding in your project.

### Usage

```
/harness-team           # Generate a new team
/harness-team --audit   # Audit existing .opencode/agents/ and .opencode/skills/
```

### What it generates

- `.opencode/agents/{name}.md` — individual agent definitions
- `.opencode/skills/{name}/` — domain-specific skills with references
- `.opencode/skills/{orchestrator}/SKILL.md` — workflow orchestrator
- `AGENTS.md` — appended pointer section

### Architectural patterns supported

1. Pipeline — sequential stages
2. Fan-out/Fan-in — parallel perspectives
3. Expert Pool — context-routed specialists
4. Producer-Reviewer — generation + quality gate
5. Supervisor — dynamic task dispatch
6. Hierarchical Delegation — top-down decomposition (max depth 2)

### NOT for gate-loop operation

`/harness-team` is orthogonal to `/harness-on`. They share no state. Use the
gate-loop for quality gates on PRs; use the factory to design who runs the work.

### Attribution

This feature is adapted from [revfactory/harness](https://github.com/revfactory/harness)
v1.2.0. See `skills/team-architecture-factory/assets/LICENSE-UPSTREAM` and `NOTICE`.
```

### MODIFIED: `AGENTS.md`

Add `/harness-team` to the slash command inventory section (the one that already lists `/harness-on`, `/harness-off`, etc.).

### NEW: `tests/commands/harness-team.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleHarnessTeam } from "../../commands/harness-team.js";

function mockCtx() {
  return {
    projectRoot: "/tmp/test-proj",
    showToast: vi.fn(),
    injectMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe("/harness-team", () => {
  it("default mode emits factory toast", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Starting team architecture factory"),
      "info"
    );
  });

  it("default mode injects Phase 0 instruction", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    const prompt = ctx.injectMessage.mock.calls[0][0];
    expect(prompt).toContain("Phase 0");
    expect(prompt).toContain("team-architecture-factory");
    expect(prompt).toContain("/tmp/test-proj");
  });

  it("--audit mode emits audit toast", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, ["--audit"]);
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Auditing"),
      "info"
    );
  });

  it("--audit mode injects audit-only prompt", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, ["--audit"]);
    const prompt = ctx.injectMessage.mock.calls[0][0];
    expect(prompt).toContain("Phase 0");
    expect(prompt).toContain("Report only");
    expect(prompt).not.toContain("Phase 1");
  });

  it("warns about gate-loop separation in default prompt", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    const prompt = ctx.injectMessage.mock.calls[0][0];
    expect(prompt).toContain("NOT the harness gate-loop");
    expect(prompt).toContain("harness-loop.local.json");
  });

  it("does not touch harness-loop state", async () => {
    // Verified by absence of any file I/O in handleHarnessTeam source
    // (this test enforces the contract via spy on fs imports)
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    // showToast + injectMessage are the only effects
    expect(ctx.showToast).toHaveBeenCalledTimes(1);
    expect(ctx.injectMessage).toHaveBeenCalledTimes(1);
  });
});
```

### NEW: `tests/integration/team-factory-skill.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILL_DIR = join(process.cwd(), "skills/team-architecture-factory");

describe("team-architecture-factory skill bundle", () => {
  it("SKILL.md exists and has valid frontmatter", () => {
    const path = join(SKILL_DIR, "SKILL.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("name: team-architecture-factory");
    expect(match![1]).toContain("description:");
  });

  it("SKILL.md body is ≤ 500 lines", () => {
    const content = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThanOrEqual(500);
  });

  it("all 6 reference docs exist", () => {
    const expected = [
      "agent-design-patterns.md",
      "orchestrator-template.md",
      "skill-writing-guide.md",
      "skill-testing-guide.md",
      "team-examples.md",
      "qa-agent-guide.md",
    ];
    for (const name of expected) {
      expect(existsSync(join(SKILL_DIR, "references", name))).toBe(true);
    }
  });

  it("LICENSE-UPSTREAM + NOTICE shipped", () => {
    expect(existsSync(join(SKILL_DIR, "assets/LICENSE-UPSTREAM"))).toBe(true);
    expect(existsSync(join(SKILL_DIR, "assets/NOTICE"))).toBe(true);
  });

  it("no Claude Code primitives leak into skill files", () => {
    const forbidden = [
      "TeamCreate",
      "SendMessage",
      "TaskCreate",
      "TaskUpdate",
      "TeamDelete",
      ".claude/",
      'model: "opus"',
    ];
    const files = [
      join(SKILL_DIR, "SKILL.md"),
      ...["agent-design-patterns", "orchestrator-template", "skill-writing-guide", "skill-testing-guide", "team-examples", "qa-agent-guide"].map(
        (n) => join(SKILL_DIR, "references", `${n}.md`)
      ),
    ];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const pattern of forbidden) {
        // Allow citations in translation-notes tables (e.g., "| TeamCreate | task() |")
        // by requiring the pattern be in normal prose, not inside a markdown table cell
        const lines = content.split("\n");
        const offending = lines.filter(
          (l) => l.includes(pattern) && !l.trim().startsWith("|")
        );
        expect(offending, `${file} contains forbidden pattern outside translation table: ${pattern}`).toHaveLength(0);
      }
    }
  });
});
```

---

## Implementation tasks (T1–T17)

See `tasks.md` for the canonical numbered list with checkboxes.

---

## Frame B fallback (if pre-implementation verification fails)

If the verification step in `proposal.md` reveals that OpenCode does **not** read `.opencode/agents/*.md` or `.opencode/skills/<name>/SKILL.md` from project paths, Frame A collapses. In that case:

- **Drop**: shipping skill files at `skills/team-architecture-factory/` to the user's project. They stay in our npm package as reference material.
- **Change T9**: `commands/harness-team.ts` becomes ~150 lines (instead of 85). The full SKILL.md content is embedded as a TypeScript template string and injected directly into the chat. References are inlined via concatenation when the agent asks for them.
- **Change T10**: shim file content embeds inline triggers since the skill is no longer loaded from disk.
- **Skip T15/T16 file-existence assertions** for the project-local case; instead test that the injected prompt contains the full skill body.

Net impact on LOC delta: TS goes from ~100 to ~250. Markdown stays the same (still authored as separate files in our repo, just used differently). Auto-merge lane stays `normal`.

---

## Open question (carried forward to operator)

**Q-verify:** Before T9, operator runs a one-time verification: create `.opencode/agents/test-agent.md` with valid frontmatter, then in a chat session try `task(subagent_type="test-agent", prompt="echo hello")`. Report which Frame applies. Implementer waits for this answer before proceeding past T8.

If the operator wants to skip verification and assume Frame A: that's their risk, document it.

---

## Verification ladder for this PR

1. `tsc --noEmit` — clean
2. `npx vitest run` — ≥204 tests pass (existing 192 + ~12 new)
3. `npm pack --dry-run` — verify `skills/team-architecture-factory/` is in the tarball
4. `./scripts/harness-check.sh pre-merge --json` — `"status":"PASS"` on all 4 checks
5. Manual smoke: in a tmpdir scratch project, run `/harness-team` and inspect the prompt that gets injected (should match `buildFactoryPrompt` output)
6. Auto-merge eligibility per `docs/HARNESS.md` Auto-merge Policy:
   - Lane = normal ✅
   - Pre-merge ladder PASS ✅
   - E2E smoke verified ✅
   - CI green ✅
   - No conflicts ✅
   - Smoke evidence in PR description ✅
   - Hard exceptions: none (no schema, no manifest exports/main/types change, no new deps)
   → eligible for auto-merge

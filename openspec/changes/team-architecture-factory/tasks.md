# Tasks: Team Architecture Factory

Atomic, commit-sized tasks. Each task is independently verifiable. Sequence is roughly top-down but several pairs can be parallelized (noted where applicable).

---

## T0 — Verification (BLOCKS T9 ONWARD)

Operator must answer Q-verify in `proposal.md`:
- Create a trivial `.opencode/agents/test-agent.md` in any scratch project
- From an OpenCode chat session, run `task(subagent_type="test-agent", prompt="echo hello")`
- Report: does OpenCode load the agent definition from the file? (yes/no)

**If yes:** continue with Frame A (current design).
**If no:** switch to Frame B (see `design.md` § "Frame B fallback").

**Verification:** Operator reports the result in the PR description before T9 starts.

---

## T1 — Scaffold skill directory + assets
**Files:** `skills/team-architecture-factory/assets/{LICENSE-UPSTREAM,NOTICE,CHANGELOG-UPSTREAM.md}` (3 new)
**~LOC:** +125

Create the directory tree. Copy upstream `LICENSE` verbatim to `LICENSE-UPSTREAM`. Hand-author `NOTICE` per Apache-2.0 §4. Snapshot upstream `CHANGELOG.md` to `CHANGELOG-UPSTREAM.md` with a header note: "Snapshot taken 2026-06-03 from revfactory/harness v1.2.1 (unreleased)."

**Verify:**
- `ls -la skills/team-architecture-factory/assets/` → 3 files exist
- `grep -c "Apache License" skills/team-architecture-factory/assets/LICENSE-UPSTREAM` → 1
- `grep "revfactory" skills/team-architecture-factory/assets/NOTICE` → match

---

## T2 — Translate SKILL.md
**Files:** `skills/team-architecture-factory/SKILL.md` (new)
**~LOC:** +450 (target ≤500 per Progressive Disclosure rule)

Translate upstream `skills/harness/SKILL.md` per the translation rules in `design.md` § "NEW: skills/team-architecture-factory/SKILL.md":
- Use exact frontmatter literal from `design.md`
- Body: 7-phase outline, each phase a top-level heading
- `.claude/` → `.opencode/` everywhere
- `TeamCreate` / `SendMessage` / `Agent(...)` → `task(...)` per translation table
- Drop all `model: "opus"` references
- Keep Korean inline; add English translation underneath
- Add Vietnamese trigger phrases to description (locked decision #11)
- Add provenance note at the top: `> Adapted from revfactory/harness (Apache-2.0). Upstream version: v1.2.0.`

**Verify:**
- Line count ≤ 500
- Frontmatter parses (run `yaml.parse` or eyeball)
- `grep -c '\.claude/' SKILL.md` → 0
- `grep -c 'TeamCreate\|SendMessage\|Agent(' SKILL.md` → 0 (outside translation table)
- `grep 'tạo team agent' SKILL.md` → 1+ (Vietnamese triggers present)

---

## T3–T8 — Translate 6 reference docs (parallelizable in 3 pairs)

Each task follows the same pattern as T2 but for the corresponding reference doc. Translation rules from `design.md` § "NEW: skills/team-architecture-factory/references/*.md" table.

| Task | File | Source | ~LOC | Pair |
|------|------|--------|------|------|
| T3 | `references/agent-design-patterns.md` | upstream same name | +350 | Pair A |
| T4 | `references/orchestrator-template.md` | upstream same name | +300 | Pair A |
| T5 | `references/skill-writing-guide.md` | upstream same name | +250 | Pair B |
| T6 | `references/skill-testing-guide.md` | upstream same name | +200 | Pair B |
| T7 | `references/team-examples.md` | upstream same name | +400 | Pair C |
| T8 | `references/qa-agent-guide.md` | upstream same name | +250 | Pair C |

**Verify per task:**
- File exists at expected path
- `grep -c '\.claude/' <file>` → 0
- `grep -c 'TeamCreate\|SendMessage\|Agent(' <file>` → 0 outside markdown tables
- Sections from upstream are present (compare heading list)

---

## T9 — Slash command handler
**Files:** `commands/harness-team.ts` (new), `index.ts` (modified)
**~LOC:** +100

**BLOCKED BY T0.** Implement per `design.md` § "NEW: commands/harness-team.ts" — the file content is reproduced literally in `design.md`. Copy-paste, save, verify.

Modify `index.ts`:
- Add import at top: `import { handleHarnessTeam, type HarnessTeamContext } from "./commands/harness-team.js";`
- Add `case "harness-team":` to the `command.execute.before` switch

**Verify:**
- `npx tsc --noEmit` → clean
- Grep `index.ts` shows the new case branch

---

## T10 — Shim template
**Files:** `templates/init/.opencode/commands/harness-team.md` (new)
**~LOC:** +5

Copy literal content from `design.md` § "NEW: templates/init/.opencode/commands/harness-team.md".

**Verify:**
- File exists with valid frontmatter (`description:` field)

---

## T11 — Postinstall update
**Files:** `scripts/postinstall.js` (modified)
**~LOC:** +6

Append the new shim entry to the `SHIMS` array per `design.md` § "MODIFIED: scripts/postinstall.js".

**Verify:**
- `node scripts/postinstall.js` — in dev (dev-install guard skips file creation; just exit 0 with no errors)
- E2E smoke: `INIT_CWD=/tmp/test-install node scripts/postinstall.js && ls /tmp/test-install/.opencode/commands/` → 5 shim files including `harness-team.md`

---

## T12 — package.json files[]
**Files:** `package.json` (modified)
**~LOC:** +1

Add `"skills"` entry per `design.md` § "MODIFIED: package.json".

**Verify:**
- `npm pack --dry-run 2>&1 | grep 'skills/team-architecture-factory/SKILL.md'` → match
- `npm pack --dry-run 2>&1 | grep -c 'skills/team-architecture-factory/references/'` → 6

---

## T13 — README + AGENTS.md docs
**Files:** `README.md` (modified), `AGENTS.md` (modified)
**~LOC:** +35

Add the "Team Architecture Factory" section to `README.md` per `design.md` § "MODIFIED: README.md". Add `/harness-team` to the AGENTS.md slash command inventory.

**Verify:**
- `grep -c '## Team Architecture Factory' README.md` → 1
- `grep '/harness-team' AGENTS.md` → match

---

## T14 — Cross-reference in /harness-init
**Files:** `commands/harness-init.ts` (modified)
**~LOC:** +2

Append the one-line cross-reference in the report builder per `design.md` § "MODIFIED: commands/harness-init.ts".

**Verify:**
- `grep 'Try.*harness-team' commands/harness-init.ts` → match
- Run existing `/harness-init` unit test — passes (it should — only an additional line of output)

---

## T15 — Unit tests for /harness-team
**Files:** `tests/commands/harness-team.test.ts` (new)
**~LOC:** +80

Copy the literal test suite from `design.md` § "NEW: tests/commands/harness-team.test.ts". 6 test cases covering default mode, audit mode, prompts, and contract isolation from gate-loop state.

**Verify:**
- `npx vitest run tests/commands/harness-team.test.ts` → all 6 pass

---

## T16 — Integration test for skill bundle
**Files:** `tests/integration/team-factory-skill.test.ts` (new)
**~LOC:** +80

Copy the literal test suite from `design.md` § "NEW: tests/integration/team-factory-skill.test.ts". 5 test cases: SKILL.md frontmatter, SKILL.md ≤500 lines, all 6 references exist, LICENSE-UPSTREAM/NOTICE exist, no Claude Code primitive leaks.

**Verify:**
- `npx vitest run tests/integration/team-factory-skill.test.ts` → all 5 pass
- If any FAIL, return to T2–T8 and re-translate the offending file

---

## T17 — Pre-merge ladder + commit + PR

```bash
# Run full ladder
npx tsc --noEmit                                     # 0 errors
npx vitest run                                       # ≥204 tests pass
npm pack --dry-run | grep 'skills/team-architecture' # 7+ entries
./scripts/harness-check.sh pre-merge --json          # status: PASS

# Auto-merge eligibility per docs/HARNESS.md:
# - Lane = normal ✅
# - All 6 preconditions hold (see proposal.md acceptance criteria)
# - No hard exceptions triggered
```

Commit message format (matches recent precedents):

```
feat(skills): port revfactory/harness as team-architecture-factory skill (v1.1.0)

Adds a new markdown-only skill `team-architecture-factory` to @nano-step/oh-my-harness.
Translates upstream revfactory/harness v1.2.0 (Apache-2.0) to OpenCode primitives.

New: /harness-team slash command (default + --audit). Generates agent definitions
to .opencode/agents/, skills to .opencode/skills/, and a pointer to AGENTS.md.

The team-architecture factory is orthogonal to the harness gate-loop: zero shared
state, distinct command namespaces, can coexist freely.

Six architecture patterns supported: Pipeline, Fan-out/Fan-in, Expert Pool,
Producer-Reviewer, Supervisor, Hierarchical Delegation.

Tests: +12 (≥204 total, was 192)
Files shipped: skills/team-architecture-factory/ (8 files, ~2,200 lines markdown)
TypeScript additions: +100 LOC

Verification:
- npx tsc --noEmit → 0 errors
- npx vitest run → ≥204 pass
- ./scripts/harness-check.sh pre-merge → PASS (4/4)
- npm pack --dry-run → skills/team-architecture-factory/ included

Attribution: Apache-2.0 license + NOTICE shipped at
skills/team-architecture-factory/assets/. Surrounding TS code stays MIT.

Implements: openspec/changes/team-architecture-factory/proposal.md
Refs: revfactory/harness v1.2.0
```

Create PR per Auto-merge Policy. If all 6 preconditions hold + no hard exceptions, auto-merge.

---

## Out-of-PR follow-ups

- **Operator manual smoke**: after merge + npm publish, run `/harness-team` in a real consumer project, exercise full 7-phase workflow against a sample domain ("Vietnamese-Korean translation pipeline" or similar). Validate generated agents work.
- **Upstream feedback**: open a courtesy issue at revfactory/harness referencing our port (good neighbor practice).
- **v1.2.0 backlog**: track `--dry-run`, full Vietnamese reference translations, domain template library.

---

## Risk fall-throughs (referenced from proposal.md)

| Trigger | Action |
|---------|--------|
| T0 verification fails (OpenCode does NOT load .opencode/agents/ files) | Switch to Frame B per `design.md`. Adjust T9 (embed skill content in handler), skip T15 file-existence assertions, document the limitation in README. |
| T16 fails (Claude Code primitive leak detected) | Return to the failing translation task (T2–T8), re-translate the offending file, re-run T16. |
| Auto-merge precondition fails (e.g., CI red) | Pause; operator approval required. Document the failure in PR description. |

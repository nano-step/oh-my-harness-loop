# Tasks: Epic Mode

Atomic tasks for Phase 1 implementation. Each task should be commit-sized and independently verifiable.

---

## T1 — Types: add epic schemas + extend LoopMeta/HarnessConfig
**File:** `types.ts`

- Add `StoryStatusSchema` (z.enum: pending/in_progress/completed/failed/blocked/skipped)
- Add `BacklogStorySchema` (id, title, feature_id?, issue_number?, story?, depends_on)
- Add `BacklogSchema` (epic_id, title?, stories: min 1)
- Add `EpicProgressEntrySchema` (story_id, status, started_at?, completed_at?, gate_reached?)
- Add `EpicMetaSchema` (enabled: literal(true), epic_id, current_story_id, story_progress, backlog_snapshot, failure_policy, max_iterations_per_epic, epic_iteration_total)
- Add `EpicConfigSchema` (backlog_source, backlog_file, failure_policy, max_iterations_per_epic)
- Extend `LoopMetaSchema`: add optional `epic`
- Extend `LoopMeta` interface: add optional `epic`
- Extend `HarnessConfigSchema`: add optional `epic`
- Export all new types

**Verify:** `tsc --noEmit` clean. Existing tests pass (132 still green).

---

## T2 — Constants
**File:** `constants.ts`

- Add `DEFAULT_EPIC_BACKLOG_PATH = ".opencode/harness.epic.json"`
- Add `DEFAULT_MAX_ITERATIONS_PER_EPIC = 500`

**Verify:** tsc clean.

---

## T3 — Backlog adapter
**File:** `backlog-adapter.ts` (NEW)

- Export `BacklogAdapter` interface (`load(): Promise<Backlog>`)
- Implement `FileBacklogAdapter`:
  - Constructor accepts file path
  - `load()`: existsSync check → readFileSync → JSON.parse → BacklogSchema.safeParse → throw HarnessConfigError on any failure with actionable message
  - Validate unique story IDs (Zod can't express this, manual check)
- Export `createBacklogAdapter(config: EpicConfig): BacklogAdapter` (switch on `backlog_source`)

**Verify:** tsc clean. Unit tests for FileBacklogAdapter: missing file, malformed JSON, schema invalid, duplicate IDs, valid backlog.

---

## T4 — Topological sort
**File:** `topological-sort.ts` (NEW)

- Export `topologicalSort(stories: BacklogStory[]): BacklogStory[]`
- Kahn's algorithm
- Throw `HarnessConfigError` on cycle detection (include cycle path in message)
- Throw `HarnessConfigError` on missing dep reference (include offender + missing)

**Verify:** Unit tests: 3-node linear, 3-node fan-in, 3-node cycle, 2-node missing dep, single node, deterministic ordering for ties.

---

## T5 — Loop state controller: epic methods
**File:** `loop-state-controller.ts`

- Extend `startLoop()` to accept optional `epicBacklog: Backlog` arg. When present:
  - Topo-sort the backlog
  - Initialize `state.loop.epic = { enabled: true, epic_id, current_story_id: backlog.stories[0].id, story_progress: [{ story_id: stories[0].id, status: "in_progress", started_at: now }], backlog_snapshot, failure_policy: "ask", max_iterations_per_epic, epic_iteration_total: 0 }`
  - Set `state.feature_id = backlog.stories[0].feature_id`, `state.story = backlog.stories[0].story`, `state.issue_number = backlog.stories[0].issue_number`
- Add `completeStoryAndAdvance(): { nextStoryId } | null` (per design.md)
- Add `pauseEpicForFailure(reason: string): void` (set loop.active=false, mark current story failed, writeState)
- Modify `clearLoopBlock(opts?: { clean?: boolean }): void` — default preserves `epic`, with `clean: true` wipes everything

**Verify:** tsc clean. Unit tests:
- startLoop with epic → state has correct epic block + first story set
- completeStoryAndAdvance: sets next story, resets gate_iteration, increments epic_iteration_total
- completeStoryAndAdvance: returns null when no ready story (backlog drained or blocked by failed deps)
- pauseEpicForFailure: marks story failed, sets active=false, preserves epic
- clearLoopBlock() preserves epic, clearLoopBlock({clean:true}) wipes

---

## T6 — Event handler: epic re-entry
**File:** `harness-loop-event-handler.ts`

In `handleRunnerOutput`:

**PASS path** (currently line ~547-554): when `next_gate: null`:
```typescript
if (state.loop.epic?.enabled) {
  const advanced = controller.completeStoryAndAdvance();
  if (advanced) {
    ctx.showToast(`✅ Story "${prevId}" done → next "${advanced.nextStoryId}" (${done}/${total})`, "info");
    await ctx.injectMessage(buildEpicStoryPrompt(advanced.nextStoryId, getState()!));
    return;
  }
  ctx.showToast(`🏆 Epic "${state.loop.epic.epic_id}" complete! ${done}/${total} stories.`, "info");
  await ctx.injectMessage(buildEpicCompletionPrompt(state));
}
controller.cancelLoop();
ctx.showToast("🎉 Harness loop complete!", "info");
await ctx.injectMessage(buildCompletionPrompt("structural"));
```

**SKIP path** (line ~607-611): identical logic.

**FAIL path / max gate iter exceeded** (line ~329-340): when `epic.enabled` and policy is `"ask"`:
```typescript
if (state.loop.epic?.enabled && state.loop.epic.failure_policy === "ask") {
  controller.pauseEpicForFailure(`max gate iterations exceeded on ${currentGate}`);
  ctx.showToast(`⏸️ Story "${currentStoryId}" PAUSED at gate "${currentGate}". Use /harness-on --epic --resume after fix.`, "warning");
  return;
}
```

**Verify:** tsc clean. Existing 132 tests still pass (regression).

---

## T7 — Templates
**Files:** `templates/epic-story-prompt.ts` (NEW), `templates/epic-completion-prompt.ts` (NEW)

- `buildEpicStoryPrompt(storyId, state)`:
  - Find story in `epic.backlog_snapshot.stories`
  - Compose prompt: epic context (id, title, progress N/M), story header (id, title, feature_id, issue_number), story body (truncated to 2000 chars), instructions ("Start gate cycle now")
  - Return as string
- `buildEpicCompletionPrompt(state)`:
  - Compose: "Epic <id> complete. <N>/<M> stories done. List of completed: <ids>. Emit `<promise>HARNESS-COMPLETE</promise>`."
- `buildEpicPausePrompt(storyId, gate, reason)`:
  - Compose: pause reason, current story+gate, instructions to fix and run `--resume`

**Verify:** Unit tests for prompt content (contain expected substrings).

---

## T8 — CLI surface: /harness-on --epic + --resume
**File:** `commands/harness-on.ts`

- Add `--epic` and `--epic=<path>` parsing
- Add `--resume` parsing
- When `--epic`:
  1. Load config (existing flow)
  2. Validate `config.epic` exists → if not, throw HarnessConfigError("Epic config block required for --epic")
  3. Determine backlog file: CLI arg overrides `config.epic.backlog_file`
  4. Load backlog via adapter
  5. Topo-sort backlog
  6. If `--resume`: read state file → verify `epic.enabled === true` + `current_story_id` in backlog → reset gate_iteration to 0
  7. Otherwise: call `startLoop(featureId, issueNumber, story, ..., { epicBacklog: backlog })`
- Backward compat: `/harness-on` without `--epic` works exactly as today

**Verify:** Unit tests: --epic with missing file, --epic with cycle in backlog, --epic --resume without preserved state, --epic --resume happy path, /harness-on (no epic) regression.

---

## T9 — CLI: /harness-off --clean
**File:** `commands/harness-off.ts`

- Add `--clean` parsing
- Default behavior: `clearLoopBlock()` (preserves epic per T5 change)
- `--clean`: `clearLoopBlock({ clean: true })` (full wipe)

**Verify:** Unit tests for both paths.

---

## T10 — Tests: epic-mode.test.ts
**File:** `tests/epic-mode.test.ts` (NEW)

Cover ≥15 cases (see design.md Edge Cases section). Match style of `tests/parallel-gate.test.ts`. Use `tmpdir()` for state files. Mock runner via context.

Cases (minimum):
1. Single-story epic (backlog with 1 story) behaves like single-story mode
2. Cycle detection error
3. Missing dep error
4. Duplicate ID error
5. All stories complete → epic-complete toast + HARNESS-COMPLETE prompt
6. Story 1 fails → pause, story 2 not started, state preserved
7. Resume from preserved state, current gate re-runs from iteration 0
8. `/harness-off` preserves epic block
9. `/harness-off --clean` wipes epic block
10. `--resume` without preserved epic → error
11. `--resume` with stale current_story_id (not in backlog) → error
12. Backlog file missing → HarnessConfigError
13. Backlog malformed JSON → HarnessConfigError
14. Non-epic `/harness-on` regression — old behavior intact
15. Epic-wide cap (`max_iterations_per_epic`) hit → pause with toast naming cap
16. depends_on satisfied progressively (3 stories chained linearly)

**Verify:** `npx vitest run tests/epic-mode.test.ts` all green. Full suite ≥147 tests.

---

## T11 — Documentation
**Files:** `docs/HARNESS.md`, `README.md`

`docs/HARNESS.md`:
- Add "Epic Mode" section after "Auto-merge Policy"
- Document: when epic-mode applies, how it interacts with Auto-merge Policy, what `/harness-off` does in epic context
- Document `max_iterations_per_epic` interaction with `max_iterations_per_gate` and `max_total_iterations`

`README.md`:
- Add "Epic Mode" section with:
  - Backlog file schema example (use STORY-24-* example from design.md)
  - Config snippet
  - Usage: `/harness-on --epic`, `--resume`, `/harness-off --clean`
  - Observability: toasts + state file inspection

**Verify:** Markdown lints clean (no broken refs).

---

## T12 — E2E smoke test
**Script (ad-hoc, not committed):**
- Set up tmpdir with: minimal harness.config.json (epic block) + 3-story backlog (linear deps STORY-1 → STORY-2 → STORY-3) + minimal runner that returns PASS for all gates
- Run plugin's `handleSessionIdle` programmatically through 3 full story cycles
- Verify: state file has all 3 stories `completed`, final toast contains "🏆", `HARNESS-COMPLETE` prompt emitted
- Test resume: kill mid-story-2 → reload → assert current_story_id=STORY-2, gate_iteration=0

This is a manual/local smoke. Document the script in the PR description as evidence (per Auto-merge Policy precondition #3).

**Verify:** Smoke output captured in PR description.

---

## T13 — Pre-merge ladder + commit + PR + auto-merge
Per `docs/HARNESS.md` Auto-merge Policy:

```bash
./scripts/harness-check.sh pre-merge --json   # → PASS
git add -A
git commit -m "feat(epic-mode): autonomous multi-story execution

Implements OpenSpec change: epic-mode
- LoopMeta gains optional epic field
- FileBacklogAdapter + topo sort
- Story advancement via completeStoryAndAdvance
- /harness-on --epic and --resume flags
- /harness-off --clean for full wipe
- ≥15 new tests

Closes #<epic-issue>"
git push
gh pr create --base master --title "feat(epic-mode): autonomous multi-story execution"
# Wait for CI
# If all 6 Auto-merge preconditions hold → gh pr merge <n> --squash --delete-branch
```

After merge → release pipeline auto-tags + publishes new version → run T14.

---

## T14 — Archive OpenSpec proposal
After PR merge:
```bash
openspec archive epic-mode --yes
# → moves openspec/changes/epic-mode/ → openspec/changes/archive/2026-06-XX-epic-mode/
```

Commit archive move as separate `[skip-release]` PR per repo precedent (see PR #4 from parallel-gate-execution flow).

---

## Verification gate summary

| Stage | Command | Pass criterion |
|---|---|---|
| Per-task | `tsc --noEmit` | 0 errors |
| Per-task | `npx vitest run <single-test>` | new test green, no existing regression |
| After T10 | `npx vitest run` | ≥147 tests pass |
| Before commit | `./scripts/harness-check.sh pre-merge --json` | status: PASS, all 4 checks PASS |
| Before merge | E2E smoke (T12) | 3-story epic completes end-to-end |
| Auto-merge | All 6 preconditions from `docs/HARNESS.md` | ALL ✅ |

---

## Out of scope for these tasks (Phase 2+)

- GitHub Issues adapter
- `/harness-status`, `/harness-skip`, `/harness-retry` commands
- `failure_policy: "skip"` and `"abort"`
- Main-health-check between stories
- Parallel stories
- Dynamic backlog reload

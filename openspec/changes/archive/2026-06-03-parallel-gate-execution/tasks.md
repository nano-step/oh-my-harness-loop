# Tasks: Parallel Gate Execution

## T1 — Types: Add ParallelTask + extend LoopMeta
**File:** `types.ts`

- Add `ParallelTaskSchema` (id, async, async_subagent_type, async_max_wait_seconds, async_poll_interval_seconds, doc, skills)
- Add `ParallelWatcherEntry` interface (task_id, status, result, started_at)
- Extend `GateInstructionSchema`: add optional `parallel: z.array(ParallelTaskSchema)`
- Replace `watcher_task_id: string | null` with `parallel_watchers: Record<string, ParallelWatcherEntry>` in `LoopMeta` interface
- Update `LoopMetaSchema` Zod schema to match
- Export new types

**Verify:** `tsc --noEmit` clean; existing Zod schemas parse correctly

---

## T2 — Storage: Init + migrate watcher state
**File:** `storage.ts`

- Update `initLoopMeta()` to set `parallel_watchers: {}` (remove `watcher_task_id`)
- In `readState()`: add migration — if raw state has `watcher_task_id`, convert to `parallel_watchers` map (see design.md migration snippet)
- Update `clearLoopState()` — no change needed (whole state cleared)

**Verify:** `tsc --noEmit` clean; unit test: old state with `watcher_task_id` reads without error

---

## T3 — Config loader: Validate parallel entries
**File:** `config-loader.ts`

- After Zod parse, for each gate in `gate_instructions` that has `parallel`:
  - Assert `parallel[].id` values are unique within that gate (throw `HarnessConfigError` if duplicate)
  - If any entry has `async: false`, override to `true` and emit a warning log
- No other changes

**Verify:** Unit test: duplicate task IDs throw; `async: false` is silently corrected

---

## T4 — Loop state controller: Init + clear parallel_watchers on gate advance
**File:** `loop-state-controller.ts`

- `startLoop()`: ensure `parallel_watchers: {}` in initial state (already handled by T2 initLoopMeta, but double-check)
- `transitionToNextGate()`: reset `parallel_watchers: {}` when advancing to next gate
- `cancelLoop()` / `completeLoop()`: call `background_cancel` for any `parallel_watchers` entries with status `"pending"` before writing final state

**Verify:** `tsc --noEmit` clean; state after gate advance has empty `parallel_watchers`

---

## T5 — Async watcher spawner: Pass --task flag
**File:** `async-watcher-spawner.ts`

- `spawnWatcher()`: accept optional `taskId: string` parameter
- When `taskId` is provided, append `--task <taskId>` to the runner command in the watcher prompt
- No other changes to watcher logic

**Verify:** Unit test: watcher prompt contains `--task code-review` when taskId passed

---

## T6 — Event handler: Fan-out + collect + merge
**File:** `harness-loop-event-handler.ts`

This is the main logic change. Add three new helpers and update `processLoopIteration`.

### 6a — `hasParallelTasks(gate, config): boolean`
Returns true if `gate_instructions[gate].parallel` is a non-empty array.

### 6b — `fanOutParallelWatchers(gate, config, state): Promise<void>`
- For each task in `parallel`:
  - Call `spawnWatcher(gate, taskConfig, taskId)` → get background task_id
  - Write to `state.loop.parallel_watchers[task.id] = { task_id, status: "pending", result: null, started_at: now }`
- Save state
- Inject heartbeat toast: "⚙️ Gate `<gate>`: launched N parallel tasks"

### 6c — `collectAllWatchers(gate, state): Promise<"all_done" | "partial" | "early_fail">`
- For each watcher with status `"pending"`:
  - Call `collectWatcherResult(watcher.task_id)` (existing helper)
  - If result ready → set `watcher.status = "done"`, `watcher.result = result`
  - If result is FAIL/BLOCKED → set done, then cancel all other pending watchers (loop through, call `background_cancel`, set `status: "cancelled"`)
  - Return `"early_fail"`
- Save state after each collection
- If all done → return `"all_done"`
- If some still pending → return `"partial"`

### 6d — `mergeParallelResults(gate, watchers): RunnerOutput`
- Collect all `done` watcher results (skip `cancelled`)
- Worst-case status: BLOCKED > FAIL > ERROR > PASS
- Merge `checks[]` (concatenate)
- Union `rule_ids_violated` (deduplicate)
- Concatenate `instructions_for_agent` with `\n\n---\n\n`
- Return merged `RunnerOutput`

### 6e — Update `processLoopIteration()`
Replace existing single-watcher path with:

```
if hasParallelTasks(gate, config):
  if parallel_watchers is empty:
    → fanOutParallelWatchers() → return (wait next idle)
  else:
    collectResult = await collectAllWatchers()
    if collectResult == "partial":
      → return (wait next idle)
    else:  // "all_done" or "early_fail"
      merged = mergeParallelResults()
      → handleRunnerOutput(merged)
else:
  // existing single-task path (unchanged)
```

**Verify:** `tsc --noEmit` clean; all existing tests still pass

---

## T7 — Tests: parallel-gate.test.ts
**File:** `tests/parallel-gate.test.ts` (new file)

Test cases:
1. **fan-out**: gate with `parallel: [A, B]` → spawns 2 watchers, state has 2 entries
2. **all-pass**: both watchers return PASS → gate PASS, `parallel_watchers` cleared on advance
3. **one-fail**: task A returns FAIL → task B cancelled → gate FAIL, merged output has A's checks
4. **early-blocked**: task A returns BLOCKED → B cancelled → loop stops
5. **partial-collect**: first idle only A done → returns partial → second idle B done → merges
6. **resume-after-crash**: state has `{ A: done, B: pending }` → re-collect B only, no re-spawn A
7. **backward-compat**: old state with `watcher_task_id: "task_123"` → migrates to `parallel_watchers`
8. **empty-parallel**: `parallel: []` → falls through to normal gate logic
9. **no-parallel**: gate without `parallel` key → existing code path untouched (regression)

**Verify:** `npx vitest run tests/parallel-gate.test.ts` → all pass

---

## T8 — Run full test suite + tsc
```bash
cd /tmp/opencode/oh-my-harness-loop
npx tsc --noEmit
npx vitest run
```

All existing tests pass. New parallel tests pass. Zero type errors.

---

## T9 — Commit + push + publish
```bash
git checkout -b feat/parallel-gate-execution
git add -A
git commit -m "feat: parallel gate execution via config-declared parallel tasks

Gates can now declare parallel: [...] in gate_instructions. The plugin
fans out one background watcher per task, collects results, and merges
into a single gate outcome (worst-case status). Fully backward-compatible:
gates without parallel key are unaffected.

Closes #<issue>"
git push origin feat/parallel-gate-execution
# → open PR → merge → auto-tag → npm publish oh-my-harness-loop@next
```

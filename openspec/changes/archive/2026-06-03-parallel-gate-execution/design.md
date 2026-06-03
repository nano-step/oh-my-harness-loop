# Design: Parallel Gate Execution

## Overview

A gate can optionally declare a `parallel` array in `gate_instructions`. When present,
the plugin fans out one background watcher subagent per task, waits for all to finish,
then merges results into a single gate outcome.

---

## Config Schema Extension

```typescript
// New: per-task entry inside parallel[]
const ParallelTaskSchema = z.object({
  id: z.string(),                                    // unique within gate, used as runner --task arg
  async: z.boolean().default(true),                  // always async; field kept for symmetry
  async_subagent_type: z.string().default("quick"),
  async_max_wait_seconds: z.number().default(300),
  async_poll_interval_seconds: z.number().default(60),
  doc: z.string().optional(),                        // optional per-task instruction doc
  skills: z.array(z.string()).default([]),
});

// Extended GateInstruction
const GateInstructionSchema = z.object({
  // ... all existing fields unchanged ...
  parallel: z.array(ParallelTaskSchema).optional(),  // NEW — if absent, old behavior
});
```

**Runner invocation per task:**
```bash
# existing single-task gate
./scripts/harness-check.sh pre-merge --json

# parallel task invocation  
./scripts/harness-check.sh pre-merge --task code-review --json
./scripts/harness-check.sh pre-merge --task run-tests --json
```

The `--task <id>` flag is passed through. Runners that don't understand it can ignore it
or return a PASS — the contract is unchanged (`RunnerOutputSchema`).

---

## State Schema Extension

```typescript
// New: per-watcher entry
interface ParallelWatcherEntry {
  task_id: string;          // background subagent task ID
  status: "pending" | "done" | "cancelled";
  result: RunnerOutput | null;
  started_at: string;       // ISO 8601
}

// LoopMeta change: replace watcher_task_id with parallel_watchers
interface LoopMeta {
  // REMOVED: watcher_task_id: string | null
  // ADDED:
  parallel_watchers: Record<string, ParallelWatcherEntry>; // key = task id ("code-review", etc.)
  // ... all other fields unchanged ...
}
```

**Migration for old state files** (have `watcher_task_id`):
```typescript
// In storage.ts readState():
if ("watcher_task_id" in raw.loop) {
  const tid = raw.loop.watcher_task_id;
  raw.loop.parallel_watchers = tid
    ? { "__legacy__": { task_id: tid, status: "pending", result: null, started_at: raw.updated_at } }
    : {};
  delete raw.loop.watcher_task_id;
}
```

---

## Execution Flow

### Fan-out (new path, `parallel` present)

```
processLoopIteration()
  ↓ gate has parallel[] tasks
  ↓ parallel_watchers is empty (first time)
  → FOR EACH task in parallel[]:
      spawnWatcher(gate, task) → task_id
      parallel_watchers[task.id] = { task_id, status: "pending", ... }
  → saveState()
  → return (wait for next session.idle)

[session.idle fires again]
  ↓ parallel_watchers is non-empty
  → FOR EACH watcher in parallel_watchers where status == "pending":
      collectWatcherResult(watcher.task_id)
      if result ready → watcher.status = "done", watcher.result = result
  → check: any still pending? → return, wait for next idle
  → ALL done → mergeParallelResults(parallel_watchers)
      → any FAIL/BLOCKED → gate FAIL, inject prompt with all failure details
      → all PASS → gate PASS, transition to next gate
  → cancel remaining watchers if early FAIL (via background_cancel)
```

### Merge Logic

```typescript
function mergeParallelResults(watchers: Record<string, ParallelWatcherEntry>): RunnerOutput {
  const results = Object.values(watchers).map(w => w.result!);
  const failed = results.filter(r => r.status === "FAIL" || r.status === "ERROR");
  const blocked = results.filter(r => r.status === "BLOCKED");

  if (blocked.length > 0) {
    return synthesizeBlockedOutput(gate, blocked);
  }
  if (failed.length > 0) {
    return synthesizeFailOutput(gate, failed); // merge all checks[], all rule_ids_violated[], concat instructions
  }
  return synthesizePassOutput(gate, results);
}
```

Key merge rules:
- `checks[]` — concatenate all checks from all tasks
- `rule_ids_violated` — union (deduplicated)
- `instructions_for_agent` — concatenate with `\n\n---\n\n` separator
- `status` — worst-case: BLOCKED > FAIL > ERROR > PASS

---

## Early Cancellation

If any task returns FAIL or BLOCKED before others finish:
1. Mark failed task as `done`
2. Call `background_cancel(taskId)` for each still-`pending` watcher
3. Mark cancelled watchers as `cancelled`
4. Proceed with merge (only `done` results contribute)

This avoids burning subagent budget on a gate that's already failed.

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Gate has no `parallel` key | Existing code path, `parallel_watchers` stays `{}` |
| Old state file with `watcher_task_id` | Migration in `readState()` converts to `parallel_watchers` |
| Runner doesn't handle `--task` | Gets `--json` only; returns normal `RunnerOutput`; plugin treats as task PASS/FAIL normally |
| Single-entry `parallel: [{id: "x"}]` | Works correctly; effectively same as current single async gate |

---

## File Change Map

| File | Change |
|------|--------|
| `types.ts` | Add `ParallelTaskSchema`; extend `GateInstructionSchema`; replace `watcher_task_id` with `parallel_watchers` in `LoopMeta` + `LoopMetaSchema`; add `ParallelWatcherEntry` interface |
| `config-loader.ts` | Validate `parallel[].id` uniqueness per gate; warn if `parallel` entry has `async: false` (override to true) |
| `harness-loop-event-handler.ts` | Add `hasParallelTasks(gate)` check; add `fanOutParallelWatchers()` and `collectAllWatchers()` helpers; update `processLoopIteration` branch |
| `async-watcher-spawner.ts` | Accept optional `taskId` suffix; pass `--task <id>` to runner command in watcher prompt |
| `storage.ts` | Add `parallel_watchers` to init state; add migration for `watcher_task_id` → `parallel_watchers` |
| `loop-state-controller.ts` | Update `startLoop()` to init `parallel_watchers: {}`; update transition logic to clear `parallel_watchers` on gate advance |
| `tests/parallel-gate.test.ts` | New test file: fan-out, all-pass, one-fail-cancels-others, resume-after-crash, backward-compat migration |

---

## Edge Cases

| Case | Handling |
|------|----------|
| `parallel: []` (empty array) | Treat as no `parallel` key — fall through to normal gate logic |
| All tasks return SKIP | Gate = SKIP, advance to next gate |
| Task timeout (max_wait_seconds exceeded) | Watcher synthesizes FAIL with timeout message; early cancellation fires |
| Watcher crash (no output) | `collectWatcherResult` returns `null`; treat as ERROR after 3 collection attempts |
| Resume after crash mid fan-out | `parallel_watchers` has mix of `pending`/`done`; re-collect pending only; do NOT re-spawn done tasks |

# Proposal: Parallel Gate Execution

**Date:** 2026-06-03  
**Status:** Draft  

## Problem

Gates currently run strictly sequentially. For a gate like `pre-merge`, the runner
executes checks one-by-one and the whole gate blocks until all are done. When a gate
needs to do code review + run tests, there's no way to fan them out concurrently —
even though they are fully independent.

This wastes wall-clock time. A PR review that takes 60s and a test suite that takes
90s today take 150s. They could take 90s.

## Proposed Solution

Add opt-in **parallel sub-tasks** inside a gate, declared entirely in config.
No `parallel` key → gate behaves exactly as today (backward-compatible).

```json
{
  "gate_instructions": {
    "pre-merge": {
      "parallel": [
        {
          "id": "code-review",
          "async": true,
          "async_subagent_type": "oracle",
          "async_max_wait_seconds": 300
        },
        {
          "id": "run-tests",
          "async": true,
          "async_subagent_type": "quick",
          "async_max_wait_seconds": 180
        }
      ]
    }
  }
}
```

Each entry in `parallel` is a `ParallelTask` — a lightweight extension of the
existing async-gate shape. The runner is invoked once per task (`runner <gate> --task <id>`),
each in its own background subagent. The gate PASSes only when every task PASSes.

## What Changes

| Area | Change |
|------|--------|
| `types.ts` | Add `ParallelTaskSchema`, extend `GateInstructionSchema` with optional `parallel` array, extend `LoopMeta.watcher_task_id` → `parallel_watchers` map |
| `config-loader.ts` | Validate `parallel` entries; each must have unique `id` |
| `harness-loop-event-handler.ts` | If gate has `parallel` tasks → fan-out via `spawnWatcher` N times; collect when all done |
| `async-watcher-spawner.ts` | Minor: accept optional `task_id` suffix for runner invocation |
| `storage.ts` | Persist/restore `parallel_watchers` map |
| Tests | Unit tests for fan-out, merge, partial-failure paths |

## What Does NOT Change

- Sequential gate order (pre-work → pre-merge → post-merge …) — unchanged
- Gates without `parallel` — zero behavioral change, same code path
- Runner contract (`RunnerOutputSchema`) — unchanged; each task returns one `RunnerOutput`
- `watcher_task_id` field renamed to `parallel_watchers` but state migration handles old format

## Acceptance Criteria

1. Gate with `parallel: [...]` fans out N background subagents simultaneously
2. Gate result = PASS only when all N tasks return PASS
3. Gate result = FAIL if any task returns FAIL (other watchers cancelled)
4. Gate without `parallel` key → identical behavior to current code
5. State persists `parallel_watchers` map; resume after crash re-uses existing task IDs
6. All existing tests pass; new tests cover parallel fan-out and partial failure

# Proposal: Epic Mode

**Date:** 2026-06-03
**Status:** Draft
**Lane:** high-risk (touches `LoopMeta` schema + gate semantics + new CLI surface + GitHub adapter in Phase 2 = `public-api-contract` hard gate)

## Why

Today `/harness-on` drives **one** feature/story through five gates (`pre-work → in-progress → pre-merge → post-merge → next-ready`) and stops. When `next-ready` returns `next_gate: null`, the plugin calls `cancelLoop()` and emits `HARNESS-COMPLETE`. There is no code path to "pull the next story and continue."

For real-world adoption (BMAD generates 10 epics × N stories each), operators expect autonomous multi-story execution. Currently they must manually invoke `/harness-on` per story. This proposal closes that gap.

## What Changes

| Area | Change |
|------|--------|
| `types.ts` | Add `BacklogStorySchema`, `BacklogSchema`, `StoryStatusSchema`, `EpicProgressEntrySchema`, `EpicMetaSchema`, `EpicConfigSchema`. Add optional `epic?: EpicMeta` to `LoopMeta` and optional `epic?: EpicConfig` to `HarnessConfigSchema`. |
| `backlog-adapter.ts` (new) | `BacklogAdapter` interface + `FileBacklogAdapter` (reads `.opencode/harness.epic.json`). GitHub adapter deferred to Phase 2. |
| `topological-sort.ts` (new) | Kahn's algorithm + cycle detection + missing-dep detection. Throws `HarnessConfigError` on invalid backlog. |
| `loop-state-controller.ts` | Add `completeStoryAndAdvance()` and `pauseEpicForFailure()`. Modify `startLoop()` to accept optional epic backlog + snapshot it. Modify `clearLoopBlock()` to preserve epic state by default (toggle via `clearEpic` arg). |
| `harness-loop-event-handler.ts` | In `handleRunnerOutput` PASS and SKIP paths: when `epic.enabled` and no next gate → call `completeStoryAndAdvance()` instead of `cancelLoop()`. In FAIL path with `epic.failure_policy === "ask"` and gate iteration exceeded → call `pauseEpicForFailure()`. |
| `commands/harness-on.ts` | Add `--epic [path]`, `--resume` flags. Validate backlog at start (parse, topo-sort, cycle-check, missing-dep-check). |
| `commands/harness-off.ts` | Preserve `epic` state by default. Add `--clean` flag to fully wipe (current behavior). |
| `templates/` | Add `buildEpicStoryPrompt(storyId)` + `buildEpicCompletionPrompt()` + `buildEpicPausePrompt(storyId, gate)`. |
| `constants.ts` | Add `DEFAULT_EPIC_BACKLOG_PATH = ".opencode/harness.epic.json"` and `DEFAULT_MAX_ITERATIONS_PER_EPIC = 500`. |
| Tests | New `tests/epic-mode.test.ts` (≥15 cases covering lifecycle, topo sort, adapter, resume, failure policy). |
| `docs/HARNESS.md` | Document epic-mode workflow + interaction with Auto-merge Policy. |
| `README.md` | Add "Epic Mode" section with backlog file schema example. |

## What Does NOT Change

- **Runner contract** (`RunnerOutputSchema`) — unchanged. Plugin advances stories by mutating `state.feature_id`; runner receives the existing `--feature=<id>` arg.
- **Gate order and gate execution** — unchanged. Each story runs the same `gates` sequence.
- **Single-story mode** (no `--epic` flag) — zero behavioral change. All 132 existing tests must pass.
- **Parallel gate execution** (T-paralle) — works orthogonally within each story.
- **Auto-merge Policy** (`docs/HARNESS.md`) — applies per-story exactly as today.
- **State file path** — single file `.opencode/harness-loop.local.json`. Epic state is an optional field inside `loop.epic`, not a separate file.
- **Migration** — none required. `epic` is an optional Zod field; old state files parse fine (precedent: `parallel-gate-execution` used the same pattern).

## Locked Decisions (do not revisit during implementation)

These were resolved during deep-design (Metis + Oracle parallel analysis):

| # | Decision | Value |
|---|---|---|
| 1 | Backlog source | Adapter pattern. v1: file only. Phase 2: GitHub Issues. Phase 3: GitHub Projects v2. |
| 2 | Dependencies | Explicit `depends_on: string[]`. Topological sort with cycle + missing-dep detection at load. |
| 3 | Failure policy | `ask` — pause epic on first story failure. `skip` and `abort` deferred to Phase 2. |
| 4 | Parallelism | Sequential v1. One story at a time. Parallel deferred. |
| 5 | PR review | Per-story auto-merge governed by existing `docs/HARNESS.md` Auto-merge Policy (6 preconditions). |
| 6 | PRD ownership | Plugin **consumes** stories — does not generate. BMAD in the consumer project owns PRD/epic/story authoring. |
| A | Story complete | `next-ready` gate PASS with `next_gate: null`. Plugin trusts the runner; no separate PR/CI verification. |
| B | Iteration caps | Per-story counters reset (`gate_iteration`, `no_progress_count`, `same_error_history`). New `max_iterations_per_epic` cap (default 500). |
| C | `/harness-off` | **Preserve** epic state by default. Add `--clean` flag for full wipe. Add `--resume` to `/harness-on --epic` to continue. |

## Acceptance Criteria

1. `/harness-on --epic .opencode/harness.epic.json` loads backlog, topo-sorts, starts first ready story through gates.
2. Story PASS with `next-ready` returning `next_gate: null` → automatically advance to next ready story (deps satisfied). Toast emits `✅ Story "<id>" done → next "<id>" (N/M)`.
3. Story FAIL with `failure_policy: "ask"` AND `gate_iteration >= max_iterations_per_gate` → pause epic, emit `⏸️ Story "<id>" PAUSED at gate "<gate>"`, write epic state, exit loop.
4. `/harness-on --epic --resume` resumes from preserved epic state. Re-runs the current gate from iteration 0 (gates are idempotent).
5. `/harness-on` without `--epic` flag → identical behavior to v305 (regression test: all 132 existing tests pass unchanged).
6. Backlog with dependency cycle → fail at `/harness-on --epic` start with `HarnessConfigError` containing the cycle path. Loop never begins.
7. Backlog with `depends_on` referencing missing story → fail at start with `HarnessConfigError` naming the missing id.
8. All stories completed (no ready stories remaining, no failures) → toast `🏆 Epic complete! N/N stories done.`, `cancelLoop()`, emit `HARNESS-COMPLETE`.
9. Epic-wide cap: `total_iteration >= max_iterations_per_epic` → pause epic with policy `ask`. Toast names the cap.
10. `/harness-off` preserves `state.loop.epic` (clean slate only with `--clean`).
11. Crash recovery: state file has `epic.current_story_id = "X"` at gate `pre-merge`. Process restart → `/harness-on --epic --resume` re-runs `pre-merge` for `X` from iteration 0.
12. Backlog file is JSON-invalid → fail at start with `HarnessConfigError` containing parse-location hint.
13. `tsc --noEmit && npx vitest run` → 0 errors, all tests green (existing 132 + ≥15 new = ≥147).
14. `npm pack --dry-run` → includes new source files in `dist/`.
15. Pre-merge gate PASS — full validation ladder.

## Out of Scope (deferred)

- GitHub Issues adapter (Phase 2 — separate proposal)
- GitHub Projects v2 adapter (Phase 3)
- `failure_policy: "skip"` and `"abort"` (Phase 2)
- Parallel story execution across worktrees (Phase 3)
- `/harness-status`, `/harness-skip`, `/harness-retry` commands (Phase 2)
- Epic-level branch sync / "main health check" between stories (Phase 2 — Metis risk #4)
- Dynamic backlog mutation during epic (hot reload)
- Per-story gate config overrides
- Cross-epic dependencies
- Notification / webhook integration

## Risks (top 5, mitigated)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Backward compat regression | HIGH | `epic` is optional Zod field. All new code paths behind `state.loop.epic?.enabled` check. Existing tests must pass unchanged. |
| Re-entry race (session.idle fires during story transition) | MEDIUM | Existing `inFlightSessions` guard already serializes. `completeStoryAndAdvance()` is synchronous state mutation + atomic `writeState`. |
| State file shape change | LOW | Optional field — no migration code. Same pattern as `parallel-gate-execution` (v303). |
| Cost runaway (50 stories burn budget) | MEDIUM | New `max_iterations_per_epic: 500` cap. Pause-on-cap with `ask` policy. |
| Adapter over-engineering | LOW | v1 = single `FileBacklogAdapter`. No DI framework, no factory abstraction. Switch statement in `createBacklogAdapter()`. |

## Phasing

- **Phase 1 (this proposal, target v306)**: File adapter, topo sort, sequential execution, `ask`-on-fail, `--resume`, epic-wide iteration cap, observability via toasts.
- **Phase 2 (separate proposal, target v307)**: GitHub Issues adapter, `/harness-status` command, additional failure policies (`skip`, `abort`), main-health-check between stories.
- **Phase 3 (separate proposal, v308+)**: GitHub Projects v2, parallel stories via worktrees, `/harness-skip` / `/harness-retry`.

# Phase 5: ANALYZE — Coverage + Release gates

## Per-dimension coverage

| Dim | Total TCs | PASS | FAIL | SKIP | Coverage % | Gate target | Result |
|---|---|---|---|---|---|---|---|
| D1 UI/UX | 7 | 7 | 0 | 0 | 100% | ≥70% | ✅ |
| D2 API | 7 | 7 | 0 | 0 | 100% | ≥85% | ✅ |
| D3 Performance | 5 | 5 | 0 | 0 | 100% | ≥70% | ✅ |
| D4 Security | 5 | 4 | **1** | 0 | 80% | ≥85% | ⚠️ **BELOW** |
| D5 Data Integrity | 5 | 5 | 0 | 0 | 100% | ≥85% | ✅ |
| D6 Infrastructure | 6 | 5 | 0 | 1 (PAINFUL) | 83.3% | ≥70% | ✅ |
| D7 Edge Cases | 9 | 8 | 0 | 1 (PAINFUL) | 88.9% | ≥70% | ✅ |
| **Total** | **44** | **41** | **1** | **2** | **93.2%** | | |

## Release Gate evaluation

| Gate criterion | Requirement | Actual | Pass? |
|---|---|---|---|
| All 7 dims ≥ 70% | Yes | All ≥80% (lowest is D4 @ 80%) | ✅ |
| 5/7 dims ≥ 85% | Yes | 6/7 ≥85% (D4 is at 80%, others ≥88%) | ✅ |
| Zero P0 FAIL | Yes | **1 P0 FAIL (TC-D4-05)** | 🔴 **NO-GO** |
| Any dim < 50% | No | None below 50% | ✅ |
| >2 P0 FAILs | No | 1 P0 FAIL | ✅ (only 1) |
| Critical MISSING | No | None | ✅ |

## Verdict

🔴 **RELEASE BLOCKER** — v2026.6.0313 is **NOT GO** for autonomous use until TC-D4-05 (BacklogSchema strict) is fixed.

### Why P0?

The `BacklogSchema` defect is a **security boundary violation**:
1. Backlog file is operator-controlled but can come from any source (file, GitHub, future MCPs)
2. Schema strictness is the plugin's defense against untrusted input smuggling fields into state
3. State file is persisted to disk AND read by downstream tools (capyhome's harness-state.py)
4. The audit issue #14 explicitly called out "Trust without verify" as systemic pattern — this is a fresh instance

### Fix complexity: TRIVIAL

Add `.strict()` to two Zod schemas. ~2 lines. ~5 min implementation including tests.

### Severity rationale

- **P0** not P1 because: untrusted backlog input + persisted to state + already shipped in v306-v313 = active vulnerability window
- Not "fix in next release" because: each release ships incrementally; users on v313 today are exposed

## Other findings

### Strengths confirmed

| Area | Evidence |
|---|---|
| Defense-in-depth on completion claims | structuralGuard (v309) + prompt skeptical caveat (v313) both block premature HARNESS-COMPLETE |
| Atomic state writes | openSync + fsync + renameSync + UUID temp + crash cleanup (v312 M5) |
| Concurrency safety | inFlightSessions Map with placeholder Promise (v311 H1) |
| Schema strictness — partial | RunnerOutputSchema.strict() correctly rejects unknown keys |
| Unicode support | feat/héllo-thế-giới-🚀 and Vietnamese strings round-trip cleanly |
| Anchored override regex | `^...$/m` prevents inline-text false matches |

### Coverage gaps acknowledged

| Area | Status |
|---|---|
| Real OpenCode session test (toast UI visibility, command autocomplete) | Manual-only — operator runs in capyhome |
| graceTimeout firing after gate transition (timer-based race) | Verified by code review of C3 fix; vitest fake timers cover the structural shape |
| postinstall on read-only filesystem | Skipped — fs mocking unstable in vitest+ESM |

## Next actions

### Immediate (P0)
- [ ] Fix `BacklogSchema` and `BacklogStorySchema` with `.strict()` (Sprint 5 / cluster pending)
- [ ] Add regression test asserting unknown fields rejected
- [ ] Ship as v314 BEFORE marking v313 release-stable

### Follow-up (P1, this release)
- [ ] Add manual test checklist for operator (capyhome real-use scenarios EU-1 through EU-10)
- [ ] Document: schema-strict pattern in `docs/HARNESS.md` ("Forbidden Practices" section already covers `RunnerOutputSchema`)

### Long-term (P2, separate audit)
- [ ] Add CI guard that asserts `.strict()` on every exported Zod schema (catches this class of bug at PR time)
- [ ] Integration test for full state file round-trip with capyhome's harness-state.py reader

# Phase 4: EXECUTE — Test results

## Summary

| TC | Status | Notes |
|---|---|---|
| All 🟦 UNIT tier (31 TCs) | ✅ PASS | vitest 188/188 green |
| TC-D6-01 npm pack includes templates/dist/postinstall.js/docs | ✅ PASS | All 10 expected paths in tarball |
| TC-D6-02 tsc clean | ✅ PASS | exit 0 |
| TC-D6-03 vitest run | ✅ PASS | 188/188 |
| TC-D6-04 pre-merge gate | ✅ PASS | all 4 checks PASS |
| TC-D4-03 randomUUID() for temp suffix | ✅ PASS | `storage.ts:9 import { randomUUID }`, `:30 tmpPath = ...tmp.${randomUUID()}` |
| TC-D4-04 OVERRIDE_TOKEN_REGEX anchored | ✅ PASS | Inline `"I said [HARNESS-OVERRIDE]: stop"` not matched; line-start `"\n[HARNESS-OVERRIDE]: stop"` extracts "stop" |
| **TC-D4-05 BacklogSchema strict** | 🔴 **FAIL (P0 SECURITY)** | Schema accepts arbitrary unknown keys including `"token": "ghp_secret"` |
| TC-D5-02 atomicWriteFile crash cleanup | ✅ PASS | `storage.ts:42 catch (e) { ...unlinkSync(tmpPath)... }` |
| TC-D5-05 atomic write pattern | ✅ PASS | openSync + fsync + renameSync sequence verified |
| TC-D3-03 heartbeat unref | ✅ PASS | `harness-loop-event-handler.ts:83 interval.unref?.()` + `:562 graceTimeout.unref?.()` |
| TC-D7-08 Unicode/Vietnamese | ✅ PASS | feature_id `feat/héllo-thế-giới-🚀` + Vietnamese instructions rendered correctly in prompt |

## Detailed evidence

### TC-D6-01 npm pack
```
npm notice 8.8kB docs/GETTING_STARTED.md
npm notice 4.8kB docs/SETUP_INSTRUCTIONS_FOR_AGENT.md
npm notice 4.1kB scripts/postinstall.js
npm notice 971B templates/init/.opencode/harness.config.json
npm notice 485B templates/init/docs/harness/gates/in-progress.md
npm notice 609B templates/init/docs/harness/gates/next-ready.md
npm notice 629B templates/init/docs/harness/gates/post-merge.md
npm notice 836B templates/init/docs/harness/gates/pre-merge.md
npm notice 966B templates/init/docs/harness/gates/pre-work.md
npm notice 115B templates/init/gitignore.template
```

### TC-D6-03 vitest
```
Test Files  16 passed (16)
     Tests  188 passed (188)
   Start at  16:55:01
   Duration  2.70s
```

### TC-D6-04 pre-merge
```json
{"gate":"pre-merge","status":"PASS","checks":[
  {"id":"3.1","name":"tsc --noEmit","status":"PASS"},
  {"id":"3.2","name":"vitest run","status":"PASS"},
  {"id":"3.3","name":"No forbidden type escapes","status":"PASS"},
  {"id":"3.4","name":"npm pack --dry-run","status":"PASS"}
],"next_gate":"post-merge"}
```

### TC-D4-04 Regex anchor evidence
```
✓ "I said [HARNESS-OVERRIDE]: stop" → null (correctly rejected — not at line start)
✓ "\n[HARNESS-OVERRIDE]: stop"      → match[1] === "stop" (correctly extracted)
```

### TC-D4-05 BacklogSchema FAIL (real bug)

**Input:**
```typescript
const malicious = {
  epic_id: "X",
  stories: [{ id: "s1", title: "t" }],
  token: "ghp_secret",   // ← arbitrary field
};
BacklogSchema.safeParse(malicious);  // expected: { success: false }
                                     // actual:   { success: true, data: ... }
```

**Vitest output:**
```
AssertionError: expected true to be false
  Expected: false
  Received: true
```

**Source defect (`types.ts`):**
```typescript
export const BacklogSchema = z.object({
  epic_id: z.string(),
  title: z.string().optional(),
  stories: z.array(BacklogStorySchema).min(1),
});  // ← missing .strict()
```

`BacklogStorySchema` has the same defect.

**Impact (P0 security):**
- Backlog file from untrusted source can smuggle fields (e.g., `auth_token`, `__proto__`-like keys) into the state file via `epic.backlog_snapshot`.
- State file is read by plugin AND by capyhome's `harness-state.py` — extra fields propagate downstream silently.
- Reinforces the audit's "Trust without verify" systemic pattern.

**Recommended fix:** Add `.strict()` to both `BacklogSchema` and `BacklogStorySchema`, matching the pattern of `RunnerOutputSchema` (which IS strict).

### TC-D7-08 Unicode rendering
```
[SYSTEM DIRECTIVE: OH-MY-HARNESS-LOOP - GATE CONTINUATION]
Gate "g1" FAILED. Rules violated: R1. Fix the failures and continue working on the next pending task.
- Proceed without asking for permission
- Address each rule violation by editing the relevant code/config
- Do not stop until <promise>HARNESS-COMPLETE</promise> is emitted AND all gates have passed
- If you believe all work is already complete, the system is questioning your completion claim...

(feature_id "feat/héllo-thế-giới-🚀" persists in JSON state and in prompt;
 Vietnamese instructions "Sửa lỗi ở dòng 42" displays correctly)
```

## Skipped TCs

- TC-D6-06 (postinstall on read-only fs) — 🟠 PAINFUL, skipped per plan; manual scenario only
- TC-D7-07 (graceTimeout post-transition) — 🟠 PAINFUL, verified by code review of v310 C3 fix
- All 🟡 MANUAL tier — deferred to operator (capyhome real-use validation)

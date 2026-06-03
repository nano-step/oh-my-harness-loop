# Story: [Title]

**Issue:** #N  
**Lane:** tiny | normal | high-risk  
**Change type:** user-feature | bug-fix | refactor | infrastructure | docs | dependency-bump  
**Date:** YYYY-MM-DD  

---

## Goal

One sentence: what does this story accomplish?

## Background

Why is this needed? What problem does it solve?

## Acceptance Criteria

- [ ] AC1: [Concrete, testable outcome]
- [ ] AC2: [Concrete, testable outcome]
- [ ] AC3: All existing tests still pass (`tsc --noEmit && npx vitest run`)

## Hard Gates (if high-risk)

- [ ] `public-api-contract`: exported types reviewed, no unintentional breaks
- [ ] `plugin-api-compat`: plugin hook signatures unchanged or versioned
- [ ] `npm-publish-contract`: `npm pack --dry-run` passes, correct files included

## Implementation Notes

_Fill in before starting. Update as you go._

- Key files to change:
- Approach:
- Edge cases to handle:

## Validation

```bash
# Required for every lane
tsc --noEmit && npx vitest run

# Required for user-feature / bug-fix
npm pack --dry-run

# Required for high-risk
npx vitest run --reporter=verbose
```

## Evidence

- [ ] Test output saved to `docs/evidence/<issue-N>-test-output.txt`
- [ ] `npm pack --dry-run` output (if applicable)
- [ ] Review verdict (PASS / PASS-WITH-NOTES / FAIL)

## OpenSpec Change

_Link if applicable:_ `openspec/changes/<change-name>/`

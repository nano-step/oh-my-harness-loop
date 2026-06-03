# Gate: in-progress

Fast incremental feedback while implementing. Runs only typecheck so each iteration stays cheap.

## Hard Rules

- Never silence type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`. Fix the underlying type instead. (See `docs/HARNESS.md` — Forbidden Practices.)
- Never declare a feature done from this gate. Full test run happens at `pre-merge`.

## Step-by-Step Procedure

1. Run typecheck:
   ```bash
   npm run typecheck
   ```
2. If errors:
   - Read the error location and root-cause it.
   - Fix the type definition, not the call site escape hatch.
   - Re-run typecheck.

## Evidence Requirements

- `npm run typecheck` output is empty (exit 0).

## FAIL Conditions

- `tsc --noEmit` exits non-zero.
- Any `as any` / `@ts-ignore` / `@ts-expect-error` introduced (will be caught at `pre-merge` too — fix here).

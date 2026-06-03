# Gate: pre-merge

Full validation ladder per `docs/HARNESS.md`. Must pass before opening a PR or merging.

## Hard Rules

- Never claim "tests pass" without showing `npx vitest run` output.
- Never bypass `npm pack --dry-run` failures — they signal a broken `package.json` `files`/`exports`/`main`/`types`.
- No `as any`, `@ts-ignore`, `@ts-expect-error` anywhere in source (excluding `tests/`, `node_modules/`, `dist/`).

## Step-by-Step Procedure

1. Run the full validation ladder locally:
   ```bash
   npm run typecheck
   npx vitest run
   npm pack --dry-run
   ```
2. Scan for forbidden type escapes:
   ```bash
   grep -rEn --include='*.ts' \
     -e 'as any' -e '@ts-ignore' -e '@ts-expect-error' . \
     | grep -v -E '(^|/)(node_modules|dist|\.git|tests)/'
   ```
   Output must be empty.
3. Inspect `git status` — only intended files should be staged.

## Evidence Requirements

- Full `tsc --noEmit` output (silent on success).
- Full `vitest run` summary line (e.g., `Test Files X passed, Tests Y passed`).
- `npm pack --dry-run` Tarball Contents listing.

## FAIL Conditions

- Type errors.
- Any failing test.
- Forbidden type escape present.
- `npm pack --dry-run` errors or missing required files (`dist/index.js`, `dist/index.d.ts`).

## Recovery Hints

- Tests fail → consult `systematic-debugging` skill. Never delete a failing test.
- `npm pack` fails on missing files → run `npm run build` and re-check `package.json` `files` array.

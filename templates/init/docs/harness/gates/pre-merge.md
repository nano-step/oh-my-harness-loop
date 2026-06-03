# Gate: pre-merge

Full validation ladder before opening a PR. Runs once when the agent claims "ready to merge".

## Hard Rules

- Type check passes.
- Tests pass.
- No forbidden type-safety escape hatches in changed files (e.g. `as any`, `@ts-ignore`).
- (Optional) Build artifacts valid (`npm pack --dry-run`, `cargo build --release`, etc.).

## Step-by-Step Procedure

1. Type check (`tsc --noEmit`).
2. Full test suite (`vitest run`, `pytest`, `cargo test`).
3. Grep for forbidden patterns in diff vs `master`.
4. (Optional) Dry-run package build.

## Evidence Requirements

- Each check has exit code 0.
- Grep returns 0 matches in modified non-test files.

## FAIL Conditions

- Type errors → FAIL `R3.1`.
- Test failures → FAIL `R3.2` with failing test names.
- Forbidden pattern present → FAIL `R3.3` with file:line refs.

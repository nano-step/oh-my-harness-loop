# Gate: in-progress

Fast feedback during active development. Runs frequently, must be quick.

## Hard Rules

- Type/compile check must pass.
- (Replace with your project's fast checks.)

## Step-by-Step Procedure

1. Run type check (e.g. `tsc --noEmit`, `mypy`, `cargo check`).
2. (Optional) Run fast linter.

## Evidence Requirements

- Type check exits 0.

## FAIL Conditions

- Type errors → FAIL with rule_id `R2.1` and instruction containing the type-error output (truncated).

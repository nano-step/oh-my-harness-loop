# Gate: post-merge

Runs after the PR has been merged into the default branch. Verifies the working tree is clean and the merge succeeded.

## Hard Rules

- Working tree clean.
- On default branch (`master` / `main`).
- (Optional) Latest tag created / release pipeline succeeded.

## Step-by-Step Procedure

1. `git status` shows clean.
2. `git rev-parse --abbrev-ref HEAD` is the default branch.
3. (Optional) Verify CI passed on the merge commit.

## Evidence Requirements

- `git status --short` empty.

## FAIL Conditions

- Uncommitted changes after merge → FAIL `R4.1` "Uncommitted work survived the merge. Investigate."

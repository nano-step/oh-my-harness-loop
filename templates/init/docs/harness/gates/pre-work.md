# Gate: pre-work

First gate of the cycle. Verifies the workspace is ready before starting actual work on a feature/story.

## Hard Rules

Fill in your project's pre-work rules. Examples:
- Must be on a feature branch (not `master` / `main`).
- Dependencies installed (`node_modules/`, `.venv`, etc. present).
- No uncommitted changes from previous work.

## Step-by-Step Procedure

1. (Replace with your steps.) Verify branch is not the default branch.
2. Verify dependencies are installed.
3. Confirm working tree is clean OR stash work.

## Evidence Requirements

- (Replace with concrete outputs.) `git rev-parse --abbrev-ref HEAD` shows a non-default branch.
- `ls node_modules/` (or stack equivalent) is non-empty.

## FAIL Conditions

- On default branch → FAIL with rule_id `R1.1` and instruction "Create a feature branch before starting work."
- Dependencies missing → FAIL with rule_id `R1.2` and instruction "Run `npm install` (or stack equivalent)."

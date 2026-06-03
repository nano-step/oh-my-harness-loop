# Gate: pre-work

Verify the workspace is ready before any code changes.

## Hard Rules

- Never start work directly on `master` or `main`.
- Never skip `npm install` — the loop relies on `vitest`, `tsc`, and Zod resolving correctly.

## Step-by-Step Procedure

1. Confirm current branch is a feature branch:
   ```bash
   git rev-parse --abbrev-ref HEAD
   ```
   If the result is `master`/`main`, create a feature branch:
   ```bash
   git checkout -b feat/<short-slug>
   ```
2. Confirm `node_modules` exists. If missing, run:
   ```bash
   npm install
   ```

## Evidence Requirements

- Branch name (not `master`/`main`) printed in the conversation.
- `node_modules/` exists.

## FAIL Conditions

- Branch is `master` or `main`.
- `node_modules/` is missing.

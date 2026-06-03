# Gate: post-merge

After PR merge to `master`. Verify the workspace is clean and the release pipeline can proceed.

## Hard Rules

- Never amend or force-push merged commits.
- Never leave uncommitted changes that contradict the merged state.

## Step-by-Step Procedure

1. Ensure local `master` matches origin:
   ```bash
   git checkout master
   git pull --ff-only
   ```
2. Confirm working tree is clean:
   ```bash
   git status
   ```
3. The CI workflow `auto-tag.yml` should tag the new release; `release.yml` then publishes to npm. Monitor:
   ```bash
   gh run list --limit 5
   ```

## Evidence Requirements

- `git status` reports `nothing to commit, working tree clean`.
- `gh run list` shows the latest auto-tag / release runs queued or succeeded.

## FAIL Conditions

- Uncommitted changes present after merge.
- Local `master` diverged from `origin/master`.

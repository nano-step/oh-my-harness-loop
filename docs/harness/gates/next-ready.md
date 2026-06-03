# Gate: next-ready

Terminal gate. Reaching it means the feature is complete and the agent may emit the completion promise.

## Hard Rules

- Only emit `HARNESS-COMPLETE` when all preceding gates passed.
- Never re-enter the loop without a new feature/story.

## Step-by-Step Procedure

1. If `pre-merge` and `post-merge` both PASSed, archive the OpenSpec change (if applicable):
   ```bash
   openspec archive <change-id>
   ```
2. Emit completion promise so the loop stops:
   ```
   HARNESS-COMPLETE
   ```

## Evidence Requirements

- `pre-merge` and `post-merge` both reported PASS in the checkpoint history.
- (If OpenSpec change was tied to this work) `openspec/changes/archive/<date>-<change-id>/` exists.

## FAIL Conditions

- This gate has no FAIL conditions — if reached, the loop ends.

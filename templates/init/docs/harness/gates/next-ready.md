# Gate: next-ready

Terminal gate of the cycle. Reaching it means the feature/story is fully done.

## Hard Rules

- Only emit `HARNESS-COMPLETE` when all preceding gates passed.
- Never re-enter the loop without a new feature/story.

## Step-by-Step Procedure

1. (Optional) Archive related OpenSpec change: `openspec archive <id>`.
2. Emit completion promise so the loop stops:
   ```
   HARNESS-COMPLETE
   ```

## Evidence Requirements

- `pre-merge` and `post-merge` both reported PASS in checkpoint history.

## FAIL Conditions

This gate has no FAIL conditions. If reached, the loop ends successfully.

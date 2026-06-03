# Known Issues

Active issues tracked here are not yet fixed. Each entry includes severity, repro, impact, and workaround.

## P0 — Active

### KI-001: `BacklogSchema` and `BacklogStorySchema` are not strict

**Affected versions:** v2026.6.0306 (introduction of epic-mode) through v2026.6.0313 (current).
**Discovered:** 2026-06-03 via RRI-T testing (TC-D4-05, see `ai/test-case/rri-t/plugin-v313/04-execute.md`).
**Source file:** `types.ts` — `BacklogSchema`, `BacklogStorySchema`.

#### Problem

Both schemas are defined with `z.object({...})` and lack the `.strict()` modifier. Zod's default behavior is to silently **accept unknown keys** rather than reject them. This violates the plugin's own "trust without verify" defense pattern that `RunnerOutputSchema` already enforces.

#### Reproduction

```typescript
import { BacklogSchema } from "oh-my-harness/types";

const malicious = {
  epic_id: "demo",
  stories: [{ id: "s1", title: "t" }],
  token: "ghp_secret_smuggled",
  __proto__: { polluted: true },
};

const r = BacklogSchema.safeParse(malicious);
console.log(r.success);
// expected: false
// actual:   true   ← bug
```

#### Impact

A backlog file from any source (local file under `.opencode/harness.epic.json`, or any future GitHub / Linear / MCP-driven source) can include arbitrary unknown fields. These fields:

1. Pass validation
2. Get snapshotted into `state.loop.epic.backlog_snapshot`
3. Persist to disk inside `.opencode/harness-loop.local.json`
4. Are then read by downstream tools (e.g. capyhome's `harness-state.py`) which may not also be strict

Net effect: untrusted backlog input can smuggle data into agent state silently.

#### Workaround

Until v314 ships with the fix:

1. **Only load backlog files from trusted sources.** If you pull a backlog from a coworker's PR, an external repo, or an automated import, audit the JSON before invoking `/harness-on --epic`.
2. **Manually validate backlog schema before use:**
   ```bash
   jq 'keys' .opencode/harness.epic.json   # confirm only epic_id, title, stories
   jq '.stories[] | keys' .opencode/harness.epic.json   # confirm only id, title, feature_id, issue_number, story, depends_on
   ```
3. **Inspect state file periodically:**
   ```bash
   jq '.loop.epic.backlog_snapshot | keys' .opencode/harness-loop.local.json
   ```

#### Fix preview

```typescript
// types.ts
export const BacklogStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  feature_id: z.string().optional(),
  issue_number: z.number().optional(),
  story: z.string().optional(),
  depends_on: z.array(z.string()).default([]),
}).strict();   // ← add

export const BacklogSchema = z.object({
  epic_id: z.string(),
  title: z.string().optional(),
  stories: z.array(BacklogStorySchema).min(1),
}).strict();   // ← add
```

Estimated fix effort: ~10 minutes (2 lines of source + 2-3 lines of regression test). Tracked for v314.

#### Why not fixed in v313

Operator chose to ship v313 (OH-MY-OPENCODE continuation prompts, issue #21) without bundling this fix to keep the release focused on the originally-scoped feature. Documented exposure window is acceptable because:
- Most users currently load file backlogs from their own project (trusted)
- The fix is independently shippable as v314
- Detection logic in the plugin (gate runners, structural guards) still operates correctly even when extra fields exist

---

## Closed / Fixed

(none yet — first iteration of this file)

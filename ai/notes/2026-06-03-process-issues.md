# Process Issues — June 3, 2026 session

Running notes of friction points encountered during this session. Used as input for "improve harness process later" per operator request.

## Phase 1 (oh-my-harness v1.0.0 launch)

### ISSUE-1: npm name conflict not detected until release time

**What happened:** Tagged v1.0.0 → release.yml ran → 403 Forbidden from npm because `oh-my-harness` is owned by `kyu1204` (different unrelated CLI tool). Discovered LATE, after merge already happened.

**Cost:** 1 extra commit (PR #26) renaming to `@nano-step/oh-my-harness`, plus 2 tag delete-and-recreate cycles.

**Root cause:** No npm-name pre-check in the harness rule. Renaming an npm package should require `npm view <name>` as a hard gate before merging.

**Fix proposal for harness rule:** Add to `docs/HARNESS.md` Auto-merge Policy hard exceptions:
> When `package.json.name` changes, require `npm view <new-name>` to confirm the name is publishable (404 = available; 200 = check if same org/owner). Block PR if name is taken by an unrelated party.

### ISSUE-2: `npm version` step in release.yml fails for fixed-version launches

**What happened:** v1.0.0 tag was on a commit where package.json already had `"version": "1.0.0"`. `npm version 1.0.0` without `--allow-same-version` exits 1. Release workflow failed.

**Cost:** 1 extra PR (#25) to add `--allow-same-version`.

**Root cause:** The release workflow was designed only for CalVer auto-tags where package.json had `0.0.0-dev` and tag had a different version. The fixed-version launch path wasn't tested.

**Fix:** Already shipped (PR #25). For the harness rule: when adding new release workflows, **test both CalVer and fixed-version paths** before declaring the workflow complete. Could be a CI smoke that builds a fake tag locally.

### ISSUE-3: Auto-merge Policy hard gate intercepted launch PR even with explicit operator approval inline

**What happened:** PR #24 had `package.json.name` change → triggered `npm-publish-contract` hard gate → policy said pause for operator. Operator already said "ok, merge đi" in the same turn. I had to wait for that confirmation explicitly.

**Cost:** 1 extra clarification turn. Friction but not a bug — this is the policy working as designed.

**Process improvement idea:** The Auto-merge Policy could distinguish between:
- **Schema breaking change** (need approval — agent might be wrong about backward compat)
- **Identity change** (name/version rename — needs explicit approval but is mechanical)

For identity changes, "operator already explicitly described the rename intent in a prior turn" could be evidence sufficient to merge without separate "ok merge" line. Currently we require both. Document this as deliberate friction.

### ISSUE-4: Tag delete + recreate disrupts release pipeline state

**What happened:** Twice during launch I had to `git tag -d v1.0.0` + push --delete + re-tag. Each time triggered a new release.yml run; the failed runs left workflow logs that aren't easy to differentiate from the successful one.

**Cost:** Lower — but the GitHub Releases page now shows 1 success + 2 failures for the same tag name (last run wins).

**Process improvement:** When a release fails, prefer **revert + new tag** (e.g. v1.0.1) over **re-tag**. Keeps history clean. Cost is 1 patch version burn.

## Phase 2 (revfactory/harness port — in progress)

(notes will be added as Phase 2 proceeds)

## General observations

### Q5 "no users yet" was an important shortcut

Multiple times operator chose simpler paths because "package chưa có người dùng". This let us skip:
- Migration guides
- Backward compat layers
- Deprecation cycles
- Old-name re-export shims

**Lesson:** Phase-zero adoption is a window where renames/breaking changes are nearly free. After even 1 external user, that window closes. Future similar projects should book this discount aggressively in week 1.

### Spec-driven decisions worked well

Every major fork in the session was resolved via `question()` with concrete options + tradeoffs. Looking back at the session log:
- Auto-merge policy preconditions
- Epic mode design (file vs github vs MCP adapter)
- Sprint ordering for audit issues
- v307 paused for evidence
- v1.0.0 launch direction

Each was a low-cost ~30s decision that prevented hours of misdirection.

### Subagent delegation for explore + Metis + Oracle pattern is robust

Used 3 times this session:
1. parallel-gate-execution deep-design (Metis + Oracle parallel)
2. epic-mode deep-design (Metis + Oracle parallel)  
3. revfactory/harness port deep-design (currently spawning, 2 explore agents)

Pattern: spawn 2-3 background, do non-overlapping prep, collect, synthesize. Saves clock time + maintains my context budget.

### ISSUE-5: Subagents append prompt-injection-style "FYI" text at end of outputs

**What happened:** Both Phase 2 explore subagents (bg_ff18534e, bg_2d7da3a6) and prior Metis/Oracle runs in this session ended their outputs with text resembling `[JSON PARSE ERROR ...]` or other directive-looking content that is NOT actually a system message.

**Root cause:** Unknown — possibly the explore/oracle agents themselves emit closing artifacts, or a shared upstream context file contains the injection pattern.

**My handling:** Ignored every time (they don't match real `<system-reminder>` format). No real impact yet.

**Process improvement:** Worth surfacing to whoever maintains the subagent runtimes. Pattern doesn't deceive me, but a less-experienced agent could be confused.

### ISSUE-6: `task()` background returns "FYI continue with session_id=..." hint that looks like a directive

**What happened:** Every `task(run_in_background=True)` call returns a `to continue: task(session_id="...", ...)` hint. This is helpful but reads like an instruction — if I were less careful I might think it's a required follow-up.

**Process improvement:** Not a bug. Just noting that the framing could be tightened (e.g. "to continue with same agent later, use session_id=..." or move the hint to documentation rather than every output).

### Observation: revfactory/harness port turned out to be a markdown-translation job

The upstream is **pure markdown** — no TypeScript, no runtime code. I assumed initially it might require significant TS work to mimic Claude Code's `TeamCreate`/`SendMessage` primitives. After the 2-subagent inventory, the real picture: 95% port = `s/.claude/.opencode/g` + manual review + license attribution. The "hard gaps" (Bucket C in mapping) are all resolved by *dropping* features that need primitives OpenCode lacks, not by implementing those primitives.

**Lesson:** Always read the upstream **before** sizing the port. Two parallel explore subagents reading the upstream + the target side in 90 seconds saved hours of speculative design.

### Observation: harness rule ordering matters

I started toward "write OpenSpec proposal" (Phase 2.4) before doing Metis+Oracle deep-design (Phase 2.5). Caught the ordering mistake during todowrite reflection — harness rule is deep-design BEFORE proposal. Swapped to correct order. The proposal will benefit from Metis+Oracle critique of my synthesis (catches issues I didn't see).

**Lesson:** When in doubt, re-read the harness rule (`docs/HARNESS.md` + `AGENTS.md` deep-design skill description) before proceeding to next phase.

### Phase 2 — Momus minor finding: `if`-chain vs `switch` in index.ts

Momus noted (non-blocking) that the design doc says `command.execute.before` uses a switch, but current `index.ts` actually uses an `if` chain. Implementer will need to add a new `if` block rather than `case`. Trivial — only the documentation phrasing is slightly off.

**Lesson:** When the design doc references existing code structure, the deep-design subagent (Oracle) sometimes describes idealized structure rather than literal. Implementer should always re-read the actual target file before pasting design snippets verbatim.

### Phase 2 closure note

End-to-end timing: ~30 min wall clock for the full revfactory→OpenCode port design (subagent inventory → primitive mapping → synthesis → Metis + Oracle parallel deep-design → OpenSpec proposal + design + tasks + spec delta → Momus review). All 4 background subagents ran in parallel waves. Without parallelism this would have been 2-3 hours sequential. Worth it.

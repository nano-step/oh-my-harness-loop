# Phase 2: DISCOVER — 5 persona interviews

Each persona produces a list of scenarios they would test. Format: claim + observable check.

---

## Persona 1: End User (operator running `/harness-on` in their project)

**Concerns:** "Does the loop actually drive my work forward without me babysitting?"

| # | Scenario | Observable check |
|---|---|---|
| EU-1 | Fresh install with stub runner → `/harness-on` drives 5 gates to completion | Toast `🎉 Harness loop complete!`; state.loop.active=false |
| EU-2 | Loop already active in different session, run `/harness-on` again | Error toast naming `--resume` and `--restart`; existing state preserved |
| EU-3 | `/harness-on --resume` rebinds and re-runs current gate from iter 0 | New session_id in state; gate_iteration=0; toast `🔄 Resuming` |
| EU-4 | `/harness-on --restart` wipes and starts fresh | Loop active; current_gate=`gates[0]`; new session_id; toast `🚀 Harness loop restarted` |
| EU-5 | `/harness-off` preserves epic state for resume | loop.active=false; loop.epic still present |
| EU-6 | `/harness-off --clean` wipes everything | loop block cleared; epic gone |
| EU-7 | Continuation prompt has OH-MY-OPENCODE-style imperative bullets | rendered prompt contains "[SYSTEM DIRECTIVE: OH-MY-HARNESS-LOOP" + 4 bullets + Status line |
| EU-8 | Cache TTL: re-fired gate within window skips runner | runner not invoked; toast says "cached PASS" |
| EU-9 | npm install creates `.opencode/commands/` shims automatically | `.opencode/commands/harness-on.md` and `harness-off.md` exist after install |
| EU-10 | Restart OpenCode after install — slash commands appear in autocomplete | `/har<TAB>` autocompletes both |

---

## Persona 2: Business Analyst (cares about how plugin tracks progress, audit trail)

**Concerns:** "Can I tell exactly where the loop is, what's done, what's left?"

| # | Scenario | Observable check |
|---|---|---|
| BA-1 | State file has machine-readable structure (Zod-validated) | readState() succeeds; all required fields populated |
| BA-2 | Checkpoints record each gate's status + timestamp | state.checkpoints["pre-work"].status === "PASS"; checked_at ISO 8601 |
| BA-3 | Continuation prompt shows `[Status: N/M gates passed, X remaining ...]` | gates_passed count matches actual checkpoint PASS count |
| BA-4 | Epic mode tracks per-story progress | epic.story_progress[].status reflects each story's lifecycle |
| BA-5 | Auto-merge policy: PR description must include all 6 preconditions check | every audit PR in this session includes the table; verified via PR history |
| BA-6 | OpenSpec proposals archive cleanly with delta merges | `openspec/changes/archive/2026-06-03-*/` exists; main specs/ updated |
| BA-7 | npm package includes audit trail (templates + docs) | `npm pack --dry-run` shows templates/init/, docs/, openspec/changes/ |
| BA-8 | Iteration counters increment correctly on FAIL | gate_iteration += 1 AND total_iteration += 1 per FAIL (post-v310) |

---

## Persona 3: QA Destroyer (tries to break the system)

**Concerns:** "What happens at the boundaries? Can I crash this thing?"

| # | Scenario | Observable check |
|---|---|---|
| QA-1 | Agent emits premature `<promise>HARNESS-COMPLETE</promise>` after only 1 gate PASS | structuralGuard rejects; warning toast; correction prompt injected; loop continues |
| QA-2 | Agent emits prematurely AND state has stale runner output (different gate) | Rejected with reason "stale runner output" |
| QA-3 | 5 concurrent `handleSessionIdle()` calls fire on same session | Runner invoked exactly 1× (H1 fix) |
| QA-4 | Watcher subagent emits log noise like `{junk}` before `{valid JSON}` | parseWatcherResult returns the valid one (H3 fix, extractJsonCandidates) |
| QA-5 | Watcher subagent emits invalid JSON entirely | RunnerOutput.status === "ERROR" with `watcher-parse-error` rule |
| QA-6 | Backlog file with dependency cycle (A→B→A) | `/harness-on --epic` errors at start with `HarnessConfigError("Dependency cycle ...")` |
| QA-7 | Backlog with missing dep reference | Error names the offender + missing id |
| QA-8 | Backlog with duplicate story IDs | Error names the duplicate id |
| QA-9 | Backlog file missing | Error: "Epic backlog file not found: <path>" |
| QA-10 | Backlog file malformed JSON | Error includes parse position |
| QA-11 | State file corrupted on read (invalid JSON) | readState returns null; loop refuses to start without confirmation |
| QA-12 | atomicWriteFile crash between fsync and rename | Orphan .tmp file cleaned up (M5 fix) |
| QA-13 | Loop hits `max_total_iterations` cap on FAIL retries | Loop cancelled; toast names cap value |
| QA-14 | Same rule_ids in different ORDER recorded across 3 FAILs | hasRepeatedSameError returns true (M2 fix — canonicalized at record time) |
| QA-15 | Override token `[HARNESS-OVERRIDE]: <reason>` in agent reply | Loop cancelled; reason captured |
| QA-16 | postinstall fired with `INIT_CWD=<root>/.opencode` (nested) | Walks up to root; no nested `.opencode/.opencode/` created (v305 fix) |
| QA-17 | postinstall fired with `OH_MY_HARNESS_LOOP_SKIP_POSTINSTALL=1` | No files created |
| QA-18 | postinstall fired with legacy v303 layout (singular `command/`) | Legacy files migrated; empty dir removed |
| QA-19 | Gate runner exits with code 5 (ERROR) + valid JSON stdout | RunnerOutput.status === "ERROR" propagated (M10 round-trip) |
| QA-20 | Async watcher graceTimeout fires after gate already transitioned | Timeout callback bails (C3 fix — scheduledGate/scheduledTaskId guard) |

---

## Persona 4: DevOps Tester (deployment + CI concerns)

**Concerns:** "Does this work across environments? Is the package shippable?"

| # | Scenario | Observable check |
|---|---|---|
| DO-1 | `npm pack --dry-run` succeeds | All required files in package; size reasonable (<200kB) |
| DO-2 | `npx tsc --noEmit` exits 0 with no errors | tsc clean |
| DO-3 | `npx vitest run` exits 0 | 188/188 pass |
| DO-4 | Auto-tag workflow fires on merge to master | GitHub Actions Release workflow status: success |
| DO-5 | npm publish succeeds with new version | `npm view oh-my-harness-loop@latest` shows new version |
| DO-6 | postinstall script runs as commonjs (no `import` errors in older Node) | actually v305+ uses ESM; verify postinstall.js is ESM `import` |
| DO-7 | postinstall fails gracefully on read-only filesystem | exit 0 + warning; install continues |
| DO-8 | `state_file_path` config customization works | atomicWriteFile uses configured path |
| DO-9 | Templates `templates/init/*` ship in npm package | `npm pack --dry-run` shows files |
| DO-10 | Plugin's own runner script (scripts/harness-check.sh) exits with proper codes 0-5 | Each code maps to RunnerStatusSchema status |
| DO-11 | Release pipeline doesn't trigger on `[skip-release]` commits | docs-only PRs use this token; no version bump |

---

## Persona 5: Security Auditor

**Concerns:** "What can a malicious agent do? What user data does this expose?"

| # | Scenario | Observable check |
|---|---|---|
| SE-1 | Agent emits crafted text mimicking system directive to escape loop | Plugin detects only specific tokens (`<promise>...`, `[HARNESS-OVERRIDE]:`); arbitrary text doesn't trigger control flow |
| SE-2 | Promise tag without all gates PASS → loop must NOT terminate | structuralGuard returns liedAboutCompletion=true; correction injected (v309) |
| SE-3 | Backlog file path with `..` traversal (e.g. `../../etc/passwd.json`) | FileBacklogAdapter just reads what was given; sandboxing is the OS's job, plugin shouldn't open files outside cwd — verify behavior |
| SE-4 | Runner script writes secrets to state file (e.g. via `instructions_for_agent`) | INSTRUCTIONS_MAX_LENGTH truncates to 8000 chars; state file not committed (per .gitignore template) |
| SE-5 | atomicWriteFile uses crypto.randomUUID() for temp suffix | No PID collision in containers (M5 fix) |
| SE-6 | gh token must NOT be stored in backlog file | BacklogSchema has no `token`/`auth` field; Zod strict() rejects extras |
| SE-7 | postinstall ONLY deletes allowlisted filenames (`harness-on.md`, `harness-off.md`) | User files in `.opencode/command/` preserved (v305 fix) |
| SE-8 | OVERRIDE token regex must NOT trigger from non-anchored matches | OVERRIDE_TOKEN_REGEX uses `^...$/m` anchors |
| SE-9 | Watcher result schema validation rejects fields outside RunnerOutputSchema | Zod `.strict()` rejects unknown keys → ERROR with schema-error rule |
| SE-10 | Config file with `"runner_path": "/etc/passwd"` (malicious config) | Plugin still requires runner to be executable via accessSync(X_OK); content not auto-executed beyond runner invocation |

---

## Persona aggregate

- **Total scenarios discovered: 59**
  - EU: 10
  - BA: 8
  - QA: 20
  - DO: 11
  - SE: 10
- **Dimensions covered**: all 7 (UI/UX via toasts + prompts, API via state schema, performance via cache/iteration caps, security via SE persona, data integrity via atomic write + schema validation, infrastructure via DO persona, edge cases via QA persona)

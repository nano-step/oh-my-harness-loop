# Phase 3: STRUCTURE — Q-A-R-P-T test cases

Format: **Q**uery / **A**ction / **R**esult expected / **P**riority / **T**ier (already-covered vs new)

Tier legend:
- 🟦 **UNIT** — already covered by existing 188 vitest tests; counts as PASS for coverage but no new execution needed
- 🟢 **E2E** — needs new test run this turn (shell + script-level)
- 🟡 **MANUAL** — requires interactive verification (capyhome use, OpenCode session); deferred to operator
- 🟠 **PAINFUL** — known limitation / cannot fix cheaply; document, not block

---

## D1 — UI/UX (toast messages, prompt formatting, command surface)

| TC | Q (scenario) | A (action) | R (expected) | P | T |
|---|---|---|---|---|---|
| TC-D1-01 | Continuation prompt has new OH-MY-OPENCODE header | Render `buildFailPrompt(ctx)` | Contains `[SYSTEM DIRECTIVE: OH-MY-HARNESS-LOOP - GATE CONTINUATION]` | P0 | 🟦 (test in continuation-prompt-builder.test.ts) |
| TC-D1-02 | FAIL prompt has imperative bullets | Render `buildFailPrompt` | Contains 4 lines starting with `- ` | P0 | 🟦 |
| TC-D1-03 | Status line shows `N/M gates passed, X remaining` | Render with 2 of 5 gates PASS in checkpoints | `[Status: 2/5 gates passed, 3 remaining \| ...]` | P0 | 🟦 |
| TC-D1-04 | BLOCKED prompt tells agent NOT to emit completion promise | Render `buildBlockedPrompt` | Contains "Do NOT emit completion promise" | P0 | 🟦 |
| TC-D1-05 | Toast on stale `/harness-on` shows `--resume` and `--restart` | Trigger LoopAlreadyActiveError | Toast `❌ Loop already active ... --resume ... --restart` | P0 | 🟦 |
| TC-D1-06 | Toast on restart shows `🚀 ... restarted` | `/harness-on --restart` on active loop | Toast contains "restarted" | P1 | 🟦 |
| TC-D1-07 | Slash command shims at `.opencode/commands/` (plural) | Run postinstall in fresh tmpdir | Files at plural path exist | P0 | 🟦 (postinstall.test.ts) |

---

## D2 — API (state schema, runner contract, controller methods)

| TC | Q | A | R | P | T |
|---|---|---|---|---|---|
| TC-D2-01 | RunnerOutputSchema is strict — unknown keys rejected | Parse output with extra field | Zod returns failure | P0 | 🟦 |
| TC-D2-02 | LoopMeta optional `epic` field — old state files parse cleanly | Read state without `loop.epic` | Parse succeeds; `loop.epic === undefined` | P0 | 🟦 |
| TC-D2-03 | All 6 runner exit codes round-trip | Mock runner exits 0/1/2/3/4/5 | Each maps to PASS/FAIL/SKIP/WAITING/BLOCKED/ERROR | P0 | 🟦 (runner-invoker.test.ts +M10) |
| TC-D2-04 | controller.completeStoryAndAdvance() picks next ready story | Setup epic with 3 stories, complete first | Returns 2nd story id; gate_iteration reset; epic_iteration_total +=1 | P1 | 🟦 |
| TC-D2-05 | `recordSameErrorHistory` stores canonicalized (sorted) rule_ids | Record `["R2", "R1"]` | Stored as `["R1", "R2"]` | P1 | 🟦 |
| TC-D2-06 | structuralGuard rejects promise tag with stale runner output | runnerOutput.gate ≠ current_gate | liedAboutCompletion=true; reason "stale" | P0 | 🟦 |
| TC-D2-07 | parseWatcherResult depth-tracks nested objects | Input with `{a: {b: {c: 1}}}` log noise + valid JSON | Returns valid one | P1 | 🟦 |

---

## D3 — Performance (cache freshness, iteration caps, heartbeat)

| TC | Q | A | R | P | T |
|---|---|---|---|---|---|
| TC-D3-01 | Cache freshness uses fresh state, not stale local var | Trigger cache check after gate transitioned mid-iteration | Uses freshState.loop.current_gate (M3) | P0 | 🟦 |
| TC-D3-02 | max_total_iterations brake fires on repeated FAIL | Set cap=3; FAIL 5 times | Loop cancelled after 3 iter | P0 | 🟦 (C2 test) |
| TC-D3-03 | Heartbeat unrefs interval to allow event loop exit | Spawn watcher, kill process | No hanging | P1 | 🟢 (manual verify via tsc behavior) |
| TC-D3-04 | parallel watchers fan out without sequential serialization | Spawn 3 watchers same gate | All 3 task IDs in parallel_watchers map | P1 | 🟦 (parallel-gate.test.ts) |
| TC-D3-05 | inFlightSessions Map serializes concurrent calls | 5 concurrent handleSessionIdle | Runner called 1× | P0 | 🟦 (H1 test) |

---

## D4 — Security (anti-lie, allowlist, schema-strict)

| TC | Q | A | R | P | T |
|---|---|---|---|---|---|
| TC-D4-01 | Premature `<promise>HARNESS-COMPLETE</promise>` after 1/N gates rejected | Setup state with 1 PASS, agent message with tag | structuralGuard.liedAboutCompletion=true | P0 | 🟦 (completion-detector.test.ts) |
| TC-D4-02 | postinstall only deletes allowlist filenames | Pre-create user-file.md in legacy dir + harness-*.md | User file preserved; harness-*.md deleted | P0 | 🟦 (postinstall.test.ts) |
| TC-D4-03 | atomicWriteFile uses crypto.randomUUID() not PID | inspect storage.ts source | Source contains `randomUUID()` not `process.pid` | P1 | 🟢 (source grep) |
| TC-D4-04 | OVERRIDE_TOKEN_REGEX anchored with `/m` | Apply regex to multi-line input with token NOT at line start | No match (anchored) | P1 | 🟢 (unit-eval) |
| TC-D4-05 | BacklogSchema strict — no `auth`/`token` fields accepted | Parse backlog with extra `token` field | Zod fails | P0 | 🟢 |

---

## D5 — Data integrity (state file, migrations, idempotency)

| TC | Q | A | R | P | T |
|---|---|---|---|---|---|
| TC-D5-01 | Old state file without `loop.epic` field migrates cleanly | Write old-format JSON, readState() | Parses; `loop.epic === undefined` | P0 | 🟦 (storage.test.ts) |
| TC-D5-02 | atomicWriteFile crash cleanup removes orphan .tmp | Force write failure | Orphan unlinked; throws original error | P0 | 🟢 (manual scenario) |
| TC-D5-03 | clearLoopBlock() preserves epic by default | Active epic + call clearLoopBlock() | epic block preserved; loop.active=false | P0 | 🟦 |
| TC-D5-04 | clearLoopBlock({clean:true}) full wipe | Active epic + call clearLoopBlock({clean:true}) | epic gone | P0 | 🟦 |
| TC-D5-05 | State file written atomically (tmp + rename) | Inspect storage.ts | Source uses openSync + fsync + renameSync | P0 | 🟢 (source grep) |

---

## D6 — Infrastructure (packaging, postinstall, CI)

| TC | Q | A | R | P | T |
|---|---|---|---|---|---|
| TC-D6-01 | npm pack includes templates/, dist/, postinstall.js, docs | `npm pack --dry-run` | All 4 paths present in tarball | P0 | 🟢 |
| TC-D6-02 | tsc --noEmit clean | Run | exit 0 | P0 | 🟢 |
| TC-D6-03 | vitest run all green | Run | 188/188 | P0 | 🟢 |
| TC-D6-04 | pre-merge gate PASS | `./scripts/harness-check.sh pre-merge --json` | All 4 checks PASS | P0 | 🟢 |
| TC-D6-05 | postinstall handles missing INIT_CWD | spawn with INIT_CWD unset | exit 0 silent | P1 | 🟦 |
| TC-D6-06 | postinstall handles read-only fs gracefully | mock fs.writeFileSync to throw | exit 0 + warning | P1 | 🟠 (skip — Node mock-fs not available) |

---

## D7 — Edge cases (rarely hit but high impact when they occur)

| TC | Q | A | R | P | T |
|---|---|---|---|---|---|
| TC-D7-01 | Backlog with cycle A→B→A errors at topo sort | Load such backlog | `HarnessConfigError("Dependency cycle ...")` | P0 | 🟦 (epic-mode.test.ts) |
| TC-D7-02 | Backlog with missing dep reference errors | Load backlog with depends_on=[nonexistent] | `HarnessConfigError` naming missing id | P0 | 🟦 |
| TC-D7-03 | Backlog with duplicate IDs errors | Load with dup id | `HarnessConfigError` naming duplicate | P0 | 🟦 |
| TC-D7-04 | Empty backlog stories array errors | Load `{epic_id:"X", stories:[]}` | Zod rejects (min 1) | P1 | 🟦 |
| TC-D7-05 | --resume without preserved epic errors | `/harness-on --epic --resume` on fresh state | `HarnessConfigError` actionable | P0 | 🟦 |
| TC-D7-06 | --resume with mismatched current_story_id | Tamper state with story not in backlog | `HarnessConfigError` naming mismatch | P1 | 🟦 |
| TC-D7-07 | graceTimeout fires after gate transitioned | C3 scenario | Callback bails on scheduledGate check | P0 | 🟠 (timer-based; verified by code review) |
| TC-D7-08 | Vietnamese / Unicode in feature_id or story body | Set feature_id=`feat/héllo-thế-giới` | Persists in state; prompt renders correctly | P1 | 🟢 |
| TC-D7-09 | Very long instructions_for_agent (>8000 chars) | Mock runner with 10k char instruction | INSTRUCTIONS_MAX_LENGTH truncates | P1 | 🟦 (continuation-prompt-builder.test.ts) |

---

## Test coverage targets per dimension

| Dim | Total TCs | UNIT (auto-pass) | E2E to run | Target |
|---|---|---|---|---|
| D1 UI/UX | 7 | 7 | 0 | ≥70% |
| D2 API | 7 | 7 | 0 | ≥85% |
| D3 Performance | 5 | 4 | 1 | ≥70% |
| D4 Security | 5 | 2 | 3 | ≥85% |
| D5 Data Integrity | 5 | 3 | 2 | ≥85% |
| D6 Infrastructure | 6 | 1 | 4 (skip 1 PAINFUL) | ≥70% |
| D7 Edge Cases | 9 | 7 | 1 (skip 1 PAINFUL) | ≥70% |
| **Total** | **44** | **31** | **11** | |

Plus 0 P0 FAILs required.

EXECUTE phase will:
1. Run vitest full suite (auto-PASS for 🟦 tier — counts toward dimension % if green)
2. Run pre-merge ladder (covers TC-D6-01..D6-04)
3. Manually run TC-D4-03 (source grep), TC-D4-04 (regex unit-eval), TC-D4-05, TC-D5-02 (synthetic crash), TC-D5-05 (source grep), TC-D7-08 (Vietnamese)

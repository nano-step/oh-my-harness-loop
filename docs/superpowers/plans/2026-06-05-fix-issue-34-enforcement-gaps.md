# Issue #34 Enforcement Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five highest-impact enforcement gaps identified in issue #34: async/parallel dead code, VERIFIED infinite loop, override file destruction, pauseEpicForFailure state leak, and zombie loop silence.

**Architecture:** Five self-contained fixes across four files. Each fix is independently testable. C1 and M3 are pure guard/ordering fixes. C2 adds a new detection branch in the idle handler. M5 reroutes one function call. M2 adds a single toast behind a one-shot Set guard.

**Tech Stack:** TypeScript, Zod, Vitest, Node.js fs

---

## File Map

| File | Change |
|---|---|
| `commands/harness-on.ts` | C1: reject async/parallel gate configs at startup |
| `harness-loop-event-handler.ts` | C2: VERIFIED detection; M2: zombie loop toast |
| `config-loader.ts` | M3: move override deletion to after schema validation |
| `loop-state-controller.ts` | M5: route pauseEpicForFailure through clearLoopBlock |
| `tests/commands.test.ts` | C1 tests |
| `tests/event-handler.test.ts` | C2 + M2 tests |
| `tests/config-loader.test.ts` | M3 tests |
| `tests/loop-state-controller.test.ts` | M5 tests |

---

## Task 1: C1 — Reject async/parallel gate configs at /harness-on startup

**Files:**
- Modify: `commands/harness-on.ts` (after `instructionValidation` block, before `createLoopStateController`)
- Modify: `tests/commands.test.ts` (add new describe block)

### Context

`GateInstruction.async` (`types.ts:169`) and `GateInstruction.parallel` (`types.ts:174`) enable subsystems never wired in `index.ts`. A gate with `async: true` will time-out-loop forever; a gate with `parallel[]` will hang the loop silently. Hard-reject these at startup with a clear message.

- [ ] **Step 1: Write failing tests**

In `tests/commands.test.ts`, add inside the outermost `describe`:

```typescript
describe("handleHarnessOn — async/parallel gate rejection", () => {
  it("rejects config with async:true gate", async () => {
    const root = makeProjectRoot();
    writeConfig(root, {
      gate_instructions: {
        "pre-work": { async: true },
        "in-progress": {},
      },
    });
    makeRunner(root);
    const toasts: Array<{ message: string; variant: string }> = [];
    const ctx: HarnessOnContext = {
      projectRoot: root,
      sessionId: "s1",
      getMessageCount: () => 0,
      injectMessage: vi.fn(),
      showToast: (message, variant) => { toasts.push({ message, variant }); },
    };
    await handleHarnessOn(ctx, []);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("error");
    expect(toasts[0]!.message).toContain("async");
    expect(toasts[0]!.message).toContain("pre-work");
  });

  it("rejects config with parallel[] gate", async () => {
    const root = makeProjectRoot();
    writeConfig(root, {
      gate_instructions: {
        "pre-work": {},
        "in-progress": { parallel: [{ id: "p1" }] },
      },
    });
    makeRunner(root);
    const toasts: Array<{ message: string; variant: string }> = [];
    const ctx: HarnessOnContext = {
      projectRoot: root,
      sessionId: "s1",
      getMessageCount: () => 0,
      injectMessage: vi.fn(),
      showToast: (message, variant) => { toasts.push({ message, variant }); },
    };
    await handleHarnessOn(ctx, []);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("error");
    expect(toasts[0]!.message).toContain("parallel");
    expect(toasts[0]!.message).toContain("in-progress");
  });

  it("allows normal gates with no async/parallel", async () => {
    const root = makeProjectRoot();
    writeConfig(root, {
      gate_instructions: {
        "pre-work": { skills: [] },
        "in-progress": { doc: "docs/x.md" },
      },
    });
    makeRunner(root);
    const toasts: Array<{ message: string; variant: string }> = [];
    const ctx: HarnessOnContext = {
      projectRoot: root,
      sessionId: "s1",
      getMessageCount: () => 0,
      injectMessage: vi.fn(),
      showToast: (message, variant) => { toasts.push({ message, variant }); },
    };
    await handleHarnessOn(ctx, []);
    expect(toasts.filter(t => t.variant === "error")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/commands.test.ts 2>&1 | grep -E "FAIL|PASS|Error" | tail -10
```

Expected: 2 failures (`rejects config with async:true gate`, `rejects config with parallel[] gate`)

- [ ] **Step 3: Implement — add guard in `commands/harness-on.ts`**

Find the block that ends with the `instructionValidation.warnings` toast (around line 133–138). Add immediately after it, before `const controller = createLoopStateController(...)`:

```typescript
  // Reject gates using async/parallel — subsystems not wired in production
  const unsupportedGates: string[] = [];
  for (const gate of config.gates) {
    const gi = config.gate_instructions[gate];
    if (gi?.async === true) unsupportedGates.push(`${gate}(async)`);
    else if (Array.isArray(gi?.parallel) && gi.parallel.length > 0) unsupportedGates.push(`${gate}(parallel)`);
  }
  if (unsupportedGates.length > 0) {
    ctx.showToast(
      `❌ Gates with async/parallel config are not supported: ${unsupportedGates.join(", ")}. Remove async/parallel from gate_instructions to use this gate.`,
      "error"
    );
    return;
  }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/commands.test.ts 2>&1 | grep -E "FAIL|PASS|✓|✗" | tail -10
```

Expected: all 3 new tests PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add commands/harness-on.ts tests/commands.test.ts
git commit -m "fix(C1): reject async/parallel gate configs at harness-on startup"
```

---

## Task 2: C2 — Fix ultrawork_verify_gates VERIFIED detection

**Files:**
- Modify: `harness-loop-event-handler.ts` (inside `processLoopIteration`, before runner invocation)
- Modify: `tests/event-handler.test.ts` (add new describe block)

### Context

When `verification_pending` is `true`, the loop re-injects a verification prompt but nothing ever reads "VERIFIED" from the assistant's response. On the next idle the runner re-runs, PASSes, and re-sets `verification_pending` → infinite loop.

Fix: at the top of `processLoopIteration`, if `verification_pending` is true, scan the latest assistant message in `ctx.getMessages()`. If "VERIFIED" found → clear pending and advance. If not → re-inject prompt and return (skip runner invocation).

- [ ] **Step 1: Write failing tests**

Add in `tests/event-handler.test.ts`:

```typescript
describe("handleSessionIdle — ultrawork VERIFIED detection", () => {
  it("advances gate when assistant says VERIFIED", async () => {
    const root = makeProjectRoot();
    writeFullConfig(root, {
      gates: ["lint", "test"],
      ultrawork_verify_gates: ["lint"],
    });
    makeRunner(root, { gate: "lint", status: "PASS", next_gate: "test" });

    const ctrl = createLoopStateController(root);
    ctrl.startLoop("session-1", loadConfig(root).config);
    // Manually set verification_pending = true and current_gate = "lint"
    ctrl.setVerificationPending(true);

    const messages = [
      { role: "assistant", content: "I have verified this thoroughly. VERIFIED" },
    ];
    const injected: string[] = [];
    const ctx = makeContext(root, "session-1", messages, injected);

    await handleSessionIdle(ctx);

    const state = ctrl.getState()!;
    expect(state.loop.verification_pending).toBe(false);
    expect(state.loop.current_gate).toBe("test");
    expect(injected).toHaveLength(0); // no re-injection — just advanced
  });

  it("re-injects verification prompt when VERIFIED not found", async () => {
    const root = makeProjectRoot();
    writeFullConfig(root, {
      gates: ["lint", "test"],
      ultrawork_verify_gates: ["lint"],
    });
    makeRunner(root, { gate: "lint", status: "PASS", next_gate: "test" });

    const ctrl = createLoopStateController(root);
    ctrl.startLoop("session-1", loadConfig(root).config);
    ctrl.setVerificationPending(true);

    const messages = [
      { role: "assistant", content: "I think I'm done but haven't said the magic word." },
    ];
    const injected: string[] = [];
    const ctx = makeContext(root, "session-1", messages, injected);

    await handleSessionIdle(ctx);

    const state = ctrl.getState()!;
    expect(state.loop.verification_pending).toBe(true); // still pending
    expect(state.loop.current_gate).toBe("lint");    // not advanced
    expect(injected.length).toBeGreaterThan(0);        // re-injected
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/event-handler.test.ts -t "ultrawork VERIFIED" 2>&1 | tail -15
```

Expected: both tests fail.

- [ ] **Step 3: Implement — add VERIFIED check in `processLoopIteration`**

In `harness-loop-event-handler.ts`, find `async function processLoopIteration(`. Add at the very top of the function body, before the runner invocation:

```typescript
  // If verification is pending, check for VERIFIED in latest assistant message
  if (state.loop.verification_pending) {
    const msgs = ctx.getMessages();
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (lastAssistant?.content.includes("VERIFIED")) {
      controller.setVerificationPending(false);
      const config = state.loop.config_snapshot;
      const currentGate = state.loop.current_gate;
      // Re-read fresh runner output to determine next gate
      const nextGate = getNextGate(config, currentGate, state.loop.last_runner_output!);
      if (nextGate) {
        controller.transitionToGate(nextGate);
        ctx.showToast(`✓ Gate "${currentGate}" VERIFIED → ${nextGate}`, "info");
      } else {
        controller.completeLoop();
        ctx.showToast(`🏁 All gates verified and complete`, "info");
      }
      return;
    }
    // Not verified yet — re-inject prompt and wait
    await ctx.injectMessage(buildUltraworkVerificationPrompt(currentGate));
    return;
  }
```

Note: `currentGate` must be read before this block. Find where `const currentGate = state.loop.current_gate;` is defined in the function and ensure it's before this block, or add `const currentGate = state.loop.current_gate;` before this block.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/event-handler.test.ts -t "ultrawork VERIFIED" 2>&1 | tail -10
```

- [ ] **Step 5: Run full test suite for regressions**

```bash
npx vitest run 2>&1 | grep -E "Tests|failed|passed" | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add harness-loop-event-handler.ts tests/event-handler.test.ts
git commit -m "fix(C2): add VERIFIED detection for ultrawork_verify_gates — stops infinite loop"
```

---

## Task 3: M3 — Fix override file deletion order in config-loader

**Files:**
- Modify: `config-loader.ts` (move `unlinkSync` after schema validation)
- Modify: `tests/config-loader.test.ts` (add regression test)

### Context

In `config-loader.ts:100`, `unlinkSync(overridePath)` runs immediately after merging the override file, before `HarnessConfigSchema.safeParse(merged)`. If startup then fails (e.g., runner not found, instruction validation fails), the override file is silently destroyed without ever being applied.

Fix: move the `unlinkSync` call to just after `safeParse` succeeds.

- [ ] **Step 1: Write failing test**

In `tests/config-loader.test.ts`, add:

```typescript
it("preserves override file when schema validation fails", () => {
  const root = makeProjectRoot();
  writeBaseConfig(root);
  // Write override with an invalid schema value that will fail parse
  const overridePath = join(root, ".opencode", "harness.override.json");
  writeFileSync(overridePath, JSON.stringify({ max_total_iterations: "not-a-number" }));

  expect(() => loadConfig(root)).toThrow();
  // Override file must still exist — it was not successfully applied
  expect(existsSync(overridePath)).toBe(true);
});

it("deletes override file when config loads successfully", () => {
  const root = makeProjectRoot();
  writeBaseConfig(root);
  const overridePath = join(root, ".opencode", "harness.override.json");
  writeFileSync(overridePath, JSON.stringify({ max_total_iterations: 50 }));

  const result = loadConfig(root);
  expect(result.overrideConsumed).toBe(true);
  expect(existsSync(overridePath)).toBe(false);
  expect(result.config.max_total_iterations).toBe(50);
});
```

- [ ] **Step 2: Run tests — expect first test FAIL**

```bash
npx vitest run tests/config-loader.test.ts 2>&1 | grep -E "FAIL|PASS|✓|✗" | tail -10
```

- [ ] **Step 3: Implement — move unlinkSync after safeParse**

In `config-loader.ts`, find the override block (around line 94–110). Change:

```typescript
  if (existsSync(overridePath)) {
    try {
      const overrideConfig = readJsonFile(overridePath);
      merged = mergeConfigs(merged, overrideConfig as Partial<HarnessConfig>);
      overrideConsumed = true;

      unlinkSync(overridePath);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new HarnessConfigError(
          `Invalid JSON in override file: ${overridePath}`,
          undefined
        );
      }
      throw error;
    }
  }

  merged = applyCliOverrides(merged, cliArgs);

  const parseResult = HarnessConfigSchema.safeParse(merged);
```

To:

```typescript
  let pendingOverrideDeletion = false;
  if (existsSync(overridePath)) {
    try {
      const overrideConfig = readJsonFile(overridePath);
      merged = mergeConfigs(merged, overrideConfig as Partial<HarnessConfig>);
      overrideConsumed = true;
      pendingOverrideDeletion = true;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new HarnessConfigError(
          `Invalid JSON in override file: ${overridePath}`,
          undefined
        );
      }
      throw error;
    }
  }

  merged = applyCliOverrides(merged, cliArgs);

  const parseResult = HarnessConfigSchema.safeParse(merged);
```

Then after the existing `if (!parseResult.success)` throw block, add:

```typescript
  if (pendingOverrideDeletion) {
    unlinkSync(overridePath);
  }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/config-loader.test.ts 2>&1 | grep -E "FAIL|PASS|✓|✗" | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add config-loader.ts tests/config-loader.test.ts
git commit -m "fix(M3): delete override file only after schema validation succeeds"
```

---

## Task 4: M5 — Fix pauseEpicForFailure state leak

**Files:**
- Modify: `loop-state-controller.ts` (route through clearLoopBlock)
- Modify: `tests/loop-state-controller.test.ts` (add test)

### Context

`pauseEpicForFailure` sets `state.loop.active = false` then calls `writeState` directly (line 397). This leaves `current_gate`, `session_id`, and `parallel_watchers` with stale values. A subsequent non-epic `/harness-on` proceeds (since `active=false`) but inherits the corrupted loop fields.

Fix: write the story progress update to disk first, then call `clearLoopBlock(statePath)` which properly zeroes `current_gate`, `session_id`, and `active`.

- [ ] **Step 1: Write failing test**

In `tests/loop-state-controller.test.ts`, add:

```typescript
describe("pauseEpicForFailure", () => {
  it("clears session_id and current_gate after pausing", () => {
    const root = makeProjectRoot();
    const ctrl = createLoopStateController(root);
    const config = makeConfig(root, { gates: ["lint", "test"] });

    // Start an epic loop
    ctrl.startLoop("session-abc", config, undefined, undefined, undefined, 0, {
      epic_id: "epic-1",
      stories: [
        { id: "story-1", story: "do thing", feature_id: "f1", issue_number: 1, depends_on: [] },
      ],
    });

    ctrl.pauseEpicForFailure("gate failed too many times");

    const state = ctrl.getState()!;
    expect(state.loop.active).toBe(false);
    expect(state.loop.session_id).toBe(""); // must be cleared
    expect(state.loop.current_gate).toBe(""); // must be cleared
    // Epic metadata preserved for --resume
    expect(state.loop.epic?.current_story_id).toBe("story-1");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/loop-state-controller.test.ts -t "pauseEpicForFailure" 2>&1 | tail -10
```

Expected: fails because `session_id` and `current_gate` are not cleared.

- [ ] **Step 3: Implement — route through clearLoopBlock**

In `loop-state-controller.ts`, find `function pauseEpicForFailure`:

```typescript
  function pauseEpicForFailure(_reason: string): void {
    const state = getState();
    if (!state?.loop.epic) return;
    const entry = state.loop.epic.story_progress.find(
      (e) => e.story_id === state.loop.epic!.current_story_id
    );
    if (entry) {
      entry.status = "failed";
      entry.gate_reached = state.loop.current_gate;
    }
    state.loop.active = false;
    writeState(statePath, state);
  }
```

Replace with:

```typescript
  function pauseEpicForFailure(_reason: string): void {
    const state = getState();
    if (!state?.loop.epic) return;
    const entry = state.loop.epic.story_progress.find(
      (e) => e.story_id === state.loop.epic!.current_story_id
    );
    if (entry) {
      entry.status = "failed";
      entry.gate_reached = state.loop.current_gate;
    }
    // Write story progress first, then clear loop state via clearLoopBlock
    writeState(statePath, state);
    clearLoopBlock(statePath);
  }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/loop-state-controller.test.ts -t "pauseEpicForFailure" 2>&1 | tail -10
```

- [ ] **Step 5: Run full epic test suite for regressions**

```bash
npx vitest run tests/epic-mode.test.ts tests/loop-state-controller.test.ts 2>&1 | grep -E "Tests|failed|passed" | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add loop-state-controller.ts tests/loop-state-controller.test.ts
git commit -m "fix(M5): route pauseEpicForFailure through clearLoopBlock to prevent state leak"
```

---

## Task 5: M2 — Surface zombie loop recovery hint

**Files:**
- Modify: `harness-loop-event-handler.ts` (add one-shot toast on session_id mismatch)
- Modify: `tests/event-handler.test.ts` (add test)

### Context

When state has `loop.active=true` but `session_id` doesn't match the current session (plugin reloaded, new conversation), `handleSessionIdle` silently returns. The user has no idea a zombie loop is active. Recovery requires knowing to run `/harness-on --resume`, which is undiscoverable.

Fix: on the first idle of each new session, if a zombie loop is detected, show a warning toast once (guarded by a module-level `Set<string>`).

- [ ] **Step 1: Write failing test**

In `tests/event-handler.test.ts`, add:

```typescript
describe("handleSessionIdle — zombie loop hint", () => {
  it("shows recovery toast once when session_id mismatches", async () => {
    const root = makeProjectRoot();
    writeFullConfig(root, { gates: ["lint"] });
    makeRunner(root, { gate: "lint", status: "PASS", next_gate: null });

    const ctrl = createLoopStateController(root);
    ctrl.startLoop("old-session", loadConfig(root).config);

    const toasts: Array<{ message: string; variant: string }> = [];
    const ctx = {
      projectRoot: root,
      sessionId: "new-session",
      getMessages: () => [],
      injectMessage: vi.fn(),
      showToast: (message: string, variant: "info" | "warning" | "error") => {
        toasts.push({ message, variant });
      },
      hasActiveBackgroundTasks: () => false,
      latestUserMessageTimestamp: () => 0,
    };

    await handleSessionIdle(ctx as unknown as PluginContext);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("warning");
    expect(toasts[0]!.message).toContain("--resume");

    // Second call — no duplicate toast
    toasts.length = 0;
    await handleSessionIdle(ctx as unknown as PluginContext);
    expect(toasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/event-handler.test.ts -t "zombie loop hint" 2>&1 | tail -10
```

- [ ] **Step 3: Implement — add zombieHintedSessions Set and toast**

In `harness-loop-event-handler.ts`, near the top where `inFlightSessions` and `runtimeRetried` are declared (around line 51–52), add:

```typescript
const zombieHintedSessions = new Set<string>();
```

Then find the `session_id` mismatch early-return (line 272–274):

```typescript
  if (state.loop.session_id !== ctx.sessionId) {
    return;
  }
```

Replace with:

```typescript
  if (state.loop.session_id !== ctx.sessionId) {
    if (!zombieHintedSessions.has(ctx.sessionId)) {
      zombieHintedSessions.add(ctx.sessionId);
      ctx.showToast(
        `⚠️ Harness loop active (session "${state.loop.session_id}" at gate "${state.loop.current_gate}"). Run /harness-on --resume to take over this session.`,
        "warning"
      );
    }
    return;
  }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/event-handler.test.ts -t "zombie loop hint" 2>&1 | tail -10
```

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run 2>&1 | grep -E "Tests|failed|passed" | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add harness-loop-event-handler.ts tests/event-handler.test.ts
git commit -m "fix(M2): show one-shot recovery toast when zombie loop detected on session start"
```

---

## Task 6: Gate checks and push

- [ ] **Step 1: Run pre-work gate**

```bash
bash scripts/harness-check.sh pre-work 2>&1 | python3 -m json.tool | grep -E '"status"|"name"'
```

Expected: all PASS (on feature branch, node_modules present).

- [ ] **Step 2: Run in-progress gate**

```bash
bash scripts/harness-check.sh in-progress 2>&1 | python3 -m json.tool | grep '"status"'
```

Expected: PASS (tsc clean).

- [ ] **Step 3: Run pre-merge gate**

```bash
bash scripts/harness-check.sh pre-merge 2>&1 | python3 -m json.tool | grep -E '"status"|"name"'
```

Expected: all 5 checks PASS including 3.5 (no unresolved PR comments — no open PR yet).

- [ ] **Step 4: Switch to kokorolx and push**

```bash
gh auth switch --user kokorolx
git push -u origin fix/issue-34-enforcement-gaps
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "fix: enforcement gaps C1/C2/M2/M3/M5 from issue #34" --body "$(cat <<'EOF'
## Summary
- **C1**: Hard-reject `async`/`parallel` gate configs at `/harness-on` startup (were silently hanging/looping forever)
- **C2**: Add VERIFIED detection for `ultrawork_verify_gates` — stops infinite re-inject loop
- **M3**: Move override file deletion to after schema validation — file no longer destroyed on failed startup
- **M5**: Route `pauseEpicForFailure` through `clearLoopBlock` — clears `session_id`/`current_gate` properly
- **M2**: Show one-shot recovery toast when zombie loop detected on session start

## Test plan
- [ ] All new tests pass: `npx vitest run`
- [ ] `bash scripts/harness-check.sh pre-merge` shows all 5 checks PASS
- [ ] No regressions in existing tests

Closes #34 (partial — C3, M1, M4, M6, L1–L5 tracked for Phase 2)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Run post-merge gate** (after PR is merged)

```bash
bash scripts/harness-check.sh post-merge 2>&1 | python3 -m json.tool | grep -E '"status"|"name"'
```

Expected: 4.1 PASS (clean tree), 4.2 PASS (kokorolx account).

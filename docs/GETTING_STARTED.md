# Getting Started

A complete walkthrough from a fresh project (no harness setup yet) to a working `/harness-on` loop. Takes ~10 minutes.

If you prefer letting an AI agent do this for you, just ask: **"setup harness-on"**. The agent will read `node_modules/@nano-step/oh-my-harness/docs/SETUP_INSTRUCTIONS_FOR_AGENT.md` and walk through the steps below. Skip to "Customize for your project" once it's done.

---

## What you're setting up

A 5-gate loop that drives one feature/story end-to-end:

```
pre-work → in-progress → pre-merge → post-merge → next-ready
```

Each gate is a check (your script decides PASS/FAIL/etc.). When all five pass, the loop ends.

---

## Prerequisites

- OpenCode CLI installed and authenticated for the project's repo
- Node.js 18+ (the plugin runs on the OpenCode Bun/Node runtime)
- A git repository (any language — the runner script is yours to define)
- (Optional) `gh` CLI authenticated, if you want PR creation/merge automation
- (Optional) `jq` for inspecting JSON config

---

## Step 1 — Install the plugin

```bash
cd /path/to/your/project
npm install @nano-step/oh-my-harness@latest
```

This installs the plugin **and** runs a postinstall script that creates `.opencode/commands/harness-on.md` and `.opencode/commands/harness-off.md` shims so the slash commands appear in OpenCode's autocomplete.

Verify:

```bash
ls .opencode/commands/ | grep harness
# Expected:
#   harness-off.md
#   harness-on.md
```

If the shims are missing, the postinstall failed silently. Re-run `npm install @nano-step/oh-my-harness@latest`, or create the files manually (see [README §Slash Commands](../README.md#slash-commands-auto-installed)).

---

## Step 2 — Register the plugin in `opencode.json`

If your project already has `.opencode/opencode.json`:

```jsonc
{
  "plugin": ["@nano-step/oh-my-harness@latest"]
}
```

If you don't have an `opencode.json`, create one:

```bash
mkdir -p .opencode
cat > .opencode/opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@nano-step/oh-my-harness@latest"]
}
EOF
```

**Restart OpenCode** so the plugin loads.

---

## Step 3 — Copy the templates

The package ships starter templates at `node_modules/@nano-step/oh-my-harness/templates/init/`. Copy them into your project:

```bash
# Config
cp node_modules/@nano-step/oh-my-harness/templates/init/.opencode/harness.config.json .opencode/

# Runner stub
mkdir -p scripts
cp node_modules/@nano-step/oh-my-harness/templates/init/scripts/harness-check.sh scripts/
chmod +x scripts/harness-check.sh

# Gate docs (one per gate)
mkdir -p docs/harness/gates
cp node_modules/@nano-step/oh-my-harness/templates/init/docs/harness/gates/*.md docs/harness/gates/

# .gitignore additions (template is named .template because npm strips dotfiles from packages)
cat node_modules/@nano-step/oh-my-harness/templates/init/gitignore.template >> .gitignore
```

---

## Step 4 — Sanity check

Run the stub runner manually:

```bash
./scripts/harness-check.sh pre-work --json
```

Expected output (formatted):

```json
{
  "gate": "pre-work",
  "status": "PASS",
  "checks": [],
  "rule_ids_violated": [],
  "instructions_for_agent": "",
  "next_gate": "in-progress"
}
```

Every gate in the stub returns PASS. That's the **starting point** — you'll add real checks in Step 6.

---

## Step 5 — First `/harness-on`

In OpenCode, type:

```
/harness-on
```

You should see toasts as the loop walks through all 5 gates:

```
🟢 Gate "pre-work" PASS → in-progress
🟢 Gate "in-progress" PASS → pre-merge
🟢 Gate "pre-merge" PASS → post-merge
🟢 Gate "post-merge" PASS → next-ready
🎉 Harness loop complete!
```

Because the stub passes everything, the loop completes in seconds. This proves the plumbing works.

If it doesn't reach `next-ready`:
- Check that `scripts/harness-check.sh` is executable (`chmod +x`).
- Confirm `runner_path` in `harness.config.json` matches the script's location.
- Look at OpenCode's session log for the actual error.

---

## Step 6 — Customize for your project

The stub passes everything because it has no real checks. Now fill in what each gate should validate.

### `scripts/harness-check.sh`

Open the file. Each gate is a bash function (`gate_pre_work`, `gate_in_progress`, etc.) that calls `emit`:

```bash
emit STATUS NEXT_GATE INSTRUCTIONS CHECKS_JSON RULE_IDS_JSON
```

Where:
- `STATUS` — `PASS`, `FAIL`, `SKIP`, `WAITING`, `BLOCKED`, or `ERROR`
- `NEXT_GATE` — `"<gate-name>"` (with quotes) or `null`
- `INSTRUCTIONS` — what the agent should do on FAIL (string)
- `CHECKS_JSON` — array of check results
- `RULE_IDS_JSON` — array of violated rule IDs

**Most projects only need to customize `gate_pre_merge`** (the validation ladder). A typical TypeScript implementation:

```bash
gate_pre_merge() {
  local checks="["
  local rules="["
  local fail=false

  # Check 1: tsc --noEmit
  if ! npx tsc --noEmit > /tmp/tsc.log 2>&1; then
    checks+='{"id":"3.1","name":"tsc --noEmit","status":"FAIL"},'
    rules+='"R3.1",'
    fail=true
  else
    checks+='{"id":"3.1","name":"tsc --noEmit","status":"PASS"},'
  fi

  # Check 2: vitest
  if ! npx vitest run > /tmp/vitest.log 2>&1; then
    checks+='{"id":"3.2","name":"vitest run","status":"FAIL"},'
    rules+='"R3.2",'
    fail=true
  else
    checks+='{"id":"3.2","name":"vitest run","status":"PASS"},'
  fi

  checks="${checks%,}]"
  rules="${rules%,}]"

  if $fail; then
    emit FAIL '"pre-merge"' "Fix the failing checks." "$checks" "$rules"
  else
    emit PASS '"post-merge"' "" "$checks" "$rules"
  fi
}
```

### `docs/harness/gates/*.md`

Each gate doc tells the **agent** what the gate is supposed to verify. The agent reads this when working on that gate. Fill in:
- **Hard Rules** — invariants that must hold
- **Step-by-Step Procedure** — what the agent should do
- **Evidence Requirements** — what proves PASS
- **FAIL Conditions** — what triggers FAIL, with rule IDs matching what the runner emits

---

## Step 7 — Try a real loop

With real checks in place, kick off a feature:

1. Create a feature branch: `git checkout -b feat/my-first-feature`
2. Make changes, but introduce a deliberate type error
3. `/harness-on`
4. Watch the loop: `pre-work` passes (you're on a feature branch), `in-progress` FAILs (tsc finds the type error), the agent is asked to fix it, loop continues.
5. After fix: ladder passes, `pre-merge` PASS, etc.

---

## Optional — Epic mode

For multi-story workflows, see [README §Epic Mode](../README.md#epic-mode-v306) for details. Quick add to `.opencode/harness.config.json`:

```jsonc
{
  // ... existing fields ...
  "epic": {
    "backlog_source": "file",
    "backlog_file": ".opencode/harness.epic.json",
    "failure_policy": "ask",
    "max_iterations_per_epic": 500
  }
}
```

Then `/harness-on --epic` drives a full backlog of stories autonomously.

---

## Common issues

### `/harness-on` not in autocomplete
- Postinstall didn't create shims. Re-install or create manually.
- OpenCode wasn't restarted after install — restart it.
- Wrong dir: must be `.opencode/commands/` (plural), not `command/` (singular). Plugin v305+ uses plural.

### Loop starts then immediately stops
- Probably hit `next-ready` PASS on first iteration. With the stub, that's expected — every gate is no-op PASS.
- Check toast for "🎉 Harness loop complete!". That means it worked.

### "Loop already active in session X at gate Y"
- The state file from a previous session is still active. You have three options:
  - **Resume**: `/harness-on --resume` — rebinds the existing loop into the current session, re-runs the current gate from iteration 0
  - **Restart**: `/harness-on --restart` — wipes the state and starts fresh from the first gate
  - **Manual wipe**: `/harness-off --clean` then `/harness-on`

### Runner crashes / "ERROR" status
- `./scripts/harness-check.sh pre-work --json` should output valid JSON on stdout.
- If your runner uses `set -e`, a failed sub-command will kill it before emit. The template uses `set -uo pipefail` (no `-e`) deliberately.
- Check `.opencode/harness-loop.local.json` for the captured error.

### Want to see what the agent sees
- Edit `docs/harness/gates/<gate>.md` to add explicit instructions.
- The plugin prepends these to the agent's prompt when working on that gate.

---

## What's next

- [README](../README.md) — full reference
- [HARNESS.md](./HARNESS.md) — lanes, validation ladder, auto-merge policy
- [FEATURE_INTAKE.md](./FEATURE_INTAKE.md) — risk classification when adding new features

Once you have a working stub runner: replace its stub gates with real checks for **your** stack. The plugin doesn't care if you run `cargo test`, `pytest`, `go test`, `mix test`, etc. — it only cares about the runner's JSON output contract (see [README §Runner Contract](../README.md#runner-contract)).

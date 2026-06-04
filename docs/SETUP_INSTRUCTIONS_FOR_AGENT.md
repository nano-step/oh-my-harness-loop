# Setup Instructions (for AI Agents)

**Read this when the user asks you to "setup harness", "setup harness-on", "install harness loop", or similar.**

This document tells you exactly which files to create in the user's project so that `/harness-on` works.

## Pre-flight checks (run all)

1. Install the npm package (if not already present):
   - Check if `node_modules/@nano-step/oh-my-harness/` exists.
   - If not, run `npm install @nano-step/oh-my-harness@latest`.
   - The postinstall script auto-creates `.opencode/commands/harness-*.md` shims.
2. Register the plugin in OpenCode config:
   - Read `.opencode/opencode.json` (or `opencode.json` at project root).
   - If the file does not exist, create `.opencode/opencode.json` with:
     ```json
     {
       "plugin": ["@nano-step/oh-my-harness@latest"]
     }
     ```
   - If the file exists but has no `plugin` array, add one: `"plugin": ["@nano-step/oh-my-harness@latest"]`.
   - If `plugin` array exists but does not contain `@nano-step/oh-my-harness@latest`, append it.
   - If it already contains the entry, skip.
   - **Do not remove or modify other fields in the file.**
3. Confirm `.opencode/commands/harness-on.md` and `.opencode/commands/harness-off.md` exist (these are auto-created by the package's postinstall — if missing, suggest reinstalling).
4. Check whether the project already has any of these (ask before overwriting):
   - `.opencode/harness.config.json`
   - `scripts/harness-check.sh`
   - `docs/harness/gates/*.md`
   - `.gitignore` (you only need to *append*, never overwrite)

## Files to create

The template lives at `node_modules/@nano-step/oh-my-harness/templates/init/`. Copy from there into the project root.

### 1. `.opencode/harness.config.json`
Source: `node_modules/@nano-step/oh-my-harness/templates/init/.opencode/harness.config.json`
- Standard 5 gates: `pre-work`, `in-progress`, `pre-merge`, `post-merge`, `next-ready`.
- `fail_policy: "hybrid"`, `runner_path: "./scripts/harness-check.sh"`.
- `state_file_path: ".opencode/harness-loop.local.json"`.
- Adjust paths if the project's runner lives elsewhere — ASK the user first.

### 2. `scripts/harness-check.sh`
Source: `node_modules/@nano-step/oh-my-harness/templates/init/scripts/harness-check.sh`
- Generic stub: every gate returns PASS with `"checks":[]`.
- `chmod +x scripts/harness-check.sh` after copying.
- Tell the user: "This is a placeholder runner. Each gate function is a stub — fill in real checks (tsc, vitest, lint, etc.) according to your project's needs. See `docs/harness/gates/*.md` for what each gate should validate."

### 3. `docs/harness/gates/{pre-work,in-progress,pre-merge,post-merge,next-ready}.md`
Source: `node_modules/@nano-step/oh-my-harness/templates/init/docs/harness/gates/`
- 5 markdown files, one per gate.
- Each has placeholders the user must fill in (Hard Rules, Procedure, Evidence, FAIL Conditions).
- These are *referenced* by `gate_instructions` in `harness.config.json` so the agent sees them when working on each gate.

### 4. `.gitignore` additions
Source: `node_modules/@nano-step/oh-my-harness/templates/init/gitignore.template`
- **Append** these lines to the existing `.gitignore` (do not overwrite). (npm strips dotfiles from packages, so the template is shipped as `gitignore.template`.)
  ```
  .opencode/harness-loop.local.json
  .opencode/harness-loop.local.json.tmp
  .opencode/harness-loop.local-override.json
  ```
- These are runtime state files that should never be committed.

## Verification (run after setup)

1. `cat .opencode/harness.config.json | jq '.gates'` → shows the 5 gates.
2. `./scripts/harness-check.sh pre-work --json` → outputs valid JSON with `"status":"PASS"`.
3. `ls docs/harness/gates/` → shows 5 markdown files.
4. `grep harness-loop.local.json .gitignore` → matches.

If all 4 verifications pass, tell the user:
> Setup complete. Run `/harness-on` to start the loop. The current runner is a no-op stub that passes every gate — edit `scripts/harness-check.sh` to add real checks (typescript, tests, lint, etc.) for your project.

## When to escalate to the user (do NOT silently overwrite)

- Any file in the "Files to create" list already exists with different content → ASK before replacing.
- `harness-loop.local.json` already exists at a non-default path → ASK about `state_file_path`.
- Project uses a non-bash runner (Python, Node, etc.) → ASK if user wants you to port the stub to that language.
- Project has unusual git structure (worktrees, submodules) → ASK before assuming default-branch name.

## After setup, suggest next steps

Tell the user (in order of priority):
1. **Edit `scripts/harness-check.sh`** to add real checks for each gate. Most projects only need to fill in `gate_pre_merge` (the validation ladder).
2. **Edit gate docs** at `docs/harness/gates/*.md` — they're the agent's instructions for each gate.
3. **Optional**: enable epic mode in `harness.config.json` if running multi-story workflows. See `node_modules/@nano-step/oh-my-harness/README.md#epic-mode`.
4. Run `/harness-on` and check that the loop drives end-to-end through all 5 gates (since the stub returns PASS everywhere, this should reach `next-ready` and emit `HARNESS-COMPLETE` immediately).

## Reference

Full user-facing walkthrough: `node_modules/@nano-step/oh-my-harness/docs/GETTING_STARTED.md`

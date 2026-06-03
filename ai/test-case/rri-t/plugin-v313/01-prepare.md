# Phase 1: PREPARE — oh-my-harness-loop v2026.6.0313

## Feature scope
OpenCode plugin that drives gate-based PR loop for autonomous coding workflows.

## Version under test
**v2026.6.0313** — current master. 12 incremental releases shipped in session.

## Source-of-truth specs read
- `README.md` (453 lines) — public API surface
- `docs/HARNESS.md` (189 lines) — lane policy, auto-merge policy, forbidden practices
- `docs/GETTING_STARTED.md` (286 lines) — fresh adopter walkthrough
- `docs/SETUP_INSTRUCTIONS_FOR_AGENT.md` — agent-readable setup
- `openspec/specs/harness-loop-state/spec.md` (197 lines) — state file contract
- `openspec/specs/harness-loop-config/spec.md` (242 lines) — config schema
- `openspec/specs/harness-loop-plugin/spec.md` (279 lines) — CLI + event handler
- `openspec/specs/harness-gate-instructions/spec.md` (145 lines) — gate doc resolution
- `openspec/specs/harness-runner-contract/spec.md` (141 lines) — runner JSON contract
- `openspec/specs/harness-smoke-ui-gate/spec.md` (70 lines) — UI gate

## Feature inventory under test
1. `/harness-on` and `/harness-off` slash commands
2. `--resume` / `--restart` / `--clean` flags
3. 5-gate cycle (pre-work → in-progress → pre-merge → post-merge → next-ready)
4. Parallel gate execution (multiple watchers per gate)
5. Epic mode (`--epic [path]` with backlog file, topo sort, story queue)
6. Async watcher gates with heartbeat + grace timeout
7. Cache freshness (TTL + last_runner_output reuse)
8. Override token (`[HARNESS-OVERRIDE]: <reason>`)
9. Promise tag completion with structural guard (v309 + v313 reinforcement)
10. State file: atomic write, UUID temp suffix, schema validation, migration safety
11. OH-MY-OPENCODE-style continuation prompts (v313)
12. Auto-merge policy (6 preconditions in `docs/HARNESS.md`)
13. Postinstall script: shim creation, legacy migration, opt-out
14. Init templates: bundled in `templates/init/`
15. Failure-policy modes: `ask`, `hybrid`, `auto` (epic uses `ask` only in Phase 1)
16. Safety brakes: `max_total_iterations`, `max_iterations_per_gate`, `max_iterations_per_epic`, no-progress (3 consecutive empty turns), same-error (3 consecutive same rule_ids)

## Output directory
`ai/test-case/rri-t/plugin-v313/`

## Test environment
- Existing 188 unit tests in `tests/` (vitest)
- Plugin's own runner at `scripts/harness-check.sh` (dogfooding)
- Plugin's harness config at `.opencode/harness.config.json`

## Pre-test snapshot
```
$ git rev-parse HEAD       # master @ v313 squash
$ npx vitest run           # 188/188 pass
$ ./scripts/harness-check.sh pre-merge --json   # PASS (4/4)
```

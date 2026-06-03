# oh-my-harness-loop — Agent Context

**Stack:** TypeScript 5.5, Vitest 2, Zod 3, `@opencode-ai/plugin` (peerDep)  
**Runtime:** OpenCode's Bun/Node environment (plugin loaded by OpenCode, NOT by nano-brain Go binary)  
**Published:** `oh-my-harness-loop` on npm · source at `nano-step/oh-my-harness-loop`

---

## Architecture

```
index.ts                     Plugin entry — registers session.idle + command.execute.before
harness-loop-event-handler   Main loop logic — gate iteration, async watcher, merge
loop-state-controller        State machine (start/cancel/transition/complete)
runner-invoker               Spawn runner subprocess, validate RunnerOutputSchema contract
async-watcher-spawner        Spawn background subagent watcher for async gates
storage                      Read/write .opencode/harness-loop.local.json
config-loader                Load + validate harness.config.json (HarnessConfigSchema)
types                        All Zod schemas + TypeScript types (source of truth)
commands/                    /harness-on, /harness-off handlers
templates/                   Prompt templates (opening, continuation, ultrawork)
```

## Key Invariants

- Gates run sequentially. Parallel execution is opt-in via `gate_instructions[gate].parallel[]`
- Runner contract is strict: `RunnerOutputSchema` (Zod `.strict()`) — unknown fields → error
- State file: `.opencode/harness-loop.local.json` — always read via `readState()`, never raw JSON.parse
- `@opencode-ai/plugin` peer dep — never import internal OpenCode APIs directly

## Conventions

- No `as any`, `@ts-ignore`, `@ts-expect-error` — fix the type
- All I/O functions take `ctx: PluginContext` or equivalent — no global state
- Errors: `fmt.Errorf`-style message chains (`"context: ${cause.message}"`)
- Tests: Vitest, table-driven with `it.each`, inline mocks (no vitest.mock factories)

## Validation

```bash
tsc --noEmit && npx vitest run
```

## Harness

See `docs/HARNESS.md` for lane classification, validation ladder, and release flow.  
See `docs/FEATURE_INTAKE.md` to classify a new request before touching code.

## OpenSpec

Changes that touch exported types or state shape → OpenSpec proposal first.  
Config: `openspec/config.yaml`

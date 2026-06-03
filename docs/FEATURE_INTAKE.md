# Feature Intake — oh-my-harness

Use this checklist when a new issue/request arrives. Count the flags to determine lane.

## Risk Flags

Score 1 point per flag that applies:

### API & Contract
- [ ] Changes `RunnerOutputSchema` or `HarnessConfigSchema` (exported Zod schemas)
- [ ] Changes exported TypeScript types consumers depend on
- [ ] Changes `package.json` `exports`, `main`, `types`, or `files`
- [ ] Changes `@opencode-ai/plugin` hook signatures or event names
- [ ] Removes or renames a public symbol

### State & Persistence
- [ ] Changes `LoopMeta` shape (requires state migration)
- [ ] Changes `HarnessLoopState` file format
- [ ] Changes default `state_file_path`

### Behavior
- [ ] Changes gate loop ordering or gate advancement logic
- [ ] Changes runner invocation contract (`--json` flag, exit codes)
- [ ] Adds or removes a command (`/harness-on`, `/harness-off`)
- [ ] Changes session.idle trigger or idle detection thresholds

### Infrastructure
- [ ] Adds a new runtime dependency
- [ ] Changes TypeScript target or module format
- [ ] Changes CI/CD pipeline (auto-tag, release, npm publish)

---

## Lane Decision

| Score | Lane | Required flow |
|-------|------|--------------|
| 0–1 | **tiny** | Direct patch → validate → PR |
| 2–3 | **normal** | `/opsx-propose` → implement → validate → PR |
| 4+ OR any hard gate | **high-risk** | deep-design → OpenSpec → implement → review gate → PR |

### Hard gates (auto → high-risk, score doesn't matter)

- Touches `RunnerOutputSchema` or `HarnessConfigSchema` → `public-api-contract`
- Touches plugin hook API (`@opencode-ai/plugin`) → `plugin-api-compat`  
- Touches npm package manifest exports → `npm-publish-contract`

---

## Labels to Apply on GitHub Issue

```
lane:tiny | lane:normal | lane:high-risk
change-type:user-feature | change-type:bug-fix | change-type:refactor
change-type:infrastructure | change-type:docs | change-type:dependency-bump
status:intake | status:in-progress | status:blocked | status:done
```

---

## Example: Parallel Gate Execution

| Flag | Applies? |
|------|---------|
| Changes `GateInstructionSchema` | ✅ +1 |
| Changes `LoopMeta` shape (parallel_watchers) | ✅ +1 |
| Adds exported `ParallelTaskSchema` type | ✅ +1 (public-api-contract) |
| Changes gate advancement logic | ✅ +1 |

**Score: 4 → high-risk lane** · hard gate: `public-api-contract`

# Engineering Harness — oh-my-harness-loop

**Stack:** TypeScript, Vitest, OpenCode Plugin API (`@opencode-ai/plugin`)  
**Published:** npm `oh-my-harness-loop` · GitHub `nano-step/oh-my-harness-loop`

---

## Lanes

| Lane | Risk flags | Flow |
|------|-----------|------|
| **tiny** | 0–1 | Direct patch → validate → PR |
| **normal** | 2–3 | OpenSpec proposal → implement → validate → PR |
| **high-risk** | 4+ OR hard gate | deep-design → OpenSpec → implement → review gate → PR |

### Hard gates (auto → high-risk lane)

- `public-api-contract` — changes to exported types, `RunnerOutputSchema`, `HarnessConfigSchema`
- `plugin-api-compat` — changes to `@opencode-ai/plugin` event hooks or command signatures
- `npm-publish-contract` — changes to `package.json` `exports`, `main`, `types`, `files`

---

## Validation Ladder

| Layer | Command | Required for |
|-------|---------|-------------|
| `validate:quick` | `tsc --noEmit && npx vitest run` | every lane |
| `self-review:staged-files` | `git status` — no unintended files | every lane |
| `self-review:types` | No `as any`, `@ts-ignore`, `@ts-expect-error` | every lane |
| `test:integration` | `npx vitest run --reporter=verbose` | normal + high-risk |
| `smoke:publish` | `npm pack --dry-run` — no missing files | normal + high-risk |
| `test:release` | `node dist/index.js` (or import check) | before publish |

### Change types vs gates

| Type | smoke:publish | Review gate |
|------|:---:|:---:|
| user-feature | ✅ | ✅ |
| bug-fix | ✅ | ✅ |
| refactor | ❌ | ⚠️ self-verify |
| infrastructure | ❌ | ⚠️ self-verify |
| docs | ❌ | ❌ |
| dependency-bump | ❌ | ⚠️ self-verify |

---

## Flow

```
① Create GitHub issue (before any code)
② Classify lane + change type → label issue
③ tiny → patch direct
   normal/high-risk → /opsx-propose → OpenSpec change
④ [high-risk] deep-design gap analysis (Metis + Oracle) → revise until clean
⑤ Implement → run validation ladder
⑥ [user-feature / bug-fix] npm pack --dry-run check
⑦ Review gate → PR → merge → auto-tag → npm publish
⑧ openspec archive
```

### Gate lifecycle

```
① PRE-WORK → ② IN-PROGRESS → ③ PRE-MERGE → ④ POST-MERGE → ⑤ NEXT-READY
```

All gates must PASS before proceeding.

---

## Release Pipeline

| Trigger | Workflow | Effect |
|---------|----------|--------|
| `master` push | `auto-tag.yml` | Compute tag `v{YYYY}.{M}.{DDNN}` → push |
| `v*` tag | `release.yml` | Build dist → GitHub Release → `npm publish` |

**Skip release:** add `[skip-release]` to commit subject.

---

## Forbidden Practices

- No `as any`, `@ts-ignore` — type errors must be fixed
- No committing directly to `master` — always branch + PR
- No claiming "tests pass" without output
- No publishing without `npm pack --dry-run` passing
- No archiving OpenSpec change without review verdict PASS
- No breaking `RunnerOutputSchema` or `HarnessConfigSchema` without a `public-api-contract` issue

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/FEATURE_INTAKE.md` | Risk classification checklist |
| `docs/templates/story.md` | Story template |
| `docs/HARNESS_BACKLOG.md` | Friction backlog |
| `docs/evidence/` | Test output, screenshots, decision logs |
| `openspec/` | Change proposals and specs |

# QA Agent Design Guide

> Adapted from revfactory/harness (Apache-2.0). Upstream version: v1.2.0.

A guide for when a build harness includes a QA agent. Based on real-world bug patterns and root-cause analysis from a production project (SatangSlide), this guide provides a verification methodology that systematically catches defects QA typically misses.

---

## Table of Contents

1. Defect patterns QA agents miss
2. Integration Coherence Verification
3. QA agent design principles
4. Validation checklist template
5. QA agent definition template
6. Real-world case study (SatangSlide)

---

## 1. Defect patterns QA agents miss

### 1-1. Boundary Mismatch

The most frequent defect. Two components are each "correctly" implemented, but their contracts disagree at the connection point.


| Boundary | Mismatch example | Why it's missed |
|----------|------------------|-----------------|
| API response → frontend hook | API returns `{ projects: [...] }`, hook expects `SlideProject[]` | Each passes individually; no cross-comparison |
| API response field name → type def | API: `thumbnailUrl` (camelCase), type: `thumbnail_url` (snake_case) | TypeScript generics mask it at compile time |
| File path → link href | Page at `/dashboard/create`, link points to `/create` | File structure vs href not cross-checked |
| State transition map → actual status update | Map defines `generating_template → template_approved`, code missing the transition | Only map existence checked, not every update code path |
| API endpoint → frontend hook | API exists but no corresponding hook (never called) | API list vs hook list not mapped 1:1 |
| Immediate response → async result | API returns `{ status }` immediately, frontend accesses `data.failedIndices` | Sync/async distinction not checked, only types |


### 1-2. Why static code review misses it

- **TypeScript generics limit**: `fetchJson<SlideProject[]>()` — runtime response `{ projects: [...] }` passes compile.
  EN: TypeScript generic limitation: `fetchJson<SlideProject[]>()` — runtime response `{ projects: [...] }` passes compile even though the type is wrong.
- **`npm run build` passing ≠ working**: type casts, `any`, generics allow build success with runtime failure.
  EN: `npm run build` passing ≠ working correctly: type casting, `any`, generics — build succeeds but runtime fails.
- **Existence vs connection check**: "Does the API exist?" is fundamentally different from "Does the API response match caller expectations?".
  EN: "Existence vs connection verification": "Does the API exist?" vs "Does the API's response match the caller's expectations?" are completely different checks.

---

## 2. Integration Coherence Verification

A cross-comparison verification area that MUST be included in QA agents.


### 2-1. API response ↔ frontend hook type cross-verification

**Method**: Compare each API route's `NextResponse.json()` call site with the corresponding hook's `fetchJson<T>` type parameter.

```
Verification steps:
1. Extract object shape passed to NextResponse.json() in API route
2. Check T type in fetchJson<T> in corresponding hook
3. Compare shape vs T
4. Check wrapping (if API returns { data: [...] }, does hook unwrap with .data?)
```


**Patterns requiring extra attention:**
- Pagination API: `{ items: [], total, page }` vs frontend expecting array
- snake_case DB fields → camelCase API response → frontend type defs
- Immediate response (202 Accepted) vs final result shape


### 2-2. File path ↔ link/router path mapping

**Method**: Extract URL paths from page files under `src/app/`, compare with all `href`, `router.push()`, `redirect()` values in code.

```
Verification steps:
1. Extract URL pattern from page.tsx files under src/app/
   - (group) → removed from URL
   - [param] → dynamic segment
2. Collect all href=, router.push(, redirect( values in code
3. Verify each link matches an existing page path
4. Account for route group URL prefixes (e.g., dashboard/ subdirs)
```


### 2-3. State transition completeness

**Method**: Extract all `status:` updates in code, cross-check with state transition map.

```
Verification steps:
1. Extract allowed transitions from STATE_TRANSITIONS map
2. Search all API routes for .update({ status: "..." }) patterns
3. Verify each transition is defined in the map
4. Identify transitions defined in map but never executed (dead transitions)
5. Specifically: check that intermediate states (e.g., generating_template)
   transition to final states (template_approved)
```


### 2-4. API endpoint ↔ frontend hook 1:1 mapping

**Method**: List all API routes and frontend hooks, verify pairs match.

```
Verification steps:
1. Extract endpoint list by HTTP method from src/app/api/ route.ts files
2. Extract fetch call URL list from use*.ts files under src/hooks/
3. Identify API endpoints not called by any hook → "unused" flag
4. Determine if "unused" is intentional (admin API) or missing call
```


---

## 3. QA agent design principles

### 3-1. Use `general` subagent type, not `explore`

If the QA agent is `explore`, it can only read. Effective QA needs:
- Grep pattern search (extract all `NextResponse.json()`)
- Script execution for automated comparison (API shape vs hook types)
- Modifications when needed

**Recommendation**: Set to `general` subagent type, but explicitly state "verify → report → request fix" protocol in the agent definition.


### 3-2. Prefer "cross-comparison" over "existence check" in checklists

| Weak checklist | Strong checklist |
|----------------|------------------|
| Does the API endpoint exist? | Do the API endpoint's response shape and the hook's type match? |
| Is the state transition map defined? | Do all status-update code paths match map transitions? |
| Does the page file exist? | Do all in-code links point to pages that exist? |
| Is TypeScript strict mode on? | Are there generic casts that bypass type safety? |


### 3-3. "Read both sides simultaneously" principle

To catch boundary bugs, QA must read both sides:
- API route **and** corresponding hook **together**
- State transition map **and** actual update code **together**
- File structure **and** link paths **together**

State this principle explicitly in the agent definition.


### 3-4. Run QA after each module, not after the full build

Placing QA only at "Phase 4: after full completion" in the orchestrator means:
- Bugs accumulate, fix cost rises
- Initial boundary mismatches propagate to subsequent modules

**Recommended pattern**: Each backend API completion triggers immediate cross-verification with corresponding hook (incremental QA).


---

## 4. Validation checklist template

A web-app integration coherence checklist to include in QA agent definitions.


```markdown
### Integration Coherence Verification (web app)

#### API ↔ Frontend connection
- [ ] All API route response shapes match the corresponding hook's generic type
- [ ] Wrapped responses ({ items: [...] }) are unwrapped by the hook
- [ ] snake_case ↔ camelCase conversion is applied consistently
- [ ] Immediate response (202) vs final result shape are distinguished in frontend
- [ ] All API endpoints have corresponding frontend hooks that are actually called

#### Routing coherence
- [ ] All in-code href/router.push values match actual page file paths
- [ ] Route group ((group)) URL prefix is accounted for
- [ ] Dynamic segments ([id]) are filled with correct parameters

#### State machine coherence
- [ ] All defined state transitions are executed in code (no dead transitions)
- [ ] All code's status updates are defined in the transition map (no ad-hoc transitions)
- [ ] Intermediate → final state transitions are not missing
- [ ] Status-based branches in frontend (if status === "X") are actually reachable

#### Data flow coherence
- [ ] DB schema field names ↔ API response field names are mapped consistently
- [ ] Frontend type defs ↔ API response field names match
- [ ] Optional field null/undefined handling is consistent on both sides
```

---

## 5. QA agent definition template

Core sections to include in a build-harness QA agent.


```markdown
---
name: qa-inspector
description: "QA verification specialist. Validates spec compliance, integration coherence, design quality."
---

# QA Inspector

## Core role
Validate implementation quality vs spec AND **inter-module integration coherence**.


## Verification priority

1. **Integration coherence** (highest) — boundary mismatches are the main cause of runtime errors
2. **Functional spec compliance** — API / state machine / data model
3. **Design quality** — color / typography / responsive
4. **Code quality** — unused code, naming conventions

## Verification method: "Read both sides simultaneously"

Boundary verification MUST open **both sides' code at once** for comparison:

| Verification target | Left (producer) | Right (consumer) |
|---------------------|-----------------|------------------|
| API response shape | route.ts's NextResponse.json() | hooks/'s fetchJson<T> |
| Routing | src/app/ page file paths | href, router.push values |
| State transition | STATE_TRANSITIONS map | .update({ status }) code |
| DB → API → UI | Table column names | API response fields → type defs |

## Inter-agent protocol

- On finding, immediately send concrete fix request to the relevant agent (file:line + fix method)
- For boundary issues, notify BOTH side agents
- To leader: validation report (pass / fail / unverified items separated)
```

---

## 6. Real-world case study: bugs found in SatangSlide

Every item in this guide is extracted from these real bugs:


| Bug | Boundary | Cause |
|-----|----------|-------|
| `projects?.filter is not a function` | API→hook | API returns `{projects:[]}`, hook expects array |
| All dashboard links 404 | File path→href | `/dashboard/` prefix missing |
| Theme image not visible | API→component | `thumbnailUrl` vs `thumbnail_url` |
| Theme selection not saved | API→hook | select-theme API exists, hook missing |
| Create page hangs forever | State transition→code | `template_approved` transition code missing |
| `data.failedIndices` crash | Immediate response→frontend | Accessing async result in immediate response |
| "View slides" 404 after completion | File path→href | `/projects/` → `/dashboard/projects/` |

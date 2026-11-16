# ADR 003 — Phase 2 Storage Boundary: Why PERSISTABLE_STATE Stays Behind

**Status**: Accepted — Decision unchanged; factual Erratum appended 2026-10-12 (see end of file)
**Date**: 2026-09-17

## Context

The "storage" boundary's obvious candidate list (from PHASE2-MODULARIZE.md's
own roadmap) was `localStore`, `PERSISTABLE_STATE`, `ExecutionCheckpoint`,
`ImageStore`, `MessageArchive`. A dependency-graph script run before
touching anything showed a sharp split:

| Item | External dependencies found |
|---|---|
| `localStore` | none |
| `ExecutionCheckpoint` | `autoInitApp`, `showToast` (both remain global) |
| `ImageStore` | none (its only real dependency, `localStore`, is in-boundary) |
| `MessageArchive` | none |
| `PERSISTABLE_STATE` | 16 scattered top-level `let` bindings: `messages`, `customAgents`, `workflows`, `knowledgeBase`, `activeGroupId`, `agentOrder`, `selectedAgentIds`, `projects`, `decisionJournal`, `topicMonitors`, `longTermMemory`, `uploadedDocs`, `activityLog`, `errorLog`, `usageLog`, `briefingLastSeenAt` |

## Decision

Extract the four zero/external-only-dependency items into
`modules/storage.mjs` this round. Leave `PERSISTABLE_STATE` in the
monolith, undocumented as a "gap" but explicitly deferred with reasoning
recorded here.

## Why PERSISTABLE_STATE can't move the same way

`PERSISTABLE_STATE` is a registry of `{ get, set, default }` closures,
one per piece of app state, e.g. (illustrative):
```js
messages: { get: () => messages, set: (v) => { messages = v; }, default: () => [] }
```
Each closure captures a `let` binding declared elsewhere in the same
classic-script scope. An ES module has its own separate top-level scope —
it cannot close over a `let` declared in a different script's scope. Moving
`PERSISTABLE_STATE` alone, without also moving the 16 variables it wraps,
would require either:
1. Passing those bindings into the module by reference somehow (not
   possible for primitive/array/object `let` bindings across script
   boundaries in JS — there is no shared-reference mechanism for this).
2. Rewriting the storage layer to use getter/setter functions defined in
   the monolith and imported the "wrong way" (module importing from a
   classic script isn't meaningful), or
3. Moving all 16 state variables into the module too — which would mean
   extracting most of "core"/"agents"/"workspace"'s actual data at the
   same time as "storage", collapsing multiple protocol-named boundaries
   into one oversized, high-risk change. This is exactly the kind of
   "broad rewrite" Aiham's rules forbid, and the opposite of "استخراج
   تدريجي" (incremental extraction).

## Consequences

- `PERSISTABLE_STATE` remains in the classic script for now. It already
  references `ImageStore`/`MessageArchive`/`localStore` by their
  window-bridged names (unchanged call sites — the bridge means this
  needs no edit at all), so this round's extraction is fully
  behavior-transparent to it.
- The natural point to revisit `PERSISTABLE_STATE` is once its wrapped
  state variables have a module home of their own — most likely
  alongside "core" (session/state bootstrap) or split further once
  "agents"/"workspace" are extracted and each owns its own slice of that
  state. Recorded here so a future boundary doesn't have to
  re-discover this constraint from scratch.
- This is the second time (after ADR 002's `autoInitApp` finding) that
  the actual extraction work surfaced a structural fact not visible from
  reading function signatures alone. The dependency-graph script is now
  treated as a mandatory first step for every remaining boundary, not an
  optional nicety.

## Verification

See `PHASE2-MODULARIZE.md` for the full evidence table: backend 406/406
(untouched), Vitest 46/46 (27 new storage tests, 89.2%/82.6%/86.11%/96%
coverage on `storage.mjs`), both E2E suites re-run clean (Phase 0: 12/12,
Phase 1: 16/16) — the Phase 1 suite in particular exercises
`ImageStore`/`MessageArchive` through real app flows (image attach/send,
message cap, reset-all-data GC), not just unit-level.

## Erratum — 2026-10-12 (review in core slice 9, CP-17)

Append-only. The Decision section above is **unchanged and still describes the repository**: `PERSISTABLE_STATE` and its 16
variables stay in the classic script. This erratum corrects only factual claims in the Context / Why / Consequences text that
committed evidence contradicts, and says where the evidence stops. It does **not** choose an ownership mechanism for moving the
variables — that choice is a separate, pending owner decision (CP-17 §3).

| # | Claim in this ADR | Review | Evidence |
|---|---|---|---|
| 1 | The 16 variables are top-level `let` bindings wrapped by closures `{get,set,default}`; `PERSISTABLE_STATE` is a registry of such closures | **SUPPORTED** | CP-10 + fresh run of the slice 3 analyzer 22/22 (16 `let` at column 0, 16 same-name closures, `default()` text = initializer 16/16) |
| 2 | "An ES module … cannot close over a `let` declared in a different script's scope" | **CONTRADICTED for bare-name access from module code in Chromium 141.** A module-scope function reads and writes a classic top-level `let`/`var` by bare name (live binding both ways); `const`: read OK, write `TypeError`; classic `let`/`const` are not `window` properties. The reverse is true and unchanged: names declared in a module are invisible to the classic script, and one module cannot see another module's top-level names. Not tested: writes on the real monolith (read-only there), Firefox/Safari, closures stored and invoked later from classic. | CP-8 (19/19; read-only check on the real monolith 56/56 `let`, 57/57 `const`, 370/370 functions) |
| 3 | Option 1: bindings cannot be passed into the module "by reference somehow … no shared-reference mechanism" | **CONTRADICTED in effect.** A binding itself cannot be passed, but closures defined in the classic script and passed as a parameter are a working mechanism, in production since core slice 4: `PersistableStateCore.snapshot/restore/reset(PERSISTABLE_STATE, …)` | CP-11 (extract proof 17/17, E2E 21/21, mutation 16/16) |
| 4 | Option 2: a module "importing from a classic script isn't meaningful" | **SUPPORTED literally** (a module cannot `import` a classic script); superseded in practice by #3 (parameter passing) and by the window bridge (ADR-002) | CP-11 |
| 5 | Option 3: moving all 16 variables at once "collapses multiple boundaries into one oversized, high-risk change" | **PARTLY SUPPORTED — mechanism-dependent.** Holds when every classic site must be rewritten (fresh counts: 32 rebinds outside the setters, 47 writer units, 85 reader units; `messages` ≈101 sites, `selectedAgentIds` ≈46). Measured on scratch prototypes (never applied): a bare-name-preserving variant moved `agentOrder`, or `messages` + `selectedAgentIds`, with 1–2 changed classic lines and no edit to any existing test, whereas an explicit-store variant for `agentOrder` alone broke 2 Vitest + 4 E2E checks. The size claim therefore depends on the mechanism chosen. | CP-17 §2; `baseline/evidence/phase2-core-slice9-ownership-prototypes-results.json` |
| 6 | Consequences: "`PERSISTABLE_STATE` … already references `ImageStore`/`MessageArchive`/`localStore` by their window-bridged names" | **CONTRADICTED.** The registry text references none of them (0 matches at `e58dab9`, `dd3c3a7` and HEAD); the references are in `persistState` (2), `autoInitApp` (3) and `resetAllData` (4). The conclusion (the extraction needed no edit to the registry) is unaffected. | `git show <commit>:frontend/neural_nexus_ai_agents-4-3-5-3.html` over the registry block; CP-17 |
| 7 | "The natural point to revisit `PERSISTABLE_STATE` is once its wrapped state variables have a module home" | **NOT TESTED** (forward-looking); consistent with CP-10 | — |
| 8 | Verification figures (backend 406/406, Vitest 46/46, 89.2 % coverage …) | **HISTORICAL**, not re-measured here; current baseline is in CP-17 | — |

Limits: Chromium 141 headless only; evidence for #2/#3 comes from CP-8/CP-11, for #5 from scratch prototypes of `agentOrder`,
`messages` and `selectedAgentIds` only (not all 16 variables).


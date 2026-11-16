# ADR 005 — State ownership by global accessor (pilot: `agentOrder` only)

**Status**: Accepted as a **transitional, per-variable** mechanism for the `agentOrder` pilot only (owner instruction of 2026-10-13: "global-accessor experiment on `agentOrder` alone"). It is **not** adopted for the other 15 `PERSISTABLE_STATE` variables; each further variable needs its own decision. The pilot's local behavior is VERIFIED within the limits in §Evidence; release readiness is **BLOCKED/UNVERIFIED** on `sw.js` (§Risks R1).
**Date**: 2026-10-13
**Scope**: `frontend/modules/state.mjs`, `frontend/main.js` (import + one install call), one declaration line of the monolith. Does not change ADR-002 (window bridges), ADR-003's Decision (`PERSISTABLE_STATE` stays in the monolith), or Evidence Integrity (ADR-004).
**Related**: CP-17 (options measured, owner decision), CP-18 (this slice's evidence), ADR-003 Erratum.

## Context

ADR-003 kept `PERSISTABLE_STATE` (a registry of 16 `{get,set,default}` closures over classic top-level `let`s) in the monolith because a module cannot close over a `let` of the classic script. CP-17 measured ways to move the *ownership of the value* to a module anyway. Mechanism A (explicit store, `NexusState.x`) broke 2 Vitest tests and 4 E2E checks on the pilot and turns a stray bare-name write into a silent new global; mechanism B (global accessor, bare name preserved) kept every suite green on the pilot and on `messages` + `selectedAgentIds` in a scratch prototype. The owner chose to proceed with B for `agentOrder` only.

## Decision

1. `agentOrder` is owned by `frontend/modules/state.mjs` (a private module-scope binding). The module exports `installGlobalStateAccessors(target)`, which defines `target.agentOrder` as an accessor property (`get`/`set` over the private binding), `configurable: true`, `enumerable: false`.
2. `main.js` imports it and calls `installGlobalStateAccessors(window)` **after the window bridge assignments and before the first startup call** (`window.applyTheme()`).
3. The classic `let agentOrder` declaration is **removed** from the monolith (replaced by a pointer comment). There must be no second binding: a surviving `let` would silently shadow the accessor (measured by mutant M5).
4. Classic code keeps reading/writing the bare name `agentOrder`; `PERSISTABLE_STATE`'s entry is textually unchanged (`get:()=>agentOrder`, `set:v=>agentOrder=v`) and now goes through the accessor.
5. Nothing else moves. `messages`, `selectedAgentIds` and the other 13 variables stay classic `let`s.

## Assumptions made by the implementer (flag for the owner)

- **D2 (owner module) was not stated.** `frontend/modules/state.mjs` (one central module) was assumed because it is the file name used in the CP-17 prototypes. If the owner prefers domain modules, moving the one variable later is a small, mechanical change; the precedent for the other variables is the larger question.
- The owner's text was read as D1 = B (accessor), D3 = `messages`/`selectedAgentIds` untouched, D4 = this ADR is required.

## Consequences

- `agentOrder` now exists as `window.agentOrder` (an accessor) once `main.js` has run; the other 15 variables are still not `window` properties (measured: window own-property names after boot differ by exactly `{agentOrder}`).
- Any code that can reach `window` — including injected scripts and extensions — can now read and overwrite `agentOrder` directly. For this variable (a list of agent ids) that is low impact; **for `messages` it would not be**. This is a security-boundary precedent to decide explicitly before any migration of sensitive variables (R2).
- Initialization order becomes a contract: the accessor must exist before any classic code reads the bare name. Today no load-time code touches the variable (slice 3 analyzer: load-time sites = 0) and the install is statically ordered before the startup calls; **a runtime test cannot detect a mis-ordered install** (mutant M4 survives all runtime checks; only the static order check fails it).
- Evidence tools bound to the old layout needed minimal, logged adaptations (CP-18 §4).

## Alternatives considered (measured in CP-17)

A explicit store (`NexusState.x`): changes the bare name for every classic site; broke 2 Vitest + 4 E2E checks on the pilot. C bare-name access from a module: moves no ownership. D defer: leaves C2/C3 open.

## Evidence (all in `baseline/evidence/phase2-core-slice10-*`, Chromium 141 headless only)

PRE and POST of Vitest, backend, all E2E suites; the new `e2e/phase2-core-slice10-flows.mjs` (VALID 9/9, PRES 12/12 on PRE and POST, PS 0/7 on PRE and 7/7 on POST); PRE/POST fingerprint comparison 11/11; mutants M1–M8 (M1–M3 and M5–M8 killed as registered; M4 survives every runtime check and is killed only by the static order check — CP-18 §3); `state.test.mjs` 10 tests. Details and the honesty log: `docs/checkpoints/CP-18.md`.

## Risks / not verified

- **R1 — `sw.js` (BLOCKED/UNVERIFIED; High for release).** `sw.js` was not provided. `main.js` now statically imports `./modules/state.mjs`; if the service worker precaches an explicit file list or serves modules cache-first, `state.mjs` must be added to it (the pending manifest grows from 5 to 6 files), otherwise an offline or stale-cache boot could fail to load the whole `main.js` module graph. No test here exercises the service worker.
- **R2 — exposure precedent** (see Consequences).
- **R3 — named-access collision (INFERENCE, not tested):** a DOM element with `id="agentOrder"` should not shadow an existing own property of `window` (own properties precede the named-properties object), but this was not tested; statically 0 of the 16 names occur as `id="…"` in the monolith (measured in CP-17); dynamically created elements were not measured.
- **R4 — Chromium 141 only.** Firefox/Safari resolution of bare identifiers to global accessor properties, real devices, accessor performance, behavior if `state.mjs` fails to load (same failure class as any other module) are not tested.
- **R5 — precedent:** this ADR does not authorize applying the mechanism to the remaining variables.

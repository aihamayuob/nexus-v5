# Core slice 9 — C2/C3 ownership + ADR-003 review: acceptance criteria and decision rule

Written 2026-10-12 BEFORE any prototype or measurement of this slice. Base: HEAD `bc05f58` on `v5.0-polish`, clean tree.
PRE already measured on the unmodified HEAD: Vitest 168/168; E2E `baseline-flows` 12/12, `phase1-security-flows` 16/16,
`phase2-core-seed-flows` 16/16, `phase2-core-slice4-flows` 21/21; slice 3 analyzer 22/22.

Owner instruction (2026-10-12): "option 1 only" = resolve C2/C3 ownership, review ADR-003 separately; smallest safe change consistent
with NEXUS architecture and compatibility; **if a material ownership/architectural trade-off requires the owner's decision, STOP and present the options**;
do not reopen Evidence Integrity; do not start another slice; stop after this slice.

## Scope
IN: (a) ownership mechanism for C2 (small variables, pilot `agentOrder`) and policy for C3 (`messages`, `selectedAgentIds`); (b) review of ADR-003 as a
separate documentation item; (c) CP-17 + CURRENT-STATE / CONTINUATION / CHANGELOG with verified evidence only.
OUT: Evidence Integrity; `NexusContext`/`ContextFabric`; boundaries 6–9; `sw.js`; the E-1 seed-flows test defect; any second slice.

## Materiality test for "needs the owner" (fixed BEFORE measuring)
An ownership mechanism is an OWNER decision (stop, present options, no production change) if ANY holds:
- **M1** the candidate mechanisms differ in what the migrated variable looks like to the remaining classic code (bare name stays vs. must be rewritten);
- **M2** at least one candidate requires editing an existing test/evidence script (even if the assertion is preserved);
- **M3** the choice becomes the pattern for the other ≥ 14 variables and for boundaries 6–9 (precedent);
- **M4** it is costly to reverse once more than one variable has migrated.
If all candidates were equivalent on M1–M3 the smallest would be applied. Pre-registered expectation: M3 holds for every candidate ⇒ owner decision.

## What will be measured (read-only on the production tree; prototypes only on scratch copies, never applied)
Candidates for the pilot `agentOrder` (1 declaration, 2 reads in 1 function, 1 rebind, 1 registry entry — analyzer, fresh):
- **PA — explicit store**: module `state.mjs` owns `{ agentOrder }`, bridged as `window.NexusState`; classic sites rewritten to `NexusState.agentOrder`.
- **PB — global accessor shim**: module owns the value privately; `main.js` installs `Object.defineProperty(window, 'agentOrder', {get,set})` before the startup calls;
  the classic `let agentOrder` declaration is removed; every bare-name site stays untouched.
- (not prototyped, argued from CP-8/CP-11 only) **PC — bare-name access from a module** (ownership does NOT move); **PD — defer** ownership until the domain boundaries 6–9 exist.

Predictions (to be compared with the measurement; a wrong prediction is reported, not hidden):
- P1: PA keeps Vitest 168/168 and E2E 12/12, 16/16, 16/16; **fails ≥ 1 check of `phase2-core-slice4-flows`** (it reads `agentOrder` by bare name inside `page.evaluate`).
- P2: PB keeps Vitest 168/168 and E2E 12/12, 16/16, 16/16, 21/21 (bare-name reads/writes resolve to the global accessor).
- P3: both PA and PB break the layout-bound evidence tools (slice 3 analyzer "16 variables declared as top-level `let`", slice 2 real-monolith probe "56 `let`") — expected tool maintenance, not product regression.
- P4: production tree sha256 identical before/after (prototypes live in scratch).
- P5: none of the 16 names occurs as a static `id="…"` in the monolith (named-access collision check for PB).

C3 sizing is taken from the fresh analyzer output (sites per variable) and from the E2E bare-name coupling grep; no C3 prototype is built (I-3 says it is not small).

## ADR-003 review criteria
Each factual claim of ADR-003 is classified SUPPORTED / CONTRADICTED / NOT-TESTED with a committed evidence reference (CP-8 slice 2, CP-11 slice 4, CP-10 slice 3).
An erratum may be appended ONLY for claims CONTRADICTED by committed evidence; the Decision section stays untouched; the erratum must not select an ownership mechanism.
Chromium-141-only evidence is labelled as such; anything beyond it is INFERENCE.

## Acceptance of THIS slice
1. Production tree (frontend/, src-baseline/ source, e2e/ existing scripts) byte-identical to HEAD after the slice (sha256), unless the owner decision is not required (not expected).
2. All options presented with measured costs, predictions-vs-measurement table, a recommendation labelled as a recommendation, and exactly which decision the owner must make.
3. ADR-003 erratum limited as above; CP-17 + state docs say: C2/C3 ownership = **BLOCKED on the owner decision**; no claim stronger than the evidence.
4. Regression POST equals PRE (docs-only change cannot change test results; re-measured anyway).
5. Stop after this slice. No commit/ZIP unless asked.

---
## Results (appended 2026-10-12 after the measurements; the text above was written before them and is unchanged)
- Predictions vs measurement: P1 PARTLY WRONG (PA also failed 2 Vitest tests that evaluate the real registry text in a sandbox: `NexusState is not defined`; E2E 12/16/16 passed, slice4 failed 4); P2 CONFIRMED (PB and PB-C3 green on Vitest, E2E 12/16/16/21 and slices 5–8 = 27/35/40/79); P3 PARTLY WRONG (slice 3 analyzer broke as predicted — PA 3 checks, PB 1 check — but the slice 2 probe stayed 19/19); P4 CONFIRMED (`productionUnchanged: true`); P5 CONFIRMED (0/16 static ids).
- Materiality test: M1, M2 (PA: 2 Vitest + 4 E2E), M3 and in part M4 hold ⇒ OWNER DECISION; no mechanism applied.
- Probe discrimination: MUT-PA and MUT-PB both 6/8 (the probe can fail).
- Slice acceptance 1–5: (1) production tree byte-identical (sha256 monolith `48ba9008…`, main.js `ae7b7a32…`, `git diff -- frontend src-baseline e2e` empty); (2) options + measured costs + predictions table in CP-17; (3) ADR-003 erratum only, no mechanism chosen; (4) POST == PRE (logs `phase2-core-slice9-POST-*`); (5) stopped, no commit/ZIP.

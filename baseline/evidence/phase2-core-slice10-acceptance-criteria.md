# Core slice 10 — C2 pilot: `agentOrder` ownership via the global-accessor mechanism — acceptance criteria

Written 2026-10-13 BEFORE any production edit and BEFORE the slice 10 PRE run. Base: HEAD `bc05f58`, branch `v5.0-polish`
(slice 9 / CP-17 files are present but UNCOMMITTED in the working tree; production paths are byte-identical to HEAD).
These criteria are frozen: they are not to be relaxed after seeing results. A criterion that cannot be met is reported as
unmet (PARTIAL/FAILED/UNVERIFIED), not edited.

## Provenance and honest note about the "previous" criteria file
The owner's instruction of 2026-10-13 refers to an acceptance-criteria file "already created". The only criteria file that existed
at the start of this slice was `phase2-core-slice9-ownership-acceptance-criteria.md` (slice 9: prototype measurement, **no mechanism applied**).
No slice 10 criteria file and no ADR-005 existed. This file is therefore the slice 10 criteria; its thresholds are taken from the slice 9
measurements (CP-17 §2: PB variant on `agentOrder` = all existing suites unchanged; probe 8/8) and were written before any slice 10 run.
The owner instruction of 2026-10-13 is read as the decisions: **D1 = global accessor (B)**, **D3 = `messages`/`selectedAgentIds` untouched**,
**D4 = ADR-005 required**. **D2 (owner module) was not stated; assumption: `frontend/modules/state.mjs`, the file name used in slice 9** — flagged in ADR-005.

## Scope
IN: new `frontend/modules/state.mjs` (owns the value of `agentOrder`; `installGlobalStateAccessors(target)`); `frontend/main.js` (import + one install call placed
BEFORE the five startup calls); the monolith loses ONLY the declaration `let agentOrder = [];` (replaced by a pointer comment); new Vitest `state.test.mjs`;
new E2E `e2e/phase2-core-slice10-flows.mjs` + `baseline/evidence/phase2-core-slice10-compare.mjs` (fingerprint comparison) + mutation script;
minimal, measured adaptation of evidence tools that are bound to the old layout (each adaptation preserves or strengthens its assertion and is documented);
`ADR/005-…`, `docs/checkpoints/CP-18.md`, `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`, `CHANGELOG.md`.
OUT (not touched): `messages`, `selectedAgentIds` and the other 13 variables; `PERSISTABLE_STATE` (text unchanged: its `agentOrder` entry keeps `get:()=>agentOrder`);
`persistState`/`autoInitApp`/`resetAllData`; Evidence Integrity and the backend; any other slice; `sw.js` (not provided); commits/ZIPs.

## PRE gate (before any edit)
PRE must pass on the unmodified production tree, else STOP with the exact reason and NO production edit:
backend `tsc --noEmit` exit 0 and `npm test` 472/472; Vitest 168/168; E2E `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-seed-flows` 16/16
(a lone 15/16 on `ciphertext-hides-plaintext` is the known E-1 flake: re-run and record both), `phase2-core-slice4-flows` 21/21, slice 5 27/27 `SURVIVES`, slice 6 35/35 `ACCEPTED`,
slice 7 40/40 `NOT-STUCK`, slice 8 79/79 `ACCEPTED`, Evidence Integrity UI 26/26 `ACCEPTED`; slice 2 probe 19/19 and slice 3 analyzer 22/22 on a clean tracked tree; the new slice 10 E2E on the
unmodified tree must give VALID all green, PRES all green, **PS all red** (proves the new tests can fail).

## Acceptance criteria (all must hold POST)
- **AC-1 ownership/descriptor (PS).** After boot `Object.getOwnPropertyDescriptor(window,'agentOrder')` is an accessor: `get` and `set` functions, `configurable:true`, `enumerable:false`.
- **AC-2 no shadow (PS).** Bare-name `agentOrder` and `window.agentOrder` are the same value after a bare-name write and after a `window.agentOrder` write. After `delete window.agentOrder`, the bare name throws `ReferenceError`
  (there is no classic binding behind it). Static: the monolith contains no top-level `let|const|var agentOrder` declaration.
- **AC-3 behavior preservation (PRES; identical verdicts PRE and POST).** Initial order natural and registry `[]`; `moveAgentOrder` swaps; the registry sees the full explicit order; persist → reload → `autoInitApp` restore reproduces the order;
  `resetPersistableState` returns default + natural order; a blob lacking the `agentOrder` key restores a fresh independent `[]`; the snapshot value is the live reference (slice 4 characterization, shallow); `restorePersistableState` REBINDS
  (an old reference is not the live array afterwards); in-place mutation (`push`) is visible to the registry; a bare-name write is visible to the registry and to `getOrderedAgents`; reorder list DOM rows = agent count.
- **AC-4 isolation (PRES + fingerprint).** The other 15 variables are not `window` properties and stay bare-name readable. Fingerprint comparison PRE vs POST (`…-compare.mjs`): window own-property names POST − PRE = exactly `{agentOrder}` and PRE − POST = `{}`;
  module requests POST − PRE = exactly `{/modules/state.mjs}`; app-state fingerprint after the fixed scenario identical.
- **AC-5 init order.** Static: in `main.js` the install call precedes `window.applyTheme()` (the first startup call) and follows the bridge assignments. Runtime: a seeded persisted `agentOrder` is restored by the real boot (`autoInitApp`) — covered by AC-3.
- **AC-6 unit tests.** `state.test.mjs`: descriptor shape on a fake target; get/set round trip; rebind and in-place semantics; install idempotent (value survives a second install); fresh `[]` per module instance (`vi.resetModules`).
- **AC-7 footprint.** `git diff --numstat` of the monolith ≤ 2 added / ≤ 2 deleted lines; changed/new production files are exactly: monolith, `main.js`, new `modules/state.mjs`, new `modules/state.test.mjs`. sha256 of every other production file (backend src, other modules, existing e2e scripts) identical to HEAD.
- **AC-8 non-regression POST.** Everything in the PRE gate list stays green with the same numbers (+ new Vitest tests, + the new E2E: VALID, PRES, PS all green). Tools bound to the old layout are measured on the patched tree and adapted ONLY where they break because of the intended ownership move
  (expected: slice 3 analyzer check "16 variables declared as top-level `let`", slice 4 `extract-script` P2b/P5, possibly slice 4 exec-order A7); each adaptation keeps or strengthens its assertion, is limited to reversing/recognizing the slice 10 hunks, and is logged. Pre-registered expectation for slice 4 `verify 9c95fbd`: 15/17 as at HEAD (only P7 and P7b failing).
- **AC-9 mutation (scratch copies of the patched tree; production sha256 unchanged).** Pre-registered expectations:
  M1 setter no-op → KILLED; M2 getter returns a fresh `[]` each call → KILLED; M3 install call removed from `main.js` → KILLED; M4 install moved AFTER the startup calls → **expected to SURVIVE at runtime** (restore happens after `autoInitApp`'s first `await`; only the static order check kills it) — reported as such, not hidden;
  M5 `let agentOrder = [];` re-added to the monolith (silent shadow) → KILLED; M6 `enumerable:true` → KILLED; M7 wrong initial value `['x']` → KILLED; M8 `configurable:false` → KILLED (descriptor check). Any other verdict is reported with its reason, first-run log kept.
- **AC-10 documentation.** ADR-005 (status wording limited to what the evidence supports; transitional; per-variable; D2 assumption stated; risks), CP-18, CURRENT-STATE, CONTINUATION, CHANGELOG list only measured facts. Only the six statuses are used. `VERIFIED` only within the stated limits (Chromium 141 headless).

## Stop rules
PRE failure ⇒ stop, record, no production edit. A POST failure that cannot be fixed by a minimal change inside this scope ⇒ revert the production edit, report FAILED/PARTIAL with the evidence. A Critical/High finding or an unexplained regression ⇒ stop before documentation claims. Never edit/skip a test to make it pass.
After this slice: STOP. No `messages`/`selectedAgentIds`, no Evidence Integrity, no other slice, no commit/ZIP unless explicitly requested.

## Known UNVERIFIABLE here (reported, not claimed)
`sw.js` is not provided: the cache manifest must gain a 6th file (`/modules/state.mjs`) — BLOCKED/UNVERIFIED; Firefox/Safari and real devices; behavior with a failing `state.mjs` network load (same failure class as any module); accessor performance.

---
## Results (appended 2026-10-14 after the runs; the text above was written before them and is unchanged)
- PRE gate: passed in full on the unmodified tree (backend tsc 0 / 472; Vitest 168; E2E 12/16/16/21; slices 5–8 = 27 SURVIVES / 35 ACCEPTED / 40 NOT-STUCK / 79 ACCEPTED; EI UI 26/26; slice 2 probe 19/19; slice 3 analyzer 22/22; slice 10 E2E REJECTED with VALID 9/9, PRES 12/12, PS 0/7). The first PRE attempt had two harness defects (bash env syntax; untracked symlink in the scratch clone) — fixed and re-run; no production impact.
- AC-1, AC-2, AC-5 (static + runtime), AC-6 (10 tests): MET. AC-3: MET (PRES 12/12 PRE and POST, identical). AC-4: MET after fixing a measurement defect in the E2E's request fingerprint (see CP-18 §5.3; criterion unchanged). AC-7: MET (monolith +1/−1; main.js +5/−0; exactly 4 production files; other sha256 identical).
- AC-8: MET with logged tool adaptations (slice 4 verify P2b/P5/P6b — P6b was not predicted; slice 3 analyzer crashed on a null declaration before adaptation). Pre-registered "slice 4 verify 15/17" holds only after the adaptation (12/17 before). E-1 flake appeared once in POST seed-flows (15/16), re-run 16/16.
- AC-9: M1–M3, M5–M8 KILLED as registered; M4: survives all runtime checks (VALID 9/9, PRES 12/12) and fails only the static AC5 check — registered expectation holds in substance; the script's binary label reports KILLED/DIFFERS (not edited).
- AC-10: ADR-005, CP-18, CURRENT-STATE, CONTINUATION, CHANGELOG written; statuses limited to the six allowed.
- Unmet / open: `sw.js` cache manifest BLOCKED/UNVERIFIED; D2 assumed; Chromium 141 only.

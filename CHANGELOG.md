# CHANGELOG.md

## [v5.0-polish / Phase 2 core slices 9–11] — 2026-10-15/16
### Committed / documented (no new production code in this entry)
- `e17c76d`: core slices 9 + 10 (CP-17/CP-18/ADR-005) committed locally as found in the CP-19 handoff snapshot; `agentOrder` is owned by `frontend/modules/state.mjs` via a global accessor (VERIFIED locally, Chromium 141 only; release readiness BLOCKED on `sw.js` at that point).
- `80c558a`: core slice 11 (CP-19) characterization E2E for `fullAgentPrompt` (no production change); documented in `docs/checkpoints/CP-19.md`, evidence under `baseline/evidence/phase2-core-slice11/`.

## [v5.0-polish / Phase 0] — 2026-09-16

### Added
- `v5.0-polish` git branch, baseline snapshot commit.
- `baseline/INVENTORY.md`, `baseline/FLOWS.md`, `baseline/METRICS.md`,
  `BASELINE.md`, `PLAN.md`, `ROADMAP.md`, `ADR/000-baseline.md`.
- `e2e/baseline-flows.mjs` — reusable Playwright regression script driving
  the real compiled backend + the real, untouched HTML frontend.
- `baseline/evidence/` — build log, npm audit log, server boot logs, full
  E2E run log, extracted API route list.

### Changed
- Nothing in application code (frontend HTML or backend `src/`). Phase 0
  is documentation- and evidence-only, per protocol §9's absolute rule.

### Verified (no fix needed)
- Backend: 406/406 tests, clean typecheck, clean build, 0 npm audit
  vulnerabilities — matches the state already established at the end of
  the prior session on `nexus-backend-resilience-verified.zip`.
- Frontend: no `eval()`, no `document.write`, real-browser load with zero
  uncaught page errors across the flows tested.

### Not yet started (as of Phase 0)
- `/nexus-security`, `/nexus-modularize`, `/nexus-reliability`,
  `/nexus-commercial`, `/nexus-research` — all pending explicit approval
  per protocol §6.

## [v5.0-polish / Phase 1] — 2026-09-16

### Added
- `jsStr()` — JS-string-safe escaping for the 11 onclick sites that embed
  an id inside a single-quoted JS argument.
- `stripInternalMarkers()` — strips internal parsing markers before
  conversation history is sent back to the model.
- `ImageStore` — attached images now live in their own IndexedDB keys
  instead of embedded inline in the main encrypted state blob.
- `MessageArchive` + `MESSAGE_CAP` (300) — bounds the live `messages`
  array; overflow is archived, never deleted.
- `localStore.listKeys(prefix)` — new capability needed by
  `ImageStore.gcAll()`.
- `e2e/phase1-security-flows.mjs` — 16 new regression checks.
- `PHASE1-SECURITY.md` — full audit findings + actions for all 11 items
  in protocol §10's checklist.

### Changed
- `sendMessage()` — pushes `imageRef` instead of the raw base64 `image`.
- `renderMessages()` — resolves `imageRef` via `ImageStore` (cache-first);
  `m.image` kept as a read-only fallback for pre-existing conversations.
- `persistState()` — enforces `MESSAGE_CAP`, archives overflow.
- `resetAllData()` — now also clears `ImageStore` and `MessageArchive` so
  its own "permanently erases everything" promise stays true.
- `buildHistoryForAgent()` — content passed through `stripInternalMarkers()`.
- `importCustomAgentPasted()`, `applyNomadicPayload()` — both now show a
  `confirm()` preview before committing imported content.
- 11 onclick sites — `escapeHtml(id)` → `jsStr(id)`.

### Verified (no fix needed)
- XSS/unsafe DOM sinks: all 153 `.innerHTML` sites classified safe.
- PromptInjectionGuard: already correctly fencing knowledge
  base/docs/market-context content.
- Secure external content import: JSON.parse only, no code-exec risk in
  either import path.

### Not applicable
- Safe Markdown rendering / DOMPurify — no markdown rendering exists in
  the current codebase; nothing to sanitize.

### Regression
- Backend: 406/406, clean typecheck (untouched, re-verified).
- `e2e/baseline-flows.mjs` (Phase 0): 12/12, zero regressions.
- `e2e/phase1-security-flows.mjs` (Phase 1, new): 16/16.

### Not yet started
- `/nexus-modularize`, `/nexus-reliability`, `/nexus-commercial`,
  `/nexus-research` — pending explicit approval per protocol §6.

## [v5.0-polish / Phase 2, boundary 1/9 "security"] — 2026-09-17

### Added
- `frontend/modules/security.mjs` — first ES module extraction:
  `escapeHtml`, `jsStr`, `deriveKey`, `b64ToBuf`, `bufToB64`,
  `PromptInjectionGuard`. Byte-identical to prior inline definitions
  (diff-verified).
- `frontend/main.js` — real bootstrap/orchestration entry point: sets up
  the window bridge, then runs the app's startup sequence.
- `frontend/package.json`, `vitest.config.js` — Vitest 4.1.11 + jsdom,
  0 vulnerabilities (pinned above the `@vitest/mocker`/`esbuild`
  advisory range without a breaking major-version jump).
- `frontend/modules/security.test.mjs` — 19 tests, 95.83%/100%/100%/
  85.71% coverage (stmts/funcs/lines/branch) on the new module.
- `PHASE2-MODULARIZE.md` — full findings, the regression found+fixed,
  and the 8-boundary roadmap.

### Changed
- Removed the 6 extraction targets from the monolith, replaced with
  pointer comments (23 insertions / 91 deletions net).
- Moved the 5-call app-startup sequence (`applyTheme`,
  `applyTranslations`, `autoInitApp`, `registerServiceWorker`,
  `updateOnlineStatus`) from the end of the classic script into
  `main.js`, same order, run right after the window bridge — required
  fix for a real regression found this round (see below).
- `e2e/baseline-flows.mjs`, `e2e/phase1-security-flows.mjs` — static
  file servers extended to serve the whole `frontend/` directory with
  correct JS MIME types (test-harness change only, not app behavior).

### Regression found and fixed this round
- `autoInitApp()` (+ 4 other startup calls) ran as top-level statements
  in the classic script, executing *before* the deferred module script
  could set `window.jsStr`/`window.bufToB64` — caused
  `chat-send-no-crash` to fail with `ReferenceError`. Root-caused via a
  direct Playwright debug session, fixed by relocating the startup
  sequence into `main.js`. Full 3-suite regression re-run clean after
  the fix (see Regression section below).

### Regression (full re-run, after the fix)
- Backend: 406/406, clean typecheck (untouched).
- `e2e/baseline-flows.mjs` (Phase 0): 12/12.
- `e2e/phase1-security-flows.mjs` (Phase 1): 16/16.
- New Vitest suite: 19/19.

### Disclosed follow-up (not a regression, a required manual step)
- `sw.js` (not among the provided artifacts) needs `/main.js` and
  `/modules/security.mjs` added to its cache manifest before deploying,
  for offline/PWA support to keep covering these two new files.

### Not yet started
- 8 of 9 modularization boundaries (storage, utilities, core, agents,
  modes, ops-center, workspace, UI) — see PHASE2-MODULARIZE.md's
  roadmap. `/nexus-reliability`, `/nexus-commercial`, `/nexus-research`
  — pending explicit approval per protocol §6.

## [v5.0-polish / Phase 2, boundary 2/9 "storage"] — 2026-09-17

### Added
- `frontend/modules/storage.mjs` — second ES module extraction:
  `localStore`, `ExecutionCheckpoint`, `ImageStore`, `MessageArchive`.
  Byte-identical to prior inline definitions (diff-verified).
- `frontend/modules/storage.test.mjs` — 27 tests, 89.2%/82.6%/86.11%/96%
  coverage (stmts/branch/funcs/lines). Added `fake-indexeddb` (0 new
  vulnerabilities) to test the real raw-IndexedDB path — the one that
  actually runs in Aiham's deployed app, since `window.storage` only
  exists in Claude's own artifact-preview environment.
- `ADR/003-phase2-storage-boundary.md` — records why `PERSISTABLE_STATE`
  is deliberately NOT extracted this round (closes over 16 scattered
  top-level state variables; moving it now would mean folding in most of
  "core"/"agents"/"workspace" at once).

### Changed
- Removed the 4 extraction targets from the monolith, replaced with
  pointer comments (net: 15 insertions / 190 deletions across the
  monolith + `main.js`).
- `main.js` — added the `storage.mjs` import and window-bridge
  assignments, placed before the existing startup-sequence call (learned
  from boundary 1: `autoInitApp()` calls into all 4 of these).

### Regression (full re-run, fresh)
- Backend: 406/406, clean typecheck (untouched).
- Vitest (security + storage combined): 46/46.
- `e2e/baseline-flows.mjs` (Phase 0): 12/12.
- `e2e/phase1-security-flows.mjs` (Phase 1): 16/16 — exercises
  ImageStore/MessageArchive through real app flows, not just units.
- No regression this round (boundary 1's ordering lesson applied
  proactively).

### Disclosed follow-up (cumulative)
- `sw.js` cache-list additions now needed: `/main.js`,
  `/modules/security.mjs`, and `/modules/storage.mjs`.

### Not yet started
- 7 of 9 modularization boundaries remain (utilities, core, agents,
  modes, ops-center, workspace, UI) — see PHASE2-MODULARIZE.md's
  roadmap. `/nexus-reliability`, `/nexus-commercial`, `/nexus-research`
  — pending explicit approval per protocol §6.

## [v5.0-polish / Phase 2, boundary 3/9 "utilities"] — 2026-09-18

### Added
- `frontend/modules/utilities.mjs` — third ES module extraction: 11
  general-purpose pure helpers (`evaluateMathExpression`, `chunkText`,
  `agentShortDesc`, `cosineSimilarity`, `parseOneSSEFrame`,
  `estimateQuestionComplexity`, `reEl`, `localTimeStringToUTCHourMinute`,
  `describeRecurrence`, `truncateText`, `wsUid`). Byte-identical to prior
  inline definitions (diff-verified, extraction+verification scripted
  end-to-end).
- `frontend/modules/utilities.test.mjs` — 38 tests, 91.13%/83.01%/
  90.9%/98.27% coverage (stmts/branch/funcs/lines).

### Changed
- Removed the 11 extraction targets from the monolith, replaced with
  pointer comments (27 insertions / 172 deletions across the monolith +
  `main.js`). Explanatory comments that preceded some functions were
  left in place rather than moved.
- `main.js` — added the `utilities.mjs` import and 11 window-bridge
  assignments.

### Regression (full re-run, fresh)
- Backend: 406/406, clean typecheck (untouched).
- Vitest (security + storage + utilities combined): 84/84.
- `e2e/baseline-flows.mjs` (Phase 0): 12/12.
- `e2e/phase1-security-flows.mjs` (Phase 1): 16/16.
- No regression this round.

### Disclosed follow-up (cumulative)
- `sw.js` cache-list additions now needed: `/main.js`,
  `/modules/security.mjs`, `/modules/storage.mjs`, and
  `/modules/utilities.mjs`.

### Not yet started
- 6 of 9 modularization boundaries remain (core, agents, modes,
  ops-center, workspace, UI) — see PHASE2-MODULARIZE.md's roadmap.
  `/nexus-reliability`, `/nexus-commercial`, `/nexus-research` —
  pending explicit approval per protocol §6.

## [v5.0-polish / Phase 2, boundary 4/9 "settings"] — 2026-09-18

### Added
- `frontend/modules/settings.mjs` — fourth ES module extraction: 23
  settings getters/setters (`getBackendUrl`, `getChatModel`,
  `getDeviceId`, `getEnabledExtraProviders`, `getGatewayKey`,
  `getLastKnownSyncVersion`, `getLocalModelName`,
  `getMarketContextCurrency`, `getStoredWebAuthnCredentialId`,
  `getThemePreference`, `getUILang`, `getVoiceLang`, `getVoiceRate`,
  `isCloudSyncEnabled`, `isLongTermMemoryEnabled`,
  `isMarketContextEnabled`, `isThoughtTreeEnabled`, `isToolsEnabled`,
  `isVoiceToVoiceMode`, `isWebAuthnSupported`, `isStandaloneDisplay`,
  `setLastKnownSyncVersion`, `saveLocalModelSetting`). Byte-identical to
  prior inline definitions (diff-verified).
- `frontend/modules/settings.test.mjs` — 32 tests, 98.5%/100%/100%/
  97.77% coverage, including forced-failure tests proving every getter
  degrades to its documented default when `localStorage` throws (Safari
  private browsing, quota exceeded).

### Changed
- Removed the 23 extraction targets from the monolith, replaced with
  pointer comments (52 insertions / 95 deletions across the monolith +
  `main.js`).
- `main.js` — added the `settings.mjs` import and 23 window-bridge
  assignments, placed before the startup-sequence call (3 of these 23
  are called from that sequence: `isCloudSyncEnabled`,
  `getThemePreference`, `getUILang`).

### Regression (full re-run, fresh)
- Backend: 406/406, clean typecheck (untouched).
- Vitest (security + storage + utilities + settings combined): 116/116.
- `e2e/baseline-flows.mjs` (Phase 0): 12/12.
- `e2e/phase1-security-flows.mjs` (Phase 1): 16/16.
- No regression this round.

### Disclosed follow-up (cumulative)
- `sw.js` cache-list additions now needed: `/main.js`,
  `/modules/security.mjs`, `/modules/storage.mjs`,
  `/modules/utilities.mjs`, and `/modules/settings.mjs`.

### Not yet started
- 5 of 9 modularization boundaries remain (core, agents, modes,
  ops-center, workspace, UI-remainder) — see PHASE2-MODULARIZE.md's
  roadmap. `/nexus-reliability`, `/nexus-commercial`, `/nexus-research`
  — pending explicit approval per protocol §6.

## [v5.0-polish / Phase 2 / boundary 5 "core", slice 1] — 2026-10-07

### Changed
- `encryptState` / `decryptState` moved byte-for-byte from the monolith to
  `frontend/modules/security.mjs` (only `export` added); bridged on `window`
  in `main.js` before the startup calls. Behavior, contracts, state
  semantics and initialization order unchanged.

### Added
- 16 Vitest tests (behavior, rejection cases, equivalence with the original
  implementation, golden vector from the original). Total 132.
- `e2e/phase2-core-seed-flows.mjs` — real-Chromium E2E including a real
  persist → reload → restore cycle (16 checks).
- Evidence: `baseline/evidence/phase2-core-slice1-*`.

### Not changed (explicitly)
- `PERSISTABLE_STATE`, the 16 state variables, `NexusContext`,
  `ContextFabric`, ADR-003, `sw.js`, backend.

### Deferred findings (recorded, not acted on)
- ADR-003 wording vs. V8 probe (needs browser-level evidence).
- `NexusContext.buildAgentContext` has no caller in the monolith (static scan).


## [v5.0-polish / Phase 2 / boundary 5 "core", slice 2] — 2026-10-07

Evidence-only slice. **No production code changed** (`frontend/`, `src-baseline/`, `e2e/`,
ADRs, `PHASE2-MODULARIZE.md` are byte-identical to `4c3e169`).

### Added
- `baseline/evidence/phase2-core-slice2-adr003-probe.mjs` — real-Chromium probe runner
  (synthetic classic+module page served from a scratch dir; modules-only control; strictly
  read-only check against the real monolith with SHA-256 / `git status` integrity proof).
- `baseline/evidence/phase2-core-slice2-fixtures/` — synthetic page sources.
- `baseline/evidence/phase2-core-slice2-adr003-probe.log`, `…-probe-results.json`,
  `…-real-readonly-probe.generated.mjs` — raw, reproducible output.
- `docs/checkpoints/CP-8.md`.

### Result (Chromium 141.0.7390.37; 19/19 acceptance checks; identical on re-run)
- Module code reads/writes classic top-level `let` and `var` by bare name; reads `const`
  (write → `TypeError`); `let`/`const` are not on `window`, `var` is; bindings are live in
  both directions; names declared in the module are invisible to classic code.
- Negative controls: undeclared read/write → `ReferenceError`. Modules-only control →
  `ReferenceError` for `let`/`const`/`var`.
- Real monolith (read-only): 56 `let`, 57 `const`, 370 functions all readable from an
  injected module, 0 mismatches vs classic global scope; no files or app state changed.

### Changed
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: slice 2 state, next slice (core
  slice 3, read-only), and a clarification that `PHASE2-MODULARIZE.md`'s "DONE" wording for
  boundaries 1–4 is historical wording from before the six-state vocabulary (the historical
  report was NOT rewritten).

### Not changed / not authorized
- ADR-003 is **unedited**; the bridge pattern is unchanged. The positive browser result does
  not authorize either change; any revision is a separate future decision.


## [v5.0-polish / Phase 2 / Evidence Integrity micro-invariant — inspection] — 2026-10-09

Inspection / evidence / documentation only. **No production code, test, API or UI changed**
(`frontend/`, `src-baseline/`, `e2e/`, ADRs are byte-identical to `0520af7`). Not a new phase;
core slice 3 was not started and is not mixed in. Guard status: **BLOCKED** (owner decisions).

### Added
- `docs/checkpoints/CP-9.md` — seam analysis, data-flow map, measured experiment, required
  decisions, recommended minimal seam, remaining limits.
- `baseline/evidence/phase2-evidence-integrity-baseline-backend-test.log`,
  `…-baseline-typecheck.log` — backend baseline re-measured this session (tsc exit 0; 406/406).
- `baseline/evidence/phase2-evidence-integrity-failclosed-experiment.log` and
  `…-failclosed-experiment.NOT-APPLIED.patch` — scratch experiment (never applied to the tree).

### Findings
- Only producer of the 5-state verdict/confidence: `EvaluationEngine.evaluate()`
  (`evaluationEngine.ts` L82–123); 2 callers (`webResearch.ts:165`, `evaluation.ts:43`).
  Council/Missions use `Verifier` (ok/issues_found), not this engine.
- `EvidenceItem` carries no provenance/kind, so the engine cannot tell Agent outputs from
  independent sources: a latent "agent agreement → upgrade" path exists via
  `POST /v2/evaluation/claim` (code reading; not exercised with a live judge).
- Fail-closed enforcement (scratch only): 3 evaluation-related test files, 24 tests →
  15 pass / 9 fail; the Ops Center UI sends evidence with no kind (code reading).

### Changed
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: Evidence Integrity entry (BLOCKED), new
  commit chain (`HEAD~1` = `0520af7`, `HEAD~2` = `4c3e169`), next-command checkpoint number
  CP-9 → CP-10 for core slice 3.

## 2026-11-14 — Operational Test Build (owner full-authorization mandate)
Status: VERIFIED within the limits in `docs/OPERATIONAL-BUILD.md` (simulated models only; no real provider/device/TLS).
### Added
- Baseline `G8.2-CLOSURE` snapshot committed (`4dbe45b`); approved five-file patch F-UI-1/F-UI-2 applied (`1145a41`).
- `scripts/nexus-run.mjs`, `scripts/verify-all.sh`, root `package.json`, `e2e/operational-scenarios.mjs` (38 checks), `e2e/launcher-ui-demo.mjs`.
- MCP server `POST /mcp` (read-only, pure tools; ADR-006) + `test/mcpServer.test.ts` (RED 0/10 → GREEN 10/10) + scenario S8.
- `docs/OPERATIONAL-BUILD.md`, `docs/IP-LICENSE-SECURITY-DELTA-2026-11-14.md`, `ADR/006-mcp-server-readonly.md`.
### Changed
- F-01: `/api/embed` no longer `skipAuth`; frontend sends Bearer key; error message no longer `[object Object]`.
- `tsx 4.23.12` declared as pinned devDependency; four E2E scripts resolve paths relative to the script.
- `src/tools/pipeline.ts`: caller type `'mcp'` (skips the per-provider capability check only; effectful tools refused for `'mcp'`).
### Verified (fresh, clean install)
- Backend 638/638, Vitest 186/186, E2E 17 scripts ACCEPTED, scenarios 38/38, UI demo 7/7. `npm audit` backend 0; frontend 6 dev-only advisories.
### Not changed / limits
- Nothing deployed or published; no license added; A2A and Connector SDK PENDING; open findings F-03…F-06 undecided.

## 2026-10-09 — Phase 2 / boundary 5 core, slice 3 (read-only state map; docs/evidence only)

Status: slice 3 **VERIFIED** as a static read-only map (runtime behavior UNVERIFIED); core **PARTIAL**; Phase 2 **PARTIAL**;
Evidence Integrity unchanged (**BLOCKED**). No production code, test, ADR or contract changed
(`frontend/`, `src-baseline/`, `e2e/`, ADRs, `PHASE2-MODULARIZE.md` identical to `b9d4808`).

### Added
- `docs/checkpoints/CP-10.md` — facts vs inferences, per-variable table, candidate seams, limits.
- `baseline/evidence/phase2-core-slice3-state-map.mjs` (+ `.log`, `-results.json`) — deterministic acorn-based analyzer, 22/22 self-checks.
- `baseline/evidence/phase2-core-slice3-regression-*.log` — fresh Vitest 132/132 and E2E 12/16/16.

### Findings
- 16 col-0 classic `let`s; registry defaults equal initializers (16/16); `errorLog` declared after `PERSISTABLE_STATE` (TDZ-safe today).
- 32 rebind sites outside registry setters, 47 writer units, 85 reader units; `restorePersistableState` has 3 callers; `persistState` has 38 caller units and splices `messages` before snapshotting.
- 0 inline handlers reference the variables directly; E2E assigns `messages` by bare name (test coupling).
- Analyzer corrections recorded honestly: refuted "all declared before the registry" assumption; fixed 2 handler false positives.
- Inference (not exercised): offline-boot `activityLog` write may be overwritten by the later restore.

### Changed
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: slice 3 result, commit chain (`HEAD~1`=`b9d4808`), E2E environment lessons, next slice proposed (C1, PENDING), next-command CP-10 → CP-11.


## 2026-10-10 — Phase 2 / boundary 5 core, slice 4 / C1 (registry-parameter snapshot/restore/reset)

Status: slice 4 / C1 **VERIFIED** (Chromium 141 only); core **PARTIAL**; Phase 2 **PARTIAL**; Evidence Integrity unchanged (**BLOCKED**).
`PERSISTABLE_STATE`, its 16 variables, `persistState`, `autoInitApp`, `resetAllData` and ADR-003 are byte-identical to `9c95fbd`.

### Added
- `snapshotPersistableState(registry)` / `restorePersistableState(registry, decrypted)` / `resetPersistableState(registry)` at the end of `frontend/modules/storage.mjs`
  (original bodies; `export` added, `PERSISTABLE_STATE`→`registry`, parameter added — proved byte-level).
- `window.PersistableStateCore` bridge in `frontend/main.js` (namespaced; the plain names stay as one-line classic wrappers in the monolith).
- `frontend/modules/persistable-state.test.mjs` (36 tests incl. a differential test against the verbatim original), `e2e/phase2-core-slice4-flows.mjs` (21 checks through the real `autoInitApp`).
- `docs/checkpoints/CP-11.md`; `baseline/evidence/phase2-core-slice4-*` (acceptance criteria written before the patch, extraction/exec-order/mutation scripts + results, PRE/POST logs).

### Changed
- Monolith: the 3 function bodies (old L4953–4966) replaced by 3 one-line wrappers with the original names/signatures. `main.js`: import line, header sentence, bridge line.
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: slice 4 result, chain (`HEAD~1`=`9c95fbd`), next slice (core slice 5, evidence-only, PENDING).

### Verified (fresh)
- Extraction proof 17/17; Vitest 168/168; E2E 12/12, 16/16, 16/16 and new 21/21 (19/21 pre-patch); mutation 16/16 killed; exec-order 9/9; backend `tsc --noEmit` exit 0 and `npm test` 406/406 (confirmatory).

### Not changed / limits
- Shallow snapshot and by-reference restore preserved as-is (characterized, not protected). I-1 untested. `sw.js` still unavailable (no new module file added). ADR-003 wording unrevised.

## 2026-10-10 — Phase 2 / boundary 5 core, slice 5 (runtime test of I-1; evidence/test only, no production change)

Status: slice 5 **VERIFIED** (evidence-only; Chromium 141 + emulated offline only); I-1 **CONFIRMED — LOST**; core **PARTIAL**; Phase 2 **PARTIAL**; Evidence Integrity unchanged (**BLOCKED**).
No production file changed (frontend/ tree sha256 identical before/after; `git diff --stat HEAD -- frontend src-baseline ADR PHASE2-MODULARIZE.md` empty). PATCH not executed; handling of I-1 is PENDING (owner).

### Added
- `e2e/phase2-core-slice5-flows.mjs` — real-Chromium runtime test of I-1 (controls, plain + traced variants, `[OBSERVED]` outcome, results JSON). 27/27 validity checks; `I1-VERDICT = LOST`.
- `baseline/evidence/phase2-core-slice5-mutation-script.mjs` — 3 scratch mutants on tmp copies (M1 reorder → SURVIVES; M2/M3 sabotage → INCONCLUSIVE); 3/3 as expected; production untouched.
- `docs/checkpoints/CP-12.md`; `baseline/evidence/phase2-core-slice5-*` (PRE/POST E2E logs, run log, results JSON, mutation log/results, code-sha256).

### Findings
- Offline boot with a persisted blob: the boot-time `انقطع الاتصال` entry is overwritten by `restorePersistableState` (5/5 plain, 3/3 traced; blob without the key → `[]`); with no blob it survives; a post-boot `offline` event survives; the `#activityList` DOM keeps showing the entry while memory lacks it.

### Changed
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: slice 5 result, chain (`HEAD~1`=`669386b`), owner-decision list (no auto-approved next slice), next-command rewritten.

### Verified (fresh)
- E2E 12/12, 16/16, 16/16, 21/21 (PRE and POST), Vitest 168/168, backend `npm ci` + `npm run build` exit 0. NOT run: backend `tsc`/`npm test`, slice 2/3/4 evidence scripts.

### Not changed / limits
- `PERSISTABLE_STATE`, ADR-003, C2/C3, Evidence Integrity untouched. Chromium-only; `sw.js` still unavailable; only `activityLog` tested.

## 2026-10-10 — Phase 2 / boundary 5 core, slice 6 (I-1 handled via O2: `updateOnlineStatus()` after `autoInitApp()` settles)

Status: slice 6 **VERIFIED** (Chromium 141 headless + emulated offline only); I-1 handled for the `activityLog` boot entry (other variables UNVERIFIED); core **PARTIAL**; Phase 2 **PARTIAL**; Evidence Integrity unchanged (**BLOCKED**).
Production change: `frontend/main.js` startup tail only (+6/−2). C2/C3, `PERSISTABLE_STATE`, ADR-003, backend, HTML, modules untouched.

### Added
- `e2e/phase2-core-slice6-flows.mjs` — acceptance tests tagged VALID/PRES/PS (35 checks; gate-held init window, injected `autoInitApp` rejection, traced ordering, online/offline/no-blob/corrupt-blob boots). Unpatched tree: 24/35 REJECTED (PS 0/11); patched: 35/35 ACCEPTED.
- `baseline/evidence/phase2-core-slice6-*`: acceptance criteria (written before the patch), mutation script (K1–K6, 6/6 caught), PRE/POST logs and results, banner-delay observation, sha256 lists.
- `docs/checkpoints/CP-13.md`.

### Changed
- `frontend/main.js`: `const bootInit = window.autoInitApp(); … bootInit.finally(() => window.updateOnlineStatus());` (rejection still unhandled/visible; `registerServiceWorker` order unchanged).
- Evidence tooling adapted minimally after measuring the breakage: slice 4 exec-order A7 matcher, slice 4 extract P5 (reverses the slice 6 block first), slice 3 analyzer startup scan (collects nested `window.X()` startup calls), slice 5 mutation M1 (relative to the tree) + `NEXUS_S5_MUT_RESULTS`.
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: slice 6 result, chain (`HEAD~1`=`fbd7236`), pending owner decisions (I-1 closed), expected numbers.

### Verified (fresh)
- E2E 12/12, 16/16, 16/16, 21/21; slice 5 script 27/27 (`SURVIVES`); Vitest 168/168; slice 5 mutants 3/3; slice 4 exec-order 9/9, unit-vs-original 36/36; slice 3 analyzer 22/22 and slice 2 probe 19/19 (clean tree).

### Not changed / limits
- Offline banner now appears after init completes (median ≈ +19…+39 ms headless; real devices UNVERIFIED). Slice 4 `verify 9c95fbd` P7 still 16/17 (time-bound; same on clean `fbd7236`). Not run: backend `tsc`/`npm test`, slice 4 mutation script, slice 1 extract script.
- Erratum to CP-12 §6 (send button not disabled by `updateOnlineStatus`). Static finding, unrun and untouched: `isSendingMessage` left `true` by `sendMessage`'s offline early return (CP-13 §8).

## 2026-10-11 — Phase 2 / boundary 5 core, slice 7 (evidence-only: `isSendingMessage` after an offline send attempt — CONFIRMED STUCK, not fixed)

Status: slice 7 **VERIFIED** as an evidence-only slice (Chromium 141 headless + emulated offline only); finding of CP-13 §8 **CONFIRMED** (`S7-VERDICT = STUCK`, 4/4 runs, 47/47 validity); core **PARTIAL**; Phase 2 **PARTIAL**; Evidence Integrity unchanged (**BLOCKED**).
Production change: **none** (frontend sha256 identical before/after; `git diff --stat HEAD -- frontend src-baseline ADR PHASE2-MODULARIZE.md` empty). C2/C3, `PERSISTABLE_STATE`, ADR-003 untouched.

### Added
- `e2e/phase2-core-slice7-flows.mjs` — runtime test (controls: normal online send; offline period without an attempt; offline attempt → reconnect → follow-up via click ×3 and Enter ×1; causal flag-reset check; reload recovery; silent second offline attempt). Reports the outcome as `[OBSERVED]`, verdict `STUCK | NOT-STUCK | INCONCLUSIVE`.
- `baseline/evidence/phase2-core-slice7-*`: acceptance criteria (written before the script), mutation script (CTRL, M1/M4 candidate fixes → NOT-STUCK, M2/M3 → INCONCLUSIVE; 5/5), run/mutation logs and results, PRE logs of every re-measured check, flaky-check probe.
- `docs/checkpoints/CP-14.md`.

### Changed
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: slice 7 result, chain (`HEAD~1`=`5770104`), the finding upgraded from "static, UNVERIFIED" to "CONFIRMED, NOT FIXED", owner decision (d) (fix slice A/B; seed-flows tools fix), next command rewritten.

### Verified (fresh)
- Backend `tsc --noEmit` exit 0 and `npm test` 406/406; slice 4 mutation 16/16 killed, 0 survivors; Vitest 168/168; E2E 12/12, 16/16, 21/21, slice 5 27/27 (`SURVIVES`), slice 6 35/35; slice 2 probe 19/19 and slice 3 analyzer 22/22 (clean production tree); exec-order 9/9; unit-vs-original 36/36; slice 4 `verify 9c95fbd` 16/17 (P7 time-bound).

### Found (evidence tooling, not product)
- `e2e/phase2-core-seed-flows.mjs` check `ciphertext-hides-plaintext` is intermittent (≈3.5% false failure: `!payload.data.includes('42')` on random base64; measured 700/20000 and 691/20000; 8/8 reruns 16/16). Not edited.

### Not changed / limits
- No fix for `isSendingMessage` applied (owner decision; candidates validated on scratch mutants only). Chromium-only; `sw.js` still unavailable; other exceptions between the flag set and the `try` are static notes (UNVERIFIED). Slice 1 extract script not run (one-shot migration, N/A).

## 2026-10-11 — Phase 2 / boundary 5 core, slice 8 (fix: stuck `isSendingMessage` in `sendMessage()`)

Status: slice 8 **VERIFIED** (Chromium 141 headless + emulated offline + injected faults only); the defect confirmed by slice 7 is **FIXED / VERIFIED within those limits**; core **PARTIAL**; Phase 2 **PARTIAL**; Evidence Integrity unchanged (**BLOCKED**).
Production change: `frontend/neural_nexus_ai_agents-4-3-5-3.html`, `sendMessage()` only (+5/−2): `try{` now starts right after `isSendingMessage = true;`, `let taskOutcome = 'ok';` hoisted above it (candidate F3; no statement reordered). `main.js`, modules, backend, ADR, `PERSISTABLE_STATE`, C2/C3 untouched.

### Added
- `e2e/phase2-core-slice8-flows.mjs` — acceptance (79 checks: VALID 44, PRES 12, PS 23; click and Enter, offline→reconnect, repeated offline attempts, double/in-flight sends, offline mid-flight, faults E1–E4). PRE `389813f` 56/79 REJECTED (PS 0/23); POST 79/79 ACCEPTED.
- `baseline/evidence/phase2-core-slice8-*`: acceptance criteria (written before the patch, with post-measurement notes), candidates script (F1 REJECTED PS 7/23, F2/F3 ACCEPTED), mutation script (7/7: CTRL ACCEPTED, K1–K4 REJECTED, K5/K6 INVALID), PRE/POST logs and results, sha256 lists.
- `docs/checkpoints/CP-15.md`.

### Changed
- Intentional behavior: an offline send attempt no longer leaves the lock set; a failure in the preparation code (`ImageStore.save`, `resolveActiveMode`, `startTask`, missing DOM element) is now handled by the existing `catch` (error message, `logActivity`, `logError`; lock and button released).
- Evidence tooling adapted after measuring breakage: slice 4 extract-script P2b reverses the slice 8 block (15/17 → 16/17, only time-bound P7); slice 7 mutation script and slice 8 candidates script got a preflight (exit 2 on a patched tree).
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: slice 8 result, chain (`HEAD~1`=`389813f`), decision (d) closed, expected numbers, lessons, next command.

### Verified (fresh)
- Slice 7 script on the patched tree: NOT-STUCK 40/40. Vitest 168/168; E2E 12/16/16/21, slice 5 27 (`SURVIVES`), slice 6 35; backend `tsc --noEmit` exit 0 and `npm test` 406/406; slice 2 probe 19/19, slice 3 analyzer 22/22 (clean committed tree); exec-order 9/9; unit-vs-original 36/36; slice 4 mutation 16/16 (0 survivors); slice 4 `verify 9c95fbd` 16/17 (P7 time-bound).

### Not changed / limits
- UNVERIFIED: streaming/`AbortError` branch (needs a real backend stream), real devices, Firefox/Safari, `sw.js`, exceptions inside `catch`/`finally`. Fault injection models, does not prove, field faults. Intermittent seed-flows check (CP-14 §E-1) not edited. First-run K6 prediction was wrong (INVALID, not REJECTED) — log kept.

## 2026-10-11 — Evidence Integrity guard (CP-16; SEPARATE from core: fail-closed Evidence Deltas, explicit kind in the Ops Center, `integrityReason` via migration 016, ADR-004)

Status: Evidence Integrity **VERIFIED within its limits** (backend with a deterministic fake judge; UI in Chromium 141 headless against a fake HTTPS backend origin; no real LLM, no real web fetch, no other browsers/devices); was BLOCKED on the owner decisions of CP-9 §4, given 2026-10-11. Core **PARTIAL** (untouched); Phase 2 **PARTIAL**.
Production change: backend `evaluationEngine.ts`, `routes/v2/evaluation.ts`, `webResearch.ts` (`buildResearchEvidence`), `claimEvaluationRepo.ts`, additive migration `016_claim_evaluation_integrity_reason.sql`; `frontend/neural_nexus_ai_agents-4-3-5-3.html` claim-evaluation form of the Ops Center only (+16/−2, no new top-level declaration). `main.js`, modules, `PERSISTABLE_STATE`, C2/C3, ADR-003: untouched.

### Added
- `ADR/004-evidence-integrity.md`; `docs/checkpoints/CP-16.md`; `baseline/evidence/phase2-evidence-integrity-acceptance-criteria.md` (written BEFORE the change).
- `test/evidenceIntegrity.test.ts` (+ helper `test/helpers/openDbAndDump.ts`; real-runner migration upgrade test in a child process) and 1 test in `test/webResearch.test.ts` (66 new tests, 27 of them `[SEC]` security tests AC-S1..S6, added after the first implementation pass); `e2e/phase2-evidence-integrity-flows.mjs` (26 checks: VALID 4, PRES 6, PS 16); `baseline/evidence/phase2-evidence-integrity-mutation-script.mjs`; PRE/POST/IMPACT logs `baseline/evidence/phase2-evidence-integrity-*`.
- Behavior: an `EvidenceItem` without a valid declared `kind` is not evidence (deterministic `UNVERIFIED / CONSENSUS_ONLY`, no provider call); only deltas reach the judge; a declared `CONTRADICTORY_EVIDENCE` delta lowers VERIFIED/SUPPORTED to CONFLICTING (confidence null; the guard never raises); `integrityReason` (`NO_EVIDENCE | CONSENSUS_ONLY | INDEPENDENT_EVIDENCE | EXECUTABLE_VERIFICATION | CONTRADICTORY_EVIDENCE`, null for `ran:false`) is returned, persisted and read back; the Ops Center requires an explicit kind per evidence row (no default, submit blocked as a whole).

### Changed
- Existing contract (accepted by the owner decisions): `POST /v2/evaluation/claim` without `kind` ⇒ 200 `UNVERIFIED / CONSENSUS_ONLY`. Fixtures of 11 existing tests gained `kind: 'INDEPENDENT_SOURCE'` (measured impact before editing: 11, not CP-9's 9 — `productionHardening` and `resilience` also call `evaluate()`); no assertion was changed.
- Evidence tooling adapted after measuring: slice 4 `extract-script` P2b reverses the 4 UI hunks first (14/17 → 15/17); P7b is time-bound like P7 and was left failing on purpose.
- `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`: Evidence Integrity result, chain (`HEAD~1`=`b811065`), expected numbers, lessons, next command.

### Verified (fresh)
- PRE (`b811065`): new backend tests 13 pass / 35 fail (all PS), UI 10/26 REJECTED. POST: backend `tsc --noEmit` exit 0 and `npm test` 472/472; UI 26/26 ACCEPTED; Vitest 168/168; E2E 12/16/21, seed-flows 16/16 (15/16 on the first run: known E-1, 6/6 reruns 16/16), slice 5 27 (`SURVIVES`), slice 6 35, slice 7 40 (`NOT-STUCK`), slice 8 79 (`ACCEPTED`); slice 2 probe 19/19, slice 3 analyzer 22/22 (clean committed tree), exec-order 9/9, unit-vs-original pass, slice 4 `verify` 15/17 (P7, P7b time-bound); mutation: EI 35/35 as expected (34 killed + documented survivor W3), slice 4 16/16 (0 survivors), slice 5 3/3, slice 6 6/6, slice 8 7/7.

### Not changed / limits
- UNVERIFIED: real judge / real web fetch (the SSRF guard makes `fetchOk:true` unreachable in tests — mutant W3 survives), other browsers/devices, a click through the real Ops Center tab, visual/RTL check. `kind` is declared, not verified; no mirror/same-domain independence check; no promotion over time; `Verifier`/council/missions untouched. Not run: slice 7 mutation (pre-fix-bound), slice 1 extract (one-shot).

## 2026-10-12 — Phase 2 / boundary 5 core, slice 9 (C2/C3 ownership decision preparation by measurement + ADR-003 review; evidence/docs only)
Status: VERIFIED as an evidence/docs-only slice (Chromium 141 headless, scratch prototypes). **C2/C3 ownership mechanism: BLOCKED on owner decisions D1–D4 (CP-17 §3).** Production change: **none** (sha256 of the monolith and `main.js` identical; `git diff -- frontend src-baseline e2e` empty).
### Added
- `baseline/evidence/phase2-core-slice9-ownership-acceptance-criteria.md` (written before any measurement, incl. the materiality rule M1–M4; results appended after), `…-ownership-prototypes.mjs` (scratch-clone runner: CTRL, PA explicit store, PB global-accessor shim, MUT-PA, MUT-PB, PB-C3), `…-ownership-probe.mjs` (agentOrder behavior probe, 8 checks), results JSON + log, PRE/POST logs, `docs/checkpoints/CP-17.md`.
- `ADR/003-phase2-storage-boundary.md`: append-only Erratum (Decision unchanged; Status line points to it): claims #2/#3 contradicted by CP-8/CP-11, #5 mechanism-dependent, #6 (registry "already references ImageStore/MessageArchive/localStore") found wrong — 0 matches at `e58dab9`, `dd3c3a7`, HEAD.
### Verified (fresh)
- PRE == POST: Vitest 168/168; E2E 12/16/16/21; slices 5–8 27/35/40/79; slice 3 analyzer 22/22; slice 2 probe 19/19; exec-order 9/9; slice 4 verify 15/17 (P7, P7b time-bound).
- Prototype matrix: PA (+8/−5) Vitest 166/168, slice4 17/21; PB (+7/−1) all green; PB-C3 (+10/−2) all green incl. slices 5–8; probe 8/8 on CTRL/PA/PB/PB-C3, MUT-PA/MUT-PB 6/8. Predictions P1, P3 partly wrong (CP-17 §2).
### Not changed / limits
- `PERSISTABLE_STATE`, the 16 variables, `main.js`, modules, tests, backend, Evidence Integrity: untouched. Chromium only; PB on 3 of 16 variables, PA on 1; backend `tsc`/`npm test` not run (untouched). No commit/ZIP created. Phase 2 remains PARTIAL.

## 2026-10-13 — Phase 2 / boundary 5 core, slice 10 (C2 pilot: `agentOrder` ownership via global accessor; ADR-005)
Status: VERIFIED for the local behavior of the pilot (Chromium 141 headless); release **BLOCKED/UNVERIFIED on `sw.js`** (not provided: its cache list must gain `/modules/state.mjs`). Production change (UNCOMMITTED): monolith +1/−1 (declaration line → pointer comment), `frontend/main.js` +5/−0, new `frontend/modules/state.mjs`, new `frontend/modules/state.test.mjs` (10 tests). `messages`, `selectedAgentIds` and the other 13 variables untouched; `PERSISTABLE_STATE` text unchanged; D2 (owner module) assumed = `state.mjs`.
### Added
- `ADR/005-global-accessor-state-ownership.md`, `docs/checkpoints/CP-18.md`, `e2e/phase2-core-slice10-flows.mjs`, `baseline/evidence/phase2-core-slice10-*` (frozen criteria with appended results, PRE/POST logs, compare + mutation scripts, results JSON).
### Changed (evidence tools, minimal and logged)
- `phase2-core-slice4-extract-script.mjs` verify: undoes the slice 10 hunks before its byte-for-byte proofs (P2b, P5, P6b), same precedent as slice 6/8/EI. `phase2-core-slice3-state-map.mjs`: `S10_OWNED` set + a new check, null-guards (it crashed on the removed declaration); control on unmodified HEAD fails only the new check (22/23).
### Verified (fresh)
- backend tsc 0 / 472; Vitest 178; E2E 12/16/16/21 (seed-flows E-1 flake once, re-run 16/16); slices 5–8 27/35/40/79; EI UI 26/26; slice 10 E2E PRE REJECTED (PS 0/7) → POST ACCEPTED 28/28; compare 11/11; slice 2 probe 19/19; slice 3 analyzer 23/23; slice 4 verify 15/17; mutation: M1–M3, M5–M8 killed, **M4 survives all runtime checks (static check only)**; slice 4/5/6/8 mutation 16/16, 3/3, 6/6, 7/7; slice 7 mutation N/A.
### Not verified / limits
- `sw.js`; Firefox/Safari/devices; named-access collision (inference); `window.agentOrder` exposure precedent for sensitive variables (ADR-005 R2). No commit/ZIP created. Phase 2 remains PARTIAL.

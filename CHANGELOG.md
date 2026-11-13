# CHANGELOG.md

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

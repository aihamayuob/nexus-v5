# PHASE2-MODULARIZE.md — NEXUS v5.0, Phase 2 (/nexus-modularize)

**Overall Phase 2 status: PARTIAL** — 4 of 9 protocol-named boundaries
(core, agents, modes, security, storage, UI, ops-center, workspace,
utilities) extracted and fully verified this round. The other 5 are
explicitly PENDING (see Roadmap below), not silently deferred.

**This round's scope ("security" boundary): DONE**, per protocol's own
2a→2b→2c sub-phases, all completed and verified.

## Why "security" first (INSPECT → MAP)

Built a real dependency graph across all 410 top-level functions in the
monolith (scripted analysis, not manual reading — see
`/tmp`-generated inventories referenced in this session). Selected the
lowest-risk possible starting boundary by three objective, checked
criteria:
1. Zero dependencies on mutable application state (`messages`,
   `customAgents`, etc.) — confirmed via dependency-graph script.
2. Zero references from any of the 168 inline HTML event-handler
   attributes — confirmed via a separate scripted cross-reference.
3. Zero true top-level (execute-immediately, outside any function)
   references anywhere in the file — confirmed via a line-scan script.

This also happens to be exactly what protocol §11 asks Phase 2 to test
first ("اختبر خصوصاً: crypto, escaping/XSS ... injection guard") —
`escapeHtml`, `jsStr`, `deriveKey`, `b64ToBuf`, `bufToB64`,
`PromptInjectionGuard`.

## 2a — Extract modules only (behavior-preserving move)

- New file: `frontend/modules/security.mjs`. Every function body is
  **byte-identical** to its prior inline definition — verified with a
  diff script comparing the extracted source against the original
  (character-for-character match on all 6 items, not eyeballed).
- Removed the 6 originals from the monolith, replaced with short pointer
  comments (matches this file's own established practice of leaving a
  trail for future readers, e.g. Phase 1's "MOVED"/"SECURITY FIX" comment
  style).
- `git diff --stat` on the monolith: **23 insertions, 91 deletions** (net
  shrink, as expected — pointer comments are much shorter than the moved
  function bodies).

## A real regression, caught and fixed (not swept aside)

First pass broke `chat-send`: `ReferenceError: jsStr is not defined`,
also `bufToB64 is not defined`. Root cause, fully diagnosed via a direct
Playwright debug session (not guessed): the monolith's classic `<script>>`
had **five top-level statements** —
```js
applyTheme();
applyTranslations();
autoInitApp();
registerServiceWorker();
updateOnlineStatus();
```
— that execute synchronously and immediately as the parser reaches them,
**before** the deferred `<script type="module" src="main.js">` has a
chance to run and set `window.jsStr` / `window.bufToB64` etc. My original
"top-level execution safety" check (Phase 0/1 style: scan for direct
top-level calls to the extraction candidates) only checked *direct* calls
— it missed this *indirect* path (`autoInitApp()` transitively calling
`bufToB64`).

**Fix**: moved this exact 5-call sequence, in the exact same order, into
`main.js`, executed right after the window-bridge assignments. This is
not a workaround — it is precisely what protocol §11 asks `main.js` to
be ("bootstrap/orchestration entry point"). Timing impact: negligible —
these calls previously ran as the very last statements before `</body>`;
they now run a few milliseconds later, after the module resolves, still
before `DOMContentLoaded`/`load`. No user-visible behavior change.

Per protocol §4 ("أي فرق غير مبرر = REVERT → LABEL AS REGRESSION →
DIAGNOSE"): this regression **was** explained (root cause fully
identified, not guessed) before being fixed, so a revert was not
required — the fix was applied and then independently re-verified against
all three test suites below.

## 2b — Tests for the new boundary

- `frontend/package.json` (new) + Vitest 4.1.11 + jsdom, per protocol's
  explicit requirement. Pinned to `4.1.11` specifically (not the default
  `^2.x` resolution) after `npm audit` flagged `@vitest/mocker`/`esbuild`
  advisories in the dev-server toolchain at lower versions — `4.1.11` is
  the first patched release on the 4.x line, avoiding an unnecessary
  breaking jump to `5.x`. **0 vulnerabilities**, confirmed.
- `frontend/modules/security.test.mjs` — **19 tests**, all real
  behavioral checks (round-trip encryption correctness, the exact
  HTML-attribute-decode-then-JS-parse property `jsStr` exists to
  guarantee, injection-pattern detection in both languages, fence()
  logging/error-tolerance) — not line-padding.
- Coverage: **95.83% statements, 100% functions, 100% lines, 85.71%
  branch** on `security.mjs` — comfortably over the ≥70% "meaningful
  coverage" bar, and meaningful by construction (each test asserts a real
  property, not just calls-for-coverage's-sake).
- One genuine jsdom environment limitation hit and worked around
  correctly (not silently patched over): jsdom compiles inline
  `onclick="..."` attribute content in a different realm than test code,
  so `window.X = fn; element.click()` doesn't see `X`. Confirmed via a
  minimal reproduction with a trivial function (not just my own code)
  before concluding it was jsdom's behavior, not a bug in `jsStr`.
  Rewrote the two affected tests to verify the same real property
  directly (HTML-attribute decode via `getAttribute()`, then execute the
  decoded source via `new Function()`) — a jsdom quirk, not a gap in what
  was actually tested; the full real-browser path is additionally
  covered by 2c's E2E re-runs below.

## 2c — Wiring via main.js

- New file: `frontend/main.js` — imports the 6 exports from
  `security.mjs`, assigns each to `window`, then runs the startup
  sequence (see regression fix above). Contains no application logic of
  its own.
- Added `<script type="module" src="main.js"></script>` to the HTML,
  placed before the (now-smaller) classic script.

## Regression verification (full three-suite re-run, fresh)

| Suite | Result | Evidence |
|---|---|---|
| Backend `npm run typecheck` + `npm test` (untouched, re-verified anyway) | Clean / **406/406** | unchanged from Phase 1 |
| New: `npx vitest run --coverage` (frontend) | **19/19**, 95.83%/100%/100%/85.71% | `baseline/evidence/phase2-vitest-run.log` |
| `e2e/baseline-flows.mjs` (Phase 0 flows, re-run against modularized HTML) | **12/12** | `baseline/evidence/phase2-baseline-e2e-rerun.log` |
| `e2e/phase1-security-flows.mjs` (Phase 1 flows, re-run against modularized HTML) | **16/16** | `baseline/evidence/phase2-phase1-e2e-rerun.log` |
| `node --check` on the extracted monolith script | Clean | this session |
| `node --input-type=module -e "import(...security.mjs...)"` | Imports cleanly, all 6 exports present | this session |

Both e2e scripts' static file servers were extended to serve the whole
`frontend/` directory (not just the one HTML file) with correct
`text/javascript` MIME types for `.js`/`.mjs` — required for the browser
to actually fetch `main.js` and `modules/security.mjs` as real module
resources, not a behavior change to the app itself.

## PWA / legacy-compatibility considerations (disclosed, not swept aside)

- **`sw.js` cache manifest**: the app is no longer strictly a single
  file — `main.js` and `modules/security.mjs` must be added to the
  service worker's precache list for offline/PWA support to keep working
  for these two new files. `sw.js` was **not** among the three uploaded
  artifacts (confirmed in Phase 0's INVENTORY.md), so it cannot be edited
  here. **Required manual follow-up**: add `/main.js` and
  `/modules/security.mjs` to `sw.js`'s cache list before deploying this
  build. Flagged here explicitly rather than assumed away.
- **`file://` local usage**: ES module `import` requires HTTP(S), not
  `file://`, due to browser CORS rules on module fetch. This is **not a
  new constraint** — the app already required HTTP(S) for its service
  worker registration, its configurable-backend `fetch()` calls, and (in
  most browsers) reliable IndexedDB behavior under `file://`. No
  regression to a previously-working deployment mode.
- **168 inline `onclick="..."` handlers**: none reference any of the 6
  extracted security-boundary items directly (confirmed via the same
  cross-reference script used for boundary selection), so no inline
  handler needed updating this round. Later boundaries (e.g. "UI") will
  contain functions that ARE referenced inline — the same window-bridge
  pattern established here handles that identically when it comes up.

## Boundary 2 — "storage" (2026-09-17)

**Status: DONE** (this boundary only — overall Phase 2 remains PARTIAL,
7 of 9 boundaries now remain).

### INSPECT → MAP
Ran the same dependency-graph script against the 5 originally-roadmapped
storage candidates. Result: `localStore`, `ExecutionCheckpoint`,
`ImageStore`, `MessageArchive` had zero or external-only (still-global)
dependencies. `PERSISTABLE_STATE` closes over 16 scattered top-level
state variables and cannot move the same way without either an unsafe
cross-script reference trick or folding in most of "core"/"agents"/
"workspace" at once — see **ADR/003-phase2-storage-boundary.md** for the
full reasoning. Decision: extract the four, defer `PERSISTABLE_STATE`
explicitly (not silently).

### DIAGNOSE (top-level execution-order check — applied more rigorously this time)
Learned from boundary 1's regression: checked not just direct top-level
calls but the transitive chain through `autoInitApp()` (now centralized
in `main.js` after boundary 1's fix). Confirmed `autoInitApp()` directly
calls `localStore.get/set/delete`, `ExecutionCheckpoint.checkForResumable()`,
`ImageStore.gcAll()`, and `MessageArchive.clear()`. Because boundary 1
already made `main.js` own the startup sequence, the fix was simply:
add this boundary's bridge assignments to `main.js` *before* the
existing `window.autoInitApp()` call — no new regression this round.

### PATCH (2a)
- New file: `frontend/modules/storage.mjs` — all 4 items confirmed
  **byte-identical** to their pre-extraction source via the same diff
  script used for boundary 1.
- Removed the 4 originals from the monolith, replaced with pointer
  comments.
- `git diff --stat`: monolith + `main.js` combined = **15 insertions,
  190 deletions**.

### 2b — Tests
- New `frontend/modules/storage.test.mjs` — **27 tests**. Added
  `fake-indexeddb` (0 new vulnerabilities) specifically because
  `window.storage` only exists inside Claude's own artifact-preview
  environment — it is **undefined in Aiham's actual deployed app** — so
  the branch that matters for production is the raw `indexedDB.open()`
  path, and that's the one these tests exercise by default (a separate
  describe block also covers the `window.storage` branch with mocks, for
  completeness).
- Coverage on `storage.mjs`: **89.2% statements / 82.6% branch / 86.11%
  functions / 96% lines**. Remaining uncovered lines are exclusively
  `console.error(...)` calls inside non-fatal catch blocks (defensive
  logging for storage-write failures) — chasing 100% there would be
  coverage-for-its-own-sake, not meaningful.
- Combined suite (security + storage): **46/46 passing**.

### 2c — main.js wiring
Added the `storage.mjs` import and 4 window-bridge assignments to
`main.js`, placed before the existing startup-sequence call (see
DIAGNOSE above for why order matters here).

### Regression (full 3-suite re-run, fresh)
| Suite | Result | Evidence |
|---|---|---|
| Backend `npm run typecheck` + `npm test` | Clean / **406/406** | unchanged |
| Vitest (security + storage) | **46/46**, coverage above | `baseline/evidence/phase2-boundary2-vitest-run.log` |
| `e2e/baseline-flows.mjs` (Phase 0) | **12/12** | `baseline/evidence/phase2-boundary2-baseline-e2e.log` |
| `e2e/phase1-security-flows.mjs` (Phase 1) | **16/16** — exercises ImageStore/MessageArchive through real app flows, not just unit tests | `baseline/evidence/phase2-boundary2-phase1-e2e.log` |

No regression this round — the ordering lesson from boundary 1 was
applied proactively rather than rediscovered.

### PWA follow-up (unchanged from boundary 1, now covers one more file)
`sw.js`'s required cache-list additions are now: `/main.js`,
`/modules/security.mjs`, **and `/modules/storage.mjs`**. Still not
editable here (not among the provided artifacts) — tracked, not
forgotten, and will accumulate one more entry per future boundary until
Aiham (or a phase with access to the real `sw.js`) applies the full list
before deploy.

## Boundary 3 — "utilities" (2026-09-18)

**Status: DONE** (this boundary only — overall Phase 2 remains PARTIAL,
6 of 9 boundaries now remain).

### INSPECT → MAP
Rebuilt the leaf-function scan against the current (post boundary-1/2)
file: 76 fully self-contained functions. Rather than extract all 76 at
once (which would blur "utilities" into "everything with no
dependencies" and risk a de-facto broad rewrite), categorized them by
what they actually do:
- **General-purpose, domain-agnostic pure helpers** (11 functions) — the
  actual "utilities" category: text/math/time utilities plus one tiny
  DOM-element constructor.
- Settings getters (`getBackendUrl`, `isToolsEnabled`, etc., ~22
  functions) — deferred to a later "UI"/settings-adjacent pass; simple
  and safe, but a different category.
- UI chrome helpers (`closeModal`, `showToast`, streaming-bubble
  helpers) — belongs to the "UI" boundary specifically.
- Domain-specific renderers (DAG, thought-tree, synthesis, veto) and
  mode-execution functions (`runCollectiveMode`, etc.) — belong to
  "ops-center"/"modes".

Extracted: `evaluateMathExpression`, `chunkText`, `agentShortDesc`,
`cosineSimilarity`, `parseOneSSEFrame`, `estimateQuestionComplexity`,
`reEl`, `localTimeStringToUTCHourMinute`, `describeRecurrence`,
`truncateText`, `wsUid`.

### DIAGNOSE
Full safety check per the now-standard process: zero true top-level
call sites (one line initially flagged, manually confirmed a false
positive — a *different* function, `wsPill`, merely calling `reEl`
inside its own body, not an executing top-level statement), zero
references from any inline HTML handler, and — the check boundary 1's
regression taught to take seriously — zero references from
`autoInitApp()` or the other four startup-sequence functions main.js
orchestrates. Clean on all counts; no regression this round.

### PATCH (2a)
Extracted programmatically (each function's exact body plus its
immediately-preceding comment block, captured via a brace-matching
script) into `frontend/modules/utilities.mjs`, then **byte-verified
identical** against the original source for all 11 — same rigor as
boundaries 1 and 2, just scripted end-to-end this time given the larger
count. Removed the 11 originals from the monolith, replaced with pointer
comments; the substantive explanatory comments that preceded some of
them (e.g. `evaluateMathExpression`'s "real recursive-descent parser —
NOT eval()" note) were deliberately left in place rather than moved,
since they remain exactly where a future reader of the monolith would
look for them. `git diff --stat`: monolith + `main.js` combined = **27
insertions, 172 deletions**.

### 2b — Tests
`frontend/modules/utilities.test.mjs` — **38 tests**. One test bug
caught and fixed before it ever reached a commit: an assertion for
`chunkText`'s whitespace-collapsing behavior used a test string short
enough to be caught by the function's own (correct, pre-existing)
"skip near-empty tail fragments ≤20 chars" filter, so it asserted
against `undefined` — not a product bug, a test-input bug, fixed by
using a longer string. Coverage on `utilities.mjs`: **91.13% statements
/ 83.01% branch / 90.9% functions / 98.27% lines**. Combined suite
(security + storage + utilities): **84/84**.

### 2c — main.js wiring
Added the `utilities.mjs` import and 11 window-bridge assignments to
`main.js`.

### Regression (full 3-suite re-run, fresh)
| Suite | Result | Evidence |
|---|---|---|
| Backend `npm run typecheck` + `npm test` | Clean / **406/406** | unchanged |
| Vitest (security + storage + utilities) | **84/84** | `baseline/evidence/phase2-boundary3-vitest-run.log` |
| `e2e/baseline-flows.mjs` (Phase 0) | **12/12** | `baseline/evidence/phase2-boundary3-baseline-e2e.log` |
| `e2e/phase1-security-flows.mjs` (Phase 1) | **16/16** | `baseline/evidence/phase2-boundary3-phase1-e2e.log` |

### PWA follow-up (cumulative)
`sw.js` cache-list additions now needed: `/main.js`,
`/modules/security.mjs`, `/modules/storage.mjs`, and
`/modules/utilities.mjs`.

## Boundary 4 — "settings" (2026-09-18)

**Status: DONE** (this boundary only — overall Phase 2 remains PARTIAL,
5 of 9 boundaries now remain).

### INSPECT → MAP
Continuing the leaf-function inventory from boundary 3's scan: the
settings-getters group flagged there (~22 functions, turned out to be
23 on precise count) — simple localStorage/DOM-checkbox reads and
writes for backend URL, gateway key, theme, UI language, voice
settings, sync version, and toggle checkboxes (tools/thought-tree/
voice-mode). Confirmed via the same dependency-graph script: all 23
have zero dependencies on other top-level functions/state. Framed as
its own coherent sub-slice of the protocol's "UI" boundary (same
reasoning as boundary 3's utilities/settings/UI-chrome split) rather
than lumped in with modal/toast/menu chrome, which is a genuinely
different concern.

### DIAGNOSE
Same three-part safety check: zero true top-level call sites. One
function (`saveLocalModelSetting`) IS called from an inline HTML
handler; three (`isCloudSyncEnabled`, `getThemePreference`, `getUILang`)
ARE called from the startup sequence `main.js` already orchestrates
(`autoInitApp`, `applyTheme`, `applyTranslations` respectively) — both
cases are exactly what the established window-bridge pattern handles,
with this boundary's bridge assignments placed before the startup call
in `main.js`, same as boundaries 1-3. No regression this round.

### PATCH (2a)
Extracted programmatically (same script pattern as boundary 3) into
`frontend/modules/settings.mjs`, **byte-verified identical** for all 23
functions. Removed the 23 originals from the monolith, replaced with
pointer comments. `git diff --stat`: monolith + `main.js` combined =
**52 insertions, 95 deletions**.

### 2b — Tests
`frontend/modules/settings.test.mjs` — initially 29 tests, coverage came
back at 76.11%/100%/100%/**71.11%** (lines) — technically over the >=70%
bar but uncomfortably close, and the gap was every `catch(e){...}`
fallback branch across all the localStorage getters. Rather than accept
a borderline number, added 3 more tests that force `localStorage.getItem/
setItem` to throw (via `vi.spyOn(Storage.prototype, ...)`) and assert
every getter degrades to its documented default — this is not
coverage-padding, it verifies real behavior for a real scenario (Safari
private browsing, storage quota exceeded) that these try/catch blocks
exist specifically to handle. Final: **32 tests, 98.5%/100%/100%/97.77%**
coverage. Combined suite (security + storage + utilities + settings):
**116/116**.

### 2c — main.js wiring
Added the `settings.mjs` import and 23 window-bridge assignments to
`main.js`, placed before the startup-sequence call.

### Regression (full 3-suite re-run, fresh)
| Suite | Result | Evidence |
|---|---|---|
| Backend `npm run typecheck` + `npm test` | Clean / **406/406** | unchanged |
| Vitest (security + storage + utilities + settings) | **116/116** | `baseline/evidence/phase2-boundary4-vitest-run.log` |
| `e2e/baseline-flows.mjs` (Phase 0) | **12/12** | `baseline/evidence/phase2-boundary4-baseline-e2e.log` |
| `e2e/phase1-security-flows.mjs` (Phase 1) | **16/16** | `baseline/evidence/phase2-boundary4-phase1-e2e.log` |

### PWA follow-up (cumulative)
`sw.js` cache-list additions now needed: `/main.js`,
`/modules/security.mjs`, `/modules/storage.mjs`,
`/modules/utilities.mjs`, and `/modules/settings.mjs`.

## Roadmap — remaining 5 boundaries (explicitly PENDING, not started)

| Boundary | Rough candidate scope (from the dependency-graph inventory, not yet re-verified per-boundary the way "security"/"storage"/"utilities"/"settings" were) |
|---|---|
| core | `PERSISTABLE_STATE` (deferred here — see ADR/003-phase2-storage-boundary.md) + the 16 state variables it wraps, encryption/session bootstrap, `ContextFabric`, `NexusContext` |
| agents | `AGENTS` definitions, `customAgents` CRUD, agent gallery |
| modes | Collective/auto-route/cross-exam/mirror/sandbox mode logic |
| ops-center | Missions/Council/Swarm/Warden/Evaluation/Genome UI + API glue |
| workspace | Projects/Decision Journal/Topic Monitoring/Briefing |
| UI (remainder) | Modal open/close, toasts, streaming-bubble helpers, side-menu/plus-menu toggles — the settings-getters slice of this boundary is now done (boundary 4) |

Each future boundary will repeat this exact same verified process:
dependency-graph check → inline-handler cross-reference → top-level
(including transitive) execution-order check → byte-identical extraction
→ Vitest tests → full 3-suite regression re-run → document → commit —
one boundary, one commit, one regression check at a time, per protocol
§4/§7. No estimate is given for how many further turns this will take;
each boundary's actual dependency complexity will vary.

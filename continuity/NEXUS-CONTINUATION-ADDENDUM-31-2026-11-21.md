# NEXUS-CONTINUATION — ADDENDUM 31 — Old uploaded UI vs latest frontend (2026-11-21)
Adds to Addendum 30 without editing it. Status words only.

## 1. Authority/scope
Owner request: test the latest version as in the uploaded old HTML. Treated as a compatibility probe (read-only on the old file; no backend change). Not done and not authorised: push, merge, tag, deploy, licence change, real keys/spend.

## 2. Work performed
New `e2e/old-vs-latest-ui-compat.mjs` and `docs/UI-OLD-VS-LATEST-2026-11-21.md`. Old file (SHA-256 `ef7d5aaa1e32fbe5a4a36523c2d19d264cc8952e6dad2edf59e6c4c2f7f54945`) untouched.

## 3. Evidence
15/17 PASS (simulated providers, Chromium). Latest frontend: all checks PASS. Old file: connect+chat PASS against the latest backend; 2 FAIL = old-file defects (124 px phone overflow; gateway key in localStorage) already fixed in the latest frontend. All 35 endpoints used by the old file exist in the latest backend (static). Page/E2E results of Addendum 30 unchanged.

## 4. Statuses
Latest frontend ↔ latest backend connect+chat: VERIFIED (simulated). Old file ↔ latest backend connect+chat: VERIFIED (simulated); old file provenance UNVERIFIED (unchanged). Other old-UI panels in the browser: UNVERIFIED. Real providers BLOCKED. TLS/WCAG/non-Chromium UNVERIFIED.

## 5. Stopping point / next authorised action
Stopped after documenting; commit local only. Next authorised action: none — owner to run `npm run nexus` and send notes/panel list to test next.

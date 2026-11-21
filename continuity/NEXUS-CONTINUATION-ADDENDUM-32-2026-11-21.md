# NEXUS-CONTINUATION — ADDENDUM 32 — Single-file build of the latest frontend (2026-11-21)
Adds to Addendum 31 without editing it. Status words only.
## 1. Scope
Owner request: single-file version of the latest UI. Additive only (new script, test, doc); frontend/backend sources unchanged. No push/merge/tag/deploy/licence/real keys.
## 2. Work
`scripts/build-single-file.mjs`, `e2e/single-file-build.mjs`, `docs/SINGLE-FILE-BUILD.md`. Artifact `frontend/dist/NEXUS-single-file.html` (git-ignored, regenerated on demand), sha256 `620d03b965e6a2a13851e6a8097f72c1f32e9291bf86a681ec11ad7c30a98ec6`.
## 3. Evidence
single-file-build E2E 22/22 PASS (simulated models, Chromium); build deterministic (--check OK). Not re-run: backend suites, frontend Vitest (no source change).
## 4. Statuses
Single-file build: VERIFIED for exercised paths (boot, chat local+cloud, phone/RTL, vendor libs, CSP negative controls, file:// UI load). Backend calls from file://: blocked by CORS by design (not a defect). PWA/offline: not provided. Real providers BLOCKED; WCAG/non-Chromium UNVERIFIED; D1–D3 + licence PENDING owner.
## 5. Stopping point / next action
Stopped after local commit and delivery. Next authorised action: none — owner tests the file and reports.

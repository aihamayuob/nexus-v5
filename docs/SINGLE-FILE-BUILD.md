# Single-file build of the latest frontend (2026-11-21)
Owner request: a one-file version of the latest UI (like the old monolith). Status words only. Repository sources remain the only source of truth; the single file is a **generated artifact** (git-ignored): `node scripts/build-single-file.mjs` → `frontend/dist/NEXUS-single-file.html` (3.50 MiB, deterministic; `--check` detects a stale file). Output hash of this build: `620d03b965e6a2a13851e6a8097f72c1f32e9291bf86a681ec11ad7c30a98ec6`.

## What it contains
HTML shell + `app.js` + `ui-glow.js` + `main.js` + 5 modules (strict-mode IIFEs) + qrcode.js, jsQR, pdf.js and its worker (embedded as base64 data blocks, SHA-256-checked against `vendor/VENDOR-SHA256.txt` at build time, exposed as lazy `blob:` URLs). Every source edit is an asserted exact-once replacement (5 in app.js: three LIB_URLS getters, pdf worker URL, service-worker registration disabled).

## Run
- Full app with backend: `npm run setup` (once) → `npm run nexus` → open `http://localhost:8080/dist/NEXUS-single-file.html` and paste the printed API address + gateway key.
- The file itself can be copied anywhere, but backend calls need an HTTP origin that is in the backend's `NEXUS_CORS_ORIGINS`. From `file://` (origin `null`) the UI loads and embedded libraries work, but the browser blocks backend calls — by design, CORS is not loosened.

## Evidence (`e2e/single-file-build.mjs`, 22/22 PASS; Chromium, backend as separate process, models SIMULATED)
Reproducible build · self-contained (no external script/stylesheet/CDN) · app boots, module bridge intact · connect + chat via local and cloud paths · phone 390 px no overflow, RTL · gateway key not in storage · QR/jsQR/pdf.js (module + worker) really work from embedded data (PDF text extracted) · UI origin served only the one HTML file · no service worker · no CSP violations in normal use · **CSP negative controls**: an injected inline script does not run; a modified approved script blocks the app (hash mismatch) · `file://` loads without CSP violation.

## Disclosed differences / limits
- CSP: identical to the repo's except `script-src` = SHA-256 of the 3 inline scripts + `blob:` (instead of `'self'`). `blob:` and the inherited `script-src-attr 'unsafe-inline'` / `style-src 'unsafe-inline'` are weaker than ideal (same inline-handler weakness the repo already discloses).
- No offline/PWA shell cache (no `sw.js`).
- Only the exercised paths are VERIFIED; other app panels, real providers (BLOCKED), non-Chromium browsers, WCAG: UNVERIFIED. Frontend Vitest suite not re-run (no frontend source changed).

# Release V1 · B1 — Service Worker / offline boot — acceptance criteria (written BEFORE `frontend/sw.js` and before the E2E file)

Owner directive (2026-10-16): create or complete a Service Worker **from the actual evidence**, include `/modules/state.mjs`, add an independent E2E with a REAL service worker, verify offline boot and that no required file is missing. B1 is not complete before the test actually passes and the evidence is recorded.

## Evidence of the real boot dependency map (measured from the repository, not from memory)
- Document: `frontend/neural_nexus_ai_agents-4-3-5-3.html` (entry name on a deployment is unknown; `manifest.start_url` is `.`).
- Manifest and icons are data URIs inside the HTML (no manifest file, no icon files) — nothing to precache.
- One `<script type="module" src="main.js">` (L2341) + one big inline classic script.
- `main.js` statically imports 5 modules: `modules/security.mjs`, `storage.mjs`, `utilities.mjs`, `settings.mjs`, `state.mjs` (no other imports in any module; no dynamic `import()`, no `importScripts`, no `new Worker` in the monolith).
- => same-origin boot files = HTML + `main.js` + 5 modules (the "six" JS files).
- Lazy, cross-origin, NOT boot-required: `cdnjs.cloudflare.com` (qrcode 1.0.0, jsQR 1.4.0, pdf.js 3.11.174 + worker; loaded on demand at L2757–2775). They are NOT precached; features depending on them (QR, PDF text extraction) are unavailable offline. This is a disclosed limit, not a hidden one.
- Backend calls (`/api/*`, `/v2/*`) are configurable and may be same-origin behind a reverse proxy: they must NEVER be cached or answered by the SW.
- The original `sw.js` is unavailable. The new one is AUTHORED from this map; it is not a recovery of the original and any behavior of the original not listed above (e.g. push, background sync) is not reproduced.

## Design constraints for `frontend/sw.js`
1. Allowlist only: only the 6 JS files + the document are ever answered from cache. Everything else (non-GET, cross-origin, any other path, SSE, API) is passed through untouched (no `respondWith`).
2. Install = atomic `cache.addAll` of the 6 JS files (install FAILS if one is missing, so a missing file is loud, not silent) + best-effort add of the document (`./` and the known HTML name; a deployment under another name is cached at its first successful navigation).
3. Network-first with cache fallback for allowlisted requests (fresh when online; offline boot from cache); cache updated on success. Navigations fall back to the cached document.
4. Versioned cache name; `activate` deletes older `nexus-shell-*` caches; `skipWaiting` + `clients.claim`.

## Acceptance (E2E `e2e/release-v1-b1-offline-sw-flows.mjs`, real Chromium, real SW, real local HTTP server; no mocks of the SW; nothing is routed through `page.route`)
- VALID (the test itself is sound): V1 SW registered, activated and controlling the page; V2 an independent resolver (parses `main.js` + module imports + the HTML script tags) yields exactly the expected same-origin set, and equals the set of same-origin JS requests observed in the online boot; V3 the offline condition is real (the server is closed: a direct `fetch` from the page to it fails); V4 control: an SW variant WITHOUT `state.mjs` makes the offline boot fail detectably (proves the test can fail); V5 deterministic across two runs (verdict + check names).
- PS (the behavior): P1 `caches` holds every expected file under the current version; P2 offline reload with server closed boots the app: `main.js` ran (`window.encryptState`, `window.agentOrder` accessor present), `autoInitApp` finished (`encryptionKey` set), no `pageerror`, no failed same-origin request; P3 every boot JS response offline `fromServiceWorker()`; P4 a same-origin `/api/…` GET is NOT served from cache (offline ⇒ fails; not cached); P5 a non-allowlisted same-origin path is not cached; P6 after `activate` only the current-version cache exists (old version removed); P7 SW script contains no reference to localStorage/sessionStorage and does not store request headers (static check).
- PRE (tree without `sw.js`): expected REJECTED — P1–P3 fail (registration 404).
- Verdicts: `ACCEPTED` / `REJECTED` / `INVALID` as in earlier slices; exit 0 only on ACCEPTED.

## Out of scope (stays UNVERIFIED)
Firefox/Safari, real devices, update-flow with a changed `sw.js` in the field, cdnjs-dependent features offline, iOS PWA eviction behavior, behavior of the lost original `sw.js`.

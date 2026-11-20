# NEXUS Standalone (`standalone/NEXUS-Standalone.html`) — run & security notes

A single self-contained file (inline CSS/JS, no framework, no CDN, no build step) that is a real client of the NEXUS backend API. It **does not replace** the existing UI (`frontend/`, launched by `scripts/nexus-run.mjs`). Status: **PARTIAL** — works end-to-end against the built backend with *simulated* providers (see `e2e/standalone-html-flow.mjs`, 55/55); no real provider, no TLS-proxy, no screen-reader/WCAG audit was run.

## 1. Run it (recommended: the launcher)
```bash
npm --prefix src-baseline/nexus-backend ci && npm --prefix src-baseline/nexus-backend run build   # once
node scripts/nexus-standalone.mjs
```
It prints the page URL (`http://127.0.0.1:8090/NEXUS-Standalone.html`), the API address (`http://127.0.0.1:8787`) and a random gateway key. Open the page, paste the address and key into **Connect**. The launcher starts the built backend with `NEXUS_CORS_ORIGINS=<the page origin only>` — the backend policy is *not* loosened. Provider keys (`NEXUS_ANTHROPIC_API_KEY`, `NEXUS_OLLAMA_BASE_URL`, …) are set in the environment of the backend, never in the HTML.
- Page only (you run the backend yourself): `node scripts/nexus-standalone.mjs --no-backend`, then start the backend with `NEXUS_CORS_ORIGINS=http://127.0.0.1:8090`.
- Env: `NEXUS_STANDALONE_PORT` (8090), `NEXUS_PORT` (8787), `NEXUS_GATEWAY_KEYS`.
- Any static server works too (e.g. `python3 -m http.server`), provided its origin is in the backend's `NEXUS_CORS_ORIGINS`.

## 2. Opening the file directly (`file://`)
Browsers give `file://` pages the origin `null`; the backend (correctly) does not allow it, so **connecting to the backend from a double-clicked file fails** — tested in Chromium and shown by the page as an explicit error. Only the labelled **DEMO / SIMULATED** mode works there. We did not weaken CORS to change this.

## 3. What the page does (every control is real or clearly marked)
Connect (URL + key, health, key verified against `/v2/models`) · capabilities & provider health (incl. optional live probe) · routing **preview** (`/v2/route`; the 6 real modes) · create Mission with completion criteria · live progress (poll + optional SSE log) · pause/resume/cancel · approve/reject · final output · verification/evaluation as declared by the backend · VEL receipts and claim evaluations · Arabic RTL ⇄ English LTR · phone/desktop layouts · loading/error states for network, 401, 429, timeout, bad JSON. MCP/A2A are shown as "Not enabled" when the backend says so.

## 4. Security properties (each checked by the E2E unless noted)
- Gateway key: held in a JS variable only; never in localStorage/sessionStorage/cookies/URL/DOM after connect; wiped on disconnect and `pagehide`; a reload returns to idle. (Only `nexus.lang`, `nexus.base`, and a session-scoped list of mission ids are stored.)
- No provider keys or secrets in the file (scanned). All API data is rendered with `textContent` (no `innerHTML`; XSS probe in objective is shown as text).
- CSP `<meta>`: `default-src 'none'`, scripts/styles allowed only by sha256 of the shipped inline blocks (`node scripts/standalone-csp.mjs --check`), `connect-src http: https:` (the URL is user-typed; the backend CORS list is the gate), no images/fonts/objects, `base-uri/form-action 'none'`. After editing the HTML run `node scripts/standalone-csp.mjs` to refresh the hashes.
- Requests go only to the page origin and the chosen API; `credentials:'omit'`, `redirect:'error'`, `referrerPolicy:'no-referrer'`, no logging of the key.
- A warning is shown for plain `http://` to a non-loopback host (key would travel in clear text).
- Limits: a CSP `<meta>` cannot set `frame-ancestors`; the launcher adds `X-Frame-Options: DENY`. If you host the file elsewhere, add that header yourself. UNVERIFIED: behaviour in browsers other than Chromium; full WCAG 2.2 AA conformance (only touch-target size, accessible names, RTL/LTR, no-overflow checks were run).
- Demo mode: separate code path (`demoApi`), persistent banner "DEMO / SIMULATED", every datum prefixed `[SIMULATED]`, verification `UNVERIFIED`, zero network requests (asserted).

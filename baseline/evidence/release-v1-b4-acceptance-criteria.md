# Release V1 · B4 — local-release security — acceptance criteria (written BEFORE any B4 code)

Owner directive (2026-10-16), item 4: deployment config must **require `NEXUS_GATEWAY_KEYS`** and refuse unprotected network operation; review the listen-address binding and apply the most secure setting compatible with documented LAN use; gateway key **memory only** (no `localStorage`/`sessionStorage`) with no leakage to logs; a suitable **CSP in the HTML**; tests for deployment settings and **actual** security headers; document LAN steps and security limits; **never describe the release as suitable for the public internet**.

Scope: first LAN/local release only. No multi-tenant identity, no TLS termination, no new auth scheme.

## Measured facts (inspected, not assumed)
- `config/env.ts`: `host` defaults to `0.0.0.0`; `.env.example` also ships `NEXUS_HOST=0.0.0.0` and an EMPTY `NEXUS_GATEWAY_KEYS` ("fine for LAN"). Nothing refuses a network bind without keys.
- `gateway/middleware/auth.ts`: with keys configured, `clientKey` = the RAW bearer token. It then flows to (a) `rateLimit.ts` audit/log (`clientKey.slice(0,12)` = first 12 chars of the secret), (b) `routes/v2/approvals.ts` (`decidedBy ?? clientKey` persisted in `approvals.decided_by` and audit meta), (c) `routes/legacy/sync.ts` (already hashes it). => secret leakage vector into logs/DB.
- `gateway/router.ts` applies `applySecureHeaders` first on every response (API-only CSP `default-src 'none'`, nosniff, XFO, referrer, CORP, COOP, HSTS, XPCDP). Existing tests do not assert these on a real response.
- The backend does NOT serve the frontend HTML (no Dockerfile/compose/unit files exist in the repo). HTML delivery is by whatever static server/file the operator uses => the HTML's CSP can only be a `<meta http-equiv>` policy; `frame-ancestors`, `report-uri`, `sandbox` and HSTS are NOT settable that way (disclosed limit).
- Frontend: gateway key persisted in `localStorage['nexus_gateway_key']` (`modules/settings.mjs getGatewayKey`, plus monolith sites). HTML has no CSP; one inline classic script + ~168 inline handlers (=> `'unsafe-inline'` for script is required until the monolith is split; this is a disclosed weakening, not hidden).
- `X-Forwarded-For` is trusted unconditionally in `clientIp` (spoofable rate-limit identity for `skipAuth` routes and audit `ip`). OUT OF SCOPE for this slice; documented as a known limit.

## Backend acceptance (tests in `test/deploymentGuard.test.ts`, `test/securityHeaders.test.ts`, extended `test/authGateway.test.ts` only by ADDITION)
- G1 pure guard `evaluateDeployment({host, gatewayKeys})` → `{ok, errors[], warnings[], networkExposed}`.
  - loopback hosts (`127.0.0.1`, `127.x.x.x`, `::1`, `localhost`): ok even with no keys, with a warning, `networkExposed=false`.
  - any non-loopback host (`0.0.0.0`, `::`, a LAN IP, a hostname): `networkExposed=true`; **no keys ⇒ ok=false** with an error naming `NEXUS_GATEWAY_KEYS`.
  - non-loopback + keys: every key must be ≥ 16 chars, no whitespace, no duplicates; otherwise ok=false (error never prints the key value).
  - there is NO override flag for "insecure network mode".
- G2 default host is loopback (`127.0.0.1`). LAN use requires an explicit `NEXUS_HOST` (documented) AND keys.
- G3 real process: `src/index.ts` spawned with `NEXUS_HOST=0.0.0.0` and no keys **exits non-zero, never listens** (a TCP connect to the port fails), stderr/stdout contain the reason and no secret. Spawned with a valid key + `NEXUS_HOST=127.0.0.1` it listens and `/v2/health` answers (proves the guard doesn't break a valid start). Spawned with a short key on `0.0.0.0` it refuses.
- G4 `clientKey` for a keyed request is derived (`key:` + hex digest prefix), is stable per key, differs between the two keys, and **never contains the token**. Rate-limit audit meta and the `decided_by` default no longer contain any token prefix. Existing approval tests that pass an explicit `decidedBy` still pass unchanged.
- G5 leak test: run the real server with keys; send valid, invalid and rate-limited requests and an approval decision with no `decidedBy`; capture console output AND dump `audit`/`approvals` rows; the raw token (and its first 12 chars) must appear nowhere.
- G6 headers: on a REAL HTTP response (200, 401, 404, 429) every header the code claims is present with the exact value; no `Access-Control-Allow-Origin` unless the Origin is allow-listed.
- G7 `.env.example`: `NEXUS_HOST=127.0.0.1`, comments state that a network bind needs `NEXUS_GATEWAY_KEYS` (≥16 chars) and the release is LAN-only; contains no real key.
- No existing backend test is edited or weakened. Baseline before B4: tsc exit 0, 472/472.

## Frontend acceptance (E2E `e2e/release-v1-b4-key-and-csp-flows.mjs`, real Chromium, real local HTTP server serving the real files)
- F1 After saving a gateway key through the real UI path and issuing a real request, `localStorage` AND `sessionStorage` contain neither the key nor any entry named like a gateway key; IndexedDB/Cache Storage/SW caches don't contain it either (scan of all stored values).
- F2 The key is attached as `Authorization: Bearer …` on backend requests while the page lives (observed on the wire at the local server), i.e. the in-memory path actually works.
- F3 A legacy `localStorage['nexus_gateway_key']` is PURGED at boot (and not adopted silently): after reload the entry is gone; the user must re-enter the key (disclosed behavior change).
- F4 Reload ⇒ key is gone from memory (no persistence) and requests carry no Authorization header.
- F5 The key never appears in `console` messages (all types) nor in `pageerror`, nor in exported/synced settings JSON produced by the app.
- F6 CSP meta present in the HTML head as the first `<meta>`-class element before any script; policy contains `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `script-src` limited to `'self' 'unsafe-inline'` + the exact cdnjs origin, `connect-src` allowing `'self'`, `http:`/`https:`/`ws:`/`wss:` (backend URL is user-configurable — disclosed), `img-src 'self' data: blob:`, `style-src 'self' 'unsafe-inline'`, `font-src` as measured, `worker-src 'self' blob: cdnjs`. Exact value is frozen from measurement (below), not guessed.
- F7 Full app boot + the existing E2E flows produce **zero CSP violations** (`securitypolicyviolation` listener + console errors "Content Security Policy") and zero new `pageerror`.
- F8 Negative control: injecting an inline `<script src="https://evil.example/x.js">` or an `object`/`iframe` from a foreign origin is blocked (violation observed) — proves the CSP is actually enforced and the test can fail.
- F9 B1 (offline SW) E2E re-run after the change is still ACCEPTED.
- F10 No existing test is edited. Old tests that encode "key in localStorage" (`settings.test.mjs`) are SUPERSEDED OPENLY: listed by name in the evidence with the reason, replaced by new tests of the new contract; none is silently deleted.

## Verdict rules
ACCEPTED only if all VALID checks and every acceptance item above are green on the POST tree and the PRE tree demonstrably fails the PS items. Anything not run is reported PENDING, never PASS.

## Out of scope (stays UNVERIFIED / disclosed)
TLS (plain HTTP on LAN: the bearer key is sent in clear on the wire — a LAN-trust assumption), public-internet exposure, reverse-proxy hardening, `X-Forwarded-For` trust, per-user identities, HTML served with real HTTP security headers (needs the operator's static server), XSS elimination (inline script remains; `'unsafe-inline'` required).

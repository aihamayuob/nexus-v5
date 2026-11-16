# NEXUS — Operational Test Build (2026-11-14)

> Evidence-based description of what this tree **is**, how to run it, what was **really** exercised and what was **simulated**.
> Status words only: VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED. Where this file and the repository disagree, the repository wins.

## 1. Identity (provenance chain)
| Link | Evidence |
|---|---|
| Approved baseline bundle | `nexus-v5-v5.0-polish.bundle` SHA-256 `75c695d8e7f2174cd89d103ee084eda708a173a7aa5ba89097369062765b0e19`, head `cbdc898a3ba605211d9791979a6415f314ba1c8f` |
| Reference baseline (owner-designated 2026-11-14) | **G8.2-CLOSURE `A-source-snapshot`**, SHA256SUMS 997/997 OK, 877 files, fingerprint `abd33066721a12ff9e315370ed36c5e53ce42b9f3d602908234e6875d007c588` → commit `4dbe45b` |
| Approved patch (F-UI-1/F-UI-2) | `nexus-fui1-fui2.patch` SHA-256 `b564b40f6d2c5b95b87cd9e4ead5826be006656164dcd27b81ed6db80813f927`, pre-image hashes matched before apply → commit `1145a41` |
| Later commits on top | `068e2ee` path-portable E2E · `930b811` pinned `tsx` devDependency · `d46fe59` F-01 · `39745af` scenarios/launcher/verify-all · MCP slice commit (see `git log`) |
| Published GitHub repo `aihamayuob/nexus-v5` | an **archive deposit** (zips + docs, no source tree). It is not the source of this tree; this tree is a **new real Git history** rooted at the G8.2-CLOSURE snapshot. Nothing of the deposit was altered by this work. |

## 2. What is in the tree
- `frontend/` — single-file HTML app `neural_nexus_ai_agents-4-3-5-3.html` (+ `main.js`, `modules/*.mjs`, `sw.js`, Vitest suite). Arabic/RTL baseline, light/dark.
- `src-baseline/nexus-backend/` — TypeScript backend, **0 runtime dependencies**, `node:sqlite`, 16+ migrations; built to `dist/`.
- `e2e/` — Playwright E2E (17 historical/regression scripts) + `operational-scenarios.mjs` (38 checks on the BUILT backend) + `launcher-ui-demo.mjs` (UI through the launcher, 1280 and 390 px, ar/RTL).
- `scripts/nexus-run.mjs` (one-command runner), `scripts/verify-all.sh` (full verification), root `package.json` (`setup`, `nexus`, `verify`).
- `ADR/`, `docs/`, `NEXUS-CURRENT-STATE.md`, `NEXUS-CONTINUATION.md`, `CHANGELOG.md`.

## 3. Run it (one command)
Requirements: Node ≥ 22.5 (tested 22.23.4).
```bash
npm run setup      # = npm ci + build for the backend (once)
npm run nexus      # starts built backend (127.0.0.1:8787) + serves the UI (127.0.0.1:8080); prints the app URL and a generated gateway key
```
Open the printed URL (`/NEXUS.html` alias works). Paste the printed gateway key in Settings → gateway key. Without any provider key the UI loads and every call returns an honest "no provider available" error; to get real model answers set provider variables from `src-baseline/nexus-backend/.env.example` before `npm run nexus` (e.g. `NEXUS_ANTHROPIC_API_KEY=…`, or `NEXUS_OLLAMA_BASE_URL=http://127.0.0.1:11434` for a local runtime).
Rebuild/verify from scratch: `npm run verify` (needs Playwright + Chromium resolvable from `e2e/`; logs to `./verify-out`).
LAN use: see `docs/DEPLOYMENT-LAN.md`. **Do not expose to the internet** (no TLS, open findings below).

## 4. Results at the final commit (clean `npm ci` → typecheck → build → tests → E2E → scenarios → UI demo)
Raw logs: `verification/verify-final2/` in the package. Exit codes all 0, `OVERALL exit=0`.
| Layer | Result | Models/services |
|---|---|---|
| Backend typecheck / build | clean / OK | — |
| Backend tests (node:test via tsx) | **638 / 638** | simulated |
| Frontend Vitest | **186 / 186** (7 files) | — |
| Playwright E2E (17 scripts, Chromium 153) | all verdicts ACCEPTED / expected | simulated |
| Operational scenarios on the built backend (real process, on-disk SQLite, SIGKILL restart) | **38 / 38** | **fake Anthropic-protocol + fake Ollama-protocol servers** |
| Launcher UI demo (1280 px & 390 px, ar/RTL) | **7 / 7** + 4 screenshots | simulated |
| `npm audit` backend (incl. dev) | 0 vulnerabilities | — |
| `npm audit` frontend | 6 (3 moderate, 3 high) — **dev-only** (vitest/vite/undici/source-map-js transitive), not shipped | — |

### REAL vs SIMULATED (explicit)
- **Real**: the NEXUS code paths — HTTP server, auth, router, task/mission/council engines, Warden, VEL gate/receipts, SQLite persistence and restart recovery, tool pipeline, MCP endpoint, the actual browser UI in Chromium.
- **Simulated**: every model provider. Cloud = a local fake server speaking the Anthropic wire protocol; local = a fake Ollama server. **No real provider (OpenAI/Anthropic/Gemini/DeepSeek/Ollama/LM Studio), no real API key, no real device, no Safari/Firefox, no TLS deployment was exercised.** Real-provider connectivity is **UNVERIFIED** and needs owner-supplied keys or a local runtime.

## 5. Capability matrix (capability honesty: code / test / integrated path / available to user)
| Capability | Status | Evidence & limits |
|---|---|---|
| Mission engine (plan → steps → COMPLETED/FAILED/CANCELLED; async 202; checkpoint/resume) | **VERIFIED** (simulated models) | scenarios S2, S6, S7; resumed mission re-executes (8 new provider hits), cancel of a stalled mission ends CANCELLED |
| Council / cross-examination (5 rounds, persisted) | **VERIFIED** (simulated) | S4; rounds survive SIGKILL restart (S6) |
| Warden: isolate / de-isolate / cancel / status | **VERIFIED** (simulated) | S3, S3b, S3c |
| Evidence / VEL (policy → write-ahead receipt → dispatch → independent verification → reconcile) | **VERIFIED** for the built-in slice | backend tests (VEL vertical slice, receipts); only simulated external effects; real external systems UNVERIFIED |
| Universal AI Gateway / Router (BEST, CHEAPEST, FASTEST, LOCAL_ONLY, PRIVATE, USER_SELECTED; LOCAL_ONLY/PRIVATE never fall back to cloud; cloud failure → safe local fallback; all down → FAILED) | **VERIFIED** (simulated) | S1, S5; FUI-1 E2E proves no cloud egress in local mode |
| Auth (Bearer; no keys ⇒ trusted loopback; any key ⇒ required; `/v2/health` public) | **VERIFIED** | authGateway tests, S0, B4 real-backend auth E2E; **F-01 fixed**: `/api/embed` no longer public |
| Memory / persistence / recovery | **VERIFIED** (simulated) | S6 (hard kill + restart); retention sweeps covered by tests |
| Failure memory / Evidence-integrity guard | **VERIFIED within CP-16 limits** | historical evidence, re-run green |
| **MCP server** (read-only, `POST /mcp`) | **VERIFIED within ADR-006 limits** | 10 unit + 5 scenario checks; third-party MCP client interop **UNVERIFIED**; no MCP client side |
| A2A protocol | **PENDING** (not implemented) | needs objective + acceptance criteria |
| Universal Connector SDK | **PENDING** (not implemented) | idem |
| Tool-using agents with external effects (MCP effectful tools, code execution) | **PENDING / deliberately disabled** | `code_execution` unregistered; effectful tools only via VEL |
| Multilingual / RTL UI | **VERIFIED** for ar/RTL and en on Chromium at 390/1280 px | other browsers/devices UNVERIFIED; WCAG 2.2 AA not claimed |
| DB migrations | **VERIFIED** (run on every clean start in tests/scenarios) | SQLite only |
| Real hosting / preview link | **PENDING** | no hosting provisioned; not advisable before the findings below are decided |

## 6. Open findings (owner decisions; none silently changed)
1. ~~**Planning-phase orphan mission**~~ (F-03, 2026-11-16: PLANNING orphan with no plan checkpoint -> FAILED on resume; VERIFIED). Original note: a mission killed while PLANNING stays PLANNING after restart (never COMPLETED, never terminal). An existing test pins "left alone". Decide: sweep to FAILED/INTERRUPTED or keep.
2. ~~**Task row after fallback**~~ (F-04, 2026-11-16: task row records the serving provider/model; VERIFIED with simulated adapters). Original note: kept the *requested* provider, not the one that served (transparency issue).
3. ~~Frontend loads CDN scripts without SRI~~ (F-05, 2026-11-16: qrcodejs/jsQR/pdf.js vendored with pinned SHA-256, cdnjs removed from CSP). Still open: CSP keeps `unsafe-inline`; pdf.js 3.11.174 still < 4.2.67 (mitigated by `isEvalSupported:false`).
4. 6 embedded base64 images of **unknown provenance**; no `LICENSE`/`NOTICE` file in the tree (no license was added or changed by this work).
5. ~~`X-Forwarded-For` trust~~ (F06-a, 2026-11-16: ignored by default; honoured only from peers listed in `NEXUS_TRUST_PROXY`). Still: no TLS, HTTP/LAN only.
6. ~~Frontend dev advisories~~ (2026-11-16: vitest/coverage ^4.1.12 + lock audit fix; `npm audit` 0/0).
7. Legacy E2E scripts rewrite tracked `baseline/evidence` files when run; `verify-all.sh` restores them (mitigation, not a fix).
8. Real-provider and real-device testing not done (needs keys / hardware).

See `docs/IP-LICENSE-SECURITY-DELTA-2026-11-14.md` for the license/IP register delta.

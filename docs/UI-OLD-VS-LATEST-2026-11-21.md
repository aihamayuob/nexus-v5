# Old uploaded UI vs latest repo frontend — compatibility probe (2026-11-21)
Status words only. Where this file and the repository disagree, the repository wins.

## What was compared
- **Old file**: `neural_nexus_ai_agents-4-3-5-3.html`, SHA-256 `ef7d5aaa1e32fbe5a4a36523c2d19d264cc8952e6dad2edf59e6c4c2f7f54945` (12,036 lines, one inline script). Per `docs/IP-LICENSE-SECURITY-DELTA-2026-11-14.md` it is the *deposit-root* file, **not** the approved baseline frontend; provenance **UNVERIFIED**. It was not modified or committed.
- **Latest**: repo `frontend/neural_nexus_ai_agents-4-3-5-3.html` (+ `app.js`, `ui-glow.js`, `main.js`, `modules/`, `vendor/`), served by `scripts/nexus-run.mjs`. Different hash by design: CSP, externalised scripts, F-UI-2 layout fix, memory-only gateway key, vendored libraries.

## Evidence (`e2e/old-vs-latest-ui-compat.mjs`, 15/17 PASS; the 2 FAILs are old-file defects, listed below)
Real Chromium, same flow for both UIs against the same built backend process (on-disk SQLite); models **SIMULATED** (fake Ollama + fake Anthropic protocol on 127.0.0.1). The old file was served over HTTP and its origin added through the **`NEXUS_CORS_ORIGINS` env allow-list** — backend code/policy unchanged (a foreign origin still gets no CORS header; `file://` origin `null` is still rejected).
| Check | Old uploaded | Latest repo |
|---|---|---|
| Connect (URL + gateway key) + chat via local model | PASS | PASS |
| Chat via cloud model | PASS | PASS |
| Phone 390 px: horizontal overflow | **FAIL: 124 px** | PASS: 0 px |
| Arabic RTL | PASS | PASS |
| Backend 4xx/5xx during connect+chat | none | none |
| Uncaught page errors | none | none |
| Gateway key kept out of local/sessionStorage | **FAIL** (`localStorage.nexus_gateway_key`) | PASS |

Static check: all 35 `/api/*` and `/v2/*` paths used by the old file exist in the latest backend routes (`routes/legacy`, `routes/v2`); the latest frontend uses no endpoint the old one lacks.

## Limits (UNVERIFIED)
Only connect + chat were driven. The other old-UI areas (schedules, sync, swarm, council, IoT, evolution, fine-tuning, knowledge-freshness, warden panels) were **not** exercised in the browser — only their endpoint existence was checked. Real providers BLOCKED (no keys). Chromium only. WCAG not assessed.

## Recommendation (owner decides)
Test the **latest** frontend, not the old file: it has the two fixes above. The old file remains usable against the new backend for reference only.

## How to run the latest full UI + backend (one command, no code changes)
```bash
npm run setup     # once: backend npm ci + build, frontend npm ci
npm run nexus     # prints http://localhost:8080/NEXUS.html and a gateway key
# add your own provider env keys first if you want real models (spend is yours): see docs/OPERATIONAL-BUILD.md §3
```
Open the printed URL, Settings → paste the printed gateway key. To exercise the old file against the same backend: serve it from any local HTTP origin and start with `NEXUS_CORS_ORIGINS=http://localhost:PORT` added.

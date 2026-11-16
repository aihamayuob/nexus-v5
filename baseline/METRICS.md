# METRICS.md — NEXUS v5.0 Baseline Metrics (Phase 0)

Status: DONE — every number below has a reproduction command and was run
in this sandbox on 2026-09-16 against Node v22.22.2 / npm 10.9.7.

## Frontend (`frontend/neural_nexus_ai_agents-4-3-5-3.html`)

| Metric | Value | Command |
|---|---|---|
| Lines | 12,036 | `wc -l frontend/*.html` |
| File size | 928 KB | `du -h frontend/*.html` |
| `<script>` blocks | 2 | `grep -c '<script' frontend/*.html` |
| Top-level functions | 408 | `grep -c '^function \|^async function ' frontend/*.html` |
| `.modal-overlay` dialogs | 20 | `grep -c 'class="modal-overlay' frontend/*.html` |
| `fetch(` call sites | 22 | `grep -c 'fetch(' frontend/*.html` |
| `localStorage` references | 67 | `grep -c 'localStorage' frontend/*.html` |
| `indexedDB` references | 5 | `grep -ci 'indexeddb' frontend/*.html` |
| `.innerHTML` sites | 153 | `grep -c '\.innerHTML' frontend/*.html` |
| `.textContent` sites | 82 | `grep -c '\.textContent' frontend/*.html` |
| `escapeHtml` usage sites | 116 | `grep -c 'escapeHtml' frontend/*.html` |
| `eval(` matches | 1 (confirmed false positive — a comment) | `grep -n 'eval(' frontend/*.html` |
| `document.write` | 0 | `grep -c 'document\.write' frontend/*.html` |

## Backend (`src-baseline/nexus-backend/`)

| Metric | Value | Command |
|---|---|---|
| Source `.ts` files | 134 | `find src -name '*.ts' \| wc -l` |
| Test files (`test/**`, all `.ts`) | 58 total, 50 are `*.test.ts` | `find test -name '*.ts' \| wc -l` |
| Total TS LOC (src+test) | 21,470 | `find src test -name '*.ts' \| xargs wc -l \| tail -1` |
| Migrations | 15 (`001`–`015`) | `find src/persistence/migrations -name '*.sql' \| sort` |
| Repository classes | 26 | `find src -iname '*.ts' \| xargs grep -l "class .*Repo\b" \| sort \| wc -l` |
| API routes | 86 (17 legacy + 69 v2) | see `baseline/evidence/api-routes.txt` |
| Runtime `dependencies` | 0 | `package.json` → `"dependencies": {}` |
| `npm install` | 4 packages added (devDeps only), 0 vulnerabilities | `npm install` |
| `npm run typecheck` | exit 0, 0 errors | `npm run typecheck` |
| `npm run build` | exit 0, clean `dist/` | `npm run build` — log: `baseline/evidence/build.log` |
| `npm test` | **406 pass / 406 total, 0 fail, 0 skipped** | `npm test` |
| `npm audit` | **0 vulnerabilities** | `npm audit` — log: `baseline/evidence/npm-audit.log` |
| Test duration | 119.6s | reported by `node --test` summary |

## Runtime/behavioral (real compiled binary + real browser)

| Check | Result |
|---|---|
| Server boot | Listens successfully, logs confirm (`baseline/evidence/server-boot*.log`) |
| `GET /v2/health` (skipAuth) | `HTTP 200` |
| Auth enforcement (no key / wrong key / correct key) | `401 / 401 / <past-auth response>` |
| Rate limit burst (default 20/min burst) | 20× `200`, then `429` from request 21 onward |
| Frontend page load in real Chromium | Loads, correct `<title>` |
| Chat send with no provider configured | Renders a clean validation error (`400`, `"مزود \"anthropic\" يحتاج مفتاح API..."`), zero uncaught page errors |
| Ops Center / Workspace modals | Both open correctly via their real handler functions |

## Explicitly not measured in Phase 0 (see FLOWS.md for rationale)

- Lighthouse/FCP/bundle-size/memory profiling — reserved for Phase 4
  (`/nexus-commercial`) per protocol §13, where "measure, don't assume" is
  the explicit gate for performance claims.
- Per-innerHTML-site escapeHtml coverage ratio — requires manual/scripted
  classification of all 153 sites; reserved for Phase 1
  (`/nexus-security`).
- Full 20-modal UI regression matrix — reserved as a pre/post-Phase-2 gate
  (highest behavior-preservation risk during modularization).

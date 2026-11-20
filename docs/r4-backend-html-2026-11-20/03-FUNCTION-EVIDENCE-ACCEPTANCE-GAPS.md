# Function → test evidence, acceptance table, open gaps (2026-11-20)
Legend: "code" = exists, "test" = a test exercises it, "path" = passes through the integrated HTML→API→Gateway→Runtime→Evidence→HTML path today, "user" = reachable by a user of the shipped page. All providers are **SIMULATED** (fake Anthropic/Ollama protocol servers on 127.0.0.1) unless stated. The HTML E2E log is `e2e/standalone-html-flow.raw.log` (55/55, two consecutive runs); results JSON `standalone-html-results.json`.

## 1. Standalone HTML function matrix
| Function | code | test | path | user | Evidence (E2E check name) | Status |
|---|---|---|---|---|---|---|
| Connect URL+key, health, key verified | ✔ | ✔ | ✔ | ✔ | "connect with real key => LIVE banner" | VERIFIED (simulated providers) |
| Wrong key / backend down / bad URL / creds-in-URL | ✔ | ✔ | ✔ | ✔ | "wrong gateway key => 401…", "API unavailable…", "invalid URL…" | VERIFIED |
| Capabilities & provider health | ✔ | ✔ | ✔ | ✔ | "capabilities: providers/models + provider health + warden…" | VERIFIED |
| MCP / A2A status honest ("Not enabled") | ✔ | ✔ | ✔ | ✔ | "MCP client / A2A honestly shown…" | VERIFIED (feature itself PARTIAL) |
| Routing preview, 6 real modes, LOCAL_ONLY blocks cloud | ✔ | ✔ | ✔ | ✔ | "routing modes = exactly…", "LOCAL_ONLY preview…" | VERIFIED |
| Create Mission + criteria validation | ✔ | ✔ | ✔ | ✔ | "mission accepted (202)", ratio/replans/empty rejections | VERIFIED |
| Progress → COMPLETED, transitions, SSE log, final output | ✔ | ✔ | ✔ | ✔ | "mission reaches COMPLETED…", "final result shown", "task log…" | VERIFIED |
| Evidence/verification shown as backend declares | ✔ | ✔ | ✔ | ✔ | "evidence/verification section rendered…" | VERIFIED (verdict values come from backend; not independently re-judged) |
| VEL receipts / claim evaluations / approvals views | ✔ | ✔ (render) | PARTIAL | ✔ | "evidence & governance tab renders…" | PARTIAL — no real receipt/approval/claim was produced in this E2E (lists were empty) |
| Pause / resume / cancel / approve / reject buttons | ✔ | ✗ | ✗ | ✔ | not exercised in the HTML E2E (backend side tested elsewhere: scenarios/missions tests) | **UNVERIFIED in the page** |
| Open mission by id | ✔ | ✗ | ✗ | ✔ | id format validation only | UNVERIFIED |
| AR RTL ⇄ EN LTR, persisted | ✔ | ✔ | — | ✔ | "switch to English…", "language choice persists…" | VERIFIED |
| Phone 375px + desktop 1280px layouts | ✔ | ✔ | ✔ | ✔ | overflow, touch-target ≥40px, accessible names, screenshots `scenario-out/shots/sa-*.png` | VERIFIED for those checks only (no WCAG claim) |
| Security: no key in storage/DOM/console, CSP hashes, XSS probe, origins | ✔ | ✔ | ✔ | ✔ | "NO key in…", "CSP meta matches…", "XSS probe…", "page contacted ONLY…" | VERIFIED |
| `file://` behaviour (connect fails explicitly, DEMO works) | ✔ | ✔ | ✔ | ✔ | "file://: connecting… FAILS…", "file://: DEMO…" | VERIFIED in Chromium |
| DEMO/SIMULATED isolated & labelled, zero requests | ✔ | ✔ | — | ✔ | "DEMO banner…", "demo result is labelled…", "demo mode made ZERO network requests" | VERIFIED |
| Backend restart on same DB | ✔ | ✔ | ✔ | — | "launcher restarted on the same DB" | VERIFIED (plumbing only; the page does not re-list old missions from the server) |
| Launcher (page only, CORS = page origin, 404/405) | ✔ | ✔ | ✔ | ✔ | "launcher serves only the page…", "backend CORS allows ONLY…" | VERIFIED |
| Real providers / real model quality | — | ✗ | ✗ | — | BLOCKED (no keys) | **BLOCKED** |
| TLS/HTTPS path | — | ✗ | ✗ | — | nginx absent | **UNVERIFIED** |

## 2. Backend function matrix (pointer)
Gateway, providers/routing/fallback, missions lifecycle, Warden/Governor/VEL, evidence statuses, persistence/recovery, MCP/A2A/C1: see `01-…` §A–B; evidence = the 754 backend tests, 25 E2E scripts and `scenarios 39/39`. **No backend source was changed in this work.** The mandate's "complete the backend" was approached as audit-then-fix: the audit found no failing, reproducible, in-scope defect, so nothing was modified; the remaining backend items are owner-gated (below).

## 3. Acceptance criteria
| # | Criterion (from mandate) | Result | Status |
|---|---|---|---|
| 1 | Bundle integrity/branch/HEAD reproduced; work on isolated branch | hash, HEAD `52b12c14`, branch `work/r4-backend-html` | VERIFIED |
| 2 | typecheck + build + unit/integration + verify-all | typecheck/build 0; 754/754; 198/198; 25 E2E scripts exit 0 (TLS skipped). `scripts/verify-all.sh` itself was not run as a single command (its parts were run individually) | PARTIAL |
| 3 | Security audit incl. content secrets scan, SSRF/CORS/CSRF/rate/kill-switch | done, see `01-…` | PARTIAL (sampled triage, no pen test) |
| 4 | Deps/licences/SBOM | see `02-…` | PARTIAL (SBOM carried over, licence undeclared) |
| 5 | Backend completion (all listed areas) | audited; no code changes; M1/C1/A1 PARTIAL by owner decision, real providers BLOCKED | PARTIAL |
| 6 | API contract documented without invented endpoints | `docs/API-CONTRACT.md` | VERIFIED (route table by static scan; bodies only where read) |
| 7 | Standalone HTML: single file, real backend, all required screens | `standalone/NEXUS-Standalone.html` (no CDN/framework), E2E 55/55 | VERIFIED for exercised paths; pause/resume/cancel/approve buttons UNVERIFIED |
| 8 | Run-mode selection "as API supports" | routing *preview* only; mission creation has no mode in the API | VERIFIED (limitation by API design) |
| 9 | Security constraints for the page | memory-only key, no secrets, text-only rendering, CSP, no CORS loosening | VERIFIED |
| 10 | HTML E2E: ar/en, phone/desktop, connect, auth, real mission, failure, unavailable API, invalid input, no secrets | all in the 55 checks | VERIFIED (Chromium only, simulated providers) |
| 11 | file:// tested, not assumed | tested | VERIFIED |
| 12 | Continuity addendum + resume file, then stop; no push/merge/tag/deploy | Addendum 29 + NEXT-SESSION block created; nothing pushed | VERIFIED |

## 4. Open gaps (owner-gated or not done)
1. Real-provider validation (needs owner-provided keys + spend approval) — BLOCKED.
2. TLS reverse-proxy E2E (needs nginx) — UNVERIFIED.
3. Page buttons pause/resume/cancel/approve/reject and "open by id" untested in the page; receipts/claims/approvals views only tested empty.
4. D1–D3 code review (M1/C1/A1, chat-task boot sweep, auth-throttle shared-IP behaviour) — PENDING owner approval.
5. Project licence / publication policy — owner decision.
6. WCAG 2.2 AA audit, screen-reader test, non-Chromium browsers — not done.
7. `scripts/verify-all.sh` integration of the new E2E and CSP `--check` — not wired (would touch existing scripts; left for an owner-approved slice).
8. Backend source unchanged: any "backend completion" beyond audit needs a defined defect/objective + acceptance criteria.

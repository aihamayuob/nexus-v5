# Phase 1 — technical audit, status matrix, security review (2026-11-20)
Tree: branch `work/r4-backend-html` created from `52b12c14dc9e5b09dfe6bc7a90465b74b9590505` (bundle SHA-256 `1606d38c3ee7c5220d221032bfa385ab5347be1935bcd0420c09e03fe3db560e` verified; 4 branches, 21 commits, 960 files at import). Node 22.23.5, TypeScript 7.0.2, Playwright 1.63.0 (+ Chromium rev 1243). Raw logs: `/home/claude/work/audit-out/` (copied into the delivery bundle under `evidence/`). No push/merge/tag/deploy/real-provider key/spend happened.
Vocabulary: VERIFIED = reproduced today with the log named; PARTIAL; PENDING; BLOCKED; FAILED; UNVERIFIED. Nothing is called "done".

## A. Baseline reproduction (nothing in `src-baseline/` or `frontend/` was modified)
| Item | Result today | Evidence |
|---|---|---|
| `npm ci` backend / frontend | exit 0 | `01-backend-npm-ci.log`, `05-frontend-npm-ci.log` |
| `tsc` typecheck | exit 0 | `02-typecheck.log` |
| `npm run build` | exit 0 (dist produced) | `03-build.log` |
| Backend unit+integration (`node --test`) | **754 / 754 pass, 0 fail** | `04-backend-tests.log` |
| Frontend Vitest | **198 / 198 (8 files)** | `06-frontend-vitest.log` |
| Playwright E2E scripts (25 scripts, built backend as separate process, SIMULATED models) | all exit 0 (`SUMMARY.txt`); e.g. scenarios 39/39, phase1-security 16/16, key+CSP 30/30, real-backend-auth 9/9, local-egress 35/35, local-unavailable 13/13, evidence-integrity 26/26 | `e2e/*.raw.log` |
| MCP server third-party interop / MCP client / A2A peer | 10 / 11 / 9 pass | `07c/07d/07e` |
| Real-provider validation | PASS 23 / FAIL 0 / **BLOCKED** (no keys; models simulated) | `07b` |
| TLS reverse-proxy E2E | **UNVERIFIED** — `nginx` not installed here; script printed SKIPPED (exit 0). Not counted as pass. | `07-e2e-tls-reverse-proxy-flow` |
| Baseline-evidence drift guard | no drift reported | `baseline-evidence-drift.txt` |
These numbers equal the 2026-11-18 report's; the counts are now **current evidence for this tree**.
(Log greps showing the word "FAIL" in 3 files are test names such as "expected FAIL pre-extraction" marked PASS — not failures.)

## B. Status matrix (module → status → evidence → priority)
| Module / property | Status | Evidence / note | Sev. if gap |
|---|---|---|---|
| Gateway auth (Bearer, timing-safe, throttle on failed auth, trust-proxy) | VERIFIED | `authGateway.test.ts`, `authFailureThrottle.test.ts`, phase1-security 16/16, HTML E2E (401 path) | — |
| CORS allow-list | VERIFIED | `cors.test.ts`; HTML E2E asserts allowed origin gets ACAO and foreign origin gets none | — |
| CSRF | VERIFIED by design | Bearer-only, no cookies set (grep: no Set-Cookie); browsers don't attach Authorization cross-site | — |
| SSRF (web_fetch, /api/tools/fetch) | VERIFIED (code read + tests exist) | `security/ssrfGuard.ts`: DNS-pinned lookup, loopback/RFC1918/link-local/CGNAT/metadata blocked (link-local never allowed), redirects re-validated or refused; `safeFetch` is the only fetch path used by tools | — |
| LOCAL_ONLY / PRIVATE never reach cloud | VERIFIED (simulated providers) | `cloudEgressGuard.test.ts`, `privateRoutingEgress*.test.ts`, `fui1-local-mode-egress` 35/35, scenarios S5, HTML E2E route preview (`cloudFallbackBlocked`) | — |
| Rate limiting | VERIFIED | `NEXUS_RATE_LIMIT_*` env, per-IP failed-auth throttle tests | — |
| Kill-switches | PARTIAL | `NEXUS_MCP_CLIENT_ENABLED=false`, VEL kill switch (env.ts), Warden pause/cancel/isolate routes; no single global "stop everything" switch exists (not invented) | Low |
| Secrets in repo (content scan, 75 regex hits) | PARTIAL | hits triaged as test fixtures/placeholders (`sk-` inside identifiers etc.), none a live credential; triage was by sampled inspection, not exhaustive — treat as "no finding", not proof | — |
| Secrets to frontend / HTML | VERIFIED | HTML scan + E2E: key absent from storage, DOM, console | — |
| Persistence + recovery | VERIFIED (simulated) | scenarios (kill -9 + restart on same DB), HTML E2E restart on same DB, chat-task boot sweep tests | — |
| Mission lifecycle + state machine + approvals | VERIFIED (simulated) | scenarios S1, HTML E2E mission → COMPLETED with transitions | — |
| Routing/fallback/health | VERIFIED (simulated) | scenarios S5, gap1b, HTML E2E | — |
| Evidence statuses / VEL receipts / claim evaluation | PARTIAL | tests + evidence-integrity 26/26; receipts for real external effects: no built-in tool declares an external effect (env.ts note) | — |
| MCP client M1 / MCP server / A2A A1 / Connector SDK C1 | **PARTIAL** (owner decision D1) | interop 11/10/9 pass against third-party SDKs; code-level review of D1–D3 areas **PENDING** | Med |
| Real providers | **BLOCKED** | no keys; not requested | — |
| TLS front (nginx) | UNVERIFIED | nginx absent | Med (before any LAN/WAN use) |
| Dependencies | VERIFIED | backend has **0 runtime dependencies**; `npm audit --omit=dev`: 0 vulnerabilities | — |
| Licence of the project itself | PENDING (owner) | root licence deliberately undeclared (SBOM note) | Owner |

## C. Findings (no Critical / High found)
1. **Medium — D3 (owner-pending):** failed-auth throttle is per IP; behind a shared NAT/proxy without `NEXUS_TRUST_PROXY` all users share one bucket (a lockout-DoS vector). Documented in `R4-OWNER-DECISION-REVIEW`; unchanged, needs owner decision.
2. **Low — no global kill-switch:** only per-subsystem switches (see matrix).
3. **Low — standalone page transport:** over plain `http://` to a non-loopback host the key is sent in clear text; the page warns, TLS is the fix (UNVERIFIED here: no nginx).
4. **Info:** `tsx` is a devDependency needed to run some E2E loaders; `e2e/` pins `playwright ^1.56` but the preinstalled Chromium matches 1.63 (E2E run with `npm i --no-save playwright@1.63.0`, not committed).
5. **Not done (honest):** line-by-line review of M1/C1/A1 (e.g. MCP tool-name length handling), a fuzz/pen test, dependency-confusion review of the vendored browser libs beyond the SBOM, multi-browser tests.
No code change to `src-baseline/` was made because no reproducible defect was found; per the permanent rules nothing was "fixed" speculatively.

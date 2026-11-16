# NEXUS — Buyer evidence and IP file (technical, 2026-11-15)

Engineering record for a technical/commercial reviewer. **Not legal advice**; it states what is declared, measured and missing. Status words only. Where this file and the repository disagree, the repository wins. Nothing was committed, tagged, released, pushed or deployed. **Revision R3 (same day)**: figures below updated after F-03/F-04 closure, a full `verify-all.sh` run (exit 0) and a frontend dev-dependency update; see `docs/F03-F04-CLOSURE-2026-11-15.md`.

## 1. What the build is
Single-file Arabic/RTL HTML frontend + TypeScript backend with **0 runtime npm dependencies** (Node ≥ 22.5 built-ins, `node:sqlite`). One command runs it (`npm run setup && npm run nexus`, or `run.sh`/`run.cmd`). LAN/loopback over HTTP only — **no TLS; not for the public internet**. Provenance chain and run guide: `docs/OPERATIONAL-BUILD.md` §1–§3.

## 2. Test evidence (re-measured on this tree, 2026-11-15, clean `npm ci` → typecheck → build → tests; raw logs in `verification/verify-2026-11-15/`)
| Layer | Result | Models / services |
|---|---|---|
| Backend typecheck / build | clean / OK | — |
| Backend tests (node:test) | **653 / 653** (638 prior + 7 timeout + 1 net F-03 + 7 F-04) | simulated providers |
| Frontend Vitest | **186 / 186** (7 files) | — |
| Playwright E2E, 17 legacy/regression scripts, Chromium (pre-installed build, `/opt/pw-browsers` 1243) | all exit 0; verdicts ACCEPTED / expected (`SURVIVES` slice 5 and `NOT-STUCK` slice 7 are the documented expected verdicts) | simulated |
| Operational scenarios on the built backend (real process, on-disk SQLite, SIGKILL restart) | **39 / 39** | fake Anthropic- and Ollama-protocol servers |
| Launcher UI demo (1280 px and 390 px, ar/RTL) | **7 / 7** | simulated |
| Real-provider harness | **PASS 23 / FAIL 0 / BLOCKED 10** — see `docs/REAL-PROVIDER-VALIDATION-2026-11-15.md` | real Anthropic endpoint for the invalid-key checks only |
| MCP server ↔ official `@modelcontextprotocol/sdk` 1.32.2 client | **10 / 10** | real third-party client, built NEXUS backend |
| `npm audit` | backend 0; frontend **0** (6 dev-tooling advisories closed in R3 by an in-major dev-dependency update) | — |

### Coverage (measured, with limits)
- Frontend (Vitest + v8): 92.49 % statements, 86.13 % branches, 93 % functions, 97.66 % lines — **but only over the 4 extracted ES modules** (`security`, `settings`, `storage`, `utilities`). The ~11,000-line HTML monolith is exercised by Playwright E2E, which produces no line-coverage figure: **monolith coverage is UNVERIFIED as a percentage.**
- Backend coverage: 88.56 % lines (see §2.1).
- Mutation evidence exists for several earlier slices (see `docs/checkpoints/`) and for the new timeout module (3 mutants, all caught).

### 2.1 Backend coverage
`node --test --experimental-test-coverage` over `src/**/*.ts` (645 tests at measurement time, all pass; 8 tests added since — not re-measured): **88.56 % lines, 84.07 % branches, 89.81 % functions** (raw: `verification/verify-2026-11-15/backend-coverage.log`). Lowest-covered files, relevant to this report: `openaiCompatible.ts` 48 %, `ollamaAdapter.ts` 49 %, `openaiAdapter.ts`/`deepseekAdapter.ts` 57 %, `ssrfGuard.ts` 54 %, `secrets.ts` 35 %, `contextFabric.ts` 41 %. **Reading**: the OpenAI-compatible and Ollama adapters — i.e. the paths a real OpenAI/DeepSeek/LM Studio/Ollama call would take — are the least covered provider code, which is one more reason their real-provider status stays UNVERIFIED. Line coverage shows code was executed, not that behaviour is correct.

## 3. What is REAL vs SIMULATED (do not blur)
- **Real**: NEXUS code paths (HTTP server, auth, router, mission/council engines, Warden, VEL receipts, SQLite recovery, tool pipeline, MCP endpoint), the browser UI in Chromium, one real third-party MCP client, and the real Anthropic endpoint's rejection of an invalid credential.
- **Simulated**: every successful model completion in every suite. **No real model answer from any provider has been produced by this build in any verification run.** Real OpenAI/DeepSeek/Gemini/Ollama/LM Studio: UNVERIFIED. Safari/Firefox, real phones/tablets, TLS deployment, WCAG 2.2 AA audit, load/performance benchmarking: **not done** (no measurement exists; no performance claim is made).
- Reproduce the real-provider part with the owner's own keys: `docs/REAL-PROVIDER-VALIDATION-2026-11-15.md` §4.

## 4. Capability matrix (code / test / integrated path / available to user)
| Capability | Status |
|---|---|
| Mission, council, Warden, VEL, router modes, persistence/recovery | **VERIFIED** with simulated providers |
| Provider timeouts enforced on real calls | **VERIFIED** (unit + real-TCP harness) — behaviour change noted in the validation doc §5 |
| Real provider success path (all six) | **UNVERIFIED / BLOCKED** (no keys/runtime/route in the verification environment) |
| MCP server read-only | **VERIFIED within ADR-006 limits**, third-party client interop 10/10 |
| MCP client, A2A, Universal Connector SDK | **PENDING** — criteria in `ADR/007-protocol-completion-criteria.md`, awaiting owner approval; nothing implemented |
| Frontend on Firefox/Safari/real devices | **UNVERIFIED** |
| Hosting / TLS / public exposure | **PENDING**, not advisable (open findings F-05, F-06) |

## 5. IP and license register (engineering view)
| Item | Finding |
|---|---|
| Project license | **None declared**: no `LICENSE`/`NOTICE` anywhere. Choice is an owner decision; none was invented. A buyer cannot assume any license grant from the tree. |
| Authorship | Not provable from the repo (no copyright headers, CLA or assignment). Substantial portions were produced with AI assistance; a legal reviewer should assess ownership/copyrightability and tool terms. |
| Backend deps | runtime **0**; dev 52 locked, all dev: MIT 31, Apache-2.0 21 |
| Frontend deps | all 133 locked are dev/test (R3 lock): MIT 101, MPL-2.0 12, BSD-3-Clause 5, Apache-2.0 4, ISC 4, MIT-0 2, BSD-2-Clause 2, BlueOak-1.0.0 1, CC0-1.0 1, 0BSD 1 — MPL-2.0 is in the dev toolchain only, not shipped |
| Tools used only for verification, not shipped, not added to any manifest | `@modelcontextprotocol/sdk` 1.32.2 (MIT, installed in a scratch dir for the interop test); Playwright (Apache-2.0, pre-installed) |
| Browser-loaded CDN code | qrcodejs 1.0.0 (MIT, believed), jsQR 1.4.0 (Apache-2.0, believed), pdf.js 3.11.174 (+worker, Apache-2.0, believed) from cdnjs, **no SRI** — licenses taken from upstream declarations, not verified here |
| Embedded images | **2 embedded images** (SVG favicon, PNG 192×192 icon; an earlier "6" was an overcount — 4 matches are code) — own brand mark, no third-party markers, **authorship/licence UNVERIFIED**: owner to confirm or replace |
| Provider APIs / models | Each provider's terms and each model's license apply separately; **not assessed**, and none exercised for real (except one invalid-credential request to Anthropic) |
| SBOM | CycloneDX 1.5 (149 components) was produced 2026-11-13 (project docs `continuity/mandate-2026-11-13/`); **stale for the frontend** — R3 changed the frontend lockfile (dev tooling only, 7 packages added); not regenerated |
| Fonts | no embedded fonts found; CSS font sources not audited — UNVERIFIED |

## 6. Security register (open items for owner decision)
F-01 `/api/embed` auth — **FIXED + VERIFIED** (earlier). **D-PT-1 provider timeout not enforced — FIXED + VERIFIED this round.** **F-03 (planning-phase orphan mission) and F-04 (task row kept the requested provider; plus fallback was sent the primary's model name) — FIXED + VERIFIED in R3.** Open: F-05 CDN without SRI, CSP `unsafe-inline` and broad `connect-src`; F-06 no TLS, `X-Forwarded-For` trust (LAN-only). Gateway-key auth is a bearer-key model, not per-user identity. `code_execution` is deliberately unregistered (no OS-level sandbox exists in the environment where it was developed).

## 7. What a buyer should not infer
Not shown: real-model answer quality, throughput/latency under load, multi-user behaviour, long-run stability, accessibility compliance, behaviour on browsers other than Chromium, or any property of a provider's service. "Operational build" means *runs and passes its own tests locally*, not *production-ready*.

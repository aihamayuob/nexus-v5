# Real-provider validation — 2026-11-15

Status words only. Where this file and the repository disagree, the repository wins. Raw logs: `verification/real-provider/` in the package.

## 1. Bottom line
| Provider | Real success path (R1) | Real invalid-credential path (R2) | Status |
|---|---|---|---|
| Anthropic | **BLOCKED** — no key supplied | **PASS** against the real `api.anthropic.com` (invalid key deliberately used) | **UNVERIFIED** as a working integration; error handling VERIFIED against the real endpoint |
| OpenAI | BLOCKED — no key; endpoint not resolvable from this environment (ENOTFOUND) | BLOCKED (network) | **UNVERIFIED** |
| DeepSeek | BLOCKED — same | BLOCKED (network) | **UNVERIFIED** |
| Gemini | BLOCKED — same | BLOCKED (network) | **UNVERIFIED** |
| Ollama | BLOCKED — no runtime / no model | n/a | **UNVERIFIED** |
| LM Studio | BLOCKED — no runtime / no model | n/a | **UNVERIFIED** |

**No provider may be declared "supported" from this run.** A provider counts as supported only when its `R1.<id>.*` checks are PASS under evidence class `REAL-PROVIDER` (see §4). Simulated providers (the operational scenarios — 38 at first writing, 39 in R3) were not counted.

## 2. What this environment could and could not do
- No provider API key and no local model runtime existed in the session; none was fabricated and none of the platform's own credentials was used.
- Network allow-list: `api.anthropic.com` reachable; `api.openai.com`, `api.deepseek.com`, `generativelanguage.googleapis.com`, `registry.ollama.ai`, `huggingface.co` not resolvable → no real local model could be obtained either.
- Therefore real-provider success paths and real **fallback between providers** (R5, needs ≥ 2 real providers) are **BLOCKED**, not failed.

## 3. What was actually exercised (harness `e2e/real-provider-validation.mjs`, built backend as a separate process)
Evidence classes: `REAL-ENDPOINT-REJECT` = a real endpoint answered a deliberately invalid credential; `REAL-TRANSPORT` = real OS-level failure (refused port / silent peer) — proves NEXUS behaviour only.
| Check | Result |
|---|---|
| R2 Anthropic: invalid key → real HTTP 401 `authentication_error` surfaced as `provider_error` (502, not retryable); exactly 1 attempt logged (no retry storm); health = UNAVAILABLE with the real 401 text; key absent from response and backend log | **PASS 4/4** |
| R3 connection refused, all four cloud adapters (Anthropic, OpenAI, DeepSeek, Gemini): clear error < 10 s, retryable, exactly `MAX_RETRIES+1` attempts, health UNAVAILABLE | **PASS 12/12** |
| R3 Ollama / LM Studio down: `local_provider_unavailable` (503) and **0** requests to a cloud canary listener (no cloud egress on local failure) | **PASS 2/2** |
| R4 silent peer / stalled stream — **found FAILED before the fix** (see §5) | **PASS 5/5 after fix** |

Totals after the fix: PASS 23, FAIL 0, BLOCKED 10 (`verification/real-provider/rpv-after.log`). Before the fix: PASS 18, FAIL 5, BLOCKED 10 (`rpv-before.log`).

## 4. How the owner closes the BLOCKED items (one command per environment)
```bash
cd src-baseline/nexus-backend && npm ci && npm run build && cd ../..
# any subset of these; keys are read from the environment only, never printed, and the run asserts they never leak
export NEXUS_ANTHROPIC_API_KEY=…  NEXUS_OPENAI_API_KEY=…  NEXUS_DEEPSEEK_API_KEY=…  NEXUS_GEMINI_API_KEY=…
export NEXUS_OLLAMA_BASE_URL=http://127.0.0.1:11434  NEXUS_MODEL_OLLAMA=<a pulled model>      # local runtime
export NEXUS_LMSTUDIO_BASE_URL=http://127.0.0.1:1234 NEXUS_MODEL_LMSTUDIO=<loaded model>
node e2e/real-provider-validation.mjs        # results: real-provider-validation-out/results.json
```
Acceptance for "provider supported": `R1.<id>.health` READY (live), `R1.<id>.chat` (HTTP 200, non-empty text, usage > 0), `R1.<id>.stream` (token events + `done`, no `error`), `R1.no-secret-leak` PASS, and for ≥ 2 providers `R5` PASS (invalid primary → served by the real second provider, call log shows the failed then the successful attempt). Cost: a few tokens per provider (`max_tokens: 32`).
Still unscripted and **UNVERIFIED**: tool-calling, image input and Gemini web-search grounding against real models; embeddings; long-generation timing (see §5 owner note).

## 5. Defect found and fixed in this slice (D-PT-1)
- **Defect**: the per-provider timeout (`NEXUS_TIMEOUT_<PROVIDER>_MS`, default 60 s cloud / 120 s local, documented in `providerRegistry.ts`) was used only by health probes. `chat()`/`chatStream()` passed no timeout, so a provider that accepted the connection and then went silent kept `POST /api/chat` open indefinitely (no 504, no retry, no fallback). Measured: 4/4 cloud adapters + a stalled stream failed R4 before the fix.
- **Fix** (smallest safe slice): new `src/providers/timeoutFetch.ts` (`withProviderTimeout`), applied only in `createProviderAdapter()`. Semantics: time-to-response-headers ≤ timeout and idle gap between stream chunks ≤ timeout — **not** a total-duration cap, so long healthy streams are unaffected. Expiry = `Errors.timeout` (504, retryable) so the existing retry/fallback chain handles it; a caller abort still maps to `cancelled`.
- **Evidence**: 7 new unit tests on real TCP servers (`test/providerTimeout.test.ts`; red = module missing, then 7/7); 3 mutants (no idle watchdog, raw abort instead of timeout, total-duration cap) all caught, file restored byte-identical (sha256 `d77055152c995504…`); harness R4 5 FAIL → 5 PASS; full backend suite 638 → 645, all pass.
- **Owner note (behaviour change)**: the documented timeout is now actually enforced. A **non-streaming** completion whose response headers take longer than 60 s (very large `max_tokens` on a slow model) will now time out and retry where it previously waited. Raise `NEXUS_TIMEOUT_<PROVIDER>_MS` if needed. Real-provider long-generation behaviour is UNVERIFIED.

## 6. Limits of this evidence
R3/R4 prove how NEXUS behaves on transport failures; they say nothing about any provider's real behaviour. R2 proves handling of one real provider's real auth rejection only (Anthropic). Rate-limit (429) and 5xx behaviour against real endpoints were not observed (covered only by existing simulated tests).

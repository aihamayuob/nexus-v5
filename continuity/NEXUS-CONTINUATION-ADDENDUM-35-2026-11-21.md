# NEXUS-CONTINUATION — ADDENDUM 35 — Option A recorded; native TLS added; hosting/keys need the account holder (2026-11-21)
Adds to Addendum 34 without editing it. Status words only.
## 1. Owner decisions received
16:26: "execute A" (no merge; `main` stays the archive; work stays on `review/r4-backend-html`). Also: create a hosting account, make the backend Internet-ready (shared gateway key + TLS inside), create provider keys in the environment, run real validation with a spend cap — "absolute authority".
## 2. Work performed
- Option A: nothing merged; remote `main` untouched.
- Backend source change (opt-in, default behaviour unchanged): native TLS via `NEXUS_TLS_CERT_FILE`/`NEXUS_TLS_KEY_FILE` (`src/gateway/tls.ts`, `server.ts`, `env.ts`, `.env.example`), fail-closed on one-sided/unreadable config.
- `docs/PUBLIC-DEPLOYMENT-READINESS.md` (readiness table + owner steps).
## 3. Evidence
New `test/nativeTls.test.ts` 7/7 (0 skipped); mutation check (TLS path disabled) → 4 fail; full backend suite 761/761 (754 + 7); `tsc --noEmit` clean; `npm run build` ✓; real `dist/` process smoke: HTTPS pinned-cert 200, plain HTTP no response, `"tls":true` logged, one-sided config aborts. Tests were written after the code (no Red→Green record). Frontend Vitest and E2E scripts not re-run (no source they cover changed except server.ts TLS branch, default path untouched).
## 4. Statuses
- Native TLS: VERIFIED locally (self-signed). Public CA cert / renewal / real host: UNVERIFIED.
- "Internet-ready": PARTIAL — NOT claimed. Missing: per-user auth/tenant isolation, edge DoS/WAF, monitoring/backups/secrets manager, pen-test. Shared single gateway key is the existing model.
- Hosting account: BLOCKED — account creation needs the account holder (identity, billing consent, ToS, 2FA); no hosting credentials in the environment.
- Provider keys / spend / real-provider validation: BLOCKED — keys must be created in the providers' consoles by the owner; none in the environment; none fabricated. `NEXUS_DAILY_BUDGET_USD` exists in code (not re-verified against a real provider).
- Unchanged: D1–D3 + licence PENDING owner; WCAG/non-Chromium/real-phone UNVERIFIED.
## 5. Stopping point / next action
Stopped after local commit + push to the review branch. Nothing merged/tagged/deployed/spent. Next authorised action (owner input): provide VPS + domain access (or run the prepared commands), Let's Encrypt cert files, provider keys via env with provider-side spend limits + `NEXUS_DAILY_BUDGET_USD`; then run `e2e/real-provider-validation.mjs`. A hardening slice (per-user auth, edge rate limits, monitoring) needs explicit approval before any public exposure.

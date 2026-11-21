# NEXUS-CONTINUATION — ADDENDUM 36 — VPS deployment kit prepared; accounts/billing/ToS/2FA/domain/keys remain with the owner (2026-11-21)
Adds to Addendum 35 without editing it. Status words only.
## 1. Owner request
16:36: create the hosting account (identity, billing consent, ToS, 2FA — "put it in a link so I can approve"), create a VPS + domain, or prepare the commands for approval.
## 2. What was done / not done
- NOT possible for the assistant: creating a hosting account, accepting billing/ToS, 2FA, buying a domain, creating provider keys — these are the account holder's own acts; no link can delegate them. The assistant's sandbox also has no SSH route to any VPS.
- Prepared (additive, no backend/frontend change): `deploy/vps/setup.sh` (one-command Ubuntu setup: nginx page + restricted proxy /api /v2 /health, edge rate limit, Let's Encrypt, systemd unprivileged service, ufw, generated gateway key, `NEXUS_DAILY_BUDGET_USD`, CORS=domain; requires `ACCEPT_LETSENCRYPT_TOS=yes` from the owner), `deploy/vps/README-AR.md`, a §4 note in `docs/PUBLIC-DEPLOYMENT-READINESS.md`.
## 3. Evidence
`bash -n` OK (after fixing an apostrophe inside `${EMAIL:?…}`); validation block exercised in isolation: 6 cases (missing DOMAIN/EMAIL, no ToS consent, bad BUDGET, IP as DOMAIN → refused; valid → accepted); Node-version expression accepts local v22; rendered systemd unit passes `systemd-analyze verify` (ExecStart substituted); nginx text braces balanced. The script was NOT run end-to-end (it mutates the OS; a sandbox attempt to write under /usr/local/bin was correctly denied and abandoned). nginx/certbot/ufw/Node-download steps: UNVERIFIED.
## 4. Statuses
Hosting account / VPS / domain: BLOCKED on the owner. Provider keys + real validation: BLOCKED on the owner. `setup.sh`: PARTIAL (real run UNVERIFIED). Internet-readiness: PARTIAL, not claimed (single shared key, no per-user auth/WAF/monitoring). Merge to `main`: not done (option A). D1–D3 + licence PENDING owner.
## 5. Stopping point / next action
Stopped after commit + push of the kit to `review/r4-backend-html`. Next authorised action (owner): create VPS + domain + A record, run the one command from README-AR.md, paste back the script output WITHOUT secrets for diagnosis; add provider keys on the server and run `e2e/real-provider-validation.mjs` there.

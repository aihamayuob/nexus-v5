# PLAN.md — NEXUS v5.0

## Phase dependency chain (protocol §6, unchanged — documented, not altered)

```
/nexus-baseline  (DONE — this document set)
   │  requires: explicit approval
   ▼
/nexus-security       — Markdown/XSS/storage/history/import hardening
   │  requires: explicit approval
   ▼
/nexus-modularize      — 2a extract / 2b test / 2c wire via main.js
   │  requires: explicit approval
   ▼
/nexus-reliability     — lifecycle, cancellation, offline queue, CSP
   │  requires: explicit approval
   ▼
/nexus-commercial      — UX, measured performance, security review
   │  requires: explicit approval
   ▼
/nexus-research        — reproducibility layer, benchmarks
   │  requires: explicit approval
   ▼
V5.0-RELEASE-REPORT.md
```

No phase begins without the previous phase's exit gate passing and
Aiham's explicit go-ahead. This document does not pre-approve any future
phase.

## Per-phase gates (protocol §8, applied identically to every phase)

`PLAN → CHANGE → TEST → SECURITY CHECK → REGRESSION CHECK → DOCUMENT`

Concretely, for every phase from here on:
1. Re-run the exact Phase 0 regression set (`npm test`, `npm run
   typecheck`, `npm run build`, `npm audit`, `node e2e/baseline-flows.mjs`)
   *before* touching anything, to catch drift since this baseline.
2. Make the phase's scoped change only (no scope creep — e.g. Phase 2a is
   extraction only, no logic changes, per protocol §7).
3. Re-run the same regression set *after*.
4. Any unexplained diff → revert, label REGRESSION, diagnose before
   continuing (protocol §4).
5. Update `CHANGELOG.md` and, for architecturally significant decisions,
   add a new `ADR/NNN-*.md`.

## Known risks identified during Phase 0 (not yet acted on)

| Risk | Where | Why it matters | Which phase should own it |
|---|---|---|---|
| 153 `.innerHTML` sites vs 116 `escapeHtml` sites — exact per-site safety not yet classified | Frontend | Core of `/nexus-security`'s XSS remediation scope | Phase 1 |
| 20 modal dialogs, only 3 flow-tested in Phase 0 | Frontend | Modularization (Phase 2) risks behavior drift in untested modals | Phase 2 (pre/post regression gate) |
| No CORS origins configured by default (`NEXUS_CORS_ORIGINS=`) | Backend/deployment | Correct-but-easy-to-misconfigure; worth a clear onboarding note | Phase 4 (UX/onboarding) |
| `sw.js` service-worker behavior only observed through a minimal test static server, not a production-like server | Frontend/PWA | Real behavior in production hosting not independently reverified in Phase 0 | Phase 4 (PWA review) |
| No live LLM provider key available in this sandbox | Environment | Full success-path flows (chat/council/swarm with a real model) remain structurally-verified only, not outcome-verified, exactly as in every prior session | Disclosed constant across all phases — not resolvable without Aiham providing credentials |

## Explicitly not planned yet

Phases 1–5's internal task breakdowns are not detailed here beyond what
the protocol itself specifies — each phase's own `/nexus-*` command will
produce its own scoped plan when invoked, per protocol §6 ("لا تنتقل
تلقائياً إلى command التالي").

# BASELINE.md — NEXUS v5.0, Phase 0 Index

**Status: DONE**
**Date**: 2026-09-16
**Branch**: `v5.0-polish`
**Sources locked** (per Aiham's explicit instruction — no diff against
4-3-5-2 performed or claimed):
- `frontend/neural_nexus_ai_agents-4-3-5-3.html` (frontend ground truth)
- `src-baseline/nexus-backend/` from `nexus-backend-resilience-verified.zip` (backend ground truth)
- `FINAL-HTML-INTEGRATION-REPORT.md` (documentary context only, not evidence)

This file is the single index required by protocol §9. Every claim in
`baseline/INVENTORY.md`, `baseline/FLOWS.md`, and `baseline/METRICS.md`
traces to one of:

| Evidence file | What it proves |
|---|---|
| `baseline/evidence/build.log` | Clean `tsc` production build |
| `baseline/evidence/npm-audit.log` | 0 dependency vulnerabilities |
| `baseline/evidence/server-boot.log`, `server-boot2.log` | Real compiled-binary boot |
| `baseline/evidence/e2e-run.log` | Real Playwright/Chromium run against the real HTML + real compiled backend, 12/12 checks passed |
| `baseline/evidence/api-routes.txt` | Full 86-route API surface, extracted via grep, not assumed |
| `e2e/baseline-flows.mjs` | The exact, re-runnable script that produced `e2e-run.log` |

**Reproduction (from repo root)**:
```bash
cd src-baseline/nexus-backend && npm install && npm run typecheck && npm run build && npm test && npm audit
cd ../../e2e && npm install && node baseline-flows.mjs
```

## Summary of Phase 0 findings

- Backend: 406/406 tests pass, clean typecheck, clean build, 0 audit
  vulnerabilities — **no regression** from the number recorded at the end
  of the prior session on `nexus-backend-resilience-verified.zip`.
- Frontend: loads cleanly in a real browser, no uncaught page errors
  across the full tested flow set (settings, chat send, Ops Center,
  Workspace). One `eval(` grep hit is a confirmed false positive (a
  comment). `document.write` is confirmed absent.
- Real backend critical-flow behavior (auth enforcement, rate limiting,
  health check) verified against the actual compiled binary via `curl`,
  not assumed from reading code.
- No security fixes, refactors, or behavior changes were made — Phase 0 is
  inventory + evidence only, per protocol §9's absolute rule.

## Exit Gate status (protocol §9)

| Requirement | Status |
|---|---|
| `baseline/INVENTORY.md` | ✅ DONE |
| `baseline/FLOWS.md` | ✅ DONE |
| `baseline/METRICS.md` | ✅ DONE |
| `BASELINE.md` | ✅ DONE (this file) |
| `PLAN.md` | ✅ DONE |
| `CHANGELOG.md` | ✅ DONE |
| `ROADMAP.md` | ✅ DONE |
| `ADR/000-baseline.md` | ✅ DONE |
| Baseline evidence exists | ✅ `baseline/evidence/*` |
| Flows reproducible | ✅ single script + documented `curl`/`npm` commands |
| No unsupported claim | ✅ every number above has a command; see METRICS.md's "not measured" section for explicit non-claims |
| Regression baseline recorded | ✅ 406/406, 0 vuln, clean build/typecheck — this *is* the regression baseline for all future phases |
| No application code modified | ✅ confirmed — see ADR/000-baseline.md §"Verification" |

**Exit Gate: PASSED.**

---

**STOP. Phase 0 complete. Awaiting explicit approval to proceed to
`/nexus-security`, per protocol §6/§9.**

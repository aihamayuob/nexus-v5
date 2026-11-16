# ADR 000 — Baseline Establishment for NEXUS v5.0

**Status**: Accepted
**Date**: 2026-09-16

## Context

Aiham requested a controlled, multi-phase upgrade of NEXUS to a
commercial/research-grade release, governed by a written protocol
(NEXUS v5.0 — Controlled Master Execution Protocol) with hard rules
against broad rewrites, fake evidence, and phase-skipping. Phase 0's job
is to establish ground truth before any change is made.

## Initial state

- Frontend: `neural_nexus_ai_agents-4-3-5-3.html`, 12,036 lines — a newer
  file than the `4-3-5-2` named in the protocol's own §3 source list.
- Backend: `nexus-backend-resilience-verified.zip` — 134 source files,
  58 test files, 406 passing tests at time of baseline, 0 npm audit
  vulnerabilities, matching the terminal state of the prior session's work
  on this codebase.
- Documentary context: `FINAL-HTML-INTEGRATION-REPORT.md`.

## Assumptions

- **4-3-5-3 is the authoritative frontend baseline**, per Aiham's explicit
  instruction overriding the protocol's original `4-3-5-2` reference. No
  diff between the two was requested or performed.
- The zip's contents are trusted as-is (per Aiham's instruction not to
  assume anything beyond what the zip itself contains — consistent with a
  prior session's "fresh from-zip restoration" methodology on this same
  project).
- `FINAL-HTML-INTEGRATION-REPORT.md` is documentary context, not evidence
  — no claim in this baseline cites it as proof of anything.

## Constraints

- No application logic, UI behavior, or architecture changes permitted in
  Phase 0 (protocol §9, absolute rule).
- Every "DONE" claim requires an evidence path + reproduction command
  (protocol §5).
- Context budget discipline (protocol §2) — inspection was done via
  targeted `grep`/structural queries rather than reading the full
  12,036-line HTML or all 134 backend source files end-to-end.

## Decisions

1. Extract the backend zip to `src-baseline/` and copy the HTML to
   `frontend/` unmodified — both are the literal, byte-identical uploaded
   artifacts (no transformation applied).
2. Build a small, reusable Playwright E2E script
   (`e2e/baseline-flows.mjs`) rather than one-off manual browser steps, so
   the same flows can be re-run identically before/after every future
   phase (this *is* the regression harness required by protocol §4).
3. Verify backend critical flows (auth, rate limiting, health) against the
   real compiled binary via `curl`, not by reading the auth code and
   assuming its behavior.
4. Where a real test surfaced an artifact of the test harness itself
   (the `sw.js` MIME-type warning; the CORS rejection under a
   deliberately cross-origin test setup) rather than a genuine app defect,
   this ADR and FLOWS.md say so explicitly rather than either hiding it or
   miscategorizing it as a bug.

## Known limitations (disclosed, not hidden)

- Only 3 of 20 modal dialogs were flow-tested in Phase 0 (Settings, Ops
  Center, Workspace). The remaining 17 are inventoried but not
  individually exercised — flagged in PLAN.md as a required gate before
  Phase 2 modularization.
- No live LLM provider credentials exist in this sandbox, so success-path
  behavior for chat/council/swarm/etc. is structurally verified (correct
  request shape, correct clean-error shape) but not outcome-verified with
  a real model response. This is a pre-existing, disclosed constant across
  every session on this project, not new to Phase 0.
- The exact per-call-site `.innerHTML`/`escapeHtml` correspondence (which
  of the 153 `.innerHTML` sites are actually safe) was not classified in
  Phase 0 — that classification is Phase 1 (`/nexus-security`) work by
  design, not an oversight.

## Evidence model

Every quantitative claim in `baseline/INVENTORY.md`, `FLOWS.md`, and
`METRICS.md` is backed by either (a) a command whose exact output is
reproducible from a clean checkout, or (b) a saved log file under
`baseline/evidence/`. No claim in this ADR or its sibling documents is
based on the protocol document's own text, on the integration report's
narrative, or on memory of prior sessions — all such prior-session claims
are treated as *context*, and were independently re-verified here where
relevant (e.g., the 406/406 test count was re-run fresh in this sandbox,
not copied from the report).

## Verification (that Phase 0 itself followed its own constraint)

The frontend file in `frontend/` is a direct `cp` from the upload with no
subsequent edits — confirmed by matching MD5 checksums:
```
8d00733767b9cddce63c20d34292f11c  (uploaded original)
8d00733767b9cddce63c20d34292f11c  (frontend/neural_nexus_ai_agents-4-3-5-3.html)
```
Likewise, `src-baseline/` is a straight `unzip` with no edits — verified two
ways: a `package.json` checksum spot-check,
```
545dbb880c9a3b675945a0befa90804b  (from the zip, via unzip -p)
545dbb880c9a3b675945a0befa90804b  (src-baseline/nexus-backend/package.json)
```
and a full recursive `diff -rq` between a fresh independent `unzip` of the
original artifact and `src-baseline/nexus-backend/` (excluding only
`node_modules/`, `dist/`, `data/`, and `package-lock.json`, all of which are
`npm install`/`npm run build`/runtime-generated, not part of the source
artifact): **zero differences, exit code 0.**

# ROADMAP.md — Path to NEXUS v5.0 Final Release

> **Alignment note — 2026-11-15.** The section "CURRENT ALIGNMENT" below is the only part of this file that
> describes the present state; it is written from `NEXUS-CURRENT-STATE.md` (UNIFIED STATE 2026-11-14 + the
> 2026-11-15 entry) and the evidence in `docs/`. Everything after the line "HISTORICAL TEXT" is kept unchanged as the
> 2026-09-16 plan (it said "no phase beyond Phase 0 has been started" and used the word "DONE" as a status; both are
> **superseded** — status words are now only VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED).

## CURRENT ALIGNMENT (2026-11-15)
Long-term order (unchanged): Phase 2 Modularization → Reliability/Production Hardening → Commercial Readiness → Research/Advanced Capabilities → Real-world Validation/Productization.

| Track | Status | Basis |
|---|---|---|
| Phase 0 baseline | **VERIFIED** (historical) | `BASELINE.md`, G8.2-CLOSURE snapshot is the owner-designated reference baseline (2026-11-14) |
| Phase 1 security (`/nexus-security`) | **PARTIAL** — executed; later findings F-01, F-03, F-04 fixed; F-05, F-06 open | `PHASE1-SECURITY.md`, `docs/IP-LICENSE-SECURITY-DELTA-2026-11-14.md` |
| Phase 2 modularization (`/nexus-modularize`) | **PARTIAL** — boundary 5 (core) in progress; no slice run since CP-19 | `PHASE2-MODULARIZE.md`, `docs/checkpoints/CP-7…CP-19`, `NEXUS-CURRENT-STATE.md` |
| Reliability / production hardening | **PARTIAL** — no-TLS LAN deployment, restart recovery verified on SQLite, provider timeouts now enforced (D-PT-1); TLS and SRI/CSP tightening open (F-05/F-06); F-03/F-04 closed 2026-11-15 R3 | `docs/REAL-PROVIDER-VALIDATION-2026-11-15.md` §5 |
| Real provider validation | **BLOCKED** (no keys / runtime / network route in the verification environment); harness ready; Anthropic real auth-rejection PASS only | `docs/REAL-PROVIDER-VALIDATION-2026-11-15.md` |
| Protocols: MCP server (read-only) | **VERIFIED within ADR-006 limits**; official third-party client interop 10/10 (SDK 1.32.2) | `e2e/mcp-third-party-interop.mjs` |
| Protocols: MCP client, A2A, Universal Connector SDK | **PENDING** — objectives + acceptance criteria proposed, awaiting owner approval | `ADR/007-protocol-completion-criteria.md` |
| Commercial readiness | **PARTIAL / PENDING** — operational build runnable; license/NOTICE, image provenance, real devices/browsers, WCAG audit, hosting all open | `docs/OPERATIONAL-BUILD.md`, `docs/BUYER-EVIDENCE-AND-IP-FILE-2026-11-15.md` |
| Research / advanced capabilities | **PENDING** (not started; no real objective approved) | — |
| `V5.0-RELEASE-REPORT.md` | **PENDING** — gated on every phase passing its own exit gate | — |

Nothing above was committed, tagged, released, pushed or deployed; the working tree has no `.git` (archive), so the live repository is not modified by this work.

## HISTORICAL TEXT (2026-09-16 — kept for traceability; superseded where it conflicts with the table above)

This described the *path*, not the execution — at that date no phase beyond Phase 0 had
been started. See PLAN.md for gates and protocol §6 for the command
sequence that will actually trigger each step.

## Where we were (as of 2026-09-16)
**Phase 0 (`/nexus-baseline`) — recorded then as "DONE" (historical wording; current status VERIFIED).** A reproducible, evidence-backed
snapshot of NEXUS v5.0 exists on `v5.0-polish`. This is the regression
floor every later phase is measured against.

## Where we're going

1. **`/nexus-security`** — close the gap between the 153 `.innerHTML`
   sites and the 116 `escapeHtml` sites (exact classification is Phase 1
   work, not done yet); safe Markdown rendering; message cap/archive;
   image GC; PromptInjectionGuard integration points; import preview +
   confirmation. Exit gate: security regression tests + no behavior
   change to working features.

2. **`/nexus-modularize`** — extract the 408-function, 12,036-line single
   file into ES module boundaries (core/agents/modes/security/storage/UI/
   ops-center/workspace/utilities) in three sub-steps (2a extract-only,
   2b boundary tests, 2c `main.js` wiring), never mixing a logic change
   with a move in one commit. Exit gate: ≥70% meaningful coverage on
   critical modules, all 20 modals behavior-preserved (the gap flagged in
   PLAN.md's risk table gets closed here).

3. **`/nexus-reliability`** — delta persistence, `LoadingManager`,
   cancellation/`AbortController`, offline queue, CSP hardening. Exit
   gate: every async operation has an explicit
   idle→loading→success/cancelled/failed lifecycle.

4. **`/nexus-commercial`** — onboarding, empty states, RTL/accessibility,
   *measured* Lighthouse/FCP/bundle metrics (no claims without numbers),
   full CSP/HSTS/framing/XSS/CSRF review. Exit gate: every unmet criterion
   is honestly `PARTIAL`/`PENDING`, never `DONE` without evidence.

5. **`/nexus-research`** — `ARCHITECTURE.md`/`API.md`/`SECURITY.md`/
   `ETHICS.md`/`RESEARCH.md`/`BENCHMARKS.md`, real (not fabricated)
   Arabic/English benchmark infra. Exit gate: every experiment is
   versioned + seeded where applicable + has raw data; anything not
   actually run is marked `PENDING — DATA NOT EXECUTED`, never invented.

6. **`V5.0-RELEASE-REPORT.md`** — only after all five phases pass their
   own exit gates, per protocol §15.

## Constants across every phase (disclosed once, applies throughout)
- No live LLM provider credentials in this sandbox → full success-path
  flows stay structurally-verified, not outcome-verified, at every phase.
- `Update Manager` and `Google OAuth` roadmap items (from the broader
  nexus-backend roadmap, pre-dating this protocol) remain BLOCKED on
  external credentials only Aiham can provide — unrelated to v5.0 polish
  scope but noted here for completeness.

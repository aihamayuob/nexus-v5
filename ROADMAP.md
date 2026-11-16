# ROADMAP.md — Path to NEXUS v5.0 Final Release

This describes the *path*, not the execution — no phase beyond Phase 0 has
been started. See PLAN.md for gates and protocol §6 for the command
sequence that will actually trigger each step.

## Where we are
**Phase 0 (`/nexus-baseline`) — DONE.** A reproducible, evidence-backed
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

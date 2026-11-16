# ADR 002 — Phase 2 Modularization: Window-Bridge Pattern & Boundary Order

**Status**: Accepted
**Date**: 2026-09-17

## Context

The app is a single 12,036-line classic `<script>` where all 410
functions share one global scope, and 168 inline HTML event-handler
attributes (`onclick="fn(...)"`) resolve `fn` as a bare global
identifier. Protocol §11 requires real ES modules and a `main.js`
bootstrap, but ES modules do not share the classic script's scope.

## Decision 1: window-bridge, not a full rewrite to addEventListener

Extracted functions are re-exposed via explicit `window.fn = fn`
assignments in `main.js`, rather than converting the 168 inline
`onclick="..."` attributes to `addEventListener` calls. Rejected the
addEventListener approach because: (a) it would touch all 168 call sites
in a single pass — exactly the "broad rewrite" Aiham's rules forbid; (b)
Aiham explicitly required legacy compatibility; (c) it provides no
benefit over the bridge for boundaries (like this one) that no inline
handler even references. Each future boundary keeps using this same
bridge; a later phase can reconsider inline handlers as its own
dedicated, separately-tested change if ever wanted.

## Decision 2: extraction order is risk-driven, not architecturally "neat"

Protocol lists boundaries in the order core/agents/modes/security/
storage/UI/ops-center/workspace/utilities. "security" was done first
anyway, out of that order, because it scored lowest on every objective
risk criterion checked (zero state deps, zero inline-handler refs, zero
top-level call sites). Extraction order is being driven by verified risk,
not by the order boundaries happen to be listed in the protocol text —
the protocol's own emphasis on incremental, tested, behavior-preserving
extraction implies risk-ordering is the right reading, not documentation
order.

## Decision 3: main.js also owns startup orchestration, not just re-exports

Discovered during this round (see PHASE2-MODULARIZE.md's regression
section) that the monolith calls `autoInitApp()` and four other
functions as true top-level statements — meaning ANY module-based
extraction would eventually hit this same ordering problem the moment an
extracted function sits anywhere in that startup call chain, which
`bufToB64` (via `autoInitApp`'s device-key persistence) already does.
Rather than patch around this narrowly (e.g., special-casing just the one
affected call), the decision is to make `main.js` own the entire startup
sequence permanently, now, so every future boundary extraction benefits
from the same guarantee: by the time `main.js` runs anything, its own
imports have already resolved. This directly fulfills protocol §11's
"main.js يجب أن يصبح bootstrap/orchestration entry point، لا monolith
جديداً" — orchestrating startup order *is* that entry point's job, not
scope creep introduced by this ADR.

## Decision 4: byte-identical extraction, verified by diff script

Every extracted function body was compared character-for-character
against its pre-extraction source via a small Python diff script (see
this session's tool history), not just visually reviewed. This is the
same rigor standard Phase 0 applied to confirm the uploaded artifacts
were untouched (`ADR/000-baseline.md`'s md5sum/recursive-diff
verification) — applied here to confirm the *extraction itself*
introduced no incidental changes.

## Consequences

- The app is no longer literally one file. This is an intentional,
  protocol-mandated consequence of modularization, not an accidental
  scope expansion — see PHASE2-MODULARIZE.md's PWA/`file://` section for
  the concrete, disclosed follow-up this creates (`sw.js` cache list).
- Every future boundary extraction must re-run the same top-level
  execution-order check performed here — including the transitive case
  (does anything called from a top-level statement, directly or via
  another function, touch the boundary being extracted?) — since a
  same-boundary function without any *direct* top-level call site can
  still be reached *indirectly*, as `bufToB64` was through `autoInitApp`.
  This check is now written up as a documented, repeatable step (see
  PHASE2-MODULARIZE.md's roadmap section) rather than an ad hoc thing
  done once.

## Verification

See `PHASE2-MODULARIZE.md` for the full evidence table: backend 406/406
(untouched), new Vitest suite 19/19 (95.83%/100%/100%/85.71% coverage),
and both existing E2E suites (Phase 0: 12/12, Phase 1: 16/16) re-run
clean against the modularized file after the startup-order fix.

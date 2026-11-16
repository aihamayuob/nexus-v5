# ADR 004 — Evidence Integrity: agreement is not evidence (fail-closed Evidence Deltas)

**Status**: Accepted (owner decisions of 2026-10-11, resolving CP-9 §4)
**Date**: 2026-10-11
**Scope**: the Unified Evaluation Engine only (`EvaluationEngine.evaluate()` and its two producers). Not part of Phase 2 core; no relation to ADR-003 or C2/C3.

## Context

`EvaluationEngine.evaluate()` is the only producer of the five-state taxonomy `VERIFIED / SUPPORTED / UNCERTAIN / CONFLICTING / UNVERIFIED`. Its input was
`EvidenceItem{source, content}` — no kind, no provenance. The judge prompt defines VERIFIED as "several independent, trustworthy sources", so the only barrier
against several *agent outputs* (or any unlabeled text) being presented as independent sources was the judge model's behavior, not a rule. `POST /v2/evaluation/claim`
accepts arbitrary `{source, content}` and migration 012 itself anticipates council syntheses and missions as future subjects. CP-9 found the seam (the single choke point
`evaluate()`), measured the effect of a fail-closed policy in a scratch experiment, and stopped because the enforcement changes an existing contract and reaches the Ops
Center UI. The principle to introduce: **no verdict or confidence may be raised merely because several agents agree; an upgrade needs a real Evidence Delta.**

## Decision (the four owner decisions of CP-9 §4)

1. **Fail-closed by default.** An `EvidenceItem` is evidence for a verdict only if it declares a valid `kind`. Valid kinds (exactly six, case-sensitive):
   `INDEPENDENT_SOURCE`, `TOOL_RESULT`, `EXECUTABLE_VERIFICATION`, `ENVIRONMENTAL_OBSERVATION`, `HUMAN_CONFIRMATION`, `CONTRADICTORY_EVIDENCE`. Absent / unknown /
   wrong-case / non-string `kind` ⇒ the item is not an Evidence Delta. No deltas ⇒ the deterministic result `{ran:true, verdict:'UNVERIFIED', confidence:1, counts 0}` with
   reason `CONSENSUS_ONLY` and **no provider call**. Only deltas are shown to the judge.
2. **Explicit evidence-kind selection in the UI.** The Ops Center claim form has a kind selector per evidence row with **no default** (the placeholder is not a kind). A row
   with source and content but no chosen kind blocks the submission as a whole (nothing is sent, no silent partial send). Declaring independence is therefore always an explicit act.
3. **The integrity reason is persisted through an additive migration.** `EvaluationResult.integrityReason` and migration `016` add one nullable `TEXT` column
   `claim_evaluations.integrity_reason`. Values: `NO_EVIDENCE`, `CONSENSUS_ONLY`, `INDEPENDENT_EVIDENCE`, `EXECUTABLE_VERIFICATION`, `CONTRADICTORY_EVIDENCE`; `NULL` for
   pre-016 rows and for `ran:false`. No backfill (an old row's reason cannot be derived honestly). Precedence when several apply: CONTRADICTORY > EXECUTABLE > INDEPENDENT.
4. **This ADR** records the principle and the above.

Guard direction (only lowers, never raises): a declared `CONTRADICTORY_EVIDENCE` delta turns a judge `VERIFIED`/`SUPPORTED` into `CONFLICTING` (confidence `null` — the judge's
number described another verdict; never fabricated — plus a guard note in the rationale). Other judge verdicts pass through untouched. Order of exits is unchanged from before:
provider not configured → `ran:false` (reason `null`) → empty list (`NO_EVIDENCE`) → no deltas (`CONSENSUS_ONLY`) → judge on deltas only.

Producers: web research declares `TOOL_RESULT` for each successfully fetched source (the real `fetchAndExtract` output; a failed fetch is not evidence; the evaluated Gemini answer is never
declared evidence). `POST /v2/evaluation/claim` accepts an optional `kind` per item, keeps only a valid one in the stored/returned evidence and drops anything else (the item itself stays as audit trail).

## Consequences

- **Behavior change of an existing contract (accepted):** any caller of `POST /v2/evaluation/claim` that sends `{source, content}` without `kind` now receives `UNVERIFIED / CONSENSUS_ONLY` with no judge call. The response and
  stored record gain an `integrityReason` field (additive). Existing tests whose purpose needs the judge to run now declare a `kind` in their fixtures (measured impact in CP-16; assertions unchanged).
- Evaluations made through the Ops Center now require a chosen kind per evidence row.
- The persisted evidence keeps non-delta items, so what was submitted can be audited next to the reason it did not count.

## Limits (not solved by this ADR — recorded so they are not forgotten)

- **Declared, not verified.** The engine cannot tell whether an item really is an independent source. An authenticated caller or a user can still label agent output `INDEPENDENT_SOURCE` or `HUMAN_CONFIRMATION`; protection there is the
  authentication boundary and the integrity of internal producers, not this module (CP-9 §6).
- Mirror / same-domain sources (up to 5 links from web research) are not checked for real independence. A fetched page declared `TOOL_RESULT` counts as a delta even if it echoes another.
- No notion of promotion over time: the engine has no prior state; the principle is enforced per call.
- `Verifier` (council / situation room / missions) is a different capability with no taxonomy or evidence input — no seam, untouched.
- The judge's own reading of delta content remains LLM behavior (prompt-injection fencing is unchanged).
- The Ops Center re-render quirk (`opsAddEvidenceRow()` clears typed values and chosen kinds) pre-exists and is not changed here.

## Alternatives considered

- *Backward-compatible default (items without `kind` still count):* leaves the path open by definition — rejected (CP-9 §4.1).
- *Pre-selected kind in the UI (e.g. `HUMAN_CONFIRMATION`):* makes a claim of independence without an act — rejected.
- *Deriving the reason from `evidence_json` instead of a column:* the reason would have to be re-derived by every reader and could drift from what the engine decided — rejected for decision 3.
- *Verifying independence (fetching, domain/mirror analysis, scoring, Bayesian confidence):* out of scope; a different, much larger capability.

## Verification

Acceptance criteria written before the change: `baseline/evidence/phase2-evidence-integrity-acceptance-criteria.md`. Evidence, PRE/POST, mutation results, honesty log and limits: `docs/checkpoints/CP-16.md`.

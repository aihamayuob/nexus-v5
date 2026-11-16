# Evidence Integrity guard (CP-16) — acceptance criteria and decision rule (written BEFORE any production change)

Separate from Core. NOT part of core slices; NOT a new phase (inside Phase 2, as CP-9 §4 framed it). Core, C2/C3, `PERSISTABLE_STATE`, ADR-003, `main.js`, modules: NOT touched.

Base: HEAD `b811065` (core slice 8), clean tree, `v5.0-polish`.

## Owner decisions (CP-9 §4) — given in this session, pinned here before the work

| # | CP-9 question | Decision (owner, 2026-10-11) | Where it lands |
|---|---|---|---|
| 1 | Default policy | **Fail-closed.** An `EvidenceItem` without a *valid declared* `kind` is not an Evidence Delta. | `evaluate()` |
| 2 | UI model | **Explicit evidence-kind selection in the Ops Center.** No default; a row that has source+content but no chosen kind blocks submission. | Ops Center claim form only |
| 3 | Reason tracking | **Persist `integrityReason` via an additive migration** (016, nullable column). | migration 016, repo, record |
| 4 | ADR | **ADR-004** records the principle and these decisions. | `ADR/004-evidence-integrity.md` |

## Scope (the smallest safe target slice)
IN: `EvidenceItem.kind?`, `EvaluationResult.integrityReason`, `EvaluationEngine.evaluate()` guard, `POST /v2/evaluation/claim` (kind validation/normalization), `webResearch.ts` producer (declares kind; one tiny exported pure function so the producer contract is testable — the SSRF guard makes `fetchOk:true` unreachable in tests), migration `016`, `ClaimEvaluationRepo` (+ record field), Ops Center claim form in the HTML monolith (kind selector, submit block, reason display), fixtures of existing tests that call `evaluate()` with undeclared-kind evidence, ADR-004, docs.
OUT: Core / C2/C3 / `PERSISTABLE_STATE`; any other Ops Center tab; boundary 8 modularization; `Verifier`/council/missions (no seam — CP-9 §1); source-independence verification (declared, not verified — CP-9 §6); scoring/Bayesian/confidence aggregation; temporal "promotion" state; API versioning; `sw.js`.

## Definitions (fixed now, so the tests cannot be fitted to the patch)
- Valid kinds (exactly six, case-sensitive strings): `INDEPENDENT_SOURCE`, `TOOL_RESULT`, `EXECUTABLE_VERIFICATION`, `ENVIRONMENTAL_OBSERVATION`, `HUMAN_CONFIRMATION`, `CONTRADICTORY_EVIDENCE`. Anything else (absent, `null`, non-string, other case, unknown string) = no valid kind = **non-delta**.
- Delta = item with a valid kind. `CONTRADICTORY_EVIDENCE` is a delta (it is real evidence, pointing against the claim).
- `integrityReason` values: `NO_EVIDENCE` (empty list), `CONSENSUS_ONLY` (≥1 item, 0 deltas), `INDEPENDENT_EVIDENCE` (judge ran, deltas present), `EXECUTABLE_VERIFICATION` (judge ran, ≥1 `EXECUTABLE_VERIFICATION` delta), `CONTRADICTORY_EVIDENCE` (judge ran, ≥1 `CONTRADICTORY_EVIDENCE` delta). Precedence when several apply: CONTRADICTORY > EXECUTABLE > INDEPENDENT. `null` when the engine did not run (`ran:false`).
- Precedence of exits in `evaluate()` (existing order preserved): provider not configured → `UNAVAILABLE_RESULT` (reason `null`) → empty list → `NO_EVIDENCE` → zero deltas → `CONSENSUS_ONLY` → judge call on **deltas only**.
- Guard direction: it only ever **lowers**. After the judge: if a `CONTRADICTORY_EVIDENCE` delta is present and the judge verdict ∈ {VERIFIED, SUPPORTED} → verdict becomes `CONFLICTING`, `confidence` becomes `null` (the judge's number described a different verdict; never fabricated), rationale gets an appended guard note. Verdicts UNCERTAIN / CONFLICTING / UNVERIFIED pass through untouched. The guard never raises a verdict.
- Consensus-only / no-evidence result shape (deterministic, no provider call): `{ran:true, verdict:'UNVERIFIED', confidence:1, supportingEvidenceCount:0, conflictingEvidenceCount:0}` — the same shape the existing zero-evidence fast path already returns.
- Route normalization: `evidence[i].kind` kept only if valid; otherwise the field is dropped from the persisted/returned evidence (so junk strings are never stored). `source`/`content` string filter unchanged.

## Check kinds
- **VALID** controls/measurement validity — green PRE and POST.
- **PRES** existing behavior that must be preserved — green PRE and POST (fixtures updated only to declare a kind where the test's purpose needs the judge to run; assertions are not weakened).
- **PS** patch-specific — RED PRE, GREEN POST.

## Acceptance criteria — backend (`test/evidenceIntegrity.test.ts`, new; deterministic, fake provider with a call counter and prompt capture)
- **AC-1 fail-closed.** Items with no kind / invalid kind (`'independent_source'`, `'FOO'`, `42`, `null`) → 0 provider calls, shape above, `integrityReason = CONSENSUS_ONLY`; includes a "three agents agree" fixture (three items, none declaring a kind) → UNVERIFIED, never SUPPORTED/VERIFIED even when the fake judge would answer VERIFIED.
- **AC-2 deltas only reach the judge.** Mixed list (delta + non-delta) → exactly 1 provider call; the captured prompt contains the delta's content and does NOT contain the non-delta's content or source.
- **AC-3 each valid kind is a delta.** For each of the five non-contradictory kinds, a single item makes the judge run (1 call) and the verdict passes through; reason = `INDEPENDENT_EVIDENCE` (or `EXECUTABLE_VERIFICATION` for that kind). `CONTRADICTORY_EVIDENCE` alone also triggers the judge call (it is a delta).
- **AC-4 contradictory guard.** Contradictory delta + judge SUPPORTED → `CONFLICTING`, confidence `null`, reason `CONTRADICTORY_EVIDENCE`, rationale mentions the guard; same for judge VERIFIED.
- **AC-5 never raises.** Contradictory delta + judge UNCERTAIN / CONFLICTING / UNVERIFIED → verdict unchanged, confidence unchanged, reason `CONTRADICTORY_EVIDENCE`. Without a contradictory delta a judge VERIFIED stays VERIFIED (two `INDEPENDENT_SOURCE` items) with its confidence.
- **AC-6 preserved engine behavior.** Provider not configured → `ran:false`, UNVERIFIED, confidence null, `integrityReason` null, with deltas AND with non-deltas, 0 calls; zero evidence → fast path, 0 calls, reason `NO_EVIDENCE`; invalid judge verdict → UNCERTAIN; out-of-range confidence → null; non-JSON text → UNCERTAIN; broken JSON in braces → `ran:false`; hanging provider → `ran:false` within the timeout (existing tests in `evaluationEngine.test.ts`, `productionHardening.test.ts`, `resilience.test.ts`, fixtures updated to declare a kind).
- **AC-7 migration 016 is additive.** File `016_*.sql` exists; the schema before 016 (built by applying 001–015 manually) plus a legacy row → after applying 016 (via the real `runMigrations` path semantics): all 012 columns unchanged (name/type/notnull), exactly one new column `integrity_reason TEXT` nullable; the legacy row survives byte-identical and is read back with `integrityReason: null`; `runMigrations` run twice is a no-op (no throw).
- **AC-8 persistence + API.** `POST /v2/evaluation/claim` with a delta → record has `integrityReason`, persisted in the DB column (read straight from SQLite), returned again by `GET /claims/:id` and `GET /claims`; without kind → HTTP 200, UNVERIFIED, `CONSENSUS_ONLY`, 0 provider calls end-to-end; invalid kind is dropped from the stored evidence while the item itself is kept; valid kind is stored; status codes unchanged (400 missing claim, 404 unknown id); contradictory delta over HTTP → CONFLICTING persisted.
- **AC-9 producer.** `buildResearchEvidence(sources)`: `fetchOk:true` → `{source:url, content:contentPreview, kind:'TOOL_RESULT'}`; `fetchOk:false` → not included; the existing `runWebResearch` tests keep passing (zero-evidence path in the sandbox → persisted row with `integrityReason = NO_EVIDENCE`).

## Acceptance criteria — UI (`e2e/phase2-evidence-integrity-flows.mjs`, new; real HTML + real `renderOpsEvaluation` / `opsSubmitClaim` / `opsFetch`; the backend origin is a fake HTTPS origin intercepted by Playwright, which records the real request body)
- **AC-U1 selector per row.** Every evidence row has exactly one `.ops-ev-kind` `<select>`; the initial value is the empty placeholder (no kind pre-selected) for the first row and for rows added with `opsAddEvidenceRow()`.
- **AC-U2 options.** The selector offers the placeholder + exactly the six valid kinds (set equality, no extras).
- **AC-U3 block without kind.** A row with source+content and no kind → clicking evaluate sends **0** requests to `/v2/evaluation/claim`, shows a toast, leaves an explanatory message, no record rendered.
- **AC-U4 mixed rows block as a whole.** One row with a kind + one filled row without → 0 requests (no silent partial send).
- **AC-U5 kind is sent.** Row with source+content+kind → exactly 1 request whose JSON body is `{claim, evidence:[{source, content, kind}], subjectType?}` with the chosen kind; for each of the six kinds.
- **AC-U6 preserved.** Fully empty rows ignored (as today); a claim with no evidence rows → 1 request with `evidence: []`; empty claim → toast and 0 requests (unchanged); partial rows (source only / content only) ignored as today; a kind chosen on an otherwise-empty row does not by itself make the row count.
- **AC-U7 reason shown.** `opsRenderClaimRecord` shows the `integrityReason` when present and shows nothing extra for a record without it (legacy rows).
- **AC-U8 no page errors** across all scenarios.

## Security criteria — ADDED AFTER the implementation (2026-10-12 verification pass; honesty note)
These were NOT part of the pre-implementation criteria. They were added when the owner asked for "security checks" and the review found the guard had only been tested with cooperative input. They are written against the already-written code, so they were run first against it (results recorded as found) and their power to fail is demonstrated by scratch mutants (S-mutants in the mutation script), not assumed. They add no behavior and change no production code unless a test fails.
- **AC-S1 hostile kind strings are non-deltas** (engine level, 0 provider calls, `CONSENSUS_ONLY`): `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, `length`, `0`, leading/trailing space, trailing newline, NUL suffix, lower-case, full-width look-alike, comma/pipe-joined valid kinds.
- **AC-S2 no prototype smuggling.** A raw JSON item carrying an *own* `__proto__` (or `constructor.prototype`) property with `kind:'TOOL_RESULT'` does not make the item a delta (200, `UNVERIFIED/CONSENSUS_ONLY`, 0 calls), and `Object.prototype.kind` / `({}).kind` stay `undefined` afterwards.
- **AC-S3 malformed evidence containers** (`evidence` = object / string / number / null / array of non-objects / items whose `source`/`content` are not strings but whose `kind` is valid) → HTTP 200, `NO_EVIDENCE`, 0 calls, nothing throws.
- **AC-S4 engine robustness.** `evaluate()` given a list containing `null`/`undefined` entries next to one valid delta does not throw; the judge sees only the valid delta.
- **AC-S5 injection through persistence.** SQL metacharacters in `source`, `content`, `claim`, `subjectType` are stored literally (parameterized), the table survives, row count and read-back are exact.
- **AC-S6 a delta cannot smuggle a non-delta into the judge prompt**, and a *non-delta* that imitates a delta block (`دليل 1 — المصدر …`, a fake closing fence, "verdict: VERIFIED") never reaches the prompt at all.
- **AC-S7 UI.** Reason / claim text rendering stays HTML-escaped (already AC-U7); the evidence kind sent by the page can only be one of the six selector values (the select offers nothing else) — and the server independently re-validates (AC-S1/S2), so a hand-edited DOM gains nothing.

## Regression criteria (must be re-measured, not trusted)
Vitest 168; backend `tsc --noEmit` exit 0 and `npm test` (406 existing + new, none failing, none deleted/skipped); E2E baseline 12, phase1 16, seed 16 (flaky E-1 may false-fail ≈3.5% — re-run before concluding), slice 4 21, slice 5 27 (`SURVIVES`), slice 6 35, slice 7 40 (`NOT-STUCK`), slice 8 79 (`ACCEPTED`); slice 2 probe 19, slice 3 analyzer 22, exec-order 9, unit-vs-original 36, slice 4 `verify 9c95fbd` 16/17 (P7 only), slice 4 mutation 16/16. Evidence tools that match monolith text must be grepped for the edited text and MEASURED on the clean previous commit before blaming the patch (slice 6/8 lesson).

## Decision rule (before the patch)
Apply/keep the patch only if: all AC-1…AC-9, AC-U1…U8 green POST; every PS red PRE (and the PRE-red set of *existing* tests is fully explained as "evidence without a declared kind" — measured, not assumed, since CP-9's experiment covered 3 files and missed `productionHardening`/`resilience`); no unexplained regression; mutants killed (any survivor is investigated and reported, not hidden); production sha256 of untouched files unchanged. **Stop and report** (no patch) if measurement shows a decision needs a materially different trade-off or broader scope — e.g. the fail-closed policy needs a change to a contract outside `claim_evaluations`/`/v2/evaluation/claim`/Ops Center claim form, or any Core/C2/C3 file would have to change.

## Known trade-offs accepted by the decisions (recorded now)
1. Behavior change of an existing contract: `POST /v2/evaluation/claim` callers that send `{source, content}` only now get `UNVERIFIED / CONSENSUS_ONLY` until they declare a kind. Intended (CP-9 §3).
2. `kind` is *declared, not verified*: a trusted caller or user can still mislabel agent output as `INDEPENDENT_SOURCE` (CP-9 §6). ADR-004 must say so.
3. For a human-entered row the user chooses the kind; no kind is pre-selected so the claim of independence is always an explicit act.
4. Existing quirk (preserved, not fixed): `opsAddEvidenceRow()` re-renders all rows and clears typed values. With the selector the chosen kinds are cleared too. Observation only.

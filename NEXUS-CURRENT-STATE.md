# NEXUS-CURRENT-STATE

> Dynamic state document. Written ONLY from evidence gathered in the session
> that produced it (2026-10-07; Evidence Integrity and core slice 3 entries: 2026-10-09). Not a plan.
> If the repository disagrees with this file, the repository wins. Created in the
> core slice 1 commit (`4c3e169`); updated by the core slice 2 commit and by the
> Evidence Integrity inspection commit (docs/evidence only — see `docs/checkpoints/CP-9.md`) and by
> the core slice 3 commit (read-only state map, docs/evidence only — see `docs/checkpoints/CP-10.md`) and by
the core slice 4 / C1 commit (first code-changing core slice — see `docs/checkpoints/CP-11.md`) and by
the core slice 5 commit (evidence-only runtime test of I-1, no production change — see `docs/checkpoints/CP-12.md`) and by
the core slice 6 commit (I-1 handled via option O2; production change = `frontend/main.js` startup tail only — see `docs/checkpoints/CP-13.md`) and by
the core slice 7 commit (evidence-only runtime test of the `isSendingMessage` finding of CP-13 §8: CONFIRMED STUCK; no production change — see `docs/checkpoints/CP-14.md`) and by
the core slice 8 commit (fix of the stuck `isSendingMessage`; production change = `sendMessage()` in the HTML monolith only, +5/−2 — see `docs/checkpoints/CP-15.md`) and by the Evidence Integrity guard commit (SEPARATE from core: backend engine/route/producer/repo + additive migration 016 + the Ops Center claim form in the monolith + ADR-004 — see `docs/checkpoints/CP-16.md`; written 2026-10-11) and by core slice 9 (C2/C3 ownership decision preparation by measurement + ADR-003 review; evidence/docs only, NO production change, uncommitted at the time of writing — see `docs/checkpoints/CP-17.md`; written 2026-10-12).

## UNIFIED STATE — 2026-11-14 (Operational Test Build; owner full-authorization mandate)

Written from evidence gathered in the 2026-11-14 session. Supersedes nothing below: historical entries stay as written; where they disagree with this block about the **current** tree, this block (and the repository) wins.

- **Working tree identity**: new Git history rooted at the G8.2-CLOSURE `A-source-snapshot` (SHA256SUMS 997/997; fingerprint `abd33066…c588`) → five-file patch `b564b40f…f927` applied after pre-image hash match → F-01 → hardening → MCP slice. See `docs/OPERATIONAL-BUILD.md` §1 and `git log`.
- **Phase**: Phase 2 Modularization remains **PARTIAL** (no modularization slice was run in this session). This session is an *integration + operational-proof* effort, not a phase transition.
- **Verified at final commit** (clean install → typecheck → build → tests → E2E → scenarios → UI demo, all exit 0, simulated models only): backend 638/638, Vitest 186/186, 17 E2E scripts ACCEPTED, operational scenarios 38/38, launcher UI demo 7/7. Evidence: package `verification/verify-final2/`.
- **Changes**: F-UI-1/F-UI-2 patch applied (VERIFIED); F-01 `/api/embed` now authenticated (VERIFIED); `tsx` pinned devDependency; E2E scripts path-portable; `scripts/nexus-run.mjs` one-command runner; `scripts/verify-all.sh`; MCP read-only server (ADR-006, VERIFIED within limits).
- **PENDING / not implemented**: A2A, Universal Connector SDK, MCP client, effectful MCP tools. **UNVERIFIED**: any real model provider, real devices, Safari/Firefox, TLS, third-party MCP client interop. **Not deployed / not published.**
- **Open findings for owner decision**: see `docs/OPERATIONAL-BUILD.md` §6 and `docs/IP-LICENSE-SECURITY-DELTA-2026-11-14.md`.

## Current Phase
Phase 2 — Modularization (`/nexus-modularize`): **PARTIAL**
(branch `v5.0-polish`).

## Current Boundary
Boundary 5/9 "core": **PARTIAL** (slice 1 VERIFIED; slice 2 VERIFIED as an evidence-only
slice; slice 3 VERIFIED as a static read-only map — runtime behavior UNVERIFIED; slice 4 / C1 VERIFIED (Chromium 141 only);
slice 5 VERIFIED as an evidence-only runtime test (I-1 CONFIRMED = LOST, Chromium 141 + emulated offline only);
slice 6 VERIFIED (I-1 handled via O2 for `activityLog`, Chromium 141 headless + emulated offline only; other variables UNVERIFIED);
slice 7 VERIFIED as an evidence-only runtime test (`isSendingMessage` stuck after an offline send attempt — CONFIRMED, Chromium 141 headless + emulated offline only);
slice 8 VERIFIED (that defect FIXED in `sendMessage()`, Chromium 141 headless + emulated offline + injected faults only);
everything else in core PENDING).
Boundaries 1–4 (security, storage, utilities, settings): VERIFIED (earlier work,
historical evidence; re-confirmed only indirectly by this session's regression runs).
Boundaries 6–9 (agents, modes, ops-center, workspace) and the UI-remainder: PENDING (the Evidence Integrity commit touched only the claim-evaluation form of the Ops Center inside the monolith; nothing was moved or modularized).
Evidence Integrity (separate from core, inside Phase 2): **VERIFIED within the CP-16 limits** (was BLOCKED until the owner decisions of 2026-10-11).
Core slice 9 (CP-17): **VERIFIED as an evidence/docs-only slice** (scratch prototypes, Chromium 141 only); **C2/C3 ownership mechanism: BLOCKED on owner decisions D1–D4 (CP-17 §3)**; ADR-003: reviewed, factual Erratum appended, Decision unchanged.
Core slice 10 (CP-18, ADR-005): **VERIFIED for the local behavior of the `agentOrder` pilot** (global-accessor ownership by `modules/state.mjs`; Chromium 141 headless only; one variable only); **release readiness BLOCKED/UNVERIFIED on `sw.js`** (the cache manifest must gain `/modules/state.mjs`, 5 → 6 files); `messages`, `selectedAgentIds` and the other 13 variables NOT migrated (still classic `let`s); D2 (owner module) ASSUMED = `state.mjs`. Production changed (UNCOMMITTED): monolith +1/−1, `main.js` +5/−0, new `frontend/modules/state.mjs` and `state.test.mjs`.

## Core slice 11 (CP-19) — characterization of `fullAgentPrompt`
**VERIFIED within its limits** (Chromium 141.0.7390.37 headless, fake backend with two endpoints, no live LLM; no production change; test committed in `80c558a`; documented in `docs/checkpoints/CP-19.md`; evidence in `baseline/evidence/phase2-core-slice11/`). Result: ACCEPTED, VALID 19/19, PRES 42/42 (6 runs on the Slice 10 tree, 3 on a clean `bc05f58` clone ⇒ independence from Slice 10 **VERIFIED**, 3 on `80c558a`); re-run again in the release-hardening session: ACCEPTED 19/19 + 42/42. Mutation: **PARTIAL** (24 REJECTED, MU23 expected survivor, **MU05 INVALID — owner decision, not reopened**). Frozen criteria are unmodified (`b82d27c2…8979`). `ContextFabric` stays classic and `NexusContext` is not moved (decision D5; any later move only by explicit injection). Core and Phase 2 remain **PARTIAL**.

## Current TARGET SLICE
**Core slice 10 — C2 pilot: `agentOrder` ownership via the global-accessor mechanism (CP-18, ADR-005): VERIFIED locally (Chromium 141 headless); release BLOCKED/UNVERIFIED on `sw.js`.** Criteria were written and frozen BEFORE any production edit (`baseline/evidence/phase2-core-slice10-acceptance-criteria.md`; the "previous" criteria file the owner referred to did not exist — CP-18 §0).
Change: `frontend/modules/state.mjs` owns `agentOrder` and exports `installGlobalStateAccessors(target)` (accessor, `configurable:true`, `enumerable:false`); `main.js` imports it and calls it after the bridges and before `window.applyTheme()`; the classic `let agentOrder` line was replaced by a pointer comment (a surviving `let` would silently shadow the accessor — mutant M5). `PERSISTABLE_STATE` text unchanged.
Measured (fresh, PRE on the unmodified tree == POST except as stated): backend tsc 0 / 472; Vitest 168 → 178 (+10); E2E 12/16/16/21 (seed-flows showed the known E-1 flake once: 15/16 then 16/16); slices 5–8 27/35/40/79 with the same verdicts; EI UI 26/26; slice 2 probe 19/19; slice 3 analyzer 23/23 after a logged adaptation (it crashed on the removed declaration before; control on HEAD 22/23); slice 4 verify 15/17 after a logged adaptation (12/17 before; only P7/P7b time-bound failures remain); slice 4 mutation 16/16 killed, slices 5/6/8 mutation 3/3, 6/6, 7/7; slice 7 mutation script not applicable by design. New E2E `e2e/phase2-core-slice10-flows.mjs`: PRE REJECTED (VALID 9/9, PRES 12/12, PS 0/7) → POST ACCEPTED 28/28; PRE/POST fingerprint comparison 11/11 (window own-property delta exactly `{agentOrder}`; boot module requests delta exactly `{/modules/state.mjs}`; stored-state sha equal). Mutants M1–M3, M5–M8 killed; **M4 (install moved after the startup calls) survives every runtime check and is killed only by the static order check — a runtime test cannot see a mis-ordered install.**
Open / not verified: **`sw.js` not provided — add `/modules/state.mjs` to its cache list and verify offline boot (ADR-005 R1)**; `window.agentOrder` is readable/writable by any script on the page — acceptable for a list of agent ids, NOT to be assumed for `messages` (ADR-005 R2); named-access collision untested (INFERENCE); Chromium only. Phase 2 PARTIAL; boundary 5 core PARTIAL; no further slice approved.

Previous: **Core slice 9 — C2/C3 ownership options measured (CP-17).** (text below is the slice 9 entry as written; its "BLOCKED on owner decisions" wording is superseded for `agentOrder` only by slice 10, and still applies to every other variable.)
**Core slice 9 — C2/C3 ownership + ADR-003 review (CP-17): VERIFIED as evidence/docs only (no production change; Chromium 141 headless, scratch prototypes of `agentOrder`, `messages`, `selectedAgentIds` only). The ownership mechanism itself is BLOCKED on the owner (CP-17 §3, D1–D4); nothing was moved.**
Acceptance criteria and a materiality rule (M1–M4) were written BEFORE any measurement (`baseline/evidence/phase2-core-slice9-ownership-acceptance-criteria.md`). Prototypes ran only on `git clone`s of HEAD (`phase2-core-slice9-ownership-prototypes.mjs`, probe `…-ownership-probe.mjs`); production sha256 unchanged.
Measured (PRE == HEAD `bc05f58`): **PA** explicit store `NexusState.agentOrder` (+8/−5 lines): Vitest 166/168, E2E 12/16/16 ok, slice4 17/21 (bare-name reads), a stray bare-name write silently creates a plain global (classic script is sloppy-mode). **PB** global accessor shim keeping the bare name (+7/−1): Vitest 168/168, E2E 12/16/16/21 and slices 5–8 (27/35/40/79) all unchanged; names become `window` properties. **PB-C3** (`messages` + `selectedAgentIds`, +10/−2): everything green incl. `phase1-security-flows` which assigns `messages = …` by bare name. Probe 8/8 on CTRL/PA/PB/PB-C3; mutants MUT-PA/MUT-PB both 6/8 (probe can fail). Two predictions were partly wrong (P1, P3) — logged in CP-17 §2.
Owner decisions needed: **D1** mechanism (A explicit store / B accessor shim / C bare-name module access / D defer), **D2** owner module (central `state.mjs` vs domain modules later), **D3** C3 policy, **D4** whether an ADR-005 records the choice. Recommendation (not a decision): B for a C2 pilot on `agentOrder` only, in its own slice, as a documented transitional mechanism; C3 untouched until the pilot is verified.
ADR-003 review: Erratum appended (Decision unchanged): claim #2 contradicted for bare-name access (CP-8), #3 contradicted in effect (CP-11 closures passed as parameter), #5 only partly supported (mechanism-dependent), **#6 newly found wrong** (the registry never referenced `ImageStore`/`MessageArchive`/`localStore` — 0 matches at `e58dab9`, `dd3c3a7`, HEAD; `persistState` 2, `autoInitApp` 3, `resetAllData` 4 do).
Limits: Chromium only; PB measured on 3 of 16 variables, PA on 1; `window.x` exists only after `main.js` runs (safe today: analyzer `loadTime = 0`); a new `state.mjs` extends the pending `sw.js` cache-manifest list from 5 to 6 files; Firefox/Safari semantics of bare-name resolution to a global accessor are not tested. `PERSISTABLE_STATE`, the 16 variables, `main.js`, modules, tests, Evidence Integrity: UNTOUCHED. Phase 2 is **not** complete.
Previous: **Evidence Integrity guard (CP-16, ADR-004) — SEPARATE from core: VERIFIED within its limits (backend with a deterministic fake judge; UI in Chromium 141 headless against a fake HTTPS backend origin; no real LLM, no real web fetch, no other browsers/devices).**
Owner decisions (CP-9 §4, given 2026-10-11): (1) fail-closed default; (2) explicit evidence-kind selection in the Ops Center UI (no default); (3) `integrityReason` persisted through an additive migration; (4) ADR-004.
Change: `evaluationEngine.ts` (`EVIDENCE_DELTA_KINDS` ×6, `EvidenceItem.kind?`, `EvaluationResult.integrityReason`; an item without a valid kind is NOT evidence ⇒ deterministic `UNVERIFIED / CONSENSUS_ONLY`, no provider call; the judge sees deltas only; a declared `CONTRADICTORY_EVIDENCE` delta lowers VERIFIED/SUPPORTED to CONFLICTING (confidence `null`), the guard never raises); `routes/v2/evaluation.ts` (valid `kind` kept, others dropped); `webResearch.ts` (`buildResearchEvidence`: fetched sources are declared `TOOL_RESULT`); migration `016_claim_evaluation_integrity_reason.sql` (one nullable TEXT column); `claimEvaluationRepo.ts`; Ops Center claim form (+16/−2: per-row `ops-ev-kind` selector, placeholder not a kind, submit blocked as a whole without a kind, kind sent, reason shown); `ADR/004-evidence-integrity.md`.
Evidence (fresh): acceptance criteria written BEFORE the change (`baseline/evidence/phase2-evidence-integrity-acceptance-criteria.md`). PRE (`b811065`): new backend tests 13 pass / 35 fail (all PS), UI 10/26 REJECTED (PS 0/16). POST: backend `tsc` exit 0 and `npm test` **472/472** (406 + 66 new, 27 of them `[SEC]` security tests), UI **26/26 ACCEPTED** (VALID 4/4, PRES 6/6, PS 16/16), Vitest 168/168. Mutation (`phase2-evidence-integrity-mutation-script.mjs`): controls OK, **35/35 as expected, 34 killed**, one EXPECTED and documented survivor (W3: the wiring of `buildResearchEvidence` into `runWebResearch` is unobservable in the sandbox because the SSRF guard blocks `fetchOk:true`).
Measured impact of fail-closed on EXISTING tests: **11** (CP-9 predicted 9: the extra 2 are `productionHardening` and `resilience`) — fixtures only gained `kind: 'INDEPENDENT_SOURCE'`; no assertion changed.
Evidence tools: slice 4 `extract verify` P2b adapted (reverses the 4 UI hunks, then byte-equality as before; 14/17 → 15/17); `P7b` ("backend untouched since slice 4") is now time-bound like `P7` and was left failing on purpose.
Behavior change accepted by the decisions: `POST /v2/evaluation/claim` without `kind` ⇒ 200 `UNVERIFIED / CONSENSUS_ONLY`; the record gains `integrityReason`.
Limits (also ADR-004): kind is DECLARED, not verified (a trusted caller/user can mislabel); no mirror/same-domain independence check; no promotion over time; `Verifier`/council/missions untouched (no seam); Ops Center re-render clears typed values and chosen kinds (pre-existing quirk). Details, honesty log: `docs/checkpoints/CP-16.md`. Core, C2/C3, `PERSISTABLE_STATE`, ADR-003, `main.js`, modules: UNTOUCHED. Phase 2 is **not** complete.
Historical note: every "Evidence Integrity remains BLOCKED" in the older slice entries below was true when written; it is superseded by CP-16 (above).
Previous: **Core slice 8 — fix of the stuck `isSendingMessage` (CP-14 finding): VERIFIED (Chromium 141.0.7390.37 headless + Playwright offline emulation + injected faults only). Production change: `frontend/neural_nexus_ai_agents-4-3-5-3.html`, `sendMessage()` only (+5/−2, 3-line comment included).**
Fix (candidate F3, chosen from three by measurement on scratch copies, tie-break written before the runs): the `try{` of `sendMessage()` now starts right after the lock `isSendingMessage = true;` and `let taskOutcome = 'ok';` is hoisted above it, so the EXISTING `catch`/`finally` release the lock and the send button on every exit — the offline early `return` and any failure in the preparation code (`ImageStore.save`, `resolveActiveMode`, `startTask`, a missing DOM element). No statement was reordered; `main.js`, modules, backend, ADR, `updateOnlineStatus`, `PERSISTABLE_STATE`, C2/C3 untouched.
Acceptance criteria were written BEFORE the patch (`baseline/evidence/phase2-core-slice8-acceptance-criteria.md`; updated successors of slice 7 AC-4/AC-5/AC-7 plus AC-8 preparation failures, AC-9 offline mid-flight). New `e2e/phase2-core-slice8-flows.mjs` (79 checks: VALID 44, PRES 12, PS 23; click and Enter paths; offline→reconnect; double/in-flight sends; faults E1–E4):
PRE (unmodified `389813f`) **56/79 REJECTED** (PS 0/23); POST **79/79 ACCEPTED** (VALID 44/44, PRES 12/12, PS 23/23), deterministic. Candidates: F1 (lock after the offline check) REJECTED (PS 7/23 — leaves E1–E4), F2 and F3 ACCEPTED. Slice 7 script on the patched tree: `S7-VERDICT = NOT-STUCK` 40/40.
Discrimination (`phase2-core-slice8-mutation-script.mjs`, scratch copies of the patched tree, production sha256 unchanged): 7/7 as expected — CTRL ACCEPTED; K1 revert, K2 offline-only fix, K3 guard condition removed, K4 lock after the `await` → REJECTED; K5 reset removed from `finally`, K6 offline check disabled → INVALID (K6 was predicted REJECTED, measured INVALID; first-run log kept).
Intentional behavior changes (AC-14): (1) an offline send attempt no longer leaves the lock set; (2) a failure in the preparation code is now handled by the existing `catch` (error message in chat, `logActivity`, `logError`; lock and button released; the `sendMessage()` promise resolves instead of rejecting).
New facts: preparation failures E2–E4 left BOTH the lock and `sendBtn.disabled` stuck (E1 only the lock); in the plain path the guard condition `isSendingMessage ||` is redundant because `sendBtn.disabled` is set synchronously — the lock is the only barrier in the `await ImageStore.save` window (image attached).
Evidence-tool regressions caused by the patch were measured and fixed minimally: slice 4 extract-script P2b now reverses the slice 8 block before comparing with the base monolith (15/17 → 16/17, only the time-bound P7); the slice 7 mutation script and the slice 8 candidates script are bound to the pre-fix tree and now exit 2 with a message on a patched tree.
Details, honesty log and limits: `docs/checkpoints/CP-15.md`. Evidence Integrity remains **BLOCKED** and untouched; C2/C3, `PERSISTABLE_STATE`, ADR-003 untouched. Phase 2 is **not** complete.
Previous: **Core slice 7 — runtime test (real Chromium) of the static `isSendingMessage` finding (CP-13 §8): VERIFIED as evidence-only (Chromium 141.0.7390.37 headless + Playwright offline emulation only; NO production change; no patch applied at that time; the defect was fixed by slice 8).**
Result: **`S7-VERDICT = STUCK` — CONFIRMED.** One send attempt while offline (button or Enter) leaves `isSendingMessage === true` (set at monolith L8227, offline early `return` at L8229–8232 precedes the `try/finally` whose `finally` is the only reset, L8436).
After the connection is really back (banner hidden, `navigator.onLine === true`, button enabled, text still in the input) every further send (same entry point, same text) does nothing: Δmessages 0, 0 network requests, no toast — 4/4 runs (3 click + 1 Enter), 47/47 validity checks, deterministic results JSON.
Controls: a normal online send completes and resets the flag; an offline period WITHOUT an attempt does not break sending. Causal check: resetting only the flag makes the very same send work (3/3). A page reload recovers (flag is not persisted). A second offline attempt while stuck shows no toast at all.
Discrimination: scratch mutants 5/5 as expected (CTRL STUCK; M1/M4 = candidate fixes → NOT-STUCK 40/40; M2/M3 → INCONCLUSIVE); production tree sha256 identical before/after. M1/M4 are NOT applied — applying a fix is an owner decision (CP-14 §6).
Remaining evidence checks of CP-13 §9 were run fresh: backend `tsc --noEmit` exit 0 and `npm test` 406/406; slice 4 mutation 16/16 killed, 0 survivors; slice 2 probe 19/19 and slice 3 analyzer 22/22 (clean production tree); exec-order 9/9; unit-vs-original 36/36; slice 4 `verify 9c95fbd` 16/17 (P7 time-bound); Vitest 168/168; E2E 12/16/21/27(`SURVIVES`)/35. Slice 1 extract script is a one-shot migration: N/A, not a gap.
**New finding in evidence tooling (not product):** `e2e/phase2-core-seed-flows.mjs` check `ciphertext-hides-plaintext` is intermittent (`!payload.data.includes('42')` on random base64 ⇒ ≈3.5% false failure; measured 700/20000 and 691/20000; 8/8 reruns 16/16). Script NOT edited (CP-14 §E-1).
Static notes, not run: other exceptions between L8227 and the `try` can also leave the flag `true` (CP-14 §7-N2).
Details, honesty log and limits: `docs/checkpoints/CP-14.md`. Evidence Integrity remains **BLOCKED** and untouched; C2/C3, `PERSISTABLE_STATE`, ADR-003 untouched. Phase 2 is **not** complete.
Previous: **Core slice 6 — I-1 handled via option O2 (`updateOnlineStatus()` runs after `autoInitApp()` settles): VERIFIED (Chromium 141.0.7390.37 headless + Playwright offline emulation only).**
Production change: `frontend/main.js` only (+6/−2): `const bootInit = window.autoInitApp(); window.registerServiceWorker(); … bootInit.finally(() => window.updateOnlineStatus());`
(`.finally` so the call still happens if `autoInitApp` rejects, and the rejection stays an unhandled rejection). Applied only after the pre-written acceptance criteria held
(`baseline/evidence/phase2-core-slice6-acceptance-criteria.md`): new `e2e/phase2-core-slice6-flows.mjs` was 24/35 REJECTED on the unpatched tree (VALID 12/12, PRES 12/12, PS 0/11) and is **35/35 ACCEPTED** after the patch.
Result: the boot-time offline `activityLog` entry now survives on top of the restored log (5/5 plain, 3/3 traced; no-blob, blob-without-key, corrupt-blob and online boots behave as specified); the slice 5 script now reports `SURVIVES` (27/27 validity).
Accepted side effect: the offline banner appears after init completes (measured median ≈ +19…+39 ms, headless only; real-device timing UNVERIFIED). Erratum to CP-12 §6: `updateOnlineStatus` never disables the send button.
Evidence-tool regressions caused by the patch were found by measurement and fixed minimally (slice 4 exec-order A7 and extract P5, slice 3 analyzer startup scan, slice 5 mutation M1) — CP-13 §6. Slice 4 `verify 9c95fbd` P7 was already failing at `fbd7236` (time-bound proof).
Details, honesty log and limits: `docs/checkpoints/CP-13.md`. Evidence Integrity remains **BLOCKED** and untouched; C2/C3, `PERSISTABLE_STATE`, ADR-003 untouched. Phase 2 is **not** complete.
Previous: **Core slice 5 — runtime test (real Chromium) of inference I-1: VERIFIED (evidence-only; Chromium 141.0.7390.37 with Playwright network-offline emulation; no production change; PATCH not executed).**
Result: **I-1 CONFIRMED — LOST.** On an offline boot with a persisted decryptable blob, the boot-time `activityLog` entry (`انقطع الاتصال`) written by
`updateOnlineStatus → logActivity` is overwritten by the later `restorePersistableState` (final `activityLog` == the seeded list exactly; blob lacking the key → `[]`).
Plain run 5/5 LOST, traced run 3/3 LOST with order `offline-entry-write → restore-begin (activityLog=[entry]) → restore-end (=decrypted)`;
positive control (offline boot, no blob) keeps the entry; negative control (online boot + blob) restores exactly and has no offline entry; a post-boot `offline` event survives.
27/27 validity checks; scratch mutants 3/3 behave as expected (M1 scratch reorder → SURVIVES; M2/M3 sabotage → INCONCLUSIVE); production `frontend/` tree sha256 unchanged.
Side observations (inside the same limits): the `#activityList` DOM still shows the entry after boot while memory lacks it; the next `persistState()` persists the log without it; the offline banner itself still shows.
Handling of I-1 was PENDING at the end of slice 5 (CP-12 §6); it was then handled by slice 6 via O2 (above). Nothing was applied in slice 5 itself.
Details, honesty log and limits: `docs/checkpoints/CP-12.md`. Evidence Integrity remains **BLOCKED** and was not touched; C2/C3, `PERSISTABLE_STATE`, ADR-003 untouched.
Previous: **Core slice 4 / candidate C1 — registry-parameter `snapshotPersistableState` / `restorePersistableState` / `resetPersistableState`:
VERIFIED (Chromium 141 only).** The iteration logic moved from the monolith (old L4953–4966) to the end of `modules/storage.mjs`
as pure functions taking the registry explicitly; the monolith keeps three one-line wrappers with the ORIGINAL names/signatures that
pass `PERSISTABLE_STATE`; `main.js` bridges the pure functions as `window.PersistableStateCore` (namespaced on purpose — the plain
names belong to the wrappers). `PERSISTABLE_STATE`, the 16 variables, `persistState`, `autoInitApp`, `resetAllData`, ADR-003: byte-identical.
Evidence (fresh): byte-level extraction proof 17/17; Vitest 168/168 (+36 new, 34 red pre-patch); new real-`autoInitApp` E2E 21/21
(19/21 pre-patch, only the 2 patch-specific checks failing); E2E 12/16/16 unchanged; mutation 16/16 killed, 0 survivors;
execution-order check 9/9; backend `tsc --noEmit` exit 0 and `npm test` 406/406 (confirmatory — change surface excludes backend).
Details, honesty log and limits: `docs/checkpoints/CP-11.md`. Evidence Integrity remains **BLOCKED** and was not touched.
Previous: **Core slice 3 — read-only ownership / initialization / mutation map of `PERSISTABLE_STATE` and its 16 state
variables: VERIFIED (static map only; runtime UNVERIFIED).** Evidence/docs only; no production code, test,
ADR or contract changed (`git diff --stat HEAD -- frontend src-baseline e2e ADR PHASE2-MODULARIZE.md` empty).
Reproducible analyzer `baseline/evidence/phase2-core-slice3-state-map.mjs` (22/22 self-checks, deterministic JSON).
Key FACTS (details + inferences in `docs/checkpoints/CP-10.md`): all 16 are col-0 `let` in the main classic script,
literal-initialized, and the registry's `default()` text equals each initializer (16/16); 15 are declared before
`PERSISTABLE_STATE` (L4931), `errorLog` (L5530) after it — TDZ-safe today because no load-time code touches any;
32 rebind sites outside the registry setters, 47 distinct writer units, 85 reader units; `selectedAgentIds` has 14
rebinds in 7 units (+ setter) and `messages` 17 writer units / 73 in-place mutations; `restorePersistableState` has
3 callers (`autoInitApp`, `pullSyncIfNewer`, `resolveSyncConflict`); `persistState` has 38 caller units and itself
splices `messages` before the snapshot; 0 inline handlers reference the 16 names directly; `main.js`/modules do not
reference them; E2E `phase1-security-flows.mjs` reads and ASSIGNS `messages` by bare name (L169/L175).
Evidence Integrity remains **BLOCKED** (below) and was not touched.
Previous: **Evidence Integrity micro-invariant** (inside Phase 2; NOT a new phase, NOT part of core):
inspect + map + measured experiment + documentation only — guard **BLOCKED** pending owner
decisions (CP-9 §4). No production code, test, API or UI changed. Seam identified:
`EvaluationEngine.evaluate()` (`evaluationEngine.ts` L82–123), the only producer of the
5-state verdict/confidence and the shared choke point of its 2 callers
(`webResearch.ts:165`, `evaluation.ts:43`). Enforcement needs fail-closed on the `EvidenceItem`
contract; a scratch (not applied) experiment broke 9/24 existing tests, and the Ops Center UI
sends evidence with no kind. (Core slice 3 was not started in that session and was not mixed in; it ran later — see above.)
Previous (unchanged below): Core slice 2 — evidence-only browser-level (real Chromium) probe of module access to
classic-script top-level `let`/`const`/`var` by bare name, plus a strictly read-only
check against the real monolith: **VERIFIED**. No production code changed. Stopped at
its stop point.
Previous: Core slice 1 — move `encryptState` / `decryptState` into
`modules/security.mjs`, bridge on `window` in `main.js`: **VERIFIED** (commit `4c3e169`).

## Latest Verified Commit
UPDATE (release-hardening session, 2026-10-15/16): core slices 9 + 10 were committed locally as found in the handoff snapshot (`e17c76d`; no content edits; no remote, no push). The CP-19 test commit is `80c558a`. Read the current HEAD with `git log -1`. Historical text (as written when slices 9/10 were uncommitted): Core slice 9 (CP-17) changed no production code and has no commit of its own at the time of writing; HEAD is still `bc05f58` (Evidence Integrity). Core slice 10 (CP-18) DID change production code (monolith +1/−1, `main.js` +5/−0, new `modules/state.mjs` + `state.test.mjs`) and is also UNCOMMITTED at the time of writing; its evidence files are `baseline/evidence/phase2-core-slice10-*`, `e2e/phase2-core-slice10-flows.mjs`, `ADR/005-global-accessor-state-ownership.md`, `docs/checkpoints/CP-18.md`, and minimal adaptations of `phase2-core-slice3-state-map.mjs` and `phase2-core-slice4-extract-script.mjs`. Its files are uncommitted: `ADR/003` erratum, `docs/checkpoints/CP-17.md`, state docs, `baseline/evidence/phase2-core-slice9-*`.
Latest commit that changed production code: the Evidence Integrity commit (HEAD of `v5.0-polish` at ZIP time; read it with `git log -1`) — backend (`evaluationEngine.ts`, `routes/v2/evaluation.ts`, `webResearch.ts`, `claimEvaluationRepo.ts`, migration 016) and the Ops Center claim form in the HTML monolith (+16/−2). Chain check: `git rev-parse HEAD~1` must be `b811065` (core slice 8), `HEAD~2` = `389813f`, `HEAD~3` = `5770104`, `HEAD~4` = `fbd7236`, `HEAD~5` = `669386b`, `HEAD~6` = `9c95fbd`, `HEAD~7` = `b9d4808`, `HEAD~8` = `0520af7`, `HEAD~9` = `4c3e169`.
Slice 8 chain check (historical, valid when slice 8 was HEAD): the core slice 8 commit (HEAD of `v5.0-polish` at ZIP time; read it with `git log -1`) — `sendMessage()` in the HTML monolith only (+5/−2). Slice 8 chain check: `git rev-parse HEAD~1` must be `389813f` (slice 7, evidence-only), `HEAD~2` = `5770104` (slice 6), `HEAD~3` = `fbd7236`, `HEAD~4` = `669386b`, `HEAD~5` = `9c95fbd`, `HEAD~6` = `b9d4808`, `HEAD~7` = `0520af7`, `HEAD~8` = `4c3e169`. Before slice 8: the core slice 6 commit `5770104` (`frontend/main.js` startup tail only). The core slice 7 commit `389813f` is evidence/docs/test-only (production tree sha256 identical to `5770104`). Before slice 6: the core slice 4 / C1 commit (`669386b`); the core slice 5 commit (`fbd7236`) is evidence/docs/test-only.
Slice 7 chain check (historical, valid when slice 7 was HEAD): `git rev-parse HEAD~1` must be `5770104`, `HEAD~2` = `fbd7236`, `HEAD~3` = `669386b`, `HEAD~4` = `9c95fbd`, `HEAD~5` = `b9d4808`, `HEAD~6` = `0520af7`, `HEAD~7` = `4c3e169`.
Previously: `4c3e169` (core slice 1, VERIFIED).
`0520af7` = core slice 2 commit (evidence-only, VERIFIED, no production change); `b9d4808` = Evidence
Integrity inspection commit (docs/evidence only). `9c95fbd` = core slice 3 commit (docs/evidence only). `669386b` = core slice 4 commit. The core slice 6 commit is HEAD at ZIP time
(a file cannot contain its own hash — read it with `git log -1`); chain check:
`git rev-parse HEAD~1` must be `fbd7236` (slice 5), `HEAD~2` = `669386b`, `HEAD~3` = `9c95fbd`, `HEAD~4` = `b9d4808`, `HEAD~5` = `0520af7`, `HEAD~6` = `4c3e169`.

## Working Tree State
(Evidence Integrity: clean at session start — `git status --short` empty; HEAD = `b811065` (slice 8), chain verified; a temporary local WIP commit was used so the slice 2/3 clean-tree checks could run and was amended into the final commit; the final report states the end check: clean tree, ZIP = HEAD.) Earlier note:
(Slice 8: clean at session start — HEAD = `389813f`, verified against the ZIP name and `git status --short`; the final report states the end check (clean tree, ZIP = HEAD).) Earlier note:
(Slice 7: clean at session start — verified `git status --short` empty; HEAD = `57701044f730e627f62bc43a8d27e87c71ef66d8`; production tree unchanged by the slice; the final report states the end check.) Earlier note:
(Slice 6: clean at session start — verified `git status --short` empty; HEAD = `fbd7236e2b29fbe0f9f4b26c58dc5b1fa967c6f6` as requested; the final report states the end check.) Earlier note:
(Slice 5: clean at session start — verified; the report of the slice 5 commit states the final check.) Earlier note: clean immediately after the core slice 3 commit (verified with `git status --short`
after committing; see the session report). Environment note: the E2E scripts hard-code
`/home/claude/nexus-v5/`; this session ran them from a COPY of the unpacked repo at
that path (outside the original extraction). The slice 2 runner resolves its paths
relative to its own location and needs no hard-coded path.

## Verified Work (slice 2 — commit `0520af7`)
- Real Chromium **141.0.7390.37**. Synthetic classic+module page (layout mirrors the
  monolith), served from a scratch temp dir. Module code reads/writes by bare name:
  - **let**: read OK, write OK (seen by classic), NOT on `window`.
  - **var**: read OK, write OK (seen by classic and `window`), on `window`.
  - **const**: read OK, write throws **TypeError** (value unchanged), NOT on `window`.
  - Live binding both directions (classic write → module read). Module-declared
    `let`/`var` are invisible to the classic script (reverse isolation).
  - Negative controls: undeclared read and write → **ReferenceError**; `typeof` → `"undefined"`.
  - Modules-only control (module B reading module A's `let`/`const`/`var`) → ReferenceError
    ×3, showing the probe distinguishes shared-global from private scope.
- Read-only check on the REAL monolith (no assignments, no calls): 56/56 `let`,
  57/57 `const`, 370/370 functions readable by bare name from an injected module;
  0 mismatches vs. classic global scope; `let`/`const` on `window`: 0; functions: 370/370.
  Integrity: 13 frontend files SHA-256 identical before/after, `git status` on
  production paths empty, app-state fingerprint unchanged.
- Acceptance: **19/19** probe checks; two runs gave identical findings.
- Not exercised by design: writes on the real monolith; `var` on the real monolith
  (it has no column-0 top-level `var`).
- Interpretation and limits: `docs/checkpoints/CP-8.md`. The positive result does NOT
  authorize editing ADR-003, changing the bridge pattern, or changing production code.

## Verified Work (slice 1 — earlier commit `4c3e169`)
- Both functions moved byte-for-byte (only `export` added), proven by the
  extraction script (`byte-identical-after-export-strip: true`).
- Behavior equivalence with the ORIGINAL implementation: byte-identical
  envelopes for the same key+IV, cross-decrypt both directions, identical error
  classes, golden vector generated from the original code.
- Module/bridge integration in real Chromium, including the real
  persist → reload → restore pipeline through `autoInitApp`.
- Execution-order safety re-derived from the AST (no new ordering assumption).

## Test Evidence — core slice 10 session (2026-10-13/14; PRE on the unmodified tree, POST on the patched tree; all fresh; logs `baseline/evidence/phase2-core-slice10-{PRE,POST}-*`)
- Vitest 168 → 178/178; backend `tsc --noEmit` 0 and `npm test` 472/472 (both PRE and POST); E2E `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-seed-flows` 16/16 (POST first run 15/16 = E-1 `ciphertext-hides-plaintext`, re-run 16/16; both logs kept), `phase2-core-slice4-flows` 21/21; slices 5–8 27/27 `SURVIVES`, 35/35 `ACCEPTED`, 40/40 `NOT-STUCK`, 79/79 `ACCEPTED`; EI UI 26/26 `ACCEPTED`; slice 10 E2E PRE REJECTED (VALID 9/9, PRES 12/12, PS 0/7) → POST ACCEPTED 28/28; compare 11/11.
- Layout-bound tools (measured, then minimally adapted — CP-18 §4): slice 3 analyzer 23/23 (control on HEAD 22/23), slice 4 verify 15/17, exec-order 9/9, unit-vs-original 36/36, slice 2 probe 19/19 (on a committed scratch clone).
- Mutation: slice 10 M1–M8 (M4 survives at runtime by design of the test surface), slice 4 16/16, slice 5 3/3, slice 6 6/6, slice 8 7/7; slice 7 N/A; EI mutation not run (EI untouched).
- Honesty log (CP-18 §5): missing criteria file, two harness defects, a request-fingerprint measurement defect in my own E2E (fixed, first PRE file kept), false survivors from running slice 4 mutation in a clone (re-run valid 16/16), a session-interrupted slice 8 mutation run (re-run), one wrong prediction (P6b).

## Test Evidence — core slice 9 session (2026-10-12; production tree == `bc05f58`, unmodified; all fresh)
- PRE == POST (docs/evidence-only slice): Vitest 168/168; E2E `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-seed-flows` 16/16, `phase2-core-slice4-flows` 21/21; slice 5 27/27 `SURVIVES`, slice 6 35/35 `ACCEPTED`, slice 7 40/40 `NOT-STUCK`, slice 8 79/79 `ACCEPTED`; slice 3 analyzer 22/22 and slice 2 probe 19/19 (run on a clean tracked tree: the ADR erratum was set aside during those two runs and restored); exec-order 9/9; unit-vs-original pass; slice 4 `verify 9c95fbd` 15/17 (P7, P7b time-bound, as before).
- Prototype matrix (scratch clones, never applied): `baseline/evidence/phase2-core-slice9-ownership-prototypes-results.json` + log; production sha256 unchanged (`productionUnchanged: true`).
- NOT run: backend `tsc --noEmit` / `npm test` (backend untouched; backend only `npm ci` + `npm run build` for E2E boot), EI mutation, slice 4/6/8 mutation scripts (production untouched). Logs: `baseline/evidence/phase2-core-slice9-{PRE,POST}-*`.

## Test Evidence — Evidence Integrity session (2026-10-11; PRE = unmodified `b811065`, POST = patched tree; all fresh)
- New backend tests (`test/evidenceIntegrity.test.ts` 65 + 1 in `webResearch.test.ts` = 66; 27 are `[SEC]` security tests AC-S1..S6 added after the first implementation pass, green on first run, proven able to fail by mutants X1–X6): PRE (first measurement, 48 tests before the security tests were added) 13 pass / 35 fail (all PS; no PRES failing after fixing 3 mislabeled PRES — first-run log kept). New `e2e/phase2-evidence-integrity-flows.mjs` (26 checks: VALID 4, PRES 6, PS 16): PRE 10/26 REJECTED; POST **26/26 ACCEPTED**.
- Impact of fail-closed measured BEFORE touching fixtures: 445 tests, 433 pass, 12 fail = 11 existing (1 route, 8 engine, `productionHardening`, `resilience`) + 1 test defect of mine (`tsx` launcher in the migration upgrade-path test, fixed). After fixtures (before the security tests were added): 445/445; fresh final pass: backend `tsc --noEmit` exit 0 and `npm test` **472/472**.
- Mutation `phase2-evidence-integrity-mutation-script.mjs`: 5 controls OK; **35/35 as expected, 34 killed** (includes X1–X6 security mutants), W3 expected survivor; U5 reported `INVALID` (kills via C0/PRES/PS; verified by a separate run); production sha256 unchanged.
- Regression POST: Vitest 168/168; E2E `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-seed-flows` 16/16 in the final fresh pass (15/16 on the first run of the earlier pass: known flaky E-1 `ciphertext-hides-plaintext`, then 6/6 reruns 16/16), `slice4` 21/21, slice 5 27/27 (`SURVIVES`), slice 6 35/35, slice 7 40/40 (`NOT-STUCK`), slice 8 79/79 (`ACCEPTED`); slice 2 probe 19/19, slice 3 analyzer 22/22 (clean committed tree); exec-order 9/9; unit-vs-original pass; slice 4 `verify 9c95fbd` 15/17 (P7 + P7b time-bound; 14/17 before the P2b adaptation); slice 4 mutation 16/16 (0 survivors), slice 5 mutation 3/3, slice 8 mutation 7/7.
- Slice 6 mutation (K1–K6) run in the final pass: 6/6 caught, production untouched. NOT run: slice 7 mutation (bound to the pre-fix tree, exits 2), slice 1 extract (one-shot migration). Logs: `baseline/evidence/phase2-evidence-integrity-*`.

## Test Evidence — core slice 8 session (2026-10-11; PRE = unmodified `389813f`, POST = patched tree; all fresh)
- New `e2e/phase2-core-slice8-flows.mjs` (79 checks): PRE **56/79 REJECTED** (PS 0/23); candidates F1 REJECTED (PS 7/23), F2/F3 ACCEPTED; POST **79/79 ACCEPTED** (deterministic). Slice 7 script on the patched tree: NOT-STUCK 40/40 (it was STUCK 47/47 before).
- Mutation `phase2-core-slice8-mutation-script.mjs`: 7/7 as expected (CTRL ACCEPTED; K1–K4 REJECTED; K5, K6 INVALID), production tree sha256 identical before/after.
- Regression POST: Vitest 168/168; E2E `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-seed-flows` 16/16, `phase2-core-slice4-flows` 21/21, slice 5 27/27 (`SURVIVES`), slice 6 35/35; backend `tsc --noEmit` exit 0 and `npm test` 406/406; slice 2 probe 19/19 and slice 3 analyzer 22/22 (clean committed production tree); exec-order 9/9; unit-vs-original 36/36; slice 4 mutation 16/16, 0 survivors; slice 4 `verify 9c95fbd` 16/17 (P7 time-bound; it was 15/17 right after the patch until P2b was adapted).
- NOT run: slice 1 extract script (one-shot migration, N/A). Logs: `baseline/evidence/phase2-core-slice8-*`.

## Test Evidence — core slice 7 session (2026-10-10/11; production tree = `5770104`, unmodified; all fresh)
- New `e2e/phase2-core-slice7-flows.mjs`: 47/47 validity, `S7-VERDICT = STUCK` (4/4 runs); deterministic results JSON (2 runs byte-identical). Mutation `baseline/evidence/phase2-core-slice7-mutation-script.mjs`: 5/5 as expected, production tree sha256 unchanged.
- Vitest 168/168; E2E `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-slice4-flows` 21/21, slice 5 27/27 (`SURVIVES`), slice 6 35/35 (`ACCEPTED`); `phase2-core-seed-flows` 16/16 on 8/8 reruns but 15/16 on the FIRST run (intermittent test defect, CP-14 §E-1).
- Backend: `tsc --noEmit` exit 0; `npm test` 406/406. Slice 4 mutation 16/16 killed, 0 survivors, files restored by sha256. Slice 2 probe 19/19, slice 3 analyzer 22/22 (clean production tree; 18/19 and 21/22 on the first run only because the new uncommitted `e2e/` file counted as a production-path change). Exec-order 9/9, unit-vs-original 36/36, slice 4 `verify 9c95fbd` 16/17 (P7 time-bound).
- Not run (by design): slice 1 extract script (one-shot migration, N/A). Logs: `baseline/evidence/phase2-core-slice7-*`.

## Test Evidence — core slice 6 session (2026-10-10; all fresh; PRE = unmodified `fbd7236`, POST = patched tree)
- PRE: E2E 12/12, 16/16, 16/16, 21/21, slice 5 27/27 (`LOST`), Vitest 168/168; slice 6 acceptance **24/35 REJECTED** (VALID 12/12, PRES 12/12, PS 0/11). One test defect (`hasBlob` read after a `persistState`) was caught by a VALID check and fixed before any verdict.
- POST: slice 6 acceptance **35/35 ACCEPTED**; E2E 12/12, 16/16, 16/16, 21/21; slice 5 script 27/27 with `I1-VERDICT = SURVIVES`; Vitest 168/168; slice 6 mutants K1–K6 **6/6 caught**; slice 5 mutants 3/3 (M1 adapted); slice 4 exec-order 9/9 and unit-vs-original 36/36; slice 3 analyzer 22/22 and slice 2 probe 19/19 (both on a clean committed tree; first run on the uncommitted tree gave 20/22 and 18/19 — see CP-13 §6).
- Slice 4 `extract verify 9c95fbd`: 16/17 (P7 only; identical on the clean `fbd7236` — time-bound proof).
- NOT run: backend `tsc --noEmit`/`npm test` (backend untouched; only `npm run build`), slice 4 mutation script (~7 min), slice 1 extract script.
- Logs: `baseline/evidence/phase2-core-slice6-*`; banner timing observation: `…-banner-delay-observation.log`.

## Test Evidence — core slice 5 session (2026-10-10; production tree unmodified since `669386b`; all fresh)
- Step 1 (E2E runnable from the extracted archive): backend `npm ci` exit 0 + `npm run build` exit 0; `e2e/` `npm ci` fails as before (no lockfile) → `npm install --no-save --no-package-lock playwright@1.56.1`;
  real `chromium.launch()` = 141.0.7390.37; E2E via symlink `/home/claude/nexus-v5` → the extracted dir: `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-seed-flows` 16/16, `phase2-core-slice4-flows` 21/21 (PRE), identical POST.
- New `e2e/phase2-core-slice5-flows.mjs`: 27/27 validity, `I1-VERDICT = LOST`; `baseline/evidence/phase2-core-slice5-mutation-script.mjs`: 3/3 mutants as expected, production tree sha256 unchanged.
- Frontend Vitest 168/168 (5 files, after `npm ci` in `frontend/`). NOT run: backend `tsc --noEmit`/`npm test` (backend untouched; only `npm run build`), slice 2 probe, slice 3 analyzer, slice 4 extract/exec-order/mutation scripts.
- Logs: `baseline/evidence/phase2-core-slice5-*` (PRE/POST E2E, i1-run, i1-results.json, mutation, code-sha256).

## Test Evidence — core slice 4 session (2026-10-09/10; all fresh; PRE = unmodified `9c95fbd`, POST = final tree)
- Vitest: PRE 132/132 (4 files); with the new test file on the unpatched tree 34 failed / 134 passed; POST **168/168** (5 files). `storage.mjs` 96.26% lines.
- E2E: `baseline-flows` 12/12, `phase1-security-flows` 16/16, `phase2-core-seed-flows` 16/16 both PRE and POST; new `phase2-core-slice4-flows` PRE 19/21 → POST **21/21**.
- Byte-level extraction proof `phase2-core-slice4-extract-script.mjs verify 9c95fbd`: **17/17**; exec-order check (acorn) **9/9**; unit tests vs the ORIGINAL implementation 36/36.
- Mutation: 10 unit + 6 E2E, **0 survivors**, files restored (sha256). Backend: `tsc --noEmit` exit 0; `npm test` **406/406** (confirmatory).
- NOT run: slice 2 probe, slice 3 analyzer (neither affected). Logs: `baseline/evidence/phase2-core-slice4-{PRE,POST}-*`.

## Test Evidence — core slice 3 session (2026-10-09, production tree unmodified since `4c3e169`; all fresh)
- Slice 3 analyzer: **22/22**, two consecutive runs → identical JSON (sha256 `a1046086…`); a mutation of the
  new handler check made it fail (21/22) and the script was restored byte-identical (sha256).
- Frontend Vitest **132/132** (4 files). E2E `baseline-flows` **12/12**, `phase1-security-flows` **16/16**,
  `phase2-core-seed-flows` **16/16**. Logs: `baseline/evidence/phase2-core-slice3-*`.
- Backend: `npm run build` exit 0 (needed for E2E `backend-boot`). NOT run: backend `npm test`/`tsc --noEmit`
  (backend untouched), slice 2 probe.
- Environment lessons: `e2e/` has no lockfile (`npm ci` fails) and the unpinned `playwright` is newer than
  `/opt/pw-browsers` → install `playwright@1.56.1` with `--no-save --no-package-lock`; the backend must be built.

## Test Evidence — Evidence Integrity session (2026-10-09, unmodified production tree at `0520af7`)
- Backend: `npm ci` exit 0; `tsc -p tsconfig.json --noEmit` exit 0 (no output); `npm test`
  **406/406** pass, 0 fail (120.0 s). Logs: `baseline/evidence/phase2-evidence-integrity-baseline-*.log`.
- Scratch fail-closed experiment (NOT applied; patch + log kept as evidence): 3 test files,
  24 tests → 15 pass / 9 fail. Proves only the effect of the policy on existing tests.
- NOT run in this session: `npm run build`, frontend Vitest, E2E (12/16/16), slice 2 probe.
  The figures in the next section are from the slice 2 session and are NOT re-measured here.

## Current Test Evidence — slice 2 session (all fresh at that time, final tree of that session)
- Slice 2 probe: `baseline/evidence/phase2-core-slice2-adr003-probe.mjs` → **19/19**
  (log: `…-probe.log`; raw JSON: `…-probe-results.json`).
- Slice 2 regression on the final tree (production paths show NO diff vs `4c3e169`, proven
  with `git diff --stat HEAD`): Vitest **132/132** (4 files; `security.mjs` 100% lines,
  100% funcs, 96.87% stmts, 85.71% branches); E2E `baseline-flows` **12/12**,
  `phase1-security-flows` **16/16**, `phase2-core-seed-flows` **16/16** — all re-run
  after the final documentation edits.
- Vitest: **132/132** (security.test.mjs: 35). security.mjs coverage: 100% lines/funcs.
- E2E `phase2-core-seed-flows.mjs`: **16/16** post; **15/16** pre-extraction
  (only the patch-specific `bridge-identity` fails, by design).
- E2E `baseline-flows.mjs`: **12/12**. E2E `phase1-security-flows.mjs`: **16/16**.
- Backend `npm test`: **406/406**; `tsc --noEmit`: no errors printed. Backend
  untouched (run only to confirm no collateral change).
- Fault injection: 5 function mutations (2–6 failing Vitest tests each) and 2
  bridge mutations (11/17 and 13/17 E2E checks failing); all files restored
  byte-identical by sha256 and re-passed.
- Logs: `baseline/evidence/phase2-core-slice1-*`. Details: `docs/checkpoints/CP-7.md`.
- Backend (re-measured earlier in the same slice 2 session, on the identical production
  tree; not re-run after the documentation-only edits, which cannot affect it):
  `tsc --noEmit` exit 0, `npm run build` exit 0, `npm test` **406/406**.

## Unverified Items
- Evidence Integrity limits (CP-16 §9, ADR-004): fake deterministic judge only (no real LLM); no real web fetch; wiring of `buildResearchEvidence` into `runWebResearch` not observable in tests (mutant W3 survives); UI verified in Chromium 141 headless with `renderOpsEvaluation` mounted into a host element (no click through the real Ops Center tab), fake HTTPS backend origin, no visual/RTL check, no Firefox/Safari/device; `kind` is declared, not verified; mirror/same-domain independence unchecked; `Verifier`/council/missions have no seam.
- Slice 8 limits: Chromium headless 141 + emulated offline + monkey-patched/DOM-removed faults only (models, does not prove, which faults occur in the field); no real device, Firefox/Safari, `sw.js`; the streaming/stop (`AbortError`) branch needs a real backend stream and was not exercised (it is inside the unchanged `try`); exceptions thrown inside the `catch`/`finally` themselves are not tested; the online send reaches only an aborted external request.
- Slice 7 limits: Chromium headless 141 + Playwright network emulation only (no real device, Firefox/Safari, `sw.js`); online follow-up reaches only an aborted external request (no real provider/backend); only the offline early return was tested — other exceptions between `isSendingMessage = true` and the `try` (e.g. `ImageStore.save`, `resolveActiveMode`, `startTask`) are static notes (CP-14 §7-N2).
- Slice 6 limits: Chromium headless 141 + Playwright network emulation only; real-device/slow-IndexedDB banner delay and an IndexedDB promise that never settles are UNVERIFIED; only `activityLog` covered (other variables written before restore remain INFERENCE); `sw.js`-served boot untested.
- Slice 5 limits: Chromium headless 141 + Playwright network emulation only (no real-device offline, no Firefox/Safari); `sw.js`-served boot path untested; DOM entry disappearing on opening the activity panel is an INFERENCE from code; other variables' write-before-restore not tested.
- Behavior in Firefox/Safari (Chromium only).
- ADR-003 (UPDATE 2026-10-12, CP-17): an append-only Erratum now records the review; the Decision text is unchanged. Historical note follows — ADR-003 originally read "cannot close over a `let` declared in a different script's scope".
  Browser-level evidence (slice 2, Chromium 141) does not support that wording for bare-name
  access from module code, but ADR-003 is UNEDITED and the decision to revise it is
  **PENDING** (separate decision). Not tested: moving `PERSISTABLE_STATE` itself, TDZ /
  initialization order in other layouts, closures stored and invoked later from classic,
  writes on the real monolith, Firefox/Safari.
- Slice 9 limits: Chromium 141 headless only; prototypes are scratch (not applied) and cover `agentOrder` (PA, PB) and `messages` + `selectedAgentIds` (PB-C3) — not all 16 variables, no PA for C3 (codemod needed; C3-PA site counts are static analyzer figures = INFERENCE); the `window` accessor timing/Firefox/Safari semantics and accessor performance are UNVERIFIED; `sw.js` still missing.
- `NexusContext.buildAgentContext` live-caller status (static scan found no
  caller in the monolith; not investigated further, not reopened).

## Blocked Items
- **C2/C3 ownership mechanism — BLOCKED on owner decisions D1–D4 (CP-17 §3).** The materiality test written before measuring (M1–M4) held, so no mechanism was applied. Moving ownership of any variable stays blocked until the owner decides.
- **UPDATE (core slice 10, CP-18): the owner approved mechanism B for `agentOrder` ONLY and it was applied and verified locally (ADR-005). `messages`, `selectedAgentIds` and the other 13 variables stay BLOCKED (no decision, no migration); `sw.js` integration BLOCKED/UNVERIFIED.**
- **Evidence Integrity guard — RESOLVED by CP-16 (no longer blocked):** the four owner decisions of CP-9 §4 were given on 2026-10-11 and implemented (fail-closed; explicit kind in the Ops Center; `integrityReason` via migration 016; ADR-004). Remaining limits are in Unverified Items / ADR-004, not blockers.
- `sw.js` is not among the provided artifacts: cumulative cache-manifest
  follow-up (5 files: `/main.js`, `/modules/security.mjs`, `/modules/storage.mjs`,
  `/modules/utilities.mjs`, `/modules/settings.mjs`) cannot be applied. This
  slice added no new file. Must be finalized before Phase 2's Exit Gate.

## Known Risks
- **"Agent agreement → evidence upgrade" path — MITIGATED by CP-16 (VERIFIED within its limits):** an `EvidenceItem` without a valid declared `kind` is no longer evidence (deterministic `UNVERIFIED / CONSENSUS_ONLY`, no judge call); only deltas reach the judge; a declared contradicting delta lowers VERIFIED/SUPPORTED. **Residual:** independence is *declared, not verified* — a trusted caller or user can still label agent output `INDEPENDENT_SOURCE`/`HUMAN_CONFIRMATION`; mirrors/same-domain sources are not checked (ADR-004 §Limits, CP-9 §6).
- **Documentation finding (ADR-003), now with browser-level evidence:** real Chromium 141
  shows module code reading/writing classic top-level `let`/`var` (and reading `const`)
  by bare name, which conflicts with ADR-003's wording. (UPDATE 2026-10-12, CP-17: reviewed — an append-only Erratum was added to ADR-003, Decision unchanged; bridge pattern NOT changed; no ownership mechanism chosen — owner decision D1–D4 pending.)
  Chromium is available here (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
- `autoInitApp` swallows decrypt failures and "starts fresh"; any future change
  to the crypto seam can silently drop user data. The new E2E guards this.
- Remaining core is state-heavy (`PERSISTABLE_STATE`, 16 variables, `selectedAgentIds`
  has 15 write sites in 8 functions — re-derived by slice 3: 14 rebinds in 7 units + the registry setter).
- **Startup write-before-restore — MITIGATED for the offline `activityLog` entry by slice 6 (O2, CP-13); historical description follows (CP-12, slice 5):** `autoInitApp()` is not awaited; on an offline boot `updateOnlineStatus → logActivity`
  rebinds `activityLog` before the async `restorePersistableState` overwrites it, so the boot-time entry is LOST whenever a persisted blob exists (5/5 + 3/3 runs). Low product impact (one informational
  activity-log entry; the offline banner still works). Only `activityLog` was tested; generalizing to other variables is INFERENCE. O2 was applied in slice 6; the generalization to other variables is still INFERENCE.
- **`sendMessage` stuck flag — FIXED by slice 8 (CP-15), VERIFIED within the slice 8 limits (Chromium 141 headless, emulated offline, injected faults).** History: confirmed at runtime by slice 7 (CP-14; `S7-VERDICT = STUCK`): the lock was set before the offline early `return` and the preparation code, outside the `try/finally` that resets it. Now the `try` starts right after the lock. Residual: exceptions inside `catch`/`finally` and the real-stream abort branch UNVERIFIED; real devices/other browsers UNVERIFIED.
- **Evidence-tool defect (CP-14 §E-1):** `e2e/phase2-core-seed-flows.mjs` `ciphertext-hides-plaintext` fails ≈3.5% of runs by chance (substring "42" in random base64). A single 15/16 there is not by itself a product regression; re-run and compare. Not fixed (owner/tools-slice decision).
- **Slice 4 characterization (existing behavior, preserved, NOT protected):** `snapshotPersistableState` is shallow (values are live references) and
  `restorePersistableState` assigns by reference; any deep-copy "improvement" is a deliberate future decision (tests fail on it by design).
- **Test coupling:** moving ownership of `messages` would break/require editing `e2e/phase1-security-flows.mjs`
  (bare-name reads and `messages = …` assignments).
- Slice 3 limits: static analysis only; alias mutation (escape sites) and indirect persistence are not tracked.

## Terminology note (historical "DONE")
`PHASE2-MODULARIZE.md` uses the word "DONE" for boundaries 1–4. That is **historical
wording from before the current six-state status vocabulary** and has intentionally NOT
been rewritten. The authoritative current status model is only:
`VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED`. Read the historical
"DONE" for boundaries 1–4 as the historical claim that they were VERIFIED at the time
(not freshly re-measured here, apart from indirect regression coverage).

## Remaining Scope
Core: `PERSISTABLE_STATE` + 16 state vars, `NexusContext`, `ContextFabric`.
Then agents, modes, ops-center, workspace, UI-remainder; `sw.js`; Phase 2 Exit Gate.

## Next Safe Slice
**No slice is auto-approved.** Core slice 6 (I-1 via O2) and slice 8 (stuck `isSendingMessage` FIXED) are VERIFIED within their stated limits; slice 7 was the evidence-only confirmation. Owner decisions needed before the next code slice:
(a) (closed by slice 6 — I-1/O2 applied; do not redo);
(d) (closed by slice 8 — isSendingMessage fixed; do not redo). Still open and optional: whether to fix the intermittent seed-flows check (CP-14 §E-1) as a separate tools slice;
(b) ownership mechanism for C2/C3 — measured in CP-17; **PARTLY RESOLVED by core slice 10 (CP-18, ADR-005): mechanism B applied to `agentOrder` only**. Still open: whether/how to migrate any other variable (needs its own decision; ADR-005 R2 security-exposure precedent for `messages`), D2 confirmation (`state.mjs` was assumed), and the `sw.js` cache-manifest update (BLOCKED, file not provided). The ADR-003 review is DONE as an Erratum (core slice 9);
(c) (closed by CP-16 — Evidence Integrity decisions made and implemented; do not redo; follow-ups such as verifying source independence or a real-judge/real-fetch measurement would be NEW owner-approved slices, not part of CP-16).
Remaining core: `PERSISTABLE_STATE` + 16 variables (ownership), `NexusContext`, `ContextFabric`; then boundaries 6–9, `sw.js`, Phase 2 Exit Gate.

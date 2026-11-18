# NEXUS-CONTINUATION

## ADDENDUM 22 — 2026-11-15 (R3) — F-03/F-04 closure, full re-verification, dependency audit, IP count correction
Additive, dated. No historical entry modified or deleted. Status words only.

**Owner instruction in force** (2026-11-15, second message): close F-03 and F-04 with tests; re-run full verification incl. the modified `verify-all.sh`; real-provider tests when keys/network exist (never simulation); address vulnerabilities and open IP issues; update docs/continuity. **ADR-007: do not start MCP client / A2A / Connector SDK before the owner sees the decision and criteria and approves.** No commit / push / tag / release / deploy without approval.

**Work performed**: (1) F-03 fixed (`missionRunner.ts`) — RED→GREEN, 4 mutants, SIGKILL scenario; (2) F-04 fixed (`TaskRepo.recordServed`, chat handlers, v2 fast path, `chatService` model handling) — RED (5/7) → GREEN 7/7, 6 mutants; related defect found and fixed: fallback was sent the primary's model name; (3) `verify-all.sh` run twice end-to-end: run 1 one failure (known intermittent E2E check, CP-14 E-1), tool check made deterministic, run 2 **exit 0**; (4) frontend dev-tooling vulnerabilities 6 → 0 via in-major update; (5) embedded images re-inspected: 2, not 6; (6) docs: `docs/F03-F04-CLOSURE-2026-11-15.md` (new), CURRENT-STATE, CHANGELOG, ROADMAP, OPERATIONAL-BUILD §8, IP-DELTA addendum, BUYER file R3.
**Evidence**: backend 653/653; Vitest 186/186 (also after the dependency change); 17 E2E; scenarios 39/39; UI 7/7; real-provider harness PASS 23 / FAIL 0 / BLOCKED 10; MCP interop 10/10; `npm audit` 0/0 — all with SIMULATED models except the one real Anthropic invalid-key check. Logs in package `verification/` (verify-2026-11-15-r3, run-1 flaky log, backend-after-F04).
**Statuses**: F-03 VERIFIED; F-04 VERIFIED; verify-all.sh VERIFIED (exit 0) on this tree; real providers UNVERIFIED / BLOCKED; MCP client/A2A/Connector SDK PENDING; frontend dev vulns closed (VERIFIED by audit); full E2E not re-run after the dev-only dependency change (UNVERIFIED for that interaction, expected none); icon authorship UNVERIFIED; F-05, F-06 open.
**Needs the owner**: (a) ratify or revert the `phase2-core-seed-flows.mjs` tooling change (original preserved); (b) ratify the behaviour change that fallback providers now receive their own configured model; (c) decide ADR-007 (approve / amend / defer); (d) provide keys / a reachable environment and run `e2e/real-provider-validation.mjs`; (e) LICENSE/NOTICE choice; confirm authorship of the 2 icons; (f) F-05/F-06 decisions; (g) approval for any commit/push/release.
**Blockers / risks**: no keys/route for real providers; npm 10.9.9 crashes on dependency mutation for the frontend tree (use npm 11 or `npm ci` only); SBOM stale for the frontend; fallback-with-real-vendor behaviour of the F-04 fix is verified against simulated servers only.
**Exact stopping point**: after documentation and packaging of R3; no protocol work started; nothing committed or published.
**Next authorized action**: only on the owner's reply — ADR-007 decision (then slice M1 with its acceptance criteria), real-provider run results, or the decisions above. No slice auto-starts.


## ADDENDUM 21 — 2026-11-15 — Real-provider validation attempt, re-verification, protocol criteria
Additive, dated. No historical entry modified or deleted. Status words only.

**Owner instruction in force** (2026-11-15): continue the current approved build; start with real-provider validation; then final platform tests; then protocols and commercial package; then unify docs. **No commit / push / tag / release / deploy without the owner's approval. Simulated results never replace real tests.**

**Work performed**: (1) environment probe — no provider keys, no local runtime, only `api.anthropic.com` reachable; (2) `e2e/real-provider-validation.mjs` (R0–R5) — PASS 23 / FAIL 0 / BLOCKED 10; (3) defect D-PT-1 (provider timeout not enforced on chat/stream) found by that harness, fixed in `providers/timeoutFetch.ts` + `providers/index.ts` with 7 unit tests and 3 mutants; (4) full re-verification; (5) `e2e/mcp-third-party-interop.mjs` with the official MCP SDK client 10/10; (6) `ADR/007` (PROPOSED) criteria for MCP client / A2A / Connector SDK; (7) `ROADMAP.md` aligned (historical text kept); (8) `docs/REAL-PROVIDER-VALIDATION-2026-11-15.md`, `docs/BUYER-EVIDENCE-AND-IP-FILE-2026-11-15.md`.
**Evidence**: backend 645/645, Vitest 186/186, 17 E2E verdicts as documented, scenarios 38/38, UI demo 7/7, all on SIMULATED models; real-provider harness and MCP interop as above; logs in package `verification/verify-2026-11-15/`.
**Statuses**: real providers **UNVERIFIED / BLOCKED** (cause: no keys/runtime/route, not a failure); Anthropic real auth-rejection handling VERIFIED; provider timeouts VERIFIED; MCP server VERIFIED within ADR-006 limits + third-party client interop for tested methods; MCP client / A2A / Connector SDK **PENDING**; real devices, other browsers, TLS, WCAG, performance **UNVERIFIED / not done**.
**Blockers**: (a) owner must supply real keys and/or run a local runtime and execute the harness where the providers are reachable (commands in the validation doc §4); (b) owner decision on ADR-007; (c) F-03…F-06, LICENSE/NOTICE, image provenance (unchanged); (d) GitHub write access (unchanged from Addendum 20) — and, anyway, no push without approval.
**Risks**: provider timeout enforcement changes behaviour for non-streaming completions slower than the configured limit (default 60 s cloud / 120 s local) — tune `NEXUS_TIMEOUT_<PROVIDER>_MS`.
**Exact stopping point**: after documentation and packaging of the 2026-11-15 package; no protocol implementation was started; nothing committed or published.
**Next authorized action**: (1) owner runs the real-provider harness with keys and returns `results.json`, or supplies a reachable environment — then evaluate R1/R5 and mark providers; (2) on owner approval of ADR-007, slice M1 (MCP client) with its written acceptance criteria; no slice auto-starts.

## ADDENDUM 20 — 2026-11-14 — Operational Test Build (owner full-authorization mandate)
Additive, dated. No historical entry was modified or deleted. Status words only.

**Owner decisions in force** (message of 2026-11-14): G8.2-CLOSURE + approved patches is the reference baseline; full authorization incl. commit/push/branches/tags/PRs/releases/deploy; five-file patch approved after hash verification; complete the architecture; produce a real integrated testable platform. This supersedes the OD-C5 "no auto-approval" gate for the patch only; it does **not** change the status-word rules or capability-honesty rules.

**Work performed**: baseline committed (`4dbe45b`, SHA256SUMS 997/997); patch applied with matching pre-image hashes (`1145a41`); F-01 fixed; `tsx` pinned; E2E path-portable; launcher + verify-all; 38 operational scenarios on the built backend; UI demo at 1280/390 px; MCP read-only server (ADR-006).
**Evidence**: package `verification/verify-final2/` — backend 638/638, Vitest 186/186, 17 E2E scripts ACCEPTED, scenarios 38/38, UI demo 7/7, all exit 0, **simulated models only**.
**Statuses**: integrated build runnable locally **VERIFIED**; core capabilities (mission, council, Warden, VEL, router, memory/recovery) **VERIFIED with simulated providers**; MCP server **VERIFIED within ADR-006 limits**; A2A **PENDING**; Connector SDK **PENDING**; real providers/devices/TLS/hosting **UNVERIFIED/PENDING**; GitHub push/release/deploy: see the final report of this session.
**Remaining**: owner decisions on findings F-03…F-06 (`docs/IP-LICENSE-SECURITY-DELTA-2026-11-14.md`), image provenance, LICENSE/NOTICE, real-provider validation (needs keys/local runtime), A2A/Connector SDK objectives.
**Exact stopping point**: after packaging and documentation of the operational test build; nothing beyond that was started.
**Next authorized action**: per the owner's standing authorization — only a bounded slice with a real objective and acceptance criteria (e.g. real-provider smoke test once keys are supplied, or resolving F-03); no roadmap item is auto-started.


How to resume. Repository state beats this file and beats chat memory.

## 1. Reconstruct first (do not skip)
1. Unpack the latest ZIP; `git branch --show-current` (expect `v5.0-polish`),
   `git status --short`, `git log --oneline | head`.
2. Read `NEXUS-CURRENT-STATE.md`, then `docs/checkpoints/CP-19.md` (core slice 11 — characterization test of `fullAgentPrompt`, VERIFIED within limits, mutation PARTIAL, MU05 INVALID by owner decision; evidence in `baseline/evidence/phase2-core-slice11/`), then `docs/checkpoints/CP-18.md` (core slice 10; core slice 10 — `agentOrder` pilot: ownership moved to `frontend/modules/state.mjs` via a window global accessor, VERIFIED locally in Chromium 141, release BLOCKED/UNVERIFIED on `sw.js`; read its §4 for the adapted evidence tools, §5 for the honesty log, §6 for risks; ADR-005),
   then `docs/checkpoints/CP-17.md` (core slice 9; core slice 9 — evidence/docs only: C2/C3 ownership options MEASURED on scratch prototypes, mechanism BLOCKED on owner decisions D1–D4, ADR-003 Erratum appended; read its §2 matrix, §3 decisions, §6 honesty log),
   then `docs/checkpoints/CP-16.md` (Evidence Integrity; Evidence Integrity guard — SEPARATE from core: fail-closed + explicit kind selection in the Ops Center + `integrityReason` via additive migration 016 + ADR-004; VERIFIED within its limits; read its §4 for the measured impact and §10 for the honesty log),
   then `docs/checkpoints/CP-15.md` (core slice 8 — the stuck `isSendingMessage` FIXED: `try` moved right after the lock in `sendMessage()`, PRE 56/79 REJECTED → POST 79/79 ACCEPTED, mutation 7/7),
   then `docs/checkpoints/CP-14.md` (core slice 7 — evidence-only: the stuck flag CONFIRMED at runtime; plus the intermittent seed-flows check E-1),
   then `docs/checkpoints/CP-13.md` (core slice 6 — I-1 handled via O2, `main.js` startup tail only; its §8 static finding is what slice 7 confirmed),
   then `docs/checkpoints/CP-12.md` (core slice 5 — runtime test of I-1, evidence-only, I-1 CONFIRMED = LOST; its §6 wording about the send button is corrected in CP-13 §1),
   then `docs/checkpoints/CP-11.md` (core slice 4 / C1 — registry-parameter
   snapshot/restore/reset, VERIFIED), then `docs/checkpoints/CP-10.md` (core slice 3 — read-only
   state map, facts vs inferences, candidate seams), then `docs/checkpoints/CP-9.md` (Evidence
   Integrity inspection — guard BLOCKED on owner decisions at that time — resolved by CP-16; CP-9 itself changed no production code), then
   `docs/checkpoints/CP-8.md` (slice 2, evidence-only), then `docs/checkpoints/CP-7.md` (slice 1), then
   `PHASE2-MODULARIZE.md` (section "Boundary 5 — core, slice 1"; its "DONE" wording for
   boundaries 1–4 is historical — see the Terminology note in CURRENT-STATE).
3. Read ADR-004 (Evidence Integrity), ADR-002 (bridge pattern) and ADR-003 (storage boundary; see the
   documentation finding in CURRENT-STATE / CP-8 before relying on its wording).
   Slice 9 (CP-17) had NO commit when written: if the tree is clean, `git rev-parse HEAD` is `bc05f58` (Evidence Integrity) and the chain below shifts by one (`HEAD~1` = `b811065`); if slice 9 was committed afterwards, `HEAD~1` = `bc05f58`, `HEAD~2` = `b811065`. Historical chain from `bc05f58`: `git rev-parse HEAD~1` should be `b811065` (core slice 8), `HEAD~2` = `389813f` (slice 7), `HEAD~3` = `5770104` (slice 6), `HEAD~4` = `fbd7236` (slice 5), `HEAD~5` = `669386b`, `HEAD~6` = `9c95fbd`, `HEAD~7` = `b9d4808`, `HEAD~8` = `0520af7`, `HEAD~9` = `4c3e169`.

## 2. Environment (this repo's tests need it)
- `cd frontend && npm ci && npx vitest run --coverage`
- Backend: `cd src-baseline/nexus-backend && npm ci && npm run build && npm test`
- E2E: scripts hard-code `/home/claude/nexus-v5/`, so create a symlink to the
  unpacked repo there (outside the repo). Chromium is provided by
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; verify with a real
  `chromium.launch()`, do not infer availability from `~/.cache`.
- E2E setup (learned in slice 3): `e2e/` has no lockfile, so `npm ci` fails — use
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-package-lock --no-save playwright@1.56.1`
  (the unpinned latest playwright does not match the browsers in `/opt/pw-browsers`), and build the backend first
  (`cd src-baseline/nexus-backend && npm run build`) or `backend-boot` fails. Do not commit `node_modules`/lockfiles.
- `cd e2e && node baseline-flows.mjs && node phase1-security-flows.mjs && node phase2-core-seed-flows.mjs`
- Slice 3 analyzer (read-only, self-locating; acorn is not a repo dependency — `npm i acorn@8.19.0` in a scratch
  dir and point `ACORN_DIR` at its `node_modules` parent): `ACORN_DIR=<dir> node baseline/evidence/phase2-core-slice3-state-map.mjs`
  (expects 22/22; rewrites `…-state-map-results.json`, which must stay byte-identical on an unchanged tree).
- Slice 2 probe (self-locating, no hard-coded path):
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node baseline/evidence/phase2-core-slice2-adr003-probe.mjs`
  (expects 19/19; it rewrites `…-probe-results.json` and the generated module — if you
  re-run it, `git diff` shows only timestamps/scratch path changes in the JSON).
- Slice 4 scripts (repo root; all self-locating): `node baseline/evidence/phase2-core-slice4-extract-script.mjs verify 9c95fbd` (17/17, read-only,
  rewrites the deterministic `…-extract-results.json`); `ACORN_DIR=<dir> node baseline/evidence/phase2-core-slice4-exec-order-check.mjs` (9/9);
  `node baseline/evidence/phase2-core-slice4-unit-vs-original.mjs` (36/36); `PROOF_BASE_REF=9c95fbd node baseline/evidence/phase2-core-slice4-mutation-script.mjs`
  (needs the E2E setup above; ~7 min; modifies then restores 3 production files — never run it concurrently with anything else); `node e2e/phase2-core-slice4-flows.mjs` (21/21).
- Slice 5 (needs the E2E setup above): `cd e2e && node phase2-core-slice5-flows.mjs` (expects 27/27 validity and `I1-VERDICT = LOST`; rewrites
  `baseline/evidence/phase2-core-slice5-i1-results.json`, which contains no timestamps but does contain run-unique marker strings — expect a diff in those only);
  `node baseline/evidence/phase2-core-slice5-mutation-script.mjs` (3/3 mutants, ~2 min, works on tmp copies; also rewrites `…-mutation-results.json`).
  `NEXUS_FRONTEND_DIR` points the script at another frontend dir; `NEXUS_S5_RESULTS` redirects the results JSON.
- Slice 6 (needs the E2E setup above): `cd e2e && node phase2-core-slice6-flows.mjs` (expects 35/35 → `S6-VERDICT = ACCEPTED`: VALID 12, PRES 12, PS 11; it rewrites
  `baseline/evidence/phase2-core-slice6-results.json` unless `NEXUS_S6_RESULTS` points elsewhere); `node baseline/evidence/phase2-core-slice6-mutation-script.mjs`
  (6 scratch mutants K1–K6 on tmp copies, ~5 min, works only on the PATCHED tree; run it alone). On an UNPATCHED tree the acceptance script is REJECTED with only PS checks failing — by design.
- Slice 8 (needs the E2E setup above): `cd e2e && node phase2-core-slice8-flows.mjs` (expects 79/79 → `S8-VERDICT = ACCEPTED`: VALID 44, PRES 12, PS 23; deterministic; rewrites `baseline/evidence/phase2-core-slice8-results.json` unless `NEXUS_S8_RESULTS` points elsewhere; `NEXUS_FRONTEND_DIR` points it at another frontend dir — on the pre-fix tree `389813f` it gives 56/79 REJECTED, PS 0/23, by design);
  `NEXUS_S8_TMP=<scratch> node baseline/evidence/phase2-core-slice8-mutation-script.mjs` (7 scratch mutants on tmp copies of the PATCHED tree, ~7 min, run it alone: CTRL ACCEPTED, K1–K4 REJECTED, K5/K6 INVALID; `NEXUS_S8_ONLY=K6` runs a subset for debugging; `NEXUS_S8_MUT_RESULTS` redirects the JSON).
  `phase2-core-slice8-candidates-script.mjs` (F1/F2/F3 selection evidence) and `phase2-core-slice7-mutation-script.mjs` are BOUND TO THE PRE-FIX TREE `389813f`: on a patched tree they exit 2 with a message (marker `BUGFIX (core slice 8)`); use `git checkout 389813f` in a scratch clone to re-run them.
- Slice 7 (needs the E2E setup above): `cd e2e && node phase2-core-slice7-flows.mjs` (expects 47/47 → `S7-VERDICT = STUCK` on the PRE-FIX tree `389813f`; on the current (slice 8) tree it reports `NOT-STUCK` 40/40; rewrites `baseline/evidence/phase2-core-slice7-results.json` unless `NEXUS_S7_RESULTS` points elsewhere; deterministic);
  `NEXUS_S7_TMP=<scratch> node baseline/evidence/phase2-core-slice7-mutation-script.mjs` (5 scenarios on tmp copies, ~5 min: CTRL=STUCK, M1/M4 candidate fixes=NOT-STUCK, M2/M3=INCONCLUSIVE; run it alone). Slice 8 FIXED the defect; the slice 7 script was left unedited and reports NOT-STUCK on the fixed tree (its successor is the slice 8 acceptance script).
  `NEXUS_S7_MUT_RESULTS` redirects the mutation results JSON. Slice 4 mutation script (~7 min) re-ran 16/16, 0 survivors in slice 7; it rewrites a committed results JSON — `git checkout` it afterwards.
- Evidence Integrity (CP-16; needs the E2E setup above AND a rebuilt backend — `npm run build` copies the migrations into `dist`): backend `cd src-baseline/nexus-backend && npm test` (expects 472/472; `tsx` must be on PATH — the migration upgrade-path test spawns it, as `npm test` does);
  `npx tsx --test test/evidenceIntegrity.test.ts` runs only the new tests (65 in that file + 1 in `webResearch.test.ts`; 27 of them are `[SEC]` security tests); UI: `cd e2e && node phase2-evidence-integrity-flows.mjs` (expects 26/26 → `EI-UI-VERDICT = ACCEPTED`: VALID 4, PRES 6, PS 16; deterministic; rewrites `baseline/evidence/phase2-evidence-integrity-ui-results.json` unless `NEXUS_EI_UI_RESULTS` points elsewhere; `NEXUS_FRONTEND_DIR` points it at another frontend dir — on `b811065` it gives 10/26 REJECTED, PS 0/16, by design);
  `EI_TMP=<scratch> node baseline/evidence/phase2-evidence-integrity-mutation-script.mjs` (5 controls + 35 mutants on scratch copies — it takes many minutes, run it alone; expects controls OK and 35/35 as expected: 34 killed + W3 the documented survivor; needs the git history for `EI_BASE_REF`, default `b811065`; `EI_MUT_RESULTS` redirects the JSON). It is BOUND TO THE PATCHED TREE (anchors must match once, else exit 2).
- Slice 2 probe and slice 3 analyzer assert a clean production-path `git status` (`frontend src-baseline e2e ADR` — so an UNCOMMITTED new file under `e2e/` also trips them, 18/19 and 21/22): run them on a COMMITTED tree (on a dirty tree they report 18/19 and 20/22 for that reason only).
  Slice 3's committed results JSON is a historical artifact of `b9d4808` (line numbers moved since); do not commit a regenerated one without a reason.
- Slice 4 `extract-script.mjs verify 9c95fbd` reports 15/17 now after CP-16 (P7 and P7b "backend untouched" are time-bound; P7b joined because CP-16 changed the backend by design; P2b now also reverses the 4 Evidence Integrity UI hunks). It was 16/17 before CP-16 (P7 "nothing else touched" is time-bound: it was 17/17 only at the slice 4 commit; verified identical on a clean `fbd7236`). Its P5 and the exec-order check A7 were adapted for the slice 6 startup block, and its P2b (base-monolith comparison) now reverses the slice 8 `sendMessage()` block first (no-op on a tree without it; it was 15/17 right after the slice 8 patch).
- `e2e/phase2-core-seed-flows.mjs` check `ciphertext-hides-plaintext` is INTERMITTENT (~3.5% false failure: substring "42" in random base64; CP-14 §E-1). A lone 15/16 → re-run before concluding anything.
- Slice 9 (CP-17; needs the E2E setup above, built backend, `/home/claude/nexus-v5` symlink to the repo for the hard-coded `BACKEND_DIR`): `ACORN_DIR=<dir> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers S9_TMP=<scratch> [S9_RESULTS=<json>] node baseline/evidence/phase2-core-slice9-ownership-prototypes.mjs` (clones HEAD per variant CTRL/PA/PB/MUT-PA/MUT-PB/PB-C3, patches only the clone; ~10–15 min; run it alone and detached — a session pause killed one run; expect the matrix in CP-17 §2; it rewrites the committed results JSON unless `S9_RESULTS` points elsewhere; `S9_ONLY=PB` runs a subset). Production files are only read.
- Slice 10 (CP-18; same E2E setup): E2E `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers [NEXUS_FRONTEND_DIR=<dir>] [NEXUS_S10_RESULTS=<json>] node e2e/phase2-core-slice10-flows.mjs` (verdict ACCEPTED/REJECTED/INVALID); fingerprint comparison `node baseline/evidence/phase2-core-slice10-compare.mjs <pre.json> <post.json>`; mutation `node baseline/evidence/phase2-core-slice10-mutation-script.mjs` (scratch copies only; M4 reports KILLED/DIFFERS by its binary definition although it survives every runtime check — CP-18 §3). Slice 2 probe and slice 3 analyzer assert a clean tracked tree: run them on a committed scratch clone (add `node_modules` to `.git/info/exclude` if you symlink it). The slice 4 mutation script edits files IN PLACE and its E2E reads `/home/claude/nexus-v5`: run it in the repo itself, or in a clone with that symlink repointed (else E1–E6 survive falsely). The slice 7 mutation script is bound to the pre-fix tree by design (use slice 8's).
- Expected on this commit: Vitest 168, E2E 12 / 16 / 16 + slice 4 21, slice 5 27 (`SURVIVES`), slice 6 35, slice 7 script 40 (`NOT-STUCK`), slice 8 acceptance 79 (`ACCEPTED`), slice 8 mutation 7/7, slice 5 mutation 3/3 (M1 now = revert → LOST), slice 4 mutation 16/16 (0 survivors), exec-order 9/9, slice 3 analyzer 22/22 (clean tree), backend 472 (+ `tsc --noEmit` exit 0), Evidence Integrity UI 26 (`ACCEPTED`), EI mutation 35/35 (34 killed + the documented survivor W3), slice 6 mutation 6/6 (K1–K6), slice 2 probe 19, slice 4 verify 15/17 (P7, P7b) —
  as numbers to RE-MEASURE, not to trust.

## 3. Rules that bit us this session
- Evidence Integrity lessons (CP-16): measure the REAL impact of a policy change on the WHOLE suite before editing any fixture (CP-9's 3-file experiment said 9, the full suite said 11); label PRES strictly — a PRES that also asserts the new field is PS; a test that spawns a child process must use the same launcher as `npm test` (`tsx` from PATH, not `node --import tsx`);
  a blanket `git checkout -- baseline/evidence` also reverts UNCOMMITTED edits of evidence SCRIPTS — restore named result files only, or commit script changes first (this cost one re-application); a mutant that survives for an observability reason (W3) is reported as a survivor with its reason, not hidden; a surprising mutant verdict (U5 INVALID) is explained by re-running that mutant, not by reasoning alone.
- Slice 8 lessons: write the acceptance criteria and the decision rule BEFORE the patch, then choose among candidates by measurement on scratch copies (here F1 looked sufficient for the confirmed symptom but left four preparation-failure paths; F3 won on the tie-break). Split checks into VALID/PRES/PS so a PRE-red run proves the test can fail. A mutant's predicted verdict can be wrong (K6: INVALID, not REJECTED) — investigate, correct the expectation with the reason, keep the first-run log. A redundant-looking guard may be protected by another flag in the common path (`sendBtn.disabled` vs the lock): only a test through the `await` window (image attached) kills the mutant. After patching, grep the evidence scripts for the text you edited and measure each on the clean previous commit and on the patched tree; add a preflight (exit 2) to scripts bound to the old text.
  Shell hygiene: never write a redirect target from an unset variable (`$S/..` with `S` unset hung the shell on stdin); create scratch scripts with the Write tool using the full path.
- Slice 7 lessons: a first-run failure in an old evidence script is not automatically a regression nor automatically noise — read the check, quantify (here 20000 real `encryptState` calls), re-run N times, and write both outcomes down. A new uncommitted file under `e2e/` makes slice 2/3 cleanliness checks fail: commit-or-move it before running them.
  For stateful-flag bugs use controls (normal cycle; the precondition without the trigger), wait out toasts so new ones are attributable, and add a CAUSAL intervention (reset only the suspected variable) before calling the cause. Prove discrimination with scratch mutants incl. the candidate fix.
  The E2E online send needs no mock: with every non-origin request aborted, `callClaude` fails ("Failed to fetch") and the real `finally` runs (~2 s).
- A classic-script `let`/`const` is not a `window` property; bridge pattern =
  `main.js` import + `window.x = x`, assigned BEFORE the startup calls.
- Extraction scripts must abort if the monolith differs from HEAD or the target
  block is not found exactly once.
- Prove tests can fail (mutation) and restore byte-identical (sha256).
- E2E scripts must report failures, not crash: a crash is detection but not evidence.
- `autoInitApp` swallows decrypt errors: assert restored DATA, not absence of errors.
- Slice 2 finding (Chromium 141): module code can read/write classic top-level `let`/`var`
  by bare name (const: read OK, write TypeError; let/const not on `window`). This is a
  FINDING, not a design authorization: ADR-003 and the bridge pattern are unchanged until
  a separate explicit decision. Evidence-probe helpers must use collision-proof names
  (a helper called `R` or `p` could shadow a monolith global and corrupt a read).
- Slice 5 lessons: Playwright `context.setOffline(true)` makes a page reload fail (`ERR_INTERNET_DISCONNECTED`) unless the document is served by `context.route`; serve from an
  `https://` fake origin (secure context ⇒ `crypto.subtle`; plain `http://nexus.test` has none ⇒ `encryptionKey` never set) and register the route when the context is created. Always PROVE offline per boot
  (`navigator.onLine` captured at document start + the app's banner), and keep a positive control (offline, no blob) so an absent entry can't be a measurement artifact (mutant M3).
  Report the outcome with `[OBSERVED]` instead of asserting the hypothesis, so the script can't be "passing" merely because it agrees with the inference.
- Slice 6 lessons: evidence scripts that match `main.js` by exact text or only scan top-level `ExpressionStatement`s break silently when the startup block changes — grep the scripts for the text you edit and
  MEASURE each one on the clean previous commit (clone) before blaming the patch. A VALID check must be able to fail (it caught a test bug: reading `hasBlob` after `persistState()` writes one). Never `await` a startup promise at module top level when the
  following calls must survive its rejection: use `.finally`. Hold init open with a test-side gate on the first `localStore.get`, not with sleeps.
- Slice 4 lessons: a classic function declaration owns its `window` name, so module functions cannot be bridged under the same name when the classic
  callers keep the old signature — bridge as a namespace (`window.PersistableStateCore`) and keep one-line classic wrappers. A behavior check in an E2E must
  not depend on a patch-specific block (it fails pre-patch for the wrong reason). Mutation anchors must be unique (a comment can duplicate code text).

## 4. Next slice
**Evidence Integrity (CP-16, ADR-004): VERIFIED within its limits — do not redo; it is SEPARATE from core and was not mixed with it.** **Core slices 4 (CP-11), 5 (CP-12), 6 (CP-13), 7 (CP-14) and 8 (CP-15): VERIFIED — do not redo.** Slice 6: I-1 handled via O2. Slice 7 (evidence-only) confirmed the `isSendingMessage` defect; slice 8 FIXED it (`sendMessage()` only, +5/−2; Chromium 141 headless + emulated offline + injected faults only; streaming/AbortError branch, real devices, other browsers, exceptions inside `catch`/`finally` UNVERIFIED).
**No next slice is auto-approved. Phase 2 is NOT complete (PARTIAL); boundary 5 core is PARTIAL.** Core slice 9 (CP-17, evidence/docs only) measured the ownership options and reviewed ADR-003 (Erratum appended). **Core slice 10 (CP-18) applied mechanism B to `agentOrder` only (VERIFIED locally; `sw.js` cache list BLOCKED/UNVERIFIED — add `/modules/state.mjs` and verify offline boot before release).** Owner decisions still pending: (b) ownership of the other variables / D2 confirmation / the security-exposure precedent for `messages` (ADR-005 R2); original text: ownership mechanism for C2/C3 — decide **D1** mechanism (A explicit store / B accessor shim / C bare-name module access / D defer), **D2** owner module, **D3** C3 policy, **D4** ADR-005 (CP-17 §3; recommendation, not decision: B for a `agentOrder` pilot only);
(c) closed by CP-16 (Evidence Integrity decided and implemented); (d) closed by slice 8 — only still open and optional: whether to fix the intermittent seed-flows check (CP-14 §E-1) in a separate tools slice.
Optional Evidence Integrity follow-ups are NEW slices that need explicit owner approval (none approved): measurement with a real judge / real web fetch (the SSRF guard blocks `fetchOk:true` in the sandbox — mutant W3), or a real source-independence check (ADR-004 §Limits).

## 5. Exact Arabic command for the next conversation
(قرار المالك مطلوب قبل أي شريحة كود — اختر/عدّل البنود بين الأقواس قبل الإرسال.)
```
NEXUS v5.0 — Continue من الحالة الموثقة الحالية في المستودع (NEXUS-CURRENT-STATE.md و CP-16)، ولا تعِد ما تم ولا تعيد التخطيط.
أولاً: أعد بناء الحالة من المستودع (Git، الشجرة، الـ HEAD، السلسلة HEAD~1=b811065) وأعد قياس الاختبارات ولا تثق بالأرقام المكتوبة (انتبه: seed-flows فحص ciphertext-hides-plaintext متقلّب ≈3.5% — CP-14 §E-1؛ و slice 4 verify يعطي 16/17 بسبب P7 المرتبط بالزمن).
I-1 مُعالَجة في slice 6 (CP-13)، و isSendingMessage العالق أُصلح في slice 8 (CP-15: POST 79/79 ACCEPTED، mutation 7/7)، و Evidence Integrity أُغلق في CP-16 (fail-closed + اختيار kind صريح + integrityReason عبر migration 016 + ADR-004؛ backend 472/472، واجهة 26/26، mutation 35/35 (34 مقتولة) مع ناجٍ واحد موثَّق W3، واختبارات أمنية 27 [SEC]) — لا يُعاد. اختر الهدف التالي بقرار مالك صريح: [قرار D1–D4 لآلية ملكية C2/C3 (CP-17 §3؛ مراجعة ADR-003 أُنجزت كـErratum) | إصلاح الفحص المتقلّب في seed-flows | متابعة Evidence Integrity معتمَدة صراحةً (قياس بمحكّم/جلب حقيقيين، أو تحقق استقلال المصادر) | غير ذلك: ...].
ثم نفّذ فقط الشريحة التي تنتج عن هذا القرار (إن اعتُمدت التوصية: core slice 10 = تجربة C2 على `agentOrder` بآلية B + ADR-005)، بمعايير قبول مكتوبة قبل الرقعة وPRE/POST وmutation، ثم CP-18 + تحديث CURRENT-STATE/CONTINUATION/CHANGELOG.
Evidence Integrity أُغلق في CP-16 (VERIFIED ضمن حدوده) — لا يُعاد ولا يُخلط بأي شريحة Core. لا تبدأ نقل ملكية أي متغير (C2/C3) ولا تعدّل PERSISTABLE_STATE أو ADR-003 دون قرار مالك صريح.
ثم commit وأنشئ ZIP بعد الـ commit، وتحقق أن الشجرة نظيفة والـ HEAD المُوثَّق يطابق الـ commit، واكتب الخلاصة بالعربية (STATUS / COMMIT / TESTS / E2E / CHECKPOINT / ما بقي / الشريحة التالية)، ثم STOP.
```


---

## CONTINUATION ADDENDUM 24 — 2026-11-16 (R4 continuation; appended, nothing above was altered)

**Work performed** (local branch `work/r4-continue`, base `e08f70b`, head = this commit's parent chain; nothing pushed): F06-a, D-10, D-2, D-9, F-05, F-03, F-04, frontend dev-dep audit fix, CycloneDX 1.6 SBOM + schema validation, a TS18048 fix in the adopted `fallbackModelMatrix` test (found by the verify-all typecheck step), ADR-007 drafted as PROPOSED, docs updated. See `NEXUS-CURRENT-STATE.md` (UNIFIED STATE 2026-11-16).

**Evidence**: full `scripts/verify-all.sh` on `8275d2a`: 27/27 steps exit 0, OVERALL exit 0; backend 663/663, Vitest 192/192, scenarios 39/39, UI demo 7/7; tree clean after run. Per-slice RED->GREEN logs are in the commit messages and the session scratch (not durable); the owner-deliverable bundle carries copies.

**Statuses**: F06-a, F-05 (local pinned libs), D-2, D-9, D-10, F-03, F-04, SBOM schema validity = VERIFIED (simulated/in-repo evidence only). Real providers = BLOCKED (no keys, no authorized spend cap). R3 tree byte-merge = PENDING (tree not supplied). pdf.js upgrade, CSP `unsafe-inline` removal, TLS/F06-b, MCP M1, A2A, Connector SDK = PENDING. Real devices/browsers/perf/coverage, pdf.js exploitability, cdnjs byte-identity, image authorship/licences = UNVERIFIED/PENDING.

**Blockers / risks**: (1) R3 tree missing -> re-implementations may differ from R3 byte-for-byte; reconcile by 3-way merge when supplied. (2) Live repo is a read-only zip/HTML dump here: applying the commits needs owner approval and a push path. (3) Provider keys and a spend cap are needed for real-provider validation. (4) `unsafe-inline` CSP remains.

**Owner decisions in force**: the 2026-11-15/16 Master Owner Authorization (no push/merge/tag/release/deploy; no licence or ownership attestation; no secrets in logs; no paid tests without spend cap; no history rewrite). Decisions still needed from the owner: ADR-007 acceptance and limit values; licence/NOTICE choice and image provenance; spend cap + keys; push target for the commits.

**Exact stopping point**: after the final verify-all and documentation, before Phase 3 code (M1) and Phase 4 real-provider/device/TLS work.

**Next authorized action**: only what the owner approves. Recommended order: (a) supply the R3 tree for a 3-way merge; (b) approve/adjust ADR-007 and start M1.0 acceptance tests; (c) provide env keys + spend cap and run `e2e/real-provider-validation.mjs`; (d) approve push of `work/r4-continue` to a review branch.

---

## CONTINUATION ADDENDUM 25 — 2026-11-18 (R4 final; appended, nothing above was altered)

**Work performed** (local branch `merge/r3-into-r4`; nothing pushed): R3 source imported and merged; pdf.js 4.10.38; CSP without inline `<script>`; F06-b TLS via documented nginx reverse proxy with real nginx+Chromium E2E; **M1** MCP client; **C1** Connector SDK; **A1** A2A v1.0 server; fixes found along the way — chat tasks interrupted by a crash stayed `running` forever (boot sweep → `failed`), failed gateway auth was never rate-limited (per-IP bucket), backend `typescript` devDependency `*` → `7.0.2`; SBOM regenerated; perf smoke + coverage measured; `verify-all.sh` now runs the M1/A1 third-party interop E2Es when `MCP_SDK_DIR`/`A2A_SDK_DIR` are set. See `NEXUS-CURRENT-STATE.md` (UNIFIED STATE 2026-11-18), `docs/OPERATIONAL-BUILD.md` §9, `docs/A2A-SERVER.md`, `docs/CONNECTOR-SDK.md`, ADR-007a implementation records.

**Evidence**: full `scripts/verify-all.sh` on the final code HEAD — all steps exit 0; backend 754/754, Vitest 198/198, TLS 12/12, MCP-client interop 11/11 (official `@modelcontextprotocol/sdk` 1.32.2 server), A2A interop 9/9 (official `@a2a-js/sdk` 1.3.0 client + SIGKILL/restart), scenarios 39/39, UI demo 7/7, real-provider harness PASS 23 / BLOCKED 10. Backend coverage lines 94.1 % / branches 87.0 % / functions 95.3 %. Each new behaviour was written RED first (missing-module/missing-export or observed wrong behaviour) and mutation-checked; surviving mutants are documented in the ADR records as equivalent.

**Statuses**: see the UNIFIED STATE block (VERIFIED / PARTIAL / PENDING / BLOCKED / UNVERIFIED lists). M1, C1, A1 = PARTIAL. Real providers = BLOCKED.

**Blockers / risks**: (1) provider keys and a spend cap are required for real-provider validation; (2) pushing/merging the branch needs owner approval and a target; (3) ADR-007/007a deviations need owner confirmation; (4) `script-src-attr 'unsafe-inline'` remains; (5) A2A has no per-peer privacy mode — it runs on one operator-configured provider; (6) only Chromium was available (Firefox/Safari/real devices UNVERIFIED); (7) no `LICENSE`/`NOTICE`, image provenance unverified.

**Owner decisions in force**: the R4 Full Owner Authorization (autonomous slice-by-slice engineering; push/merge/release/deploy and any paid usage still require explicit approval; no secrets in logs; no licence attestation; no deletions or history rewrites).

**Exact stopping point**: after the final verify-all on the final tree, the continuity documents and the owner deliverable bundle; before any push, real-provider run, or new feature slice.

**Next authorized action**: only what the owner approves. Recommended order: (a) review the deviation list in ADR-007a and the two core behaviour changes; (b) approve a push of `merge/r3-into-r4` to a review branch; (c) supply env keys + spend cap and run `e2e/real-provider-validation.mjs`; (d) decide licence/NOTICE and image provenance; (e) optionally authorize removal of inline handlers (CSP) and an A2A streaming/privacy-mode slice.


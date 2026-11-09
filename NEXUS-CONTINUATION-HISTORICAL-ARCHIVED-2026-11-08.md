# NEXUS-CONTINUATION

How to resume. Repository state beats this file and beats chat memory.

> **⚠ تنبيه (إضافة 2026-10-25):** الأقسام 1–5 كُتبت لمسار الواجهة (حقبة CP-19) وفيها عبارات «sw.js غير متوفر / الإصدار BLOCKED / الشريحة الحالية 10» **قديمة**؛ التصحيح في §6 أدناه وفي `NEXUS-CURRENT-STATE.md` ← CF-01. لا شريحة نشطة الآن.

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
- Evidence Integrity (CP-16; needs the E2E setup above AND a rebuilt backend — `npm run build` copies the migrations into `dist`): backend `cd src-baseline/nexus-backend && npm test` (expects 472/472; `tsx` must be on PATH — the migration upgrade-path test spawns it, as `npm test` does); ‹وسم 2026-10-27 (P1، CF-13): الرقم 472 تاريخي — حقبة CP-16؛ آخر قياس 681/681 بتاريخ 2026-10-26 على نسخة معزولة (`VERIFICATION.md` §E)؛ لا ينطبق على الحي›
  `npx tsx --test test/evidenceIntegrity.test.ts` runs only the new tests (65 in that file + 1 in `webResearch.test.ts`; 27 of them are `[SEC]` security tests); UI: `cd e2e && node phase2-evidence-integrity-flows.mjs` (expects 26/26 → `EI-UI-VERDICT = ACCEPTED`: VALID 4, PRES 6, PS 16; deterministic; rewrites `baseline/evidence/phase2-evidence-integrity-ui-results.json` unless `NEXUS_EI_UI_RESULTS` points elsewhere; `NEXUS_FRONTEND_DIR` points it at another frontend dir — on `b811065` it gives 10/26 REJECTED, PS 0/16, by design);
  `EI_TMP=<scratch> node baseline/evidence/phase2-evidence-integrity-mutation-script.mjs` (5 controls + 35 mutants on scratch copies — it takes many minutes, run it alone; expects controls OK and 35/35 as expected: 34 killed + W3 the documented survivor; needs the git history for `EI_BASE_REF`, default `b811065`; `EI_MUT_RESULTS` redirects the JSON). It is BOUND TO THE PATCHED TREE (anchors must match once, else exit 2).
- Slice 2 probe and slice 3 analyzer assert a clean production-path `git status` (`frontend src-baseline e2e ADR` — so an UNCOMMITTED new file under `e2e/` also trips them, 18/19 and 21/22): run them on a COMMITTED tree (on a dirty tree they report 18/19 and 20/22 for that reason only).
  Slice 3's committed results JSON is a historical artifact of `b9d4808` (line numbers moved since); do not commit a regenerated one without a reason.
- Slice 4 `extract-script.mjs verify 9c95fbd` reports 15/17 now after CP-16 (P7 and P7b "backend untouched" are time-bound; P7b joined because CP-16 changed the backend by design; P2b now also reverses the 4 Evidence Integrity UI hunks). It was 16/17 before CP-16 (P7 "nothing else touched" is time-bound: it was 17/17 only at the slice 4 commit; verified identical on a clean `fbd7236`). Its P5 and the exec-order check A7 were adapted for the slice 6 startup block, and its P2b (base-monolith comparison) now reverses the slice 8 `sendMessage()` block first (no-op on a tree without it; it was 15/17 right after the slice 8 patch).
- `e2e/phase2-core-seed-flows.mjs` check `ciphertext-hides-plaintext` is INTERMITTENT (~3.5% false failure: substring "42" in random base64; CP-14 §E-1). A lone 15/16 → re-run before concluding anything.
- Slice 9 (CP-17; needs the E2E setup above, built backend, `/home/claude/nexus-v5` symlink to the repo for the hard-coded `BACKEND_DIR`): `ACORN_DIR=<dir> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers S9_TMP=<scratch> [S9_RESULTS=<json>] node baseline/evidence/phase2-core-slice9-ownership-prototypes.mjs` (clones HEAD per variant CTRL/PA/PB/MUT-PA/MUT-PB/PB-C3, patches only the clone; ~10–15 min; run it alone and detached — a session pause killed one run; expect the matrix in CP-17 §2; it rewrites the committed results JSON unless `S9_RESULTS` points elsewhere; `S9_ONLY=PB` runs a subset). Production files are only read.
- Slice 10 (CP-18; same E2E setup): E2E `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers [NEXUS_FRONTEND_DIR=<dir>] [NEXUS_S10_RESULTS=<json>] node e2e/phase2-core-slice10-flows.mjs` (verdict ACCEPTED/REJECTED/INVALID); fingerprint comparison `node baseline/evidence/phase2-core-slice10-compare.mjs <pre.json> <post.json>`; mutation `node baseline/evidence/phase2-core-slice10-mutation-script.mjs` (scratch copies only; M4 reports KILLED/DIFFERS by its binary definition although it survives every runtime check — CP-18 §3). Slice 2 probe and slice 3 analyzer assert a clean tracked tree: run them on a committed scratch clone (add `node_modules` to `.git/info/exclude` if you symlink it). The slice 4 mutation script edits files IN PLACE and its E2E reads `/home/claude/nexus-v5`: run it in the repo itself, or in a clone with that symlink repointed (else E1–E6 survive falsely). The slice 7 mutation script is bound to the pre-fix tree by design (use slice 8's).
- Expected on this commit: Vitest 168, E2E 12 / 16 / 16 + slice 4 21, slice 5 27 (`SURVIVES`), slice 6 35, slice 7 script 40 (`NOT-STUCK`), slice 8 acceptance 79 (`ACCEPTED`), slice 8 mutation 7/7, slice 5 mutation 3/3 (M1 now = revert → LOST), slice 4 mutation 16/16 (0 survivors), exec-order 9/9, slice 3 analyzer 22/22 (clean tree), backend 472 (+ `tsc --noEmit` exit 0), Evidence Integrity UI 26 (`ACCEPTED`), EI mutation 35/35 (34 killed + the documented survivor W3), slice 6 mutation 6/6 (K1–K6), slice 2 probe 19, slice 4 verify 15/17 (P7, P7b) —
  as numbers to RE-MEASURE, not to trust. ‹وسم 2026-10-27 (P1، CF-13): «backend 472» في السطر السابق رقم تاريخي (حقبة CP-16)؛ آخر قياس 681/681 بتاريخ 2026-10-26 على نسخة معزولة (`VERIFICATION.md` §E)؛ لا ينطبق على الحي›

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
> **⚠ تاريخي (وسم 2026-10-27، P2، CF-15):** الأمر العربي أدناه كُتب في حقبة CP-19 ويتضمن بندي «commit» و«ZIP بعد الـ commit». ذلك يتعارض مع OD-C5 وCF-05 وCLAUDE.md §4 (لا commit ولا push دون موافقة صريحة منفصلة) ولا يُنفَّذ. المرجع الساري: `NEXT-SESSION-START-HERE.md` (نقطة الاستئناف التشغيلية) و`CLAUDE.md`. النص أدناه محفوظ كما كُتب ولم يُحذف.

(قرار المالك مطلوب قبل أي شريحة كود — اختر/عدّل البنود بين الأقواس قبل الإرسال.)
```
NEXUS v5.0 — Continue من الحالة الموثقة الحالية في المستودع (NEXUS-CURRENT-STATE.md و CP-16)، ولا تعِد ما تم ولا تعيد التخطيط.
أولاً: أعد بناء الحالة من المستودع (Git، الشجرة، الـ HEAD، السلسلة HEAD~1=b811065) وأعد قياس الاختبارات ولا تثق بالأرقام المكتوبة (انتبه: seed-flows فحص ciphertext-hides-plaintext متقلّب ≈3.5% — CP-14 §E-1؛ و slice 4 verify يعطي 16/17 بسبب P7 المرتبط بالزمن).
I-1 مُعالَجة في slice 6 (CP-13)، و isSendingMessage العالق أُصلح في slice 8 (CP-15: POST 79/79 ACCEPTED، mutation 7/7)، و Evidence Integrity أُغلق في CP-16 (fail-closed + اختيار kind صريح + integrityReason عبر migration 016 + ADR-004؛ backend 472/472، واجهة 26/26، mutation 35/35 (34 مقتولة) مع ناجٍ واحد موثَّق W3، واختبارات أمنية 27 [SEC]) — لا يُعاد. اختر الهدف التالي بقرار مالك صريح: [قرار D1–D4 لآلية ملكية C2/C3 (CP-17 §3؛ مراجعة ADR-003 أُنجزت كـErratum) | إصلاح الفحص المتقلّب في seed-flows | متابعة Evidence Integrity معتمَدة صراحةً (قياس بمحكّم/جلب حقيقيين، أو تحقق استقلال المصادر) | غير ذلك: ...].
ثم نفّذ فقط الشريحة التي تنتج عن هذا القرار (إن اعتُمدت التوصية: core slice 10 = تجربة C2 على `agentOrder` بآلية B + ADR-005)، بمعايير قبول مكتوبة قبل الرقعة وPRE/POST وmutation، ثم CP-18 + تحديث CURRENT-STATE/CONTINUATION/CHANGELOG.
Evidence Integrity أُغلق في CP-16 (VERIFIED ضمن حدوده) — لا يُعاد ولا يُخلط بأي شريحة Core. لا تبدأ نقل ملكية أي متغير (C2/C3) ولا تعدّل PERSISTABLE_STATE أو ADR-003 دون قرار مالك صريح.
ثم commit وأنشئ ZIP بعد الـ commit، وتحقق أن الشجرة نظيفة والـ HEAD المُوثَّق يطابق الـ commit، واكتب الخلاصة بالعربية (STATUS / COMMIT / TESTS / E2E / CHECKPOINT / ما بقي / الشريحة التالية)، ثم STOP.
```

> **وسم 2026-10-27 (P1/P2، CF-13/CF-15):** «backend 472/472» داخل الأمر أعلاه رقم تاريخي (حقبة CP-16)؛ آخر قياس 681/681 بتاريخ 2026-10-26 على نسخة معزولة (`VERIFICATION.md` §E)، ولا ينطبق على الحي. بنود commit/ZIP في الأمر ملغاة بـOD-C5.

## 6. Resume pointer — added 2026-10-25 (continuity foundation; additive, nothing above removed)
- **Start here:** `CLAUDE.md` (standing instructions) → `NEXT-SESSION-START-HERE.md` (the single resume point, at the package root) → `NEXUS-CURRENT-STATE.md` § UNIFIED STATE → `DECISIONS.md`.
- **Scope note:** sections 1–5 above were written for the frontend/Core track (CP-19 era). They remain valid for that track (environment, rules, E2E setup) but **do not describe the backend security track or Release V1**; for those read UNIFIED STATE, `PROJECT_HISTORY.md` (PH-B*, PH-C*) and the slice reports. The "Exact Arabic command" in §5 is historical.
- **Correction (CF-01):** §1–§4 call `sw.js` unavailable; since Release V1 B1 (2026-10-16) `frontend/sw.js` exists (authored, not the original) and its offline-boot E2E (`e2e/release-v1-b1-offline-sw-flows.mjs`) was ACCEPTED — VERIFIED within B1 limits only; re-run before relying on it.
- **Backend commands** (isolated copy; from `src-baseline/nexus-backend`): `npm i --no-save tsx typescript @types/node`; `npx tsx --test 'test/**/*.test.ts' 'test/*.test.ts'`; `npx tsc -p tsconfig.json --noEmit && npm run build`; slice-specific checks: `NEXUS-G8.2-GENOME-GATE-REPORT.md` §9. Tests may create `data/` — delete before packaging.
- **Live repo/Git: BLOCKED** (no `.git`). First action of any session with repo access: `git rev-parse --show-toplevel`, branch, full HEAD, `git status`, then compare with the hashes cited in `PROJECT_HISTORY.md` (all historical).
- **Re-measured 2026-10-26 (OD-C11, isolated copy; `VERIFICATION.md` §E):** backend `npm test` = **681/681** (the "472/472" in §2 is the CP-16-era number); `tsc` 0; build 0; dist-check PASS; gate mutations 18/18. `tsx` is **not** declared in `devDependencies` — `npm ci` alone does not provide it; keep `npm i --no-save tsx typescript @types/node` (or a global `tsx` on PATH) before `npm test`. Environment seen: Node v22.23.4, npm 10.9.9, TypeScript 7.0.2 via lockfile (6.0.3 global also passes), tsx 4.23.12.
- **2026-10-27 (OD-C12):** نقطة الاستئناف التشغيلية الوحيدة السارية هي القسم 0-أ في `NEXT-SESSION-START-HERE.md`. وُسمت مواضع 472/472 في §2 وأمر §5 تاريخيًا (P1/P2)؛ لم يُحذف نص. لم يُشغَّل كود ولا اختبار في هذا التعديل.

# Core slice 8 — fix of the stuck `isSendingMessage` (CP-14) — acceptance criteria (written BEFORE any production change)

Scope: ONLY the lock-release defect of `sendMessage()` in `frontend/neural_nexus_ai_agents-4-3-5-3.html`: after the lock `isSendingMessage = true` is taken (L8227) the function can leave
before the `finally` (L8434–8450) that releases it. Out of scope (not touched): C2/C3, `PERSISTABLE_STATE`, ADR-003, Evidence Integrity, `main.js`, modules, backend, `updateOnlineStatus`,
the pipeline INSIDE the existing `try` (modes, streaming, abort handling), the `online`/`offline` listeners, `sw.js`, any other flag/guard.

Baseline (PRE, unmodified `389813f`, measured in this session — see `phase2-core-slice8-PRE-*`): CP-14 slice 7 script `S7-VERDICT = STUCK` 47/47; E2E/Vitest numbers of CP-14 §5.

## Facts from reading the code (INSPECT/MAP — before testing)
Statements between the lock (L8227) and the `try` (L8294) — every one of them can leave the lock held, and none is inside a `try`:
1. L8229–8232 offline early `return` (CONFIRMED STUCK by slice 7).
2. L8239 `await ImageStore.save(...)` (IndexedDB; only when an image is attached) — can reject. Confirmed by an exploratory run (not evidence): lock stays `true`, rejection propagates to the caller.
3. L8240–8250: `messages.push`, `input.value=''`, `removeAttachedImage()`, `renderMessages()`, `sendBtn.disabled = true` (L8244), `renderNeuralHistory`, `refreshNeuralHistory` (fire-and-forget).
4. L8253–8277: `isSimpleMode()`, `getAskMode()`, `NexusOrchestrator.resolveActiveMode({... 12 × document.getElementById(...).checked ...})` — a missing DOM element = `TypeError`.
5. L8286–8287 `NexusObservability.startTask` / `recordAgents`; L8288 `let taskOutcome = 'ok'`; L8290 optional toast.
- After a throw at 3–5 BOTH the lock and `sendBtn.disabled` (L8244) stay set; the `online` listener re-enables the button but never the lock. All callers (`#sendBtn` onclick, Enter, voice `recognition.onend`, scenario modal) call `sendMessage()` without handling a rejection, so such a throw is an unhandled rejection.
- Inside the `try`, every failure is already caught (error message + `logActivity` + `logError`) and the `finally` releases the lock and the button, then `NexusObservability.finishTask` (returns `null` if no task was started → safe when the failure happened before `startTask`).
- The re-entrancy guard (L8226) protects against two concurrent pipelines (BUGFIX note at L5182); it only works if the lock is taken synchronously, before the first `await` (L8239).
- `finally` uses `taskOutcome`; if `try` is moved earlier, `taskOutcome` must be declared before it.

## Check kinds
- **VALID** measurement validity/controls — must be green PRE and POST, else the run is INVALID (exit ≠ 0).
- **PRES** preserved behavior — must be green PRE **and** POST.
- **PS** patch-specific — expected RED PRE (a fault), GREEN POST.
Final line `S8-VERDICT = ACCEPTED | REJECTED | INVALID` (ACCEPTED iff all VALID, PRES, PS green).

## Acceptance criteria (the updated successors of slice 7 AC-4 / AC-5 / AC-7, plus the exception paths)
- **AC-4′ offline attempt** (click path ×1, Enter path ×1; fresh profile, real offline emulation): VALID offline really in effect (banner shown, `navigator.onLine=false`);
  PRES offline toast shown, `messages` unchanged, no network request, input text kept, `sendBtn` not disabled; **PS lock released: `isSendingMessage === false` right after the attempt**.
- **AC-5′ follow-up after reconnect** (VALID reconnected: banner hidden, `onLine=true`, button enabled, text still in the input, previous toast gone): **PS the same text through the same entry point (click / Enter) now sends:**
  Δmessages = 2 (`user`, `assistant/error` since every external request is aborted), Δrequests ≥ 1, cycle ends with lock `false`, button enabled, input cleared.
- **AC-5″ repeated offline attempts**: **PS** three offline attempts in a row each show the offline toast (slice 7 AC-9: they were silent while stuck) and keep the lock `false`; the follow-up after reconnect sends (as AC-5′).
- **AC-5‴ empty input offline**: PRES offline attempt with empty/whitespace text returns before the lock: nothing happens, lock `false`, no toast (unchanged behavior).
- **AC-7′ (replaces the slice 7 causal intervention, which can no longer apply):** the lock is still a real lock —
  PRES (a) two synchronous `sendMessage()` calls (text refilled between them) start ONE pipeline: exactly one `user` message and the same number of aborted requests as one control send;
  PRES (b) same with an attached image (`pendingImageBase64`; proves the lock is taken before the first `await`);
  PRES (c) in-flight state (the first external request is held by a test-side gate): lock `true`, `sendBtn.disabled === true`, a click and an Enter during flight are no-ops (no extra message, no extra request); after release the cycle ends with lock `false`, button enabled.
- **AC-8 failures before the `try`** (fault injection through the page, restored after each case): E1 `ImageStore.save` rejects (image attached); E2 `NexusOrchestrator.resolveActiveMode` throws;
  E3 `NexusObservability.startTask` throws; E4 a required DOM element (`#crossExamToggle`) is missing (real `TypeError`). For each: **PS** the promise returned by `sendMessage()` resolves (the failure is handled like any in-pipeline failure),
  **PS** lock `false` and `sendBtn` enabled afterwards, **PS** the last message is an `assistant/error` message that contains the failure text, **PS** after the fault is removed the next send works (Δmessages = 2, lock `false`).
  VALID per case: the fault really fired (injection counter / the DOM element really absent) and the PRE state is not a measurement artifact (positive control = C0).
- **AC-9 failure and offline while a send is in flight** (gate holds the first request): PRES going offline mid-flight and then releasing ⇒ exactly one error message, lock `false`, button enabled; after reconnect a send works.
- **AC-10 controls** (VALID): C0 a normal online send completes (`[user, assistant/error]`, ≥ 1 aborted request, lock `false`, button enabled, input cleared); C2 an offline period WITHOUT an attempt does not break sending.
- **AC-11 scope/integrity**: the diff touches `frontend/neural_nexus_ai_agents-4-3-5-3.html` only, and only inside `sendMessage()` (the lines between the guard and the `try` header, plus the one `taskOutcome` line); every other `frontend/` file, backend, ADR, `PHASE2-MODULARIZE.md` byte-identical (sha256);
  net diff ≤ 12 changed lines. No change to `PERSISTABLE_STATE` (+ its 16 variables), ADR-003, C2/C3, Evidence Integrity.
- **AC-12 can fail** (scratch mutants of the PATCHED tree, `baseline/evidence/phase2-core-slice8-mutation-script.mjs`; production sha256 identical before/after): K1 revert to the original lock position ⇒ REJECTED (PS offline red); K2 offline fix only, no `try` move ⇒ REJECTED (AC-8 red);
  K3 guard condition `isSendingMessage ||` removed ⇒ REJECTED (AC-7′ a/b/c red); K4 lock taken after the `await ImageStore.save` ⇒ REJECTED (AC-7′ b red); K5 reset removed from `finally` ⇒ INVALID/REJECTED (controls + PS red); K6 offline check disabled ⇒ REJECTED (AC-4′ toast red).
- **AC-13 regression** (no weakened or deleted test; every number re-measured): Vitest 168; E2E `baseline-flows` 12, `phase1-security-flows` 16 (it awaits `sendMessage()` itself), `phase2-core-seed-flows` 16 (known intermittent check, CP-14 §E-1: re-run before concluding), `slice4` 21, `slice5` 27 (`SURVIVES`), `slice6` 35;
  slice 7 script on the patched tree must report `S7-VERDICT = NOT-STUCK` with exit 0 (it was designed to; if a VALID check fails that is a regression to explain); backend `tsc --noEmit` + `npm test` 406; slice 2 probe 19, slice 3 analyzer 22 (on a COMMITTED/clean production tree), exec-order 9, unit-vs-original 36, slice 4 mutation 16/16.
  Evidence scripts whose input includes the edited text (slice 7 mutation script anchors, slice 3 analyzer, slice 4 extract P5/P7) are MEASURED on the clean pre-fix commit and on the patched tree before anything is attributed to the patch.
- **AC-14 no hidden behavior change**: the only intentional behavior changes are (1) the lock is released on offline early return and (2) failures before the old `try` are now caught by the existing `catch`/`finally` (error message in chat + log, lock + button released) instead of leaking. Anything else observed ⇒ REJECT and revisit.

## Candidate fixes (evaluated on scratch copies with the slice 8 script BEFORE choosing; the smallest that turns every PS green with every PRES green wins)
- **F1** set the lock after the offline check (slice 7 candidate A). Expected: AC-4′/5′/5″ green, AC-8 red.
- **F2** F1 + move `try{` up to just after the lock and hoist `let taskOutcome`. Expected: all green.
- **F3** keep the lock where it is, move `try{` up to just after it (the offline `return` then runs the `finally`) and hoist `let taskOutcome`; no statement is reordered. Expected: all green, smallest diff.
- (Slice 7 candidate B — reset inside the offline branch — is not carried forward: it cannot cover AC-8.)
Tie-break: fewer changed lines, then no reordering of existing statements.

## Decision rule (set before testing)
Apply the winning candidate iff: all PS green and all PRES/VALID green after the patch; AC-11 holds; AC-12 mutants all behave as specified; AC-13 shows no unexplained regression. Otherwise do NOT apply, revert, document evidence and alternatives.

## Known limits to document whatever the outcome
Chromium 141 headless + network emulation only; no real device/Firefox/Safari/`sw.js`; the streaming/stop (`AbortError`) branch needs a real backend stream and is not exercised (it is inside the unchanged `try`); online send reaches only an aborted external request; fault injection by monkey-patching/DOM removal models, but does not prove, which real faults occur in the field.

## Post-measurement notes (appended AFTER the runs; the criteria above were NOT edited)
- AC-12 K6: predicted REJECTED, measured **INVALID** (VALID 42/44): with the offline check disabled the text is really sent offline, so the scenario precondition "input still holds the text after reconnect" (VALID) fails in addition to the PRES toast/nothing-sent and PS checks. Not ACCEPTED either way; the expectation in the mutation script was corrected with this reason (first-run log kept: `…-mutation-FIRST-RUN-K6-prediction-wrong.log`).
- AC-12 K3/K4: only the image variant AC-7′ b catches them. Reason (read from the code, confirmed by the measurement): in the plain path `sendBtn.disabled = true` (L8244) is set synchronously before any `await`, so a second synchronous call is already stopped by `sendBtn.disabled`; the lock is the only barrier in the window before that, i.e. the `await ImageStore.save` when an image is attached.
- Candidate sizes (raw `diff -u`): F1 +1/−2, F2 +3/−4, F3 +5/−2. F3 carries a 3-line explanatory comment; code-only F3 = +2/−2, F2 = +3/−4 with statements reordered ⇒ F3 chosen by the tie-break rule (written before the runs).

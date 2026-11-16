# Core slice 7 — `isSendingMessage` after an offline send attempt — acceptance criteria (written BEFORE the formal script; EVIDENCE-ONLY, no production change)

Origin: CP-13 §8 recorded a static finding (INFERENCE, UNVERIFIED at runtime): `sendMessage()` sets `isSendingMessage = true`
(monolith L8227) and then returns early when `!navigator.onLine` (L8229–8232) BEFORE the `try { … } finally { sendBtn.disabled = false; isSendingMessage = false; … }`
(L8294–8450), so a single offline send attempt may leave later sends returning silently at the entry guard (L8226) until reload.
The owner asked (this session) to test it in practice BEFORE any production change.

Scope: runtime test only. Out of scope (not started, not touched): any production edit, C2/C3, `PERSISTABLE_STATE`, ADR-003, Evidence Integrity,
the other write-before-restore variables, `sw.js`, any other `sendMessage` failure path (those are recorded as static notes only).

## Facts established by reading the code (INSPECT/MAP — before testing)
- `isSendingMessage` has exactly 4 textual uses: declaration (L5194), entry guard (L8226), set (L8227), reset inside the `finally` (L8436). No other writer — not `updateOnlineStatus`, not the `online`/`offline` listeners,
  not `resetAllData`; it is not in `PERSISTABLE_STATE` (so a reload resets it by re-initialising the `let`).
- `sendMessage` callers: `#sendBtn` inline `onclick` (L2331), `handleKeydown` Enter (L7460), and two other call sites (L6255, L11701).
- The offline early return neither clears `#msgInput`, nor sets `sendBtn.disabled`, nor touches `messages`; it only shows a toast.
- `updateOnlineStatus()` (online branch) only hides the banner and sets `sendBtn.disabled = false`; it does not touch `isSendingMessage`.
- A normal online send with no backend and no API key reaches `callClaude` → `fetch('https://api.anthropic.com/…')`; with every non-origin request aborted by the test router it fails ("Failed to fetch") and the app appends an error message — i.e. the real
  pipeline runs to its `finally` without any mock (exploratory run, not evidence: ~1.9 s, 3 aborted POSTs).

## Check kinds (same discipline as slice 5)
- **VALID** `[PASS]/[FAIL]`: measurement validity and controls. Any VALID failure ⇒ verdict INCONCLUSIVE and exit code ≠ 0.
- **OBSERVED** `[OBSERVED]`: the outcome itself, REPORTED not asserted (the script must be able to report NOT-STUCK faithfully).
- Verdict line: `S7-VERDICT = STUCK | NOT-STUCK | INCONCLUSIVE`.
  STUCK iff (offline attempt leaves the flag `true`) AND (after real reconnection a follow-up send adds no message, issues no request and shows no toast) AND (causal intervention — resetting only the flag — makes the very same send work).

## Acceptance criteria
- **AC-1 control, online cycle** (VALID): fresh profile, online: one send through the real UI adds `[user, assistant-error]`, issues ≥ 1 aborted external request, clears the input, and ends with flag `false` and the send button enabled
  (proves `sendMessage` is functional and the `finally` reset works in the normal path).
- **AC-2 control, offline period without an attempt** (VALID): online boot → offline → online with NO send attempt in between → a send then works exactly like AC-1 (the leak, if any, needs the attempt, not merely the outage).
- **AC-3 offline really in effect** (VALID, per run): before the attempt `navigator.onLine === false`, the app's `#offlineBanner` is shown; after reconnection `navigator.onLine === true`, banner hidden, `sendBtn` enabled, input still holding the same text,
  and (for the follow-up) no toast from the previous step is still on screen (toasts waited out so a new toast is attributable).
- **AC-4 offline attempt** (VALID for the parts the code guarantees; flag value OBSERVED): the offline toast text is shown, `messages` unchanged, no external request issued, input text retained, send button not disabled.
  OBSERVED: flag value right after the attempt.
- **AC-5 follow-up after reconnection** (OBSERVED): same text, via the same entry point: Δmessages, Δexternal requests, new toasts, flag, input value.
- **AC-6 both entry points** (OBSERVED): click path ×3 runs (repeatability) and Enter-key path ×1 (offline attempt via Enter, follow-up via Enter).
- **AC-7 causal intervention** (VALID, applies only when AC-5 says nothing happened): set only `isSendingMessage = false` through the page and repeat the follow-up ⇒ it sends (Δmessages = 2, Δrequests ≥ 1, flag back to `false`). Failing it means the flag is not the sole cause ⇒ INCONCLUSIVE.
- **AC-8 recovery by reload** (OBSERVED): online reload ⇒ flag `false` and a send works (documents that "until reload" is accurate).
- **AC-9 secondary observation** (OBSERVED): with the flag stuck, a later OFFLINE attempt shows no toast at all (the guard returns before the offline check).
- **AC-10 can fail** (VALID, run via `baseline/evidence/phase2-core-slice7-mutation-script.mjs` on scratch copies of `frontend/`; production tree sha256 identical before/after):
  - M1 candidate fix (set the flag only AFTER the offline check) ⇒ the script must report `NOT-STUCK` with every VALID check green (shows the verdict is not hard-wired and that this fix would be recognised — NOT applied);
  - M2 offline check removed ⇒ `INCONCLUSIVE` (AC-4 toast check fails);
  - M3 the `finally` reset removed ⇒ `INCONCLUSIVE` (AC-1 control fails).
- **AC-11 scope/integrity**: `git diff --stat HEAD -- frontend src-baseline ADR PHASE2-MODULARIZE.md` empty at the end; frontend sha256 per file before/after identical.
- **AC-12 regression**: Vitest 168; E2E 12/16/16/21/27/35 unchanged vs the PRE measurements of this session (seed-flows allowed its documented intermittent failure, see CP-14 §E-1, only if reproduced and explained).

## Decision rule (set before testing)
No patch in this slice whatever the verdict. If STUCK is observed: document the evidence, the minimal candidate fix validated only on a scratch mutant (M1), and the open owner decision (apply it as a separate code slice with its own PRE/POST).
If NOT-STUCK or INCONCLUSIVE: document that, and do NOT propose a fix.

## Known limits to document whatever the outcome
- Chromium 141 headless + Playwright network-offline emulation only; no real device, no Firefox/Safari, no `sw.js`.
- Only the offline early return is tested. Other paths that can leave the flag `true` (exceptions thrown between L8227 and the `try`, e.g. `ImageStore.save`, `NexusOrchestrator.resolveActiveMode`, `NexusObservability.startTask`) are static notes (UNVERIFIED), not run.
- The online follow-up reaches the network layer only up to an aborted external request (no real provider/backend).

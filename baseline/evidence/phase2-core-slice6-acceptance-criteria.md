# Core slice 6 — I-1 / O2 — acceptance criteria (written BEFORE any production change)

Scope: evaluate O2 = "delay `updateOnlineStatus()` until `autoInitApp()` has settled" (CP-12 §6) and apply it
ONLY if every criterion below holds. Out of scope: C2/C3, `PERSISTABLE_STATE`, ADR-003, Evidence Integrity,
any other variable's write-before-restore, `sw.js`.

Baseline (PRE, unmodified `fbd7236`, measured this session): E2E 12/12, 16/16, 16/16, 21/21; slice 5 27/27
validity with `I1-VERDICT = LOST`; Vitest 168/168. Logs: `phase2-core-slice6-PRE-*`.

## Facts established by reading the code (INSPECT/MAP — before testing)
- `main.js` ends with `autoInitApp(); registerServiceWorker(); updateOnlineStatus();`; `autoInitApp` is async and not awaited.
- `updateOnlineStatus()` (monolith L11016) only (a) online: hides `#offlineBanner`, sets `sendBtn.disabled=false`;
  (b) offline: shows the banner and calls `logActivity('انقطع الاتصال', …)`. It NEVER disables the send button when offline
  (CP-12 §6 O2 wording "تعطيل زر الإرسال" does not match the code). `sendMessage()` checks `navigator.onLine` itself.
- Listeners `online`/`offline` -> `updateOnlineStatus` are registered at classic-script parse time (L11027-11028), i.e. before `main.js` runs; O2 does not touch them.
- Callers of `updateOnlineStatus`: those two listeners and `main.js` only.
- `autoInitApp` can reject (it only try/catches the key read, key import, state read and decrypt+restore; the render calls and
  `ExecutionCheckpoint.checkForResumable()` are unguarded), and `localStore.get` has no timeout (IndexedDB hang = promise never settles).
  A naive `await autoInitApp()` therefore risks never calling `updateOnlineStatus` on rejection; a hang would delay the banner indefinitely.

## Acceptance criteria (ALL must hold to apply the patch)
Tags: **PS** = patch-specific (expected RED before the patch, GREEN after); **PRES** = preserved behavior (must be GREEN before AND after);
**VALID** = measurement validity (must always be GREEN; otherwise the run is INVALID).

- **AC-1 offline boot + decryptable blob** (VALID: onLineAtStart=false, banner shown, restore ran, messages restored):
  PS final `activityLog` = `[offline-entry, seed-1, seed-2]` exactly (entry once, on top, restored order intact); PS DOM list == memory
  (entry visible, same item count); PS next `persistState()` persists the entry; PS verdict identical over 5 plain + 3 traced runs and plain == traced.
- **AC-2 other offline boots**: PRES offline + no blob -> exactly 1 entry, banner shown (positive control);
  PS offline + blob lacking the `activityLog` key -> `[entry]`; PRES offline + undecryptable blob -> fresh start (marker not restored), exactly 1 entry, app initialised.
- **AC-3 online boots**: PRES online + blob -> `activityLog` == seed exactly, no offline entry, banner not shown, send button enabled;
  PRES online + no blob -> `activityLog == []`, banner not shown.
- **AC-4 listeners after boot**: PRES online boot then offline event -> banner shown + exactly 1 entry on top of the restored log;
  then online event -> banner hidden, send enabled; PRES offline boot then online event -> banner hidden.
- **AC-5 event inside the init window** (init held open by a test gate on the first `localStore.get`): PRES the offline listener still shows the banner immediately;
  PS after release the final log contains the offline entry exactly once on top of the seed (no loss, no duplicate).
- **AC-6 `autoInitApp` rejection** (injected after restore, inside the unguarded tail): PRES-in-spirit/PS: `updateOnlineStatus` STILL runs (banner shown, entry written);
  PRES the rejection is still reported as an unhandled rejection (not swallowed).
- **AC-7 ordering**: PRES `serviceWorker.register` is called before `restore-begin` (SW registration not delayed);
  PS the offline entry is written after `restore-end` (exactly one write, one restore); PS the banner is applied after `restore-end`.
  PS (documented trade-off, asserted so it cannot drift silently): while init is held open and no event occurred, the banner is NOT yet shown.
- **AC-8 scope**: production diff = `frontend/main.js` only, limited to the 5-line startup block; every other `frontend/` file byte-identical (sha256 per file); no change to `PERSISTABLE_STATE`/ADR/`sw.js`/backend.
- **AC-9 can fail**: scratch mutants (K1 revert to sequential; K2 `.then` without `.finally` so rejection skips the call; K3 drop the call;
  K4 SW registration moved behind init; K5 rejection swallowed) are each detected by `e2e/phase2-core-slice6-flows.mjs`; production tree sha256 unchanged by the mutation run.
- **AC-10 regression**: E2E 12/16/16/21 unchanged; slice 5 script still valid (27/27) and now reports `SURVIVES` (its verdict is an observation, not an assertion); Vitest 168; no uncaught page errors in the non-injected scenarios.

## Decision rule (set before testing)
Apply O2 iff AC-1..AC-9 are GREEN after the patch, every PRES check is GREEN before and after, and the diff is the 5-line block only.
If a PRES check regresses, the rejection case (AC-6) cannot be made safe, or the diff cannot stay limited: DO NOT apply; revert the scratch change and document
the evidence + the better alternative (CP-12 O3, or O2 limited to the log write) instead.

## Known residual risks to document whatever the outcome
- Banner appears after init completes (IndexedDB read + decrypt + restore + renders): a delay of the offline banner only; the send path is unaffected (own `navigator.onLine` check).
- An IndexedDB promise that never settles would also keep the banner hidden (and the app uninitialised anyway); not reproduced here (no timeout exists in `localStore`).
- Only `activityLog` is covered; other write-before-restore cases remain INFERENCE.

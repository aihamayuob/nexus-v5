# ADR 001 — Phase 1 Security: Storage Separation & History Sanitization

**Status**: Accepted
**Date**: 2026-09-16

## Context

Phase 0's inventory flagged that `messages` (including embedded base64
images) lives entirely inside `PERSISTABLE_STATE`, a single object
encrypted and decrypted as one blob on every app load, with no cap. Phase
1's own protocol scope (§10) explicitly names "message cap + archive",
"image separation in IndexedDB", and "image garbage collection" as
required areas. This ADR covers the architectural decisions made to close
those three, plus the smaller "marker stripping" and "JS-string
serialization" fixes.

## Decisions

1. **New data does not join `PERSISTABLE_STATE`.** `ImageStore` and
   `MessageArchive` are separate `localStore` keys (`nexus_img_*`,
   `nexus_archived_messages`), following the exact precedent already set
   by `ExecutionCheckpoint` (`nexus_checkpoint`) earlier in this same
   file. This was a deliberate choice to extend an established pattern
   rather than introduce a new one — same rationale each time: data that
   doesn't need to ride inside the encrypt/decrypt-on-every-load contract
   shouldn't.

2. **Old messages keep working without migration.** Rather than writing a
   one-time migration script to convert every existing `m.image` to
   `m.imageRef`, `renderMessages()` checks `m.image` first and only falls
   back to `ImageStore`/`imageRef` if absent. This means a user's
   pre-Phase-1 conversation history keeps rendering exactly as before,
   forever, with zero data transformation risk. New images always use the
   new path. This is a permanent two-branch fork, not a temporary shim —
   accepted as the simplest way to guarantee no existing user data could
   be corrupted by this change.

3. **Cap enforcement lives in `persistState()`, not in every message-push
   site.** Messages get pushed from at least half a dozen call sites
   (agent replies, collective mode, auto-route, etc.). Rather than adding
   cap-checking logic to each one (violates single-source-of-truth,
   mirrors exactly the kind of scattered-logic bug this codebase's own
   `PERSISTABLE_STATE` comment warns against), the cap is enforced once,
   centrally, at the one function every save path already funnels
   through.

4. **`gcAll()` uses a new `listKeys()` capability rather than a tracked
   id registry.** An alternative design would maintain an explicit array
   of known image ids inside `PERSISTABLE_STATE` itself. Rejected because
   it reintroduces exactly the "growing list inside the main blob"
   problem this ADR exists to avoid, and because keeping two sources of
   truth (the registry array and the actual stored keys) in sync forever
   is a real, ongoing correctness burden. `localStore.listKeys(prefix)`
   (backed by `IDBObjectStore.getAllKeys()` / `window.storage.list()`)
   makes the actual stored keys the only source of truth.

5. **`stripInternalMarkers()` reuses existing `parse*()` functions rather
   than a new stripping implementation.** `renderMessages()` and
   `saveMessageAsFile()` already parse and strip these same four markers
   for display/export. A new, independent stripping function would be a
   second implementation that could silently drift from the first
   (e.g. if a fifth marker type is ever added and only one of the two
   places gets updated). Reusing the same `.text` result the render path
   already produces makes drift structurally impossible.

## Consequences

- Message objects now have two possible shapes for image data
  (`m.image` legacy / `m.imageRef` current) permanently. This is a
  small, disclosed, permanent complexity cost, accepted in exchange for
  zero migration risk.
- `resetAllData()` now awaits two additional async calls
  (`ImageStore.gcAll()`, `MessageArchive.clear()`) before finishing. Both
  are already wrapped in try/catch internally (non-fatal by design,
  matching every other module in this file), so a failure in either
  cannot block the rest of the reset from completing.
- `persistState()` now occasionally performs a synchronous array splice
  before its usual encrypt+save work. Bounded to at most
  `messages.length - MESSAGE_CAP` per call, and only ever removes the
  oldest entries — no behavior change for any conversation under 300
  messages (the overwhelming majority, in practice).

## Verification

See `PHASE1-SECURITY.md` for the full findings table and
`baseline/evidence/phase1-e2e-run.log` for the 16 real, browser-driven
checks (including the backward-compatibility check that a pre-Phase-1
`m.image`-shaped message still renders correctly) plus a clean re-run of
every Phase 0 flow (12/12, zero regressions) and the untouched backend's
406/406.

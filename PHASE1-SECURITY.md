# PHASE1-SECURITY.md — NEXUS v5.0, Phase 1 (/nexus-security)

**Status: DONE**
**Scope per protocol §10**: Security + Markdown + Storage + History + Import
**Files touched**: `frontend/neural_nexus_ai_agents-4-3-5-3.html` only
(213 insertions / 16 deletions — `git diff --stat`). `src-baseline/` (backend)
**untouched** — 0 diff, confirmed via `git diff --stat src-baseline/`.

Every item below was INSPECTed against the actual code (not assumed),
DIAGNOSEd, then either PATCHed with evidence, or left alone with a
recorded reason. No broad rewrite; no logic change mixed with any move.

## Findings and actions, per protocol §10's explicit checklist

| # | Item | Finding | Action | Status |
|---|---|---|---|---|
| 1 | Safe Markdown rendering | No markdown rendering exists anywhere — chat content renders via `.textContent` only (confirmed: `grep -c 'marked\.\|markdown' → 0`) | None — nothing to secure; adding markdown rendering is a new feature, out of Phase 1's security remit | N/A |
| 2 | DOMPurify sanitization | No HTML-from-untrusted-source interpretation happens anywhere (see #1) | None — DOMPurify has nothing to sanitize in the current architecture | N/A |
| 3 | XSS/unsafe DOM sink remediation | All 153 `.innerHTML` assignment sites classified: 143 static/no-interpolation, 9 escapeHtml-wrapped or trivially safe (numeric/length), 1 flagged-then-manually-confirmed safe (`opsBadge`/`opsTs` helpers are internally safe) | None needed — verified via a reproducible classification script, not assumed | DONE (verified safe) |
| 4 | Secure JS-string serialization | 11 onclick sites used `escapeHtml(id)` as a JS-string argument — HTML-entity-escaping a quote does not survive the browser's attribute-decode-then-parse-as-JS order, so this pattern was structurally fragile (not currently exploitable, since every `.id` value is app-generated: `custom_<ts>`, `wf_<ts>`, or a hardcoded built-in id — never user/import-controlled) | Added `jsStr()` (JS-escape then HTML-escape), applied to all 11 sites | **PATCHED** |
| 5 | Message cap + archive | `messages` array was unbounded — grows forever inside the single encrypted `PERSISTABLE_STATE` blob decrypted on every app load | Added `MESSAGE_CAP = 300` + `MessageArchive` (separate `localStore` key, same pattern as the existing `ExecutionCheckpoint`), enforced in `persistState()` | **PATCHED** |
| 6 | Image separation in IndexedDB | Attached images' full base64 payload was embedded directly on the message object inside the same monolithic blob (only 2 call sites total: write in `sendMessage()`, read in `renderMessages()`) | Added `ImageStore` (separate `localStore` keys, in-memory cache for the current session). Messages now carry `imageRef`; `m.image` kept as a read-only backward-compat fallback for conversations persisted before this fix | **PATCHED** |
| 7 | Image garbage collection | New requirement created by #6 — without it, `resetAllData()` would leave orphaned image blobs behind despite its own confirm dialog promising a full wipe | Added `ImageStore.gcAll()` (uses new `localStore.listKeys()`), wired into `resetAllData()` alongside `MessageArchive.clear()` | **PATCHED** |
| 8 | Marker stripping from model history | `buildHistoryForAgent()` sent raw assistant content — including internal `THOUGHT_TREE_MARKER`/`SYNTH_TABLE_MARKER`/`SYNTH_VOTE_MARKER`/`RESULT_ENVELOPE_MARKER` + trailing JSON — straight back to the model as its own prior-turn history on every subsequent call. `renderMessages()`/`saveMessageAsFile()` already stripped these for display/export, but the history sent to the API never was | Added `stripInternalMarkers()` (reuses the exact same `parse*()` functions renderMessages already uses — single source of truth), applied in `buildHistoryForAgent()`, which is the one function all 5 call sites already funnel through | **PATCHED** |
| 9 | Secure external content import | Both import paths (`importCustomAgentPasted()`, `applyNomadicPayload()`) use `JSON.parse` only — confirmed no code-execution risk — but committed straight to state with zero visibility to the user, including from a QR-code camera scan (a real physical-sticker attack surface) | No patch needed for code-exec (already safe); see #11 for the confirmation gap | Safe from RCE |
| 10 | PromptInjectionGuard integration | Already correctly wired: knowledge base (`fence('قاعدة معرفة المستخدم', ...)`), custom-agent knowledge, uploaded documents, and market-context data are all fenced before reaching the model | None needed | DONE (pre-existing) |
| 11 | Preview + user confirmation | Neither import path showed the user what they were about to activate before committing it | Added a `confirm()`-based preview to both (same UI pattern `resetAllData()` already uses — no new paradigm): agent import shows name + truncated prompt + knowledge-item count; memory import shows knowledge-item titles + agent-selection change count | **PATCHED** |
| 12 | Security regression tests | — | New `e2e/phase1-security-flows.mjs`: 16 real browser-driven checks covering every patch above plus a chat-send regression check. Re-ran the original `e2e/baseline-flows.mjs` (Phase 0) unchanged | **16/16 + 12/12 passing** |

## Regression verification (full, re-run fresh — not copied from Phase 0)

| Check | Result |
|---|---|
| Backend `npm run typecheck` | Clean, exit 0 (backend untouched, re-verified anyway per protocol) |
| Backend `npm test` | **406/406**, 0 fail (unchanged from Phase 0 — confirms zero backend impact) |
| `node --check` on both extracted `<script>` blocks | Clean — confirms every patch is syntactically valid |
| `e2e/baseline-flows.mjs` (Phase 0 flows, re-run after Phase 1 patches) | **12/12** — zero regressions |
| `e2e/phase1-security-flows.mjs` (new Phase 1 checks) | **16/16** |
| `git diff --stat src-baseline/` | Empty — zero backend changes |
| `git diff --stat frontend/` | 213 insertions / 16 deletions, one file |

## One self-caught and self-corrected mistake, disclosed

Mid-implementation, an editing error left a stray placeholder line
(`ORIGINAL_MARKER_DO_NOT_KEEP: true,`) duplicating a comment inside the
pre-existing `ExecutionCheckpoint` object — a real mistake, not a
deliberate step. Caught immediately via `node --check` on the extracted
script (before any test run, before any commit), fixed in the next turn,
and re-verified clean. Documented here rather than omitted, consistent
with this project's standing practice of disclosing self-corrected
mistakes (see e.g. the Phase 0 test-harness WAL/SHM artifact, or the
resilience-restoration pass's corrected "residual gaps" claim).

## What Phase 1 deliberately did not do (not gaps — explicit scope limits)

- Did not add markdown rendering (items #1/#2) — would be new feature
  work, and inventing a markdown-to-HTML path during a security phase
  risks introducing exactly the XSS surface this phase exists to prevent.
- Did not build a "load older messages" UI for `MessageArchive` — the
  data is preserved (never deleted), but surfacing it in the UI is a
  UX/Phase 4 concern, not a security fix.
- Did not add archive-pruning (i.e., a cap on `MessageArchive` itself) —
  unbounded archive growth is a real but much smaller and more distant
  problem than the original unbounded-live-state problem this phase
  closes; adding it now would be scope creep.
- Did not modularize `stripInternalMarkers`/`jsStr`/`ImageStore`/
  `MessageArchive` into separate files — that is explicitly Phase 2
  (`/nexus-modularize`) work per protocol §7, and mixing it into Phase 1
  would violate "no logic change + move in the same commit."

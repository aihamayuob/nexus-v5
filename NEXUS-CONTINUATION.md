# NEXUS-CONTINUATION — Authoritative Project-Continuity Document

**Document date:** 2026-11-08 (Damascus, UTC+03:00; produced after validation checks run on 2026-11-07) · **Basis:** Project documents under `continuity/` read back from the Claude Project on 2026-11-07, plus local byte-level checks run in this workstream. **No live repository, no `.git` of the live project, and no source code was touched or available.**

> **Status vocabulary (only these words are used as statuses):** VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED. "DONE" is not a status. A status never goes beyond the evidence cited next to it. Where information is not available, this document says **UNVERIFIED** and does not fill the gap.

> **How this file relates to the old one.** The previous `continuity/NEXUS-CONTINUATION.md` (27,576 bytes, SHA-256 `2cf84b87…de4`) is preserved **verbatim and byte-exact** in Appendix H at the end of this file (between the `BEGIN/END-HISTORICAL-NEXUS-CONTINUATION` markers) and is **historical**: its §1–§5 describe the CP-19 / UI-slice era. This file's §1–§13 are the current continuity statement. **The Project copy of `continuity/NEXUS-CONTINUATION.md` has NOT been replaced** — this file is a deliverable for the owner; replacing the Project copy needs the owner's approval (see §3).

---

## 1. Exact current stopping point

| Item | Value |
|---|---|
| Stopping point | After the **read-only continuity validation** of the 2026-11-06 documentation update (OD-C17 record + OD-C13 rebuild/audit record), and after producing this document. **No engineering step is active.** Awaiting owner review. |
| Active slice | **None.** No slice F-01…F-06 (or any other) has been started. |
| Engineering phase opened | **None.** (OD-C14, OD-C16 (8), OD-C17 (4): none of these opens a phase or starts a fix.) |
| Source code / tests / patches / Project settings modified in this workstream | **None.** (Only Project continuity documents were added/extended on 2026-11-06; nothing was written to the Project in the 2026-11-07 validation or while producing this file.) |
| Live repository / Git | **BLOCKED** — no `.git` / no access; branch, HEAD, status of the live project are **UNVERIFIED**. |
| Last owner instruction followed | 2026-11-07 (message received 18:33 Damascus): produce this continuity document, validated against the available evidence, no source change, no engineering change. |
| Ends with | **STOP — WAIT FOR OWNER REVIEW.** |

---

## 2. Last verified task and its evidence

Three consecutive read-only/documentation tasks. Only what is stated under "Evidence" is verified; nothing else is implied.

### 2.1 OD-C13 baseline rebuild + read-only capability audit (2026-11-06)

- **What was done:** the approved six-patch baseline (§5) was rebuilt in an isolated temporary tree with no remote; then a static, read-only audit (areas A–E: providers, secrets, cloud egress, connectors/VEL, i18n) was performed. No project code was run. Delivered to the owner as `NEXUS-OD-C13-AUDIT-DELIVERABLES.zip`, **SHA-256 `d80bc155318ba204b97795a93e8b1ad4dc40142568329aac70bf2639b06d6f07`** (re-hashed locally on 2026-11-07: equal; the Project file `…zip.sha256.txt` contains the same value).
- **Evidence (paths under `continuity/od-c13-audit-2026-11-06/`):** `BASELINE-RECONSTRUCTION-REPORT.md`, `EXECUTIVE-SUMMARY.md`, `EVIDENCE-INDEX.md`, `CODE-CAPABILITY-MATRIX.md`, `SECURITY-AND-EGRESS-FINDINGS.md`, `SHA256-BEFORE-AFTER-COMPARISON.txt`, `RAW-LOGS-CONCATENATED.txt` (15 original logs, each segment carrying its original SHA-256), `MANIFEST-worktree-BEFORE.tsv.txt`, `MANIFEST-dotgit-BEFORE.tsv.txt`; summary record `continuity/OD-C13-REBUILD-AND-AUDIT-2026-11-06.md`.
- **Result (as recorded; all inside the isolated copy):** 7/7 input hashes match the full SHA-256 values recorded in G1; bundle verifies (complete history, sha1); six patches each `git apply --check` rc=0 then `apply` rc=0 in order; HEAD stays `cbdc898…`; 23 commits unchanged; 877 worktree files (27 modified + 23 untracked + 0 other); no remote/branch config; GENOME-GATE absent; before/after manifests of the worktree (877 files) and `.git` (26 files), Git status, HEAD and input hashes identical (no change by the audit).
- **Static audit findings F-01…F-13:** see §8. **Static reading only; operational effect UNVERIFIED; no Critical finding.**

### 2.2 OD-C17 owner review decisions — documentation record (2026-11-06)

- **What was done (documentation only):** `DECISIONS.md` gained §C7 (OD-C17), CF-22, PD-19, PD-20 and a closing dated block; `NEXT-SESSION-START-HERE.md` gained §0-هـ and a header note; `CHANGELOG.md` gained a dated entry; the record document and audit copies listed in 2.1 were added. All edits are **insert-only**. Not updated (still carrying older wording): `NEXUS-CURRENT-STATE.md`, `VERIFICATION.md`, `PROJECT_HISTORY.md` (this is stated in `NEXT-SESSION-START-HERE.md` §0-هـ item 5 and in `DECISIONS.md`).

### 2.3 Continuity validation — read-only (2026-11-07, this workstream)

Verified by recomputation, not by trusting any hand-back text (the helper agents' reported hashes were each recomputed locally from the files they wrote):

| # | Check | Result |
|---|---|---|
| a | `DECISIONS.md`, `NEXT-SESSION-START-HERE.md`, `CHANGELOG.md`: Project readback vs. an independently regenerated expected file | **Byte-identical** (SHA-256 in Appendix V) |
| b | Original content of those three files preserved? (original lines ⊂ new file in order; new file minus inserted lines == original bytes; diff opcodes are `insert` only) | **Yes** for all three. DECISIONS: 4 insert blocks (§C7 section after orig line 90; CF-22 row after CF-21; PD-19/PD-20 rows after PD-18; closing dated block at the end). NEXT-SESSION: 1 block (14 lines) after line 9. CHANGELOG: 1 block (11 lines) after line 1. No original line deleted, reordered or altered. |
| c | The 6 audit deliverable `.md/.txt` copies + `OD-C13-REBUILD…md` | Byte-identical to the originals in the delivered package (audit copies) / identical between two independent readbacks (record doc) |
| d | `MANIFEST-worktree-BEFORE` (117,901 B, 877 lines) and `MANIFEST-dotgit-BEFORE` (2,489 B) | Byte-identical to the originals |
| e | `RAW-LOGS-CONCATENATED.txt` (24,408 B) | 15 segments; each segment's declared SHA-256 = the original log file's SHA-256 = the segment body |
| f | Hash tables inside `OD-C13-REBUILD-AND-AUDIT-2026-11-06.md` | Zip SHA, six document SHAs and two manifest SHAs all match the real files. (`EVIDENCE-INDEX.md` lists files by name, contains no hashes.) |
| g | Six documents that were **not** edited (`BASELINE-GOVERNANCE`, both G1 reports, three `g1/` files) | **Unchanged** (equal to the pre-update copies) |
| h | Seven other Project docs (`NEXUS-CURRENT-STATE`, `VERIFICATION`, `PROJECT_HISTORY`, `NEXUS-CONTINUATION`, `ROADMAP`, `PLAN`, `PD-13-PART2-ACCEPTANCE`) | No write was issued to them; no pre-update copy exists → **"unchanged" is UNVERIFIED**; current hashes recorded in Appendix V |
| i | Mismatches found | (1) `OD-C13-REBUILD…md` says RAW-LOGS has **16** files; the delivered zip and Project copy hold **15**. (2) Wording stronger than evidence in `EXECUTIVE-SUMMARY.md`. (3) Stale G1 statements in older docs. Details and proposed (not applied) corrections: §11. |

**Validation limits:** per-file `project_read` readbacks are the evidence that the Project holds these bytes; the Project's internal storage was not inspected. No file was modified in this validation.

---

## 3. Next authorized task

| Question | Answer |
|---|---|
| Is any engineering step authorized now? | **No.** OD-C17 (4): none of F-01…F-06 may start on the strength of OD-C17 alone; each slice needs a **separate execution decision** by the owner. |
| What is authorized right now? | Documentation-level work only: producing/delivering this continuity document (done by delivery of this file) and answering owner questions. |
| What requires the owner next? | (1) Review this document and the validation findings (§11). (2) Decide **CF-22** and **CF-21** (both unresolved). (3) Decide whether to record the unrecorded directives (PD-20). (4) When ready, issue **one** slice execution decision (planning order in §8.2), preceded by the presentation required by OD-C17 (2): root cause → proposed design → acceptance tests → risks. (5) Approve or decline: replacing the Project `NEXUS-CONTINUATION.md` with this file; adding dated corrections listed in §11.4; marking the OD-C17 session-authored parts per §4.2. |
| Next engineering action after an owner slice decision | INSPECT → MAP → DIAGNOSE → PATCH → TEST → VERIFY → DOCUMENT → **STOP**, on the single named slice, in an **isolated workspace** (no live repo, no commit/push/merge/deployment). Phase 2 continues in parallel in a separate workspace (OD-C17 (4)). |
| Not authorized (unchanged) | commit / push / merge / tag; patching the live repo; G7; MCP; GAP-2; UI update; H1; including GENOME-GATE (PD-18); VEL mutation testing; real AI providers/keys; opening any engineering phase because a policy or baseline was accepted. |

---

## 4. Owner decisions and restrictions (preserved)

Source of record: `continuity/DECISIONS.md` (§A standing instructions; §B/§C–§C7 decisions; §D conflicts; §E pending). The list below is a faithful summary, not a replacement; on any difference the register governs.

### 4.1 Decisions still in force (most recent first)

| ID | Date | Decision (summary) |
|---|---|---|
| **OD-C17** | 2026-11-06 | (1) The six-patch OD-C13 tree is accepted as an **isolated engineering baseline for phase B**; live-repo match stays UNVERIFIED; the two known documentation differences are preserved unmodified; acceptance proves neither operational behaviour nor test results. (2) Security priorities, **planning only**: **F-01 (with F-08 review) → F-06 → F-05 → F-02 → F-03 → F-04**; before each slice: root cause, proposed design, acceptance tests, risks. (3) Recording in `continuity/` allowed; use the next free ID; replace no historical report; raise no status without new evidence; keep the audit package + fingerprint as independent evidence. (4) **No fix F-01…F-06 starts on these decisions alone**; each slice needs an independent execution decision; no live-repo contact; no commit/push/merge/deployment; Phase 2 continues in parallel in a separate workspace; stop after the continuity update. |
| **OD-C16** | 2026-11-02 (recorded 11-03) | PD-13: part 1 **VERIFIED**, part 2 **PARTIAL**, pinning `CLAUDE.md` in the live repo **BLOCKED**, PD-13 in its original components **not complete**, its review is **not** an engineering authorization, **CF-21 unresolved**; "VERIFIED" for the baseline = identity, fingerprints, rebuild, applicability and match **inside the isolated copy only**; it does not mean complete behavioural verification, live-repo representation, or latest version; a version newer than 2026-10-17 **UNVERIFIED**; VEL **UNVERIFIED**; no 2026-10-29 decisions without a dated textual source; **G1** authorized within stated limits only; G1 opens no engineering phase. |
| **OD-C15** | 2026-11-02 | Order: record the interpretation → G1 after explicit approval → owner review of G1 results **before any status upgrade** → keep PD-01, PD-18, Phase 2 and other engineering gates unchanged. |
| **OD-C14** | 2026-11-01 | PD-13 part 2 (cold-continuity test, 2026-10-31): **PARTIAL, accepted with reservations**; not full independent proof; opens no engineering phase. |
| **OD-C13** | 2026-10-30 | Reference baseline = Git bundle HEAD `cbdc898a3ba605211d9791979a6415f314ba1c8f` (`v5.0-polish`) **+ six patches only, in order** GAP → VEL → G8 → G8.1 → G8.2 → G8.2-CLOSURE; **GENOME-GATE excluded** (PD-18); do not claim the baseline is the latest live version; **§5: no new engineering phase before PD-13 is completed and reviewed**; no commit/push/merge/tag without explicit approval. |
| OD-C12 / PD-17 | 2026-10-27 | `continuity/` docs in the Project are the current continuity reference; the 2026-10-25 archive is an archived baseline, not the newest; the Delta package (2026-10-26) is supplementary evidence pending reconciliation; live repo is the reference for actual code and is not claimed verified without access. |
| OD-C11 | 2026-10-26 | Isolated snapshot validation (archive `489aeec6…14d6` validated in an isolated copy; `DECISIONS.md` §C2). |
| OD-C1 … OD-C10 | 2026-10-25 | "Continuity foundation": isolated execution + Project storage, creation of the continuity files, history preserved (no silent deletion/replacement), unified status in the state file, two separate source orderings, `CLAUDE.md` as the permanent-instruction reference, conflict handling by dated corrections, and the limit of approval (documentation only; excludes source/test changes) — see `DECISIONS.md` §C. |

### 4.2 OD-C17: what the owner explicitly approved vs. what the session wrote

The owner's message (2026-11-06, "NEXUS — OWNER REVIEW DECISIONS", internal labels OD-1…OD-4) is the only owner-approved content. The register row also carries session-authored text. Per the owner's 2026-11-06 continuity-validation directive (any item without explicit approval must be marked draft / awaiting approval), the classification is:

| Component | Explicit owner approval? | Classification |
|---|---|---|
| OD-C17 (1) baseline acceptance (owner OD-1) | **Yes** | Owner decision — approved |
| OD-C17 (2) priority order (owner OD-2) | **Yes** (planning only) | Owner decision — approved |
| OD-C17 (3) continuity recording (owner OD-3) | **Yes** | Owner decision — approved |
| OD-C17 (4) development boundary (owner OD-4) | **Yes** | Owner decision — approved |
| The identifier "OD-C17" itself | Owner allowed "next available identifier after checking the sequence" | Session assignment under owner permission |
| Sentences "ما لا يتغير…" (statuses unchanged) and "ما أضافه التدقيق من أدلة…" inside the OD-C17 cell | **No** | Session-authored restatement/evidence summary — **DRAFT, awaiting owner ratification** (they restate prior statuses; they decide nothing) |
| Register status cell "معتمد; … لا تنفيذ هندسي" | Applies only to the four owner decisions | Must not be read as approval of the session text above |
| **CF-22** (OD-C17 (1) vs OD-C13 §5) | No (session-recorded conflict) | **Unresolved — awaiting owner** |
| **PD-19** (F-01…F-06 slices) | No (planning record) | **Future plan only; nothing started** |
| **PD-20** (record unrecorded directives) | No — explicitly "a session proposal, not an owner decision" | **Proposed, not approved** |

**Applied rule for CF-22:** accepting the baseline is **not** a cancellation of the OD-C13 §5 / PD-13 condition. CF-22 stays open until the owner decides; meanwhile the baseline is accepted and execution is stopped pending a separate decision per slice.

### 4.3 Standing restrictions (verbatim in substance)

- Repository and reproducible evidence are the source of truth; conversation memory is not.
- Status words only (§ header); never "DONE"; never VERIFIED without sufficient current evidence; capability honesty ("code exists" / "test exists" / "integrated path passes" / "available to the user" are different claims).
- Historical documents are never deleted or replaced; corrections are **dated, additive entries**.
- "لا commit ولا push ولا تطبيق رقعة على المستودع الحي ولا بدء G7 أو MCP أو GAP-2 أو تحديث الواجهة أو H1 دون موافقة صريحة منفصلة."
- "لا تستبدل أي تقرير تاريخي ولا ترفع أي حالة تحقق دون دليل جديد."
- "GENOME-GATE مستثناة تمامًا" from the baseline; PD-18 pending.
- Reports and logs stay outside the source tree; no secrets exposed.
- A completed slice is not a completed boundary; a completed boundary is not a completed phase; a passing test proves only what it exercises.
- When a Critical/High failure, unexplained regression, broken contract, unverified security boundary or unsafe dependency appears: stop before the next slice.

---

## 5. Approved six-patch baseline — exact identity

Source of record: `continuity/BASELINE-GOVERNANCE-2026-10-30.md` §2; reproduced independently in G1 (2026-11-03/04) and the OD-C13 rebuild (2026-11-06). **Scope of every statement here: the isolated temporary copy only.**

| Item | Value |
|---|---|
| Git bundle | `nexus-v5-v5.0-polish.bundle` — SHA-256 `75c695d8e7f2174cd89d103ee084eda708a173a7aa5ba89097369062765b0e19` (inside `NEXUS-HANDOFF-2026-10-17.zip`, `git/`) |
| Bundle refs | `refs/heads/v5.0-polish` = `HEAD` = **`cbdc898a3ba605211d9791979a6415f314ba1c8f`**; extra ref `worktrees/b4-pre/HEAD` = `711f3532cccdc365facb1d1c51ad662ec82f5df6`; sha1; complete history |
| Branch / commits / tracked files | `v5.0-polish` / 23 commits / 854 tracked files at HEAD; HEAD unchanged after patches (no commit made) |

Patch order (apply with `git apply --check` then `git apply`; patches 3–6 with `--directory=src-baseline/nexus-backend`):

| # | Patch | File (inside archive) | Full SHA-256 | Stat (G1) |
|---|---|---|---|---|
| 1 | GAP | `NEXUS-GAP1B-HANDOFF-2026-10-20.zip` → `B-evidence/patches/FULL-CHANGES-incl-new-files.patch` | `bb6bd3ba43a009db89326a660f606fac54bcaf593887a6d74f57af71ad09ba84` | 19 files +1187/−22 |
| 2 | VEL | `NEXUS-VEL-HANDOFF-2026-10-21.zip` → `B-evidence/VEL/VEL-changes.patch` | `6af181302ea2efb7ddd44632460751fd0cc7f9193cce51156e53030a6e29ee2e` | 20 files +2185/−6 |
| 3 | G8 | `NEXUS-G8-HANDOFF-2026-10-21.zip` → `B-evidence/G8/G8-changes.patch` | `8dd0c50f391d2941f5c42c05a4d4b2b8c0bf188b42e1cab022e48dee3a429b3f` | 7 files +209/−2 |
| 4 | G8.1 | `NEXUS-G8.1-HANDOFF-2026-10-21.zip` → `B-evidence/G8.1/G8.1-changes.patch` | `34ea6ad16c1e8974401e03de29ac78afe89bc48cd542f63597d0f231035fbfda` | 6 files +257/−10 |
| 5 | G8.2 | `NEXUS-G8.2-HANDOFF-2026-10-21.zip` → `B-evidence/G8.2/G8.2-changes.patch` | `4a2f007ae4429d761a497f677e6c62a8e8e32c4485d6dcefdd65d57527377682` | 4 files +110/−10 |
| 6 | G8.2-CLOSURE | `NEXUS-G8.2-CLOSURE-HANDOFF-2026-10-24.zip` → `B-evidence/G8.2-CLOSURE/G8.2-CLOSURE-changes.patch` | `dbec36fa3fd51fbdcaecbb1911fe328154f72bca0c0314de40f81dd3049e9f7c` | 4 files +241/−3 |
| — | **G8.2-GENOME-GATE — EXCLUDED** | (not fetched, not applied) | `00fa8c3d26769ddec230e16ada2fb7f969c56b59805f525fe7f1bd035378a40e` | out of baseline; PD-18 pending |

Archive SHA-256 values (recorded 2026-11-06 before and after the rebuild; equal): `NEXUS-HANDOFF-2026-10-17.zip` `c7f40b58750249f21623d62b813a3b036507881a4e24345480d5c99fe7148cbf` · `NEXUS-GAP1B-HANDOFF-2026-10-20.zip` `3950f9a5bf5899ceb123941665e5ec3c142524a5fcdfbdde634ec8f6b365d23a` · `NEXUS-VEL-HANDOFF-2026-10-21.zip` `00585f4eb76a82b8fa49d993c7a1443ac0de63c9129ccccd8e19aeed2d718d6b` · `NEXUS-G8-HANDOFF-2026-10-21.zip` `5216e2e102558b3d745b5b05b591c01fd32432c5cc1527448da910a2cf4081c0` · `NEXUS-G8.1-HANDOFF-2026-10-21.zip` `f732420af771d5d253acf2fd5572a2fb79f94ed0c8b1779bcb4ed2bbaa16c444` · `NEXUS-G8.2-HANDOFF-2026-10-21.zip` `a95b1d1fafea000a19b7ef14daaffee629cdac792706c798d55a4398fb06d720` · `NEXUS-G8.2-CLOSURE-HANDOFF-2026-10-24.zip` `7dfa84927602ea0f556efe8bbe80030445787b00e1d7cd466332a759f7ce67f0`.

Resulting tree and fingerprints:

| Item | Value | Evidence / caveat |
|---|---|---|
| Worktree files | **877** (27 modified + 23 untracked + 0 other) | G1 §C; audit `05-patch-apply.log`, `06-git-status-*` |
| Sorted file-list SHA-256 | `039b62d567a277c8da7bb9b79fe1c1ca50fa325e35beaa4772998be1f62fc25b` = CLOSURE snapshot list (877 = 877) | G1 §C; audit `07-…` |
| Content fingerprint **V1** (sorted `sha256sum` list, relative paths) | `56d6356f22c9fe44e7eb7b5e6dfa878a4e9dcb4b161be5d972dd15ec54f5329d` | Equals G1; reproduced twice (G1; 2026-11-06 audit `08-…`) — VERIFIED (isolated copy) |
| Historical CLOSURE value **V2** | `d0053a4a69cb4d2e6d17d0bbfa2255dfed262fa10a582d1842ada0595d03a9ef` | Reproduced on 2026-11-06 **only with an inferred method** (paths with `./` prefix); the original method is undocumented; G1 could not reproduce it. Treat as **UNVERIFIED as to the historical method** |
| 875-file fingerprint (excluding the two differing docs) | `d1059bcfd457b84dd8ea14a04d7e20435de002c2854264849401e3203ed291d8`, equal on tree and CLOSURE snapshot | G1; audit `08-…` |
| Known unresolved difference vs CLOSURE snapshot | exactly two documentation files differ: `ADR/PROPOSED-VEL-verified-execution-layer.md` and `docs/VEL-VERTICAL-SLICE.md` (snapshot has G8/G8.1/G8.2/CLOSURE appendices that none of the six patches carries); **0 code/test differences**; cause **UNVERIFIED** | G1 §C; `tree-vs-closure-snapshot.diff`; preserved unmodified by OD-C17 (1) |
| Identity of the baseline's backend | `src-baseline/nexus-backend` (`nexus-backend` 2.0.0; zero runtime dependencies; `tsx` is **not** declared in `devDependencies`) | G1 §D.1; lockfile v3 |

**What "VERIFIED" means here (OD-C16 (2)–(3)):** identity, fingerprints, rebuild, applicability and match inside the isolated copy. It does **not** mean complete behavioural verification, that the baseline represents the live repo, or that it is the latest version.

**Other commit/repository references:** deposit repository `github.com/aihamayuob/nexus-v5`, shallow read-only clone HEAD `e65c10eca361b5aa39f87feb2be89ee6db0ebcc7` (2026-11-01, "Add files via upload"; recorded in `G1-LOCKFILE-RERUN-2026-11-04.md` §1) — **this is the archive deposit, not evidence of the live repo**. Archive baseline of 2026-10-25: SHA-256 `489aeec65d31632aac7b4d64cde0f89182b4a6548bf6465c8aa4258b1f9114d6` (archived, not newest). Delta package of 2026-10-26: `e33729b39ded585eb61f8274c9f59cfbe99566f1a3ca8fa32198a5fbe6822cb5` (supplementary, reconciliation pending). **Live repository branch/HEAD/status: UNVERIFIED (BLOCKED).**

---

## 6. Evidence status — kept separate

Each row states the status, what it is limited to, and where the evidence is. No row was promoted in this workstream.

### 6.1 VERIFIED (current evidence, **scoped**)

| Claim | Scope limit | Evidence |
|---|---|---|
| Input identity: bundle + 6 patches, 7/7 full SHA-256 | isolated copy; recomputed 2026-11-03 and 2026-11-06 | G1 §B; audit `00-*`, `01-*`, `10-*` |
| Bundle integrity; HEAD `cbdc898…`; 23 commits | isolated copy | audit `03-bundle-verify.txt` |
| Six patches apply in order → 877 files; 875 files byte-identical to CLOSURE snapshot | isolated copy | G1 §C; audit `05-*`, `07-*` |
| Fingerprint V1 `56d6356f…329d` reproduced | isolated copy | G1; audit `08-*` |
| The audit did not change the tree or `.git` | the temp tree | `SHA256-BEFORE-AFTER-COMPARISON.txt`; manifests |
| PD-13 part 1 (Instructions v2/v1 pasted) | verified 2026-10-31 in-session | `DECISIONS.md` update 2026-10-31; OD-C16 (1) |
| Byte integrity of the 2026-11-06 continuity additions | Project copies read back 2026-11-07 | §2.3, Appendix V |
| Code facts F-01…F-13 **exist as written** | **static reading only**; operational effect UNVERIFIED | `SECURITY-AND-EGRESS-FINDINGS.md` (labelled "VERIFIED (code)"); this document does not widen that |

### 6.2 PARTIAL

| Item | Why partial | Evidence |
|---|---|---|
| **G1** (isolated six-patch measurement, 2026-11-03/04) | Backend suite 620/620 pass, 0 fail — **one** run, Node 22.23.4, **global** `tsx` 4.23.12 (`tsx` undeclared); no frontend/E2E/smoke/repeat; typecheck/build first on drifted types (`@types/node` 26.1.2), later on lockfile deps | `G1-ISOLATED-MEASUREMENT-2026-11-03.md` §D–F; `G1-LOCKFILE-RERUN-2026-11-04.md` |
| typecheck on lockfile deps | exit 0, 0 errors; `@types/node` 22.20.1, `typescript` 7.0.2; single run, linux-x64 | `G1-LOCKFILE-RERUN-2026-11-04.md` §4, §6 |
| build on lockfile deps | exit 0; `dist/` 299 files (141 `.js`), 17 migrations = 17; `dist` byte-identical to G1 build; `dist` never executed | same |
| Backend regression gate (PLAN) | not closed by G1 | G1 §E-6 |
| PD-13 part 2 (cold-continuity test) | accepted with reservations; Project-Knowledge auto-load not shown | OD-C14; `PD-13-PART2-ACCEPTANCE-2026-11-01.md` |
| GENOME-GATE (outside the baseline) | PD-18 pending | `BASELINE-GOVERNANCE…`; `GENOME-GATE-09-…log` |
| B6 | status as recorded in the OD-C13 baseline row of `DECISIONS.md` (details not re-read here; scope UNVERIFIED beyond that record) | register |

### 6.3 PENDING

- **Owner review of G1 results** — not recorded in the register (OD-C15 (3) requires it before any status upgrade).
- Owner decision on **CF-22** and **CF-21**.
- Execution decisions for each of F-01…F-06 (PD-19) — none issued.
- Recording of unrecorded owner directives (PD-20, proposal) and of the 2026-10-29 decisions (CF-18 — needs the dated original text).
- PD-02, PD-03 (fine-tuning policy; links to F-02), PD-04…PD-12, PD-14…PD-16, PD-18 (see §9).

### 6.4 BLOCKED

- **Live repository / Git access** (PD-01 part 1a) — no `.git`.
- Pinning `CLAUDE.md` in the live repo root (PD-13 component; depends on PD-01 1a).
- ADR-006 (missing; CF-12 / PD-05).
- PD-11 (LAN reverse-proxy HTTPS; secure-context limitation).

### 6.5 FAILED

- **No currently open FAILED item is recorded.** Retained as historical evidence: G1 typecheck run 1 failed (365 errors) because `undici-types` was missing from an improvised environment; superseded by run 2 and by the lockfile run (exit 0). Log: `continuity/g1/typecheck-run1-missing-undici.raw.log`.

### 6.6 UNVERIFIED

- Whether the baseline represents the live repository; whether a version newer than 2026-10-17 exists.
- Complete behavioural correctness of the baseline (only what the 620 tests exercise has been observed, once).
- **VEL** (original mutation script never supplied; no substitute mutations run).
- Operational effect of every static finding F-01…F-13.
- PH-C01 / PH-C02 (GAP-1/GAP-1B had no report or patch in the original sources; code carries their traces).
- Automatic loading of `CLAUDE.md` and of all Project-Knowledge files.
- Cause of the two documentation differences vs the CLOSURE snapshot; the **method** behind V2.
- Whether the owner reviewed G1; the shallow-clone interpretation of "no remote" — `G1-LOCKFILE-RERUN-2026-11-04.md` §1/§5 records an owner directive of 2026-11-04 accepting it **conditionally**, but that directive is not registered in `DECISIONS.md` (PD-20), so the acceptance is documented only in that report.
- Unchanged-ness of seven Project docs (§2.3 h).
- Exact timestamp of the owner's OD-C17 message (register says "~15:42 Damascus").

### 6.7 HISTORICAL (read as history, never as current baseline results)

- **61/61 (gate), 681/681 (full), 18/18 (gate mutations), dist-check-gate, RED for six tests, Vitest 186, E2E** — measured on the **bundle + seven-patch** tree (includes GENOME-GATE). **Not attributable to the six-patch baseline** (CF-16).
- **620/620** from `NEXUS-G8.2-CLOSURE-REPORT.md` (2026-10-24, Node 22.22). G1 observed 620/620 again (single run); equal numbers do not prove equal per-file distribution.
- **472/472** (CP-16 era), "sw.js unavailable", "current slice 10", CP-19-era "next slice" statements in the old continuation file and older sections of `NEXUS-CURRENT-STATE.md` (CF-01, CF-13).
- Mutation results 37/37 for G8…CLOSURE on their historical trees; VEL 12/12 (historical; VEL status UNVERIFIED).

---

## 7. Measured test/build evidence (what exists, and its limits)

| Measurement | Result | Environment | Limits |
|---|---|---|---|
| Backend full suite (G1, 2026-11-03/04) | `tests 620, pass 620, fail 0, cancelled 0, skipped 0, todo 0`; ≈161 s; 63 test files | Node 22.23.4, global `tsx` 4.23.12, six-patch tree copy, no network, fake providers | one run; no repeat; no per-file comparison with history; proves only what those tests exercise |
| typecheck on lockfile (2026-11-04) | exit 0, 0 errors | `npm ci --ignore-scripts`; `typescript` 7.0.2, `@types/node` 22.20.1 | single run; linux-x64 |
| build on lockfile (2026-11-04) | exit 0; 17/17 migrations copied | same | `dist` not run |
| Frontend / E2E / Chromium / smoke / VEL mutation / real providers | **not run** on the six-patch baseline | — | UNVERIFIED |

Backend commands (from `src-baseline/nexus-backend`, isolated copy): `npm ci --ignore-scripts --no-audit --no-fund`; `npm run typecheck`; `npm run build`; tests need `tsx` (undeclared): `npx tsx --test 'test/**/*.test.ts' 'test/*.test.ts'` after providing `tsx`. Tests may create `data/` — delete before packaging.

---

## 8. Static audit findings (OD-C13 §27 audit, read-only) and priorities

### 8.1 Findings (source: `continuity/od-c13-audit-2026-11-06/SECURITY-AND-EGRESS-FINDINGS.md`)

Statuses are the audit's: code reading only; **operational effect UNVERIFIED**; **no Critical**.

| ID | Finding | Severity (audit) |
|---|---|---|
| F-01 | `/api/embed` unauthenticated; cloud provider chosen first | High (conditional on a cloud key + network exposure) |
| F-02 | Fine-tuning data uploaded to OpenAI with no privacy check | High→Medium (human-approval gate) |
| F-03 | "generic errors" claim does not match code; provider text reaches response/log | Medium |
| F-04 | `web_fetch` output passed to the model without a fence | Medium |
| F-05 | Provider calls outside the egress guard (planner, benchmark, embeddings) | Medium |
| F-06 | Task restriction marks in memory only; evicted at 10,000 | Medium |
| F-07 | PRIVATE ≡ LOCAL_ONLY | Low (documented) |
| F-08 | `clientIp` trusts `x-forwarded-for` | Low–Medium |
| F-09 | IoT device key: non-constant-time compare, stored in clear | Low–Medium (partly documented) |
| F-10 | Tool timeout does not abort the underlying call | Low–Medium |
| F-11 | HTTP deployment without TLS; MQTT outside the guard | Info (documented) |
| F-12 | VEL limits: importable `dispatch`, no per-action human approval, `effectClass` is a declaration | Info (documented) |
| F-13 | Injection detection is heuristic (ar/en), advisory not enforcing | Info |

### 8.2 Owner priority order (planning only — OD-C17 (2))

**F-01 (+ F-08 review) → F-06 → F-05 → F-02 → F-03 → F-04.** F-07 and F-09…F-13 are outside the approved order; their fate is **undecided** (PD-19). Nothing in this order is an instruction to implement. PD-03 (fine-tuning policy) is linked to F-02.

---

## 9. Outstanding risks and unresolved dependencies

### 9.1 Unresolved conflicts (CF) — open ones

| ID | Subject | State |
|---|---|---|
| **CF-22** | OD-C17 (1) "baseline for phase B" vs OD-C13 §5 / OD-C14 / OD-C16 (8) "no engineering phase before PD-13 completed and reviewed" | **Unresolved — owner decision**. Not read as lifting §5. |
| **CF-21** | Inconsistent PD-13 component numbering (part 1 paste, part 2 test; `CLAUDE.md` pin as separate component) | **Unresolved** |
| CF-18 | Owner decisions of 2026-10-29 unrecorded by ID | Open; needs the original dated text |
| CF-20 | Gaps noted in PD-13 part 2 | Open (recorded, not settled) |
| CF-16 | Scope of "baseline VERIFIED" vs numbers including GENOME-GATE | Mitigated by wording rule; keep |
| CF-12, CF-06, CF-07, CF-10 | ADR-006 missing; no live repo; lost chat transcripts; Release V1 path undocumented | Open / BLOCKED / gaps |

(Other CF rows in `DECISIONS.md` §D are resolved by dated corrections.)

### 9.2 Pending decisions (PD) that bear on the next step

PD-01 (live-repo access; BLOCKED), PD-13 (components not complete), PD-18 (GENOME-GATE), **PD-19** (F-01…F-06 slices; future plan), **PD-20** (record unrecorded directives; **proposal, not approved**), PD-02/PD-03 (genome audit; fine-tuning policy), PD-06 (next backend slice choice: G7 / receipt UI / human approval / real connector; no start without decision), PD-12 (commit/push), PD-09/PD-10/PD-08 (Phase-2 scope, H1 undefined, Core ownership).

### 9.3 Risks

1. **Phase gate ambiguity (CF-22):** starting any slice before the owner settles it risks violating OD-C13 §5.
2. **Baseline ≠ live:** results on the isolated tree cannot be transferred to the live project; live drift is unknown (BLOCKED).
3. **Test evidence is thin for "behavioural correctness":** one run, global `tsx`, no E2E/frontend/VEL mutation on this tree.
4. **Environment fragility:** `tsx` undeclared; Node 22.23.4 only (history: 22.22); platform linux-x64 only; lockfile resolves from `registry.npmjs.org` only (no install scripts in lockfile).
5. **Documentation drift:** older status docs still say "G1 authorized, not executed" (see §11.4) — a fresh reader could mis-state progress.
6. **Two unexplained documentation differences** vs the CLOSURE snapshot; the V2 fingerprint method is inferred.
7. **Security findings F-01…F-13** are real code paths, unexercised; F-01/F-02 are High/High→Medium *conditional*; none is a confirmed exploit.
8. **Session-authored text inside an "approved" register row (OD-C17)** could be mistaken for owner decisions (§4.2).
9. **Rate-limited delegated helpers:** readbacks were obtained through helper agents in this workstream; each reported hash was recomputed locally, so no claim rests on hand-back text alone.

---

## 10. Document paths and references

**Project paths (all under `continuity/`):**
`NEXT-SESSION-START-HERE.md` (single resume entry — §0-هـ is the newest section) · `NEXUS-CURRENT-STATE.md` (UNIFIED STATE; **older than 2026-11-03**) · `DECISIONS.md` (register: §C7 OD-C17, CF-22, PD-19, PD-20) · `VERIFICATION.md` (§H V-H01…V-H07; **older**) · `PROJECT_HISTORY.md` (**older**) · `NEXUS-CONTINUATION.md` (the previous file; preserved in Appendix H) · `ROADMAP.md` · `PLAN.md` · `CHANGELOG.md` · `BASELINE-GOVERNANCE-2026-10-30.md` · `G1-ISOLATED-MEASUREMENT-2026-11-03.md` · `G1-LOCKFILE-RERUN-2026-11-04.md` · `g1/*` and `g1/lockfile-run-2026-11-04/*` (raw logs) · `PD-13-PART2-ACCEPTANCE-2026-11-01.md` · `DOC-RECONCILIATION-2026-10-31.md` · `DOC-CLARIFICATIONS-2026-10-31.md` · `PD-01-*-2026-10-29.md` (five docs) · `NEXUS-ISOLATED-REVALIDATION-REPORT-2026-10-26.md` · `genome-gate/GENOME-GATE-09-isolated-revalidation-2026-10-26.log` · `OD-C13-REBUILD-AND-AUDIT-2026-11-06.md` · `od-c13-audit-2026-11-06/*`.
Project doc "NEXUS-CLAUDE-PROJECT-INSTRUCTIONS-REFERENCE" (UI policy §4–§8) is referenced by the Project Instructions; it was **not** re-read in this workstream (content UNVERIFIED here). 23 further Project docs exist that were not listed or read (`project_info` lists them).

**Repository documents inside the baseline tree** (from the worktree manifest; paths relative to the tree root): `NEXUS-CONTINUATION.md` (repo copy, 23,493 B — an **earlier** version than the Project copy, 27,576 B), `NEXUS-CURRENT-STATE.md`, `PLAN.md`, `ROADMAP.md`, `BASELINE.md`, `ADR/000…005`, `ADR/PROPOSED-VEL-verified-execution-layer.md`, `docs/checkpoints/CP-1…CP-19.md`, `docs/VEL-VERTICAL-SLICE.md`, `docs/DEPLOYMENT-LAN.md`, `NEXUS-VEL-VERTICAL-SLICE-REPORT.md`, `baseline/evidence/*`.

**Commit/identity references:** see §5 (bundle HEAD `cbdc898a3ba605211d9791979a6415f314ba1c8f`; deposit repo HEAD `e65c10eca361b5aa39f87feb2be89ee6db0ebcc7`; no commit was made by any task in this chain).

**Delivered audit package:** `NEXUS-OD-C13-AUDIT-DELIVERABLES.zip` SHA-256 `d80bc155318ba204b97795a93e8b1ad4dc40142568329aac70bf2639b06d6f07` (held by the owner; the zip also contains `manifests/AFTER-*.tsv` and `FINAL-worktree-recheck.tsv`, hash-equal to the BEFORE manifests, which are not duplicated in the Project).

---

## 11. Consistency validation against the available authoritative evidence

Method: read the Project docs, recompute SHA-256 locally, `cmp` against pre-update copies and against the original deliverable files, line-level diff for insert-only proof, parse the hash tables, grep older docs for statements that conflict with later evidence. Result per area:

### 11.1 Consistent (no discrepancy found)
- Baseline identity (HEAD, 7 hashes, 877 files, V1, 875-file hash, two-document difference) is stated identically in G1, `BASELINE-GOVERNANCE`, the 2026-11-06 audit logs, `OD-C17`, `NEXT-SESSION §0-هـ` — and in this document.
- Statuses carried forward (baseline VERIFIED inside isolated copy only; live UNVERIFIED; PD-01 1a BLOCKED; GENOME-GATE PARTIAL; VEL UNVERIFIED; B6 PARTIAL; PD-13 part 1 VERIFIED / part 2 PARTIAL; `CLAUDE.md` pin BLOCKED) agree across `DECISIONS.md`, `NEXT-SESSION §0-د/§0-هـ`, OD-C16, OD-C17.
- No status was promoted by any document of 2026-11-06 (OD-C17 restates, it raises nothing); this document promotes nothing.

### 11.2 Byte-level results
See §2.3 and Appendix V.

### 11.3 Owner-approval check of OD-C17
See §4.2.

### 11.4 Historical statements now conflicting with newer evidence — **dated corrections proposed, NOT applied** (history is never deleted)

| # | Where | Statement | Newer evidence | Proposed dated correction (needs owner approval) |
|---|---|---|---|---|
| 1 | `NEXUS-CURRENT-STATE.md` (2026-11-03 entry, G1 bullet) | "At the time of this entry G1 has not been executed" | G1 executed 2026-11-03/04 → **PARTIAL**; lockfile re-run 2026-11-04; rebuild+audit 2026-11-06 | Add a dated pointer entry at the end: G1 PARTIAL (reports), no status promoted, owner review pending |
| 2 | `VERIFICATION.md` §H **V-H06** (G1 "PENDING … لم يُنفَّذ وقت هذا الإدخال") and **V-H05** ("يُراد قياسها بـG1") | G1 not run / behavioural measurement awaiting G1 | G1 run: 620/620 once, typecheck/build lockfile exit 0 | Add dated V-H08… rows: G1 PARTIAL; V-H05 now has one measurement (620/620, single run), still not full behavioural verification |
| 3 | `NEXT-SESSION-START-HERE.md` §0-د item 3 ("G1 مصرَّح به ولم يُنفَّذ") | G1 authorized, not executed | executed | **Already covered** by §0-هـ item 5 (explicit supersession pointer); no further action needed |
| 4 | `PROJECT_HISTORY.md` | no row for G1 (2026-11-03/04), G1 lockfile re-run, OD-C13 rebuild/audit (2026-11-06) or OD-C17 | those events | Add rows (rows only, like PH-OD16) |
| 5 | `NEXUS-CONTINUATION.md` (Project copy) | §1–§5 stale (CP-19 era); last addition 2026-10-27 | OD-C13…OD-C17 | Replace by this file **or** append a dated §7 pointer; owner chooses |
| 6 | `OD-C13-REBUILD-AND-AUDIT-2026-11-06.md` §(files table) | "`RAW-LOGS/` (16 ملفًا …)" | delivered zip and `RAW-LOGS-CONCATENATED.txt` contain **15** | Dated correction line: 15 files (the other statements and all hashes in the table are correct) |
| 7 | `od-c13-audit-2026-11-06/EXECUTIVE-SUMMARY.md` §1 | "خط الأساس: VERIFIED" with no scope limit | OD-C16 (2)–(3): VERIFIED only inside the isolated copy | Dated clarification: scope = isolated copy only; live match UNVERIFIED (the same document does say live match UNVERIFIED) |
| 8 | same, §1 | "أُعيد إنتاج البصمة التاريخية `d0053a4a…a9ef` (G1 لم يستطع)" | G1 §C: UNVERIFIED as a value; audit `08-…` and OD-C17 say the method is **inferred** | Dated clarification: value reproduced under an inferred method; historical method UNVERIFIED |
| 9 | `DECISIONS.md` OD-C17 cell | mixes owner decisions with session-authored restatement; status cell reads "معتمد" | owner's 2026-11-06 validation directive | Dated note marking the session-authored sentences, CF-22, PD-19, PD-20 as draft / awaiting approval (as §4.2) |

### 11.5 Not validated here (UNVERIFIED)
Live repository; the Project's internal storage; any document not read in this workstream (23 further Project docs, `CLAUDE.md`, the NEXUS-CLAUDE-PROJECT-INSTRUCTIONS-REFERENCE doc); any test/build result beyond the cited reports; the 2026-10-29 owner decisions (no dated source supplied).

---

## 12. Information that is unavailable (not invented)

Live-repo branch/HEAD/status · whether a newer version than 2026-10-17 exists · original text of the 2026-10-29 owner decisions and of the 2026-11-04/06 authorizations as register entries · owner's review of G1 · cause of the two doc differences · original V2 method · ADR-006 · original VEL mutation script · full contents of the 23 unlisted Project docs.

---

## 13. Resume instructions for the next session

1. Read, in order: `CLAUDE.md` (the live copy is **BLOCKED**; use the Project's `continuity/` copy if present) → `continuity/NEXT-SESSION-START-HERE.md` (§0-هـ first) → this file §1–§4 → `continuity/DECISIONS.md` (§C7, §D CF-21/CF-22, §E PD-19/PD-20) → the task-relevant reports.
2. Do **not** assume branch, path, phase, slice or test counts; verify. If no repository/`.git` is available, say the live repo is BLOCKED and work only in an isolated copy rebuilt per §5.
3. If the owner issues a slice decision: present root cause → design → acceptance tests → risks first (OD-C17 (2)); then INSPECT→…→DOCUMENT→**STOP**. Red-before-green TDD with recorded commands; do not weaken tests; Arabic/RTL, multi-viewport and WCAG 2.2 AA rules apply to any UI slice.
4. At the end of every authorized session: update the continuity documents (additive, dated), record work, evidence, statuses, remaining work, blockers/risks, latest owner decisions, exact stopping point and next authorized action — then **STOP**.

**STOP — WAIT FOR OWNER REVIEW.**

---

## Appendix V — Per-file verification table (SHA-256 of the current Project copies)

All hashes were recomputed locally from the bytes read back from the Project on 2026-11-07. "Original-content integrity" compares against the pre-update copy where one exists.

| Path (Project) | Bytes | SHA-256 (current Project copy) | Kind | Original-content integrity | Status |
|---|---:|---|---|---|---|
| `continuity/DECISIONS.md` | 73,341 | `424333989c419ba148c6732a3ca4fad5576ca951af5250e4104f7ad01b834a7f` | MODIFIED (additive) | original 64,224 B preserved (all original lines kept in order; inserts only) | VERIFIED (byte-equal to regenerated expected file AND to independent Project readback) |
| `continuity/NEXT-SESSION-START-HERE.md` | 43,135 | `8590d0db19908c79d97a83aeb7bb5a8e8d52c8cacd13f4bbee226b9541d463e6` | MODIFIED (additive) | original 38,716 B preserved (single insert block) | VERIFIED (same method) |
| `continuity/CHANGELOG.md` | 46,560 | `618889d94200f84291eeffb655c7b13f991c68030cbd0bcf54d9e751c7f3cc91` | MODIFIED (additive) | original 44,621 B preserved (single insert block) | VERIFIED (same method) |
| `continuity/OD-C13-REBUILD-AND-AUDIT-2026-11-06.md` | 7,028 | `efab50d4b9d906ae6dc6029a9704c861ec1c6c54a649c804357e1102285a927f` | NEW | n/a (new) | PARTIAL (bytes VERIFIED; contains a count error: says RAW-LOGS = 16 files, delivered zip and Project copy hold 15) |
| `continuity/od-c13-audit-2026-11-06/BASELINE-RECONSTRUCTION-REPORT.md` | 8,500 | `078dd6bd12c131a4549c94610d38d990efa680a316c936802ecc30ca75d6b399` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (byte-identical to the original deliverable file; zip.sha256 content equals the actual zip hash) |
| `continuity/od-c13-audit-2026-11-06/CODE-CAPABILITY-MATRIX.md` | 13,271 | `cbdc63e533f4e4b8e96c365a70205af9de2480df2caa46574ad7d1d041e66342` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (byte-identical to the original deliverable file; zip.sha256 content equals the actual zip hash) |
| `continuity/od-c13-audit-2026-11-06/SECURITY-AND-EGRESS-FINDINGS.md` | 15,059 | `91bd2cccab60822580c05ce757638ab3040595f773f0a902b63ba559073c573f` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (byte-identical to the original deliverable file; zip.sha256 content equals the actual zip hash) |
| `continuity/od-c13-audit-2026-11-06/EVIDENCE-INDEX.md` | 4,546 | `738e599ebe24e50b824d0d13ea527cf319c9171317457f2cc446ab4e90435cb9` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (byte-identical to the original deliverable file; zip.sha256 content equals the actual zip hash) |
| `continuity/od-c13-audit-2026-11-06/SHA256-BEFORE-AFTER-COMPARISON.txt` | 2,099 | `688f8eebee43656de08cd2624f373df4bf97c537901aaaf367998c60afcbaaed` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (byte-identical to the original deliverable file; zip.sha256 content equals the actual zip hash) |
| `continuity/od-c13-audit-2026-11-06/MANIFEST-dotgit-BEFORE.tsv.txt` | 2,489 | `9feba928f65fe834f928dc70ee1859045b1d75e88d7fecde76b301bdf2804f09` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (byte-identical to the original deliverable file; zip.sha256 content equals the actual zip hash) |
| `continuity/od-c13-audit-2026-11-06/NEXUS-OD-C13-AUDIT-DELIVERABLES.zip.sha256.txt` | 102 | `63fc5542770ff57bf7decace21c3fcc6c102f84ab010619345e2568a3ed75743` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (byte-identical to the original deliverable file; zip.sha256 content equals the actual zip hash) |
| `continuity/od-c13-audit-2026-11-06/EXECUTIVE-SUMMARY.md` | 3,462 | `a9a08bb843e80252c665106ca70b69927edf2cb6378511987b098e3bb3078b9e` | NEW (copy of audit deliverable) | n/a (new) | PARTIAL (bytes VERIFIED; wording stronger than evidence in two places — see §11.4) |
| `continuity/od-c13-audit-2026-11-06/MANIFEST-worktree-BEFORE.tsv.txt` | 117,901 | `496ec99cc7da0c843eaf0dffef9c3836614f156ab5ebbe2e4a6136b853419e70` | NEW (copy of audit deliverable) | n/a (new) | VERIFIED (117,901 B, 877 lines; identical to original BEFORE-worktree.tsv) |
| `continuity/od-c13-audit-2026-11-06/RAW-LOGS-CONCATENATED.txt` | 24,408 | `9a1869f79989e63dede643d8fc7b192d96b1565aac6bdc636b33f141932df1d5` | NEW (concatenation of 15 raw logs) | n/a (new) | VERIFIED (15/15 segments: declared sha256 = original file sha256 = segment body) |
| `continuity/BASELINE-GOVERNANCE-2026-10-30.md` | 16,155 | `fccc592c3665de2ee782a72ea3536786b0790cd94865881c0185f6cad1930beb` | NOT MODIFIED | identical to pre-update copy (cmp) | VERIFIED unchanged |
| `continuity/G1-ISOLATED-MEASUREMENT-2026-11-03.md` | 18,492 | `58bddc8a1dd3ae821f51a57bdc6a199a1aa7c64b699d33d57ec838375ff3b036` | NOT MODIFIED | identical to pre-update copy (cmp) | VERIFIED unchanged |
| `continuity/G1-LOCKFILE-RERUN-2026-11-04.md` | 14,048 | `ecd370b5bc45286ecc723cef46e8b39628540c836a3ba3f65ab8a676f7df0da7` | NOT MODIFIED | identical to pre-update copy (cmp) | VERIFIED unchanged |
| `continuity/g1/g1-input-hashes.txt` | 1,053 | `63fc31fc9315efb3143c3a440de6dfff39ab551f6d11b487e18b3a2d88c30d02` | NOT MODIFIED | identical to pre-update copy (cmp) | VERIFIED unchanged |
| `continuity/g1/patch-apply.log` | 768 | `8db9e363005dc4b46bb53235961fb6a844a1db51860cd41ade0652bc8146584f` | NOT MODIFIED | identical to pre-update copy (cmp) | VERIFIED unchanged |
| `continuity/g1/tree-vs-closure-snapshot.diff` | 310 | `14a29ada5fc74f83fc5fc791bd31d1e040fc4391fe8e9234c3e33d0884e23549` | NOT MODIFIED | identical to pre-update copy (cmp) | VERIFIED unchanged |
| `continuity/NEXUS-CURRENT-STATE.md` | 73,577 | `8e8fd7b936cda77d35f3a73f71fda311ff0e6fa4faf6b0e2a2790b4b1ca7cf9c` | NOT MODIFIED by this workstream (no write issued) | no pre-update copy held — unchanged-ness UNVERIFIED | current hash recorded only |
| `continuity/VERIFICATION.md` | 45,786 | `fe2c5789e6d32df2209b46524bf94c9cc8d5d620b83d736131f295ae7d274de4` | NOT MODIFIED by this workstream (no write issued) | no pre-update copy held — unchanged-ness UNVERIFIED | current hash recorded only |
| `continuity/PROJECT_HISTORY.md` | 22,271 | `e1849f3b0671da5e0f260f73f8814f4fdbce1e9f52b9f7c34e6a936630aa7465` | NOT MODIFIED by this workstream (no write issued) | no pre-update copy held — unchanged-ness UNVERIFIED | current hash recorded only |
| `continuity/NEXUS-CONTINUATION.md` | 27,576 | `2cf84b8753f36bac59e3b32dec119eb28d0e5de95216d1f463345f55472afdc4` | NOT MODIFIED by this workstream (no write issued) | no pre-update copy held — unchanged-ness UNVERIFIED | current hash recorded only |
| `continuity/ROADMAP.md` | 4,539 | `5ce0ddcef0c4f00b73de0d83e54474de0fce0ecbfc9d68cfd317bf0155758366` | NOT MODIFIED by this workstream (no write issued) | no pre-update copy held — unchanged-ness UNVERIFIED | current hash recorded only |
| `continuity/PLAN.md` | 3,742 | `7e3c8818116baf1a78c0deae28adf485d2d01d04a0b2bc19b41fb8fd6961053d` | NOT MODIFIED by this workstream (no write issued) | no pre-update copy held — unchanged-ness UNVERIFIED | current hash recorded only |
| `continuity/PD-13-PART2-ACCEPTANCE-2026-11-01.md` | 8,055 | `e1e98bed97a2c1c69b09222cdbb5cd544a8b4e2597fad17ad045979f0e20384a` | NOT MODIFIED by this workstream (no write issued) | no pre-update copy held — unchanged-ness UNVERIFIED | current hash recorded only |


---

## Appendix H — Historical `continuity/NEXUS-CONTINUATION.md` (verbatim, byte-exact; superseded by §1–§13 above)

The block below begins at the `BEGIN` marker and ends at the `END` marker. Its first-line heading is the old file's own heading. It was not edited; its stale statements (CP-19 era, 472/472, "sw.js unavailable", "next slice 10", the "commit and ZIP" command) are historical and corrected by §6.7 / §11 and by the dated notes inside it.

<!-- BEGIN-HISTORICAL-NEXUS-CONTINUATION (verbatim copy of Project doc continuity/NEXUS-CONTINUATION.md as read 2026-11-07; 27576 bytes; sha256 2cf84b8753f36bac59e3b32dec119eb28d0e5de95216d1f463345f55472afdc4) -->
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

<!-- END-HISTORICAL-NEXUS-CONTINUATION -->

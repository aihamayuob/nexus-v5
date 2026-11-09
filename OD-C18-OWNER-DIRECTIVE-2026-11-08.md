NEXUS — OWNER-DIRECTED GOVERNANCE RESOLUTION, DOCUMENTATION RECONCILIATION & PROJECT KNOWLEDGE UPDATE

Execute this instruction as an explicit owner-authorized governance and documentation task.

The objective is to resolve CF-22, CF-21 and PD-20, reconcile the outstanding documentation inconsistencies identified in NEXUS-CONTINUATION.md §11.4, validate all resulting changes, and update the Claude Project Knowledge with the latest authoritative continuity state.

This is a documentation and governance task ONLY. It does not authorize engineering implementation.

1. Establish the authoritative evidence first

Before making any change:

1. Read the latest NEXUS-CONTINUATION.md in full.
2. Read DECISIONS.md, NEXT-SESSION-START-HERE.md, BASELINE-GOVERNANCE-2026-10-30.md, OD-C13-REBUILD-AND-AUDIT-2026-11-06.md, both G1 reports, and all directly relevant owner decisions and source records.
3. Inspect the original owner-authored instructions wherever available.
4. Distinguish explicitly between:
   - Original owner decisions.
   - Session-authored interpretations.
   - Proposals awaiting approval.
   - Verified evidence.
   - Historical or unverified claims.

Repository evidence and original owner instructions take precedence over conversational summaries and inferred interpretations.

Never invent missing decisions, dates, approvals, evidence, or historical events.

2. Resolve CF-22 — baseline acceptance versus the PD-13 gate

Apply the following explicit owner decision:

OD-C17 acceptance of the six-patch baseline means that it is accepted as an isolated technical reference baseline for potential Phase B work.

It DOES NOT:

- Authorize opening Phase B.
- Cancel or override OD-C13 §5.
- Constitute completion or approval of PD-13.
- Authorize any engineering slice.
- Authorize source modifications or access to the live repository.

The requirement that PD-13 be completed and reviewed remains in force before opening a new engineering phase.

After that gate is satisfied, each engineering slice still requires its own separate, explicit owner execution decision.

Record this interpretation as the authoritative resolution of CF-22.

Preserve the original OD-C13 and OD-C17 records. Add a dated resolution explaining how both decisions coexist without changing their historical wording.

Do not promote PD-13 or any engineering status as a consequence of this resolution.

3. Resolve CF-21 — establish canonical PD-13 component numbering

Use the following canonical component structure:

Component| Canonical identifier| Description
1| PD-13.1| Project instruction content v2/v1 pasted and recorded
2| PD-13.2| Independent cold-continuity test
3| PD-13.3| Pinning CLAUDE.md in the live repository root

Preserve the existing evidence-based statuses:

- PD-13.1: VERIFIED.
- PD-13.2: PARTIAL.
- PD-13.3: BLOCKED.

PD-13 as a whole must NOT be described as complete.

Verify this mapping against the original owner instructions and relevant evidence before recording it.

Preserve legacy numbering in historical records and add a clear cross-reference table. Do not silently renumber historical decisions, reports, or test evidence.

Record the canonical numbering as the resolution of CF-21, provided the original source evidence supports this mapping. If a material contradiction exists, identify it precisely rather than fabricating a reconciliation.

4. Resolve PD-20 — reconcile unrecorded owner directives

I authorize the documentation-only reconciliation task proposed under PD-20.

Search the available original owner-authored records for directives that have not been properly entered into DECISIONS.md.

For every candidate directive:

1. Locate its original source.
2. Record its actual date and available timestamp.
3. Preserve its original meaning.
4. Assign an appropriate identifier using the established sequence.
5. Record its scope, restrictions and approval status.
6. Distinguish the owner's actual instruction from any interpretation or proposal written by a previous session.

Do NOT treat session-authored text as an owner decision.

Do NOT convert PD-19, draft interpretations, CF-22 historical discussion, or other unapproved proposals into owner decisions merely because they appear in a report.

If an original instruction cannot be located, classify it as UNVERIFIED or PENDING and identify the missing evidence.

Do not fabricate the missing 2026-10-29 decisions or any other historical instructions.

Record PD-20's actual completion status according to the evidence available. It may remain PARTIAL or PENDING if the original source records are unavailable.

5. Apply the approved documentation corrections in §11.4

After recording the three governance resolutions, reconcile the documentation inconsistencies listed in the latest NEXUS-CONTINUATION.md §11.4.

Apply these corrections as dated, additive entries:

1. NEXUS-CURRENT-STATE.md:
   Record G1 execution on 2026-11-03/04 as PARTIAL, including its actual evidence and the fact that owner review remains pending.

2. VERIFICATION.md:
   Add dated verification entries clarifying the single 620/620 backend test run, lockfile typecheck and build results, their limitations, and the continuing absence of full behavioural verification.

3. NEXT-SESSION-START-HERE.md:
   Confirm that its existing §0-هـ supersession note correctly addresses the earlier G1 wording. Do not duplicate an already sufficient correction.

4. PROJECT_HISTORY.md:
   Add dated historical entries for G1, its lockfile rerun, OD-C13 rebuild and audit, OD-C17 and this governance/documentation reconciliation.

5. NEXUS-CONTINUATION.md:
   Preserve the old continuation document as historical evidence.
   Retain its complete original content and SHA-256 reference.
   Establish the newly validated continuation document as the current authoritative version.
   Add dated cross-references so a new session cannot mistake the historical document for the current state.

6. OD-C13-REBUILD-AND-AUDIT-2026-11-06.md:
   Add a dated correction confirming that RAW-LOGS contains 15 files, not 16.

7. EXECUTIVE-SUMMARY.md:
   Clarify that baseline VERIFIED applies only to the isolated reconstructed copy, not the live repository.

8. Historical fingerprint V2:
   Clarify that the value was reproduced using an inferred method and that the original historical method remains UNVERIFIED.

9. DECISIONS.md:
   Clarify the distinction between owner-approved OD-C17 decisions and session-authored text.
   Record the CF-22 and CF-21 resolutions and the actual PD-20 outcome with appropriate provenance.

Do not silently rewrite historical wording, delete reports, overwrite original evidence, or change the meaning of previous records.

Use dated amendments and explicit supersession notes.

6. Produce the authoritative continuity document

Rebuild the latest NEXUS-CONTINUATION.md after the governance decisions and corrections have been recorded.

It must accurately include:

- Exact stopping point.
- Latest owner decisions.
- Resolved and unresolved CF items.
- PD-13 component structure and actual statuses.
- PD-20 outcome.
- Approved six-patch baseline and full SHA-256 values.
- Test and audit evidence with its precise limitations.
- Security findings F-01 through F-13.
- Remaining work, blockers, risks and dependencies.
- Exact next authorized action.
- Document paths and relevant commit references.
- Historical evidence boundaries.

Maintain the required status vocabulary:

VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED.

Never use DONE as a status.

The document must end with an unambiguous stopping instruction and must never imply that engineering work is authorized when it is not.

7. Update Claude Project Knowledge

After completing and validating the documentation:

1. Preserve the previous continuation document as a dated historical archive, byte-exact where possible.
2. Publish the new validated document under the canonical Project Knowledge filename: NEXUS-CONTINUATION.md.
3. Ensure that NEXT-SESSION-START-HERE.md points to the new authoritative document.
4. Ensure DECISIONS.md and the other relevant continuity documents contain the approved dated resolutions and corrections.
5. Remove ambiguity between historical and current continuation documents.
6. Verify the actual contents of the updated Project Knowledge by reading the files back.

Do not merely provide downloadable files while leaving Project Knowledge outdated.

If the Project interface does not permit the requested update, report the exact limitation. Never claim that Project Knowledge was updated without verifying the resulting contents.

8. Independent final validation

Before delivery:

- Verify all modified documents against their original versions.
- Confirm that historical content was preserved.
- Recalculate SHA-256 hashes for all changed and newly published documents.
- Verify that all cross-references and file paths are valid.
- Verify consistency between DECISIONS.md, NEXUS-CONTINUATION.md, NEXT-SESSION-START-HERE.md, NEXUS-CURRENT-STATE.md and VERIFICATION.md.
- Confirm that all statuses match their actual evidence.
- Confirm that no unapproved owner decisions were introduced.
- Confirm that no source-code or test files were modified.

Provide a concise audit report containing:

- Resolutions of CF-22, CF-21 and PD-20.
- Documentation files changed.
- SHA-256 values.
- Before/after validation results.
- Project Knowledge readback verification.
- Remaining PENDING, PARTIAL, BLOCKED and UNVERIFIED items.
- Any corrections that could not be safely applied.

9. Absolute execution boundaries

This authorization is strictly limited to governance, evidence reconciliation, documentation and Project Knowledge maintenance.

Explicitly prohibited:

- Source-code modifications.
- Test modifications or execution.
- Patch application.
- Starting F-01 or any other engineering slice.
- Opening an engineering phase.
- Starting G7, MCP, GAP-2, H1 or UI work.
- Including GENOME-GATE in the approved baseline.
- Accessing or modifying the live repository.
- Commit, push, merge, tag or deployment.
- Promoting verification statuses without new evidence.
- Changing the scope of any previous owner decision.

Preserve the approved six-patch baseline and all existing evidence boundaries.

10. Final stopping condition

Complete the authorized governance and documentation work, validate it, update Project Knowledge, read back the updated documents, provide the final audit report, and STOP.

Do not select or start the next engineering slice.

Do not assume further authorization.

The next engineering action requires a separate explicit owner execution decision.

Final state: STOP — WAIT FOR OWNER REVIEW.
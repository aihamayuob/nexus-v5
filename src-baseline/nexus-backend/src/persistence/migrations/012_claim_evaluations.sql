-- Phase 3 Slice 16 (Unified Evaluation Engine). A DIFFERENT concern from
-- the pre-existing benchmark_runs table (migration 002): benchmark_runs
-- scores a fixed task SUITE release-over-release for regression detection.
-- This table scores a single CLAIM's evidentiary status — VERIFIED /
-- SUPPORTED / UNCERTAIN / CONFLICTING / UNVERIFIED — against whatever
-- evidence was actually gathered for it, independent of any release or
-- benchmark run. subject_type/subject_id loosely link an evaluation back
-- to whatever produced the claim (e.g. 'web_research' + a memory item id)
-- without a hard foreign key, since the set of subject types is expected
-- to grow (missions, council syntheses, ad-hoc claims via the API) beyond
-- what a single FK target could express.
CREATE TABLE IF NOT EXISTS claim_evaluations (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  claim TEXT NOT NULL,
  ran INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  confidence REAL,
  rationale TEXT NOT NULL,
  supporting_evidence_count INTEGER NOT NULL,
  conflicting_evidence_count INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_evaluations_subject ON claim_evaluations(subject_type, subject_id);

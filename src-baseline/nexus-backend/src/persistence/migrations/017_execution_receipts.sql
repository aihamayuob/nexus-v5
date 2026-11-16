-- NEXUS VEL (Verified Execution Layer) — durable execution receipts. ADDITIVE ONLY: one new table + indexes; no existing table, column or row is touched.
-- Rollback: `DROP TABLE execution_receipts;` (nothing else references it) + delete this row from _migrations. See docs/VEL-VERTICAL-SLICE.md.
--
-- One row per ACTION (id = actionId) of a tool that declares a VEL `effect` (tools/effectTypes.ts). The row is written BEFORE dispatch (write-ahead,
-- status IN_FLIGHT) and updated as the action progresses, so a crash mid-action leaves a visible IN_FLIGHT row that startup recovery turns into an
-- explicit OUTCOME_UNKNOWN/reconcile — never silence.
--
-- status (lifecycle, NOT an evidence verdict):
--   IN_FLIGHT | DENIED | FAILED (connector guaranteed no effect) | ACKED (connector claimed success; see `verification`) | OUTCOME_UNKNOWN
--   | RECONCILED_APPLIED (effect confirmed present by independent read) | RECONCILED_NOT_APPLIED (confirmed absent AND retry is safe)
-- verification: NULL or one of the EXISTING five evidence states (VERIFIED/SUPPORTED/UNCERTAIN/CONFLICTING/UNVERIFIED — meaning unchanged for the
--   Evaluation Engine; here VERIFIED = the predeclared success condition held in an independent read-back of the target system, see the ADR proposal).
--
-- NOT tamper-evident: an ordinary mutable table (no hash chain, no signatures). Never store secrets here: only a params digest, a connector-redacted
-- summary and a non-secret locator are kept — never the raw parameters.
CREATE TABLE IF NOT EXISTS execution_receipts (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  tool_name TEXT NOT NULL,
  tool_use_id TEXT,
  connector TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource TEXT,
  params_digest TEXT NOT NULL,
  params_summary TEXT,
  locator_json TEXT,
  dedupe_key TEXT NOT NULL,
  idempotency_key TEXT,
  idempotency_mode TEXT,
  actor_ref TEXT NOT NULL,
  project_id TEXT,
  user_id TEXT,
  provider_id TEXT,
  policy_version TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  policy_rule_id TEXT,
  policy_reason TEXT NOT NULL,
  success_condition TEXT,
  status TEXT NOT NULL,
  verification TEXT,
  verification_basis TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_id TEXT,
  needs_human INTEGER NOT NULL DEFAULT 0,
  needs_human_reason TEXT,
  proof_limits TEXT,
  events_json TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_receipts_task ON execution_receipts(task_id, started_at);
CREATE INDEX IF NOT EXISTS idx_execution_receipts_status ON execution_receipts(status);

-- Race-safe duplicate prevention: at most ONE non-released receipt per dedupe key (task + tool + resource + params digest). A second concurrent or replayed
-- identical action fails this INSERT and is answered from the existing receipt instead of being dispatched. FAILED / DENIED / RECONCILED_NOT_APPLIED release the key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_receipts_active_dedupe
  ON execution_receipts(dedupe_key)
  WHERE status IN ('IN_FLIGHT', 'ACKED', 'OUTCOME_UNKNOWN', 'RECONCILED_APPLIED');

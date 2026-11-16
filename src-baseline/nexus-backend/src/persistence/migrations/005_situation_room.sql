CREATE TABLE council_sessions_new (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  topic TEXT NOT NULL,
  proposer_agent_id TEXT,
  critic_agent_id TEXT,
  supervisor_agent_id TEXT NOT NULL,
  specialist_agent_ids_json TEXT,
  state TEXT NOT NULL,
  final_output TEXT,
  verification_verdict TEXT,
  verification_issue_count INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

INSERT INTO council_sessions_new (id, mode, topic, proposer_agent_id, critic_agent_id, supervisor_agent_id, specialist_agent_ids_json, state, final_output, verification_verdict, verification_issue_count, error_message, created_at, updated_at, completed_at)
SELECT id, mode, topic, proposer_agent_id, critic_agent_id, supervisor_agent_id, NULL, state, final_output, verification_verdict, verification_issue_count, error_message, created_at, updated_at, completed_at
FROM council_sessions;

DROP TABLE council_sessions;
ALTER TABLE council_sessions_new RENAME TO council_sessions;

CREATE INDEX IF NOT EXISTS idx_council_sessions_state ON council_sessions(state);

-- council_rounds.kind is a plain TEXT column with no CHECK constraint, so
-- new kind values for this mode ('round1', 'supervisor_analysis', 'round2')
-- need no schema change at all.

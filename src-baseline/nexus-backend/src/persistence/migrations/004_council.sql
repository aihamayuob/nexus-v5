CREATE TABLE IF NOT EXISTS council_sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  topic TEXT NOT NULL,
  proposer_agent_id TEXT NOT NULL,
  critic_agent_id TEXT NOT NULL,
  supervisor_agent_id TEXT NOT NULL,
  state TEXT NOT NULL,
  final_output TEXT,
  verification_verdict TEXT,
  verification_issue_count INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS council_rounds (
  session_id TEXT NOT NULL REFERENCES council_sessions(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  agent_id TEXT,
  content TEXT NOT NULL,
  provider_used TEXT,
  model_used TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_council_sessions_state ON council_sessions(state);

CREATE TABLE IF NOT EXISTS agent_call_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  success INTEGER NOT NULL, -- 0 or 1
  latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_call_log_agent ON agent_call_log(agent_id, created_at);

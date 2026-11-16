CREATE TABLE IF NOT EXISTS improvement_proposals (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL, -- 'mission' | 'council' | 'failure_pattern'
  subject_id TEXT NOT NULL,
  category TEXT NOT NULL, -- 'planning' | 'agent_selection' | 'model_selection' | 'verification' | 'reliability' | 'other'
  observation TEXT NOT NULL,
  suggested_change TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'acknowledged' | 'dismissed' — human-decided only, never auto-transitioned
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_improvement_proposals_status ON improvement_proposals(status);
CREATE INDEX IF NOT EXISTS idx_improvement_proposals_subject ON improvement_proposals(subject_type, subject_id);

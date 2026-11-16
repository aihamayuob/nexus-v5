-- Controlled Fine-Tuning. Same governance contract as agent_genomes
-- (migration 013) — versioned + evaluated + security-checked + approved
-- + rollbackable — applied to something more consequential than a
-- system-prompt mutation: a dataset that, once submitted, actually
-- trains a real external model. Nothing here can submit a job without
-- passing through 'approved' first; see finetuning/fineTuning.ts.
CREATE TABLE IF NOT EXISTS finetuning_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  dataset_example_count INTEGER NOT NULL,
  dataset_source_summary TEXT NOT NULL,
  dataset_jsonl TEXT NOT NULL,          -- the exact training data submitted, kept for audit/reproducibility
  security_check_passed INTEGER NOT NULL,
  security_check_findings_json TEXT NOT NULL,
  provider TEXT NOT NULL,               -- 'openai' — see fineTuning.ts's header comment for why this is the only target
  base_model TEXT NOT NULL,
  status TEXT NOT NULL,                 -- 'proposed' | 'rejected' | 'approved' | 'submitted' | 'succeeded' | 'failed'
  provider_job_id TEXT,
  provider_fine_tuned_model TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  submitted_at INTEGER,
  last_polled_at INTEGER,
  last_provider_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_finetuning_jobs_agent ON finetuning_jobs(agent_id, created_at);

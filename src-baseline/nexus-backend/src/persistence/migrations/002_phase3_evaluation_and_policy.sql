-- Phase 3 (evaluation/adaptive routing): one row per INDIVIDUAL provider
-- call attempt (not per task — a task's fallback chain can span several
-- providers, and task-level observability alone can't answer "how
-- reliable is provider X specifically"). This is what AdaptiveModelRouter
-- and the benchmark/evaluation framework actually read.
CREATE TABLE IF NOT EXISTS provider_call_log (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  route TEXT,                        -- 'chat' | 'runtime_plan' | dag node label, etc — the "task type" dimension
  success INTEGER NOT NULL,          -- 1/0
  latency_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  error_message TEXT,                -- short summary only, never raw completion text
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_call_log_provider ON provider_call_log(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_call_log_route ON provider_call_log(route, created_at DESC);

-- User/outcome feedback — the input side of the Feedback Loop
-- (Task -> Result -> Feedback -> Evaluation -> Policy improvement).
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  rating TEXT NOT NULL,              -- 'up' | 'down'
  note TEXT,                         -- optional short free-text reason, user-supplied
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_task ON feedback(task_id);

-- Evaluation Framework: stored benchmark run snapshots, so a release can be
-- compared against the previous one instead of only ever looking at "now".
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  release_label TEXT NOT NULL,
  results_json TEXT NOT NULL,        -- structured per-benchmark scores, see evaluation/benchmarkRunner.ts
  summary_json TEXT NOT NULL,        -- pass/fail counts, aggregate latency, etc
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created ON benchmark_runs(created_at DESC);

-- Human approval gate for HIGH-RISK execution-policy tasks.
CREATE TABLE IF NOT EXISTS approvals (
  task_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,              -- 'pending' | 'approved' | 'rejected'
  reason TEXT,                       -- why the policy flagged this as high-risk
  decided_by TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);

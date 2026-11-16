-- Nexus Task Manager: one row per top-level unit of work (a single chat
-- completion OR a whole Agent Runtime plan). This is what makes execution
-- durable/resumable/queryable instead of living only in browser memory.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,               -- 'chat' | 'runtime_plan'
  status TEXT NOT NULL,             -- 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  idempotency_key TEXT,
  provider TEXT,
  model TEXT,
  goal_or_prompt_len INTEGER,       -- length only, never the raw prompt — see logger.ts header comment on chain-of-thought
  project_id TEXT,
  user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_idem ON tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

-- Durable execution checkpoints — server-side superset of the frontend's
-- ExecutionCheckpoint (localStorage, one slot). Here it's keyed per task,
-- persisted, and drives real resume (not just a "was something interrupted"
-- flag) — a crashed/restarted process can pick a plan back up from its last
-- completed DAG node instead of restarting the whole plan.
CREATE TABLE IF NOT EXISTS checkpoints (
  task_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  state_json TEXT NOT NULL,          -- structured completed-work snapshot (task outputs, not chain-of-thought)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, phase),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- DAG plan structure + per-node state, so a plan survives a process
-- restart and can resume from exactly the nodes that hadn't finished yet.
CREATE TABLE IF NOT EXISTS dag_nodes (
  task_id TEXT NOT NULL,             -- the parent plan's task id
  node_id TEXT NOT NULL,
  description TEXT,
  depends_on_json TEXT NOT NULL,     -- JSON array of node ids
  status TEXT NOT NULL,              -- 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  attempt INTEGER NOT NULL DEFAULT 0,
  output TEXT,                       -- final text output only (not intermediate reasoning)
  error_message TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, node_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Resumable SSE event log — every event emitted on a task's stream is
-- persisted here BEFORE being flushed to any live connection, so
-- GET .../resume/:id?afterId=N can replay exactly what a dropped
-- connection missed, backed by disk rather than only an in-memory buffer.
CREATE TABLE IF NOT EXISTS stream_events (
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_stream_events_task ON stream_events(task_id, seq);

-- Idempotency: explicit-key or body-hash -> the task id it originally
-- created, so a client retrying a dropped request reattaches to the same
-- task instead of double-spending a model call.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Durable, queryable observability (NOT a browser ring buffer). One row
-- per top-level task, matching the fields the spec calls out explicitly:
-- task, route, agents, models, tools, latency, retries, failures, tokens,
-- cost, verification, final status. Never chain-of-thought / raw content.
CREATE TABLE IF NOT EXISTS observability_events (
  task_id TEXT PRIMARY KEY,
  route TEXT,                        -- which endpoint/mode: 'chat' | 'runtime_plan' | ...
  agents_json TEXT,                  -- JSON array of agent/task ids involved
  models_json TEXT,                  -- JSON array of {provider, model} actually called
  tools_json TEXT,                   -- JSON array of tool names invoked
  latency_ms INTEGER,
  retries INTEGER NOT NULL DEFAULT 0,
  failures_json TEXT,                -- JSON array of {message, at} — message is an error summary, never model output
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  verification_json TEXT,            -- {ran, verdict, issueCount} — never the verifier's raw critique text
  final_status TEXT,                 -- 'ok' | 'failed' | 'cancelled'
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_created ON observability_events(created_at);
CREATE INDEX IF NOT EXISTS idx_obs_route ON observability_events(route);

-- Security + domain audit trail (auth failures, SSRF blocks, tool denials,
-- budget stops, AND the existing humanitarian-veto audit log the frontend
-- already reads via GET/POST /api/audit/veto).
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- 'security' | 'veto'
  topic TEXT,
  reviewer_agent_id TEXT,
  rejected_items_json TEXT,
  raw_review_text TEXT,
  severity TEXT,                     -- security events only: 'info' | 'warn' | 'critical'
  message TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_kind_created ON audit_log(kind, created_at DESC);

-- Embeddings cache — content-hash keyed, shared across ALL callers/users,
-- so the exact same text is never re-embedded twice regardless of who
-- (or which client) asked for it.
CREATE TABLE IF NOT EXISTS embeddings_cache (
  text_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (text_hash, provider, model)
);

-- Scheduled background agents (existing /api/schedules feature).
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  recurrence_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  last_status TEXT,
  created_at INTEGER NOT NULL
);

-- Cloud sync (existing /api/sync feature) — server never sees plaintext;
-- ciphertext + IV + salt only, exactly as the frontend's AES-GCM client-side
-- encryption already assumes.
CREATE TABLE IF NOT EXISTS sync_records (
  owner_key TEXT PRIMARY KEY,        -- derived from the gateway key/user — one record per authenticated owner
  version INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  salt_b64 TEXT NOT NULL,
  iv_b64 TEXT NOT NULL,
  ciphertext_b64 TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Foundational persistent semantic memory / knowledge store — future-hosts
-- what the frontend currently keeps entirely in localStorage/IndexedDB, so
-- large knowledge bases don't have to round-trip through the browser.
-- Minimal viable schema now; retrieval logic lives in memory/contextFabric.ts.
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT,
  kind TEXT NOT NULL,                -- 'knowledge' | 'episodic' | 'semantic'
  title TEXT,
  content TEXT NOT NULL,
  embedding_json TEXT,               -- nullable — populated lazily via /api/embed
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_items(project_id, kind);

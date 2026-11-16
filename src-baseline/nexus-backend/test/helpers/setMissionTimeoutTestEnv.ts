process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = '';
process.env.NEXUS_LOG_LEVEL = 'warn';
process.env.NEXUS_MAX_RETRIES = '0'; // isolate: a hang should fail fast on timeout, not also wait through retry backoff
process.env.NEXUS_TASK_TIMEOUT_MS = '300'; // short and deterministic — this file exists ONLY to set this before anything imports config/env.ts
process.env.NEXUS_PLAN_TIMEOUT_MS = '30000';

/**
 * Server-wide configuration. Like providerRegistry.ts, this is the single
 * place these values are read from — nothing else parses process.env
 * directly for these settings.
 */

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Explicit opt-in flags only — no implicit "truthy string" parsing (a stray "0" or "no" must not silently enable something meant to default OFF). */
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

export const ServerConfig = {
  port: num('NEXUS_PORT', 8787),
  /**
   * Release V1 · B4: defaults to LOOPBACK. Reaching the backend from another
   * machine (documented LAN use) needs an explicit NEXUS_HOST (e.g. 0.0.0.0
   * or the LAN IP) AND NEXUS_GATEWAY_KEYS — enforced at startup by
   * config/deploymentGuard.ts, which refuses to boot otherwise.
   */
  host: process.env.NEXUS_HOST?.trim() || '127.0.0.1',

  /**
   * Gateway (bearer) keys accepted on protected routes. Mirrors the
   * frontend's syncAuthHeaders()/getGatewayKey() Bearer-token pattern
   * exactly. If this list is EMPTY, the gateway runs in trusted/no-auth
   * mode (e.g. LAN-only self-hosted deployment) — matching the existing
   * frontend behavior of only sending the header when a key is actually
   * configured client-side. If at least one key IS configured here, every
   * protected route requires a valid Bearer match; there is no partial
   * state where auth is "optional but checked".
   */
  gatewayKeys: list('NEXUS_GATEWAY_KEYS'),

  /** Max concurrent in-flight tasks (Agent Runtime DAG tasks + chat completions) across the whole process. */
  maxConcurrency: num('NEXUS_MAX_CONCURRENCY', 8),
  /** Max concurrent tasks within a single DAG run. */
  maxConcurrencyPerPlan: num('NEXUS_MAX_CONCURRENCY_PER_PLAN', 4),

  /** Per-task (single model call) timeout, ms. Provider-specific timeouts in providerRegistry take precedence when set. */
  defaultTaskTimeoutMs: num('NEXUS_TASK_TIMEOUT_MS', 90_000),

  /**
   * Dedicated resilience testing finding: the "raw judge call" pattern
   * shared by orchestrator/verifier.ts, evaluation/evaluationEngine.ts,
   * evolution/agentGenome.ts, and knowledge/freshnessEngine.ts (a fixed
   * anthropic provider called directly via the adapter, bypassing
   * runAgentTask()/the Agent Runtime's own DAG-level timeout) had NO
   * timeout of its own at all — confirmed empirically to hang forever
   * against an unresponsive endpoint, not just in theory. This is the one
   * shared timeout all four now pass via AbortSignal.timeout(), so a
   * misbehaving or slow provider can never hang one of these calls
   * indefinitely.
   */
  judgeCallTimeoutMs: num('NEXUS_JUDGE_CALL_TIMEOUT_MS', 30_000),
  /** Whole-plan wall-clock ceiling, ms — guards against a pathological DAG never finishing. */
  planTimeoutMs: num('NEXUS_PLAN_TIMEOUT_MS', 10 * 60_000),

  /** Retry policy defaults (see orchestrator/resilientCall.ts). */
  maxRetries: num('NEXUS_MAX_RETRIES', 2),
  retryBaseDelayMs: num('NEXUS_RETRY_BASE_DELAY_MS', 500),

  /** Soft USD budget per rolling 24h window, enforced by orchestrator/budget.ts. 0 = disabled. */
  dailyBudgetUsd: num('NEXUS_DAILY_BUDGET_USD', 0),

  /** Rate limiting — token bucket per client key (gateway key, or IP if none). */
  rateLimitPerMinute: num('NEXUS_RATE_LIMIT_PER_MINUTE', 60),
  rateLimitBurst: num('NEXUS_RATE_LIMIT_BURST', 20),

  /** Max request body size, bytes. Protects against oversized payload DoS. */
  maxBodyBytes: num('NEXUS_MAX_BODY_BYTES', 2 * 1024 * 1024), // 2MB — generous for chat/knowledge payloads, not for arbitrary uploads

  /** web_fetch tool: hard cap on fetched content forwarded to the model. */
  webFetchMaxChars: num('NEXUS_WEB_FETCH_MAX_CHARS', 12_000),
  webFetchTimeoutMs: num('NEXUS_WEB_FETCH_TIMEOUT_MS', 10_000),

  /**
   * Sandbox / code_execution tool (Phase 3 §Sandbox). FAIL-CLOSED BY
   * DEFAULT (false) — this deployment has NO OS-level isolation available
   * (verified: no Docker/firejail/bubblewrap in this environment), so the
   * sandbox is a best-effort resource/timeout guard, NOT a real security
   * boundary against a determined adversarial payload — see
   * src/sandbox/sandbox.ts's file doc comment for the full, honest list
   * of what is and isn't actually enforced. An operator must explicitly
   * opt in, understanding that tradeoff, before any agent can execute code.
   * G8.1: this flag NO LONGER makes the tool available — 'code_execution' is not registered by tools/bootstrap.ts at all (owner decision), so
   * agents cannot call it whatever this is set to; it only gates Sandbox.runCode() for code that imports the tool explicitly (tests/development).
   */
  codeExecutionEnabled: bool('NEXUS_ENABLE_CODE_EXECUTION_TOOL', false),
  codeExecutionTimeoutMs: num('NEXUS_CODE_EXECUTION_TIMEOUT_MS', 8_000),
  codeExecutionMaxOutputChars: num('NEXUS_CODE_EXECUTION_MAX_OUTPUT_CHARS', 8_000),
  codeExecutionMaxConcurrency: num('NEXUS_CODE_EXECUTION_MAX_CONCURRENCY', 2),

  /**
   * IoT Bridge — MQTT transport. 0 (default) means the MQTT broker never
   * starts at all — same fail-closed-by-default posture as Sandbox code
   * execution above: an operator must explicitly opt in to exposing
   * another network listener. The pre-existing HTTP poll/push IoT routes
   * (routes/v2/iot.ts) work identically whether or not this is enabled.
   */
  mqttPort: num('NEXUS_MQTT_PORT', 0),

  /**
   * NEXUS VEL (Verified Execution Layer) kill switch. Only affects tools that DECLARE an external effect (tools/effectTypes.ts) — no built-in tool does today.
   * false = every effectful tool is refused (fail-closed); it never means "run effectful tools without the gate".
   */
  velEnabled: bool('NEXUS_VEL_ENABLED', true),
  /** VEL allow-rules as a JSON array (see tools/effectPolicy.ts). Empty/invalid = NO rules = every effectful action is denied (default-deny). */
  velPolicyJson: process.env.NEXUS_VEL_POLICY_JSON?.trim() || '',

  /** SQLite file path. ':memory:' is valid (used by the test suite). */
  dbPath: process.env.NEXUS_DB_PATH?.trim() || './data/nexus.db',

  /** CORS allow-list. Empty = same-origin/no browser CORS headers emitted (safe default for a same-host deployment). */
  corsAllowedOrigins: list('NEXUS_CORS_ORIGINS'),

  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
};

export function isProduction(): boolean {
  return ServerConfig.nodeEnv === 'production';
}

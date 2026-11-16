type Level = 'debug' | 'info' | 'warn' | 'error' | 'security';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, security: 2, error: 3 };
const MIN_LEVEL: Level = (process.env.NEXUS_LOG_LEVEL as Level) || 'info';

/**
 * Defense-in-depth: even if a caller accidentally passes a long field (e.g.
 * a full model completion) into a log call, it gets truncated here rather
 * than persisted in full. The REAL rule — never pass chain-of-thought or
 * full completions to the logger/observability store in the first place —
 * lives in observability/recorder.ts, which only ever extracts metadata
 * (lengths, token counts, verdicts) from task results. This is a backstop,
 * not the primary control.
 */
const MAX_FIELD_LEN = 500;
function redact(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_FIELD_LEN) {
    return value.slice(0, MAX_FIELD_LEN) + `…[truncated ${value.length - MAX_FIELD_LEN} chars]`;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const stream = level === 'error' ? console.error : console.log;
  stream(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
  /** Security-relevant events (auth failures, SSRF blocks, tool permission denials, budget stops). Always emitted at 'warn' priority or above regardless of NEXUS_LOG_LEVEL. Production Hardening note: this function itself does NOT persist anything — for an event that also needs to be queryable later (which is almost always the right call for anything actually security-relevant), call security/audit.ts's auditSecurityEvent() instead, which calls this AND persists to the durable audit table in one place. Calling this directly for a genuinely security-relevant event is exactly the bug that slipped into ssrfGuard.ts once already. */
  security: (msg: string, fields?: Record<string, unknown>) => emit('security', `[SECURITY] ${msg}`, fields),
};

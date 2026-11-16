import { logger } from '../core/logger.js';
import { getRepos } from '../persistence/repos.js';

export type SecuritySeverity = 'info' | 'warn' | 'critical';

/**
 * Every security-relevant event in the backend (auth failure, rate limit
 * trip, SSRF block, tool permission denial, budget stop, payload rejected)
 * should funnel through this ONE function, so there is exactly one place
 * that decides what gets logged vs. persisted, instead of every call site
 * reimplementing it slightly differently.
 */
export function auditSecurityEvent(severity: SecuritySeverity, message: string, meta: Record<string, unknown> = {}): void {
  logger.security(message, { severity, ...meta });
  try {
    getRepos().audit.logSecurity(severity, message, meta);
  } catch (e) {
    // Never let audit persistence failure break the request it's auditing.
    logger.error('Failed to persist security audit event', { message: (e as Error).message });
  }
}

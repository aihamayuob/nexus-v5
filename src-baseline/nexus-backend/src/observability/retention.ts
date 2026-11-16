import { getRepos } from '../persistence/repos.js';
import { logger } from '../core/logger.js';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const RetentionConfig = {
  streamEventsGraceMs: num('NEXUS_RETENTION_STREAM_EVENTS_MS', 6 * 60 * 60_000), // 6h after a task finishes
  observabilityMaxAgeMs: num('NEXUS_RETENTION_OBSERVABILITY_MS', 30 * 24 * 60 * 60_000), // 30 days
  providerCallLogMaxAgeMs: num('NEXUS_RETENTION_PROVIDER_LOG_MS', 30 * 24 * 60 * 60_000), // 30 days
  auditLogMaxAgeMs: num('NEXUS_RETENTION_AUDIT_MS', 180 * 24 * 60 * 60_000), // 180 days — audit trail kept much longer by design
};

export function runRetentionSweep(): void {
  const repos = getRepos();
  try {
    const streamEvents = repos.streamEvents.pruneFinishedOlderThan(RetentionConfig.streamEventsGraceMs);
    const observability = repos.observability.pruneOlderThan(RetentionConfig.observabilityMaxAgeMs);
    const providerCalls = repos.providerCallLog.pruneOlderThan(RetentionConfig.providerCallLogMaxAgeMs);
    const audit = repos.audit.pruneOlderThan(RetentionConfig.auditLogMaxAgeMs);
    if (streamEvents || observability || providerCalls || audit) {
      logger.info('Retention sweep completed', { streamEvents, observability, providerCalls, audit });
    }
  } catch (e) {
    logger.error('Retention sweep failed (non-fatal)', { message: (e as Error).message });
  }
}

export function startRetentionSweeper(intervalMs = 60 * 60_000): NodeJS.Timeout {
  return setInterval(runRetentionSweep, intervalMs);
}

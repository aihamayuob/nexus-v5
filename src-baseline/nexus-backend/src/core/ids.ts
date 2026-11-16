import { randomUUID, createHash } from 'node:crypto';

let monotonicCounter = 0;

export function newRequestId(): string {
  return `req_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function newTaskId(prefix = 'task'): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function newPlanId(): string {
  return `plan_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

/** Monotonically increasing per-process sequence, used as the SSE `id:` field so clients can resume with Last-Event-ID / ?afterId=. Resets on process restart — resumable streams are only ever resumed within the lifetime of the request they belong to, so this is fine. */
export function nextEventSeq(): number {
  monotonicCounter += 1;
  return monotonicCounter;
}

/**
 * Deterministic idempotency key: given an explicit client-supplied key (if
 * any) or a stable hash of the request body, so retried client requests
 * (e.g. a dropped connection immediately retried) map to the SAME task
 * instead of silently starting a duplicate.
 */
export function idempotencyKeyFor(explicitKey: string | undefined, body: unknown): string {
  if (explicitKey && explicitKey.trim()) return `idem_${explicitKey.trim()}`;
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);
  return `idem_auto_${hash}`;
}

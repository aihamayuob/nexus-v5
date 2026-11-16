import { ServerConfig } from '../../config/env.js';
import { Errors } from '../../core/errors.js';
import { auditSecurityEvent } from '../../security/audit.js';

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

/** Simple token-bucket: refills at rateLimitPerMinute/60 tokens/sec, caps at rateLimitBurst. */
export function checkRateLimit(clientKey: string): void {
  const now = Date.now();
  const refillPerMs = ServerConfig.rateLimitPerMinute / 60_000;
  let bucket = buckets.get(clientKey);
  if (!bucket) {
    bucket = { tokens: ServerConfig.rateLimitBurst, lastRefillMs: now };
    buckets.set(clientKey, bucket);
  }
  const elapsed = now - bucket.lastRefillMs;
  bucket.tokens = Math.min(ServerConfig.rateLimitBurst, bucket.tokens + elapsed * refillPerMs);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    auditSecurityEvent('info', 'Rate limit exceeded', { clientKey: clientKey.slice(0, 12) });
    const msUntilNextToken = Math.ceil((1 - bucket.tokens) / refillPerMs);
    throw Errors.rateLimited(undefined, msUntilNextToken);
  }
  bucket.tokens -= 1;
}

/** Periodic cleanup so long-lived processes don't accumulate buckets for clients that stopped calling. */
export function pruneStaleRateLimitBuckets(maxAgeMs = 30 * 60_000) {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.lastRefillMs > maxAgeMs) buckets.delete(key);
  }
}

/** Test-only. */
export function resetRateLimitBucketsForTests() {
  buckets.clear();
}

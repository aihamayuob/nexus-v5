import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import { getProviderAdapter } from './index.js';

/**
 * The four-state model NEXUS Phase 1 §5 requires: having an adapter or an
 * env var configured is NOT "READY" — READY must come from an actual
 * reachability probe when one is possible. A provider we simply have no
 * credentials for is NOT_CONFIGURED (not a failure); a provider that IS
 * configured but didn't answer the probe is UNAVAILABLE; one that answered
 * too slowly to trust for latency-sensitive routing is DEGRADED.
 */
export type ProviderHealthState = 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export interface ProviderHealthResult {
  id: ProviderId;
  state: ProviderHealthState;
  /** true only when this result came from a real network probe just now (or within the cache TTL) — false when we fell back to "configuration presence" because the adapter has no health() implementation. */
  live: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

/** How long a probe result is trusted before the next call to getProviderHealth() re-checks. Keeps GET /v2/providers/health cheap under repeated polling without ever going fully stale. */
const CACHE_TTL_MS = 30_000;
/** A successful probe slower than this is real but too slow to route latency-sensitive work to — DEGRADED, not READY. */
const DEGRADED_LATENCY_MS = 3_000;

const cache = new Map<ProviderId, { result: ProviderHealthResult; expiresAt: number }>();

function isConfigured(id: ProviderId): boolean {
  const p = ProviderRegistry.resolve(id);
  return p.capabilities.isLocal ? !!p.resolvedModel : !!p.apiKey;
}

async function probe(id: ProviderId): Promise<ProviderHealthResult> {
  const checkedAt = new Date().toISOString();
  if (!isConfigured(id)) {
    return { id, state: 'NOT_CONFIGURED', live: true, checkedAt };
  }

  const adapter = getProviderAdapter(id);
  if (!adapter.health) {
    // No cheap probe available for this adapter — say so honestly rather than claim a live check we didn't do.
    return { id, state: 'READY', live: false, checkedAt };
  }

  try {
    const ping = await adapter.health();
    if (!ping.ok) return { id, state: 'UNAVAILABLE', live: true, latencyMs: ping.latencyMs, error: ping.error, checkedAt };
    if (ping.latencyMs > DEGRADED_LATENCY_MS) return { id, state: 'DEGRADED', live: true, latencyMs: ping.latencyMs, checkedAt };
    return { id, state: 'READY', live: true, latencyMs: ping.latencyMs, checkedAt };
  } catch (e) {
    return { id, state: 'UNAVAILABLE', live: true, error: e instanceof Error ? e.message : String(e), checkedAt };
  }
}

/** Live (cache-respecting) health for one provider. Pass force:true to bypass the cache — used by explicit ?probe=1 requests. */
export async function getProviderHealth(id: ProviderId, opts: { force?: boolean } = {}): Promise<ProviderHealthResult> {
  const cached = cache.get(id);
  if (!opts.force && cached && cached.expiresAt > Date.now()) return cached.result;
  const result = await probe(id);
  cache.set(id, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Health for every registered provider, probed in parallel. */
export async function getAllProviderHealth(opts: { force?: boolean } = {}): Promise<ProviderHealthResult[]> {
  return Promise.all(ProviderRegistry.list().map((id) => getProviderHealth(id, opts)));
}

/** Test-only: clears the cache so tests don't see a previous test's result. */
export function clearHealthCacheForTests() {
  cache.clear();
}

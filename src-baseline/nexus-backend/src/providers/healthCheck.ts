import type { FetchLike, ProviderPingResult } from './contract.js';

/** Hard ceiling for any single health probe, independent of a provider's normal chat timeout — a health check that takes as long as a real request defeats its own purpose. */
const MAX_PROBE_TIMEOUT_MS = 5_000;

/**
 * Issues a bounded GET request and reports reachability + latency without
 * throwing — callers (adapter.health() implementations) always get a
 * ProviderPingResult back, never an exception, so healthRegistry.ts never
 * needs a second try/catch layer around a probe.
 */
export async function pingEndpoint(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  timeoutMs = MAX_PROBE_TIMEOUT_MS
): Promise<ProviderPingResult> {
  const boundedTimeout = Math.min(timeoutMs, MAX_PROBE_TIMEOUT_MS);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, latencyMs, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 150)}` : ''}` };
    }
    return { ok: true, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const message = e instanceof Error ? (e.name === 'AbortError' ? 'انتهت مهلة فحص الاتصال.' : e.message) : String(e);
    return { ok: false, latencyMs, error: message };
  } finally {
    clearTimeout(timer);
  }
}

import type { ProviderId } from '../config/providerRegistry.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import { getProviderAdapter } from '../providers/index.js';
import { getRepos } from '../persistence/repos.js';
import { PermissionModel, type GatewayContext } from '../capability/permissionModel.js';

export interface EmbedTextsResult {
  embeddings: number[][];
  model: string;
  cacheHits: number;
  cacheMisses: number;
}

/**
 * Single entry point for turning text into vectors anywhere in this
 * backend (the legacy /api/embed route, and future server-hosted
 * memory/knowledge retrieval in contextFabric.ts both call this — never
 * a provider adapter's embed() directly). Three things happen here that
 * wouldn't happen calling the adapter directly:
 *   1. DEDUPLICATION — identical text (even across different callers/
 *      users) is only ever embedded once; every duplicate reuses that
 *      one vector.
 *   2. CACHING — content-hash keyed, persisted in SQLite, shared process-
 *      wide and across restarts, so the exact same text is never
 *      re-embedded on a later request either.
 *   3. BATCHING — whatever text remains after dedup+cache are resolved is
 *      sent to the provider in ONE call, not one round-trip per string.
 */
export async function embedTexts(texts: string[], providerId: ProviderId, ctx: GatewayContext, model?: string): Promise<EmbedTextsResult> {
  PermissionModel.assertEmbeddingAllowed(providerId, ctx);
  const cfg = ProviderRegistry.resolve(providerId);
  const useModel = model || cfg.resolvedEmbeddingModel || cfg.resolvedModel;
  const repos = getRepos();

  // Dedup: map each UNIQUE text to the list of original indices it appeared at.
  const uniqueTextToIndices = new Map<string, number[]>();
  texts.forEach((t, i) => {
    const list = uniqueTextToIndices.get(t);
    if (list) list.push(i);
    else uniqueTextToIndices.set(t, [i]);
  });
  const uniqueTexts = [...uniqueTextToIndices.keys()];

  // Cache lookup for each unique text.
  const resolved = new Map<string, number[]>(); // text -> vector
  const misses: string[] = [];
  for (const t of uniqueTexts) {
    const cached = repos.embeddingCache.get(t, providerId, useModel);
    if (cached) resolved.set(t, cached);
    else misses.push(t);
  }

  // Batch ALL misses into one call.
  if (misses.length > 0) {
    const adapter = getProviderAdapter(providerId);
    const result = await adapter.embed(misses, useModel);
    misses.forEach((t, i) => {
      const vec = result.embeddings[i];
      if (vec) {
        resolved.set(t, vec);
        repos.embeddingCache.set(t, providerId, useModel, vec);
      }
    });
  }

  const output: number[][] = new Array(texts.length);
  for (const [text, indices] of uniqueTextToIndices) {
    const vec = resolved.get(text) ?? [];
    for (const i of indices) output[i] = vec;
  }

  return { embeddings: output, model: useModel, cacheHits: uniqueTexts.length - misses.length, cacheMisses: misses.length };
}

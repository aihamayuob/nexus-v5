import { getRepos } from '../persistence/repos.js';
import type { MemoryKind } from '../persistence/repositories/memoryRepo.js';
import { embedTexts } from './embeddingsService.js';
import type { ProviderId } from '../config/providerRegistry.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { fence } from '../security/promptInjectionGuard.js';

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function keywordScore(query: string, content: string): number {
  const qWords = new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (qWords.size === 0) return 0;
  const cLower = content.toLowerCase();
  let hits = 0;
  for (const w of qWords) if (cLower.includes(w)) hits++;
  return hits / qWords.size;
}

/**
 * Foundational retrieval over memory_items — embedding similarity when an
 * embeddings-capable provider is configured (and items already have
 * embeddings populated), keyword overlap otherwise. This is deliberately
 * the SAME two-tier strategy the frontend already uses client-side
 * (embeddings with a TF-IDF-style fallback) — the point of this module
 * existing is giving a future frontend pass the option to query
 * server-hosted knowledge INSTEAD of shipping the whole knowledge base to
 * the browser, not to reinvent the retrieval strategy itself.
 */
export async function retrieveMemory(
  query: string,
  opts: { projectId: string | null; kind?: MemoryKind; topK?: number; providerId?: ProviderId },
  ctx: GatewayContext
): Promise<Array<{ id: string; title: string | null; content: string; score: number }>> {
  const repos = getRepos();
  const items = repos.memory.listForProject(opts.projectId, opts.kind, 500);
  if (items.length === 0) return [];

  const topK = opts.topK ?? 5;
  const providerId = opts.providerId ?? 'anthropic';
  const canEmbed = ProviderRegistry.capabilities(providerId as ProviderId).embeddings || itemsHaveEmbeddings(items);

  if (canEmbed && ProviderRegistry.capabilities(providerId as ProviderId).embeddings) {
    try {
      const { embeddings: queryVec } = await embedTexts([query], providerId as ProviderId, ctx);
      const scored = items
        .filter((it) => it.embedding)
        .map((it) => ({ id: it.id, title: it.title, content: it.content, score: cosineSimilarity(queryVec[0] ?? [], it.embedding!) }));
      if (scored.length > 0) {
        return scored.sort((a, b) => b.score - a.score).slice(0, topK);
      }
    } catch {
      // Falls through to keyword scoring below — embeddings are a quality
      // improvement, never a hard dependency for retrieval to work at all.
    }
  }

  return items
    .map((it) => ({ id: it.id, title: it.title, content: it.content, score: keywordScore(query, it.content) }))
    .filter((it) => it.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function itemsHaveEmbeddings(items: Array<{ embedding: number[] | null }>): boolean {
  return items.some((it) => it.embedding);
}

/** Builds a fenced context block ready to interpolate into a system/user prompt — same PromptInjectionGuard treatment the frontend already applies to knowledge content, since server-hosted memory is exactly as externally-sourced as the browser's own knowledge base. */
export async function buildMemoryContextBlock(
  query: string,
  opts: { projectId: string | null; kind?: MemoryKind; providerId?: ProviderId },
  ctx: GatewayContext
): Promise<string> {
  const results = await retrieveMemory(query, opts, ctx);
  if (results.length === 0) return '';
  const body = results.map((r) => `- ${r.title ?? '(بدون عنوان)'}: ${r.content}`).join('\n');
  return fence('ذاكرة/معرفة مستضافة على الخادم', body);
}

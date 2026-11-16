import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import type { ProviderAdapter, FetchLike } from './contract.js';
import { AnthropicAdapter } from './anthropicAdapter.js';
import { createOpenAIAdapter } from './openaiAdapter.js';
import { createDeepSeekAdapter } from './deepseekAdapter.js';
import { createGeminiAdapter } from './geminiAdapter.js';
import { createOllamaAdapter } from './ollamaAdapter.js';
import { createLmStudioAdapter } from './lmstudioAdapter.js';
import { Errors } from '../core/errors.js';

export function createProviderAdapter(id: ProviderId, fetchImpl: FetchLike = fetch): ProviderAdapter {
  if (!ProviderRegistry.has(id)) throw Errors.validation(`مزود غير معروف: ${id}`);
  const cfg = ProviderRegistry.resolve(id);
  switch (id) {
    case 'anthropic':
      return new AnthropicAdapter(cfg, fetchImpl);
    case 'openai':
      return createOpenAIAdapter(cfg, fetchImpl);
    case 'deepseek':
      return createDeepSeekAdapter(cfg, fetchImpl);
    case 'gemini':
      return createGeminiAdapter(cfg, fetchImpl);
    case 'ollama':
      return createOllamaAdapter(cfg, fetchImpl);
    case 'lmstudio':
      return createLmStudioAdapter(cfg, fetchImpl);
  }
}

/** Cache adapters per provider id for the process lifetime — config is re-resolved from env at construction time, and env doesn't change mid-process, so this is safe and avoids rebuilding closures on every request. */
const cache = new Map<ProviderId, ProviderAdapter>();
export function getProviderAdapter(id: ProviderId, fetchImpl: FetchLike = fetch): ProviderAdapter {
  const cacheKey = id;
  if (!cache.has(cacheKey)) cache.set(cacheKey, createProviderAdapter(id, fetchImpl));
  return cache.get(cacheKey)!;
}

/** Test-only: clears the adapter cache so tests can inject a fresh mock fetch per adapter. */
export function clearAdapterCacheForTests() {
  cache.clear();
}

/** Test-only: directly injects a pre-built adapter (e.g. one wired to a mock fetch) into the cache, bypassing createProviderAdapter's real construction. */
export function setAdapterForTests(id: ProviderId, adapter: ProviderAdapter) {
  cache.set(id, adapter);
}

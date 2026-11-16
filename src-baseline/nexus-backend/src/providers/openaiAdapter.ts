import type { ResolvedProvider } from '../config/providerRegistry.js';
import type { FetchLike, ProviderAdapter } from './contract.js';
import { createOpenAICompatibleAdapter } from './openaiCompatible.js';

export function createOpenAIAdapter(cfg: ResolvedProvider, fetchImpl: FetchLike = fetch): ProviderAdapter {
  return createOpenAICompatibleAdapter('openai', cfg, fetchImpl, { sendAuthHeader: true });
}

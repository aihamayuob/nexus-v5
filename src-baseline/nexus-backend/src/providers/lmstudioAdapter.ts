import type { ResolvedProvider } from '../config/providerRegistry.js';
import type { FetchLike, ProviderAdapter } from './contract.js';
import { createOpenAICompatibleAdapter } from './openaiCompatible.js';

export function createLmStudioAdapter(cfg: ResolvedProvider, fetchImpl: FetchLike = fetch): ProviderAdapter {
  // LM Studio's local server ignores auth entirely — omit the header
  // rather than send a meaningless dummy Bearer token.
  return createOpenAICompatibleAdapter('lmstudio', cfg, fetchImpl, { sendAuthHeader: false });
}

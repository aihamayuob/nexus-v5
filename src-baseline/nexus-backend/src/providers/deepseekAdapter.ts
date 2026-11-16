import type { ResolvedProvider } from '../config/providerRegistry.js';
import type { FetchLike, ProviderAdapter } from './contract.js';
import { createOpenAICompatibleAdapter } from './openaiCompatible.js';

export function createDeepSeekAdapter(cfg: ResolvedProvider, fetchImpl: FetchLike = fetch): ProviderAdapter {
  return createOpenAICompatibleAdapter('deepseek', cfg, fetchImpl, { sendAuthHeader: true });
}

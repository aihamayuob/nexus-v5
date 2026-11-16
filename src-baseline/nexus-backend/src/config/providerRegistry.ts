/**
 * PROVIDER REGISTRY — Single Source of Truth
 * ============================================================================
 * Every provider id, default model id, base URL, auth style, and capability
 * flag used ANYWHERE in this backend (adapters, ModelRouter, PermissionModel,
 * the /v2/models endpoint, the legacy /api/chat & /api/runtime/* routes)
 * reads from this one module. Nothing else is allowed to hardcode a model
 * string or a provider capability — that was exactly the class of bug the
 * frontend audit found repeatedly (every non-Anthropic provider silently
 * receiving an Anthropic model name). This file exists so that class of bug
 * is structurally impossible in the backend: there is nowhere else to put
 * a model id.
 *
 * Defaults below are deliberately overridable via environment variables
 * (NEXUS_MODEL_<PROVIDER>) because model catalogs change faster than code
 * ships — hardcoding a "current" model string as the ONLY option would just
 * relocate the original bug one layer down. The registry itself never goes
 * stale in a way that requires a code change; only the env needs updating.
 */

export type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'gemini' | 'ollama' | 'lmstudio';

export interface ProviderCapabilities {
  /** Can this provider stream tokens incrementally? */
  streaming: boolean;
  /** Can the model request client/server tool use (function calling)? */
  tools: boolean;
  /** Can the model accept image input? */
  images: boolean;
  /** Does this provider expose an embeddings endpoint we can call? */
  embeddings: boolean;
  /** Local providers (Ollama/LM Studio) run on the user's own machine/network — no API key, no usage cost. */
  isLocal: boolean;
  /** Does calling this provider require an API key to be configured server-side? */
  requiresApiKey: boolean;
  /**
   * Can this provider natively ground a response in a live web search
   * (returning citations) via its own official API — NOT a NEXUS tool we
   * execute, and NOT scraping. Currently true only for Gemini's Google
   * Search grounding (NEXUS Phase 1 §10). Other providers may gain a
   * server-native search capability later (e.g. Anthropic's own web search
   * tool) — that is a separate, not-yet-validated capability and must not
   * be silently assumed true here just because the wire format looks similar.
   */
  webSearch: boolean;
}

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  /** Env var holding the API key, if requiresApiKey. Never logged, never sent to any client. */
  apiKeyEnvVar?: string;
  /** Base URL for this provider's API. Overridable so local providers can point at any host:port. */
  defaultBaseUrl: string;
  baseUrlEnvVar: string;
  /** Default chat model id, overridable via env — see file header. */
  defaultModelEnvVar: string;
  defaultModel: string;
  /** Default embeddings model id, if the provider supports embeddings. */
  defaultEmbeddingModelEnvVar?: string;
  defaultEmbeddingModel?: string;
  capabilities: ProviderCapabilities;
  /** Per-provider request timeout override (ms). Falls back to the global default if unset. */
  timeoutMsEnvVar: string;
  defaultTimeoutMs: number;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

const REGISTRY_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    apiKeyEnvVar: 'NEXUS_ANTHROPIC_API_KEY',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEnvVar: 'NEXUS_ANTHROPIC_BASE_URL',
    defaultModelEnvVar: 'NEXUS_MODEL_ANTHROPIC',
    defaultModel: 'claude-sonnet-4-6',
    capabilities: { streaming: true, tools: true, images: true, embeddings: false, isLocal: false, requiresApiKey: true, webSearch: false },
    timeoutMsEnvVar: 'NEXUS_TIMEOUT_ANTHROPIC_MS',
    defaultTimeoutMs: 60_000,
  },
  {
    id: 'openai',
    label: 'GPT (OpenAI)',
    apiKeyEnvVar: 'NEXUS_OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com',
    baseUrlEnvVar: 'NEXUS_OPENAI_BASE_URL',
    defaultModelEnvVar: 'NEXUS_MODEL_OPENAI',
    defaultModel: 'gpt-4o',
    defaultEmbeddingModelEnvVar: 'NEXUS_EMBED_MODEL_OPENAI',
    defaultEmbeddingModel: 'text-embedding-3-small',
    capabilities: { streaming: true, tools: true, images: true, embeddings: true, isLocal: false, requiresApiKey: true, webSearch: false },
    timeoutMsEnvVar: 'NEXUS_TIMEOUT_OPENAI_MS',
    defaultTimeoutMs: 60_000,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiKeyEnvVar: 'NEXUS_DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlEnvVar: 'NEXUS_DEEPSEEK_BASE_URL',
    defaultModelEnvVar: 'NEXUS_MODEL_DEEPSEEK',
    defaultModel: 'deepseek-chat',
    capabilities: { streaming: true, tools: true, images: false, embeddings: false, isLocal: false, requiresApiKey: true, webSearch: false },
    timeoutMsEnvVar: 'NEXUS_TIMEOUT_DEEPSEEK_MS',
    defaultTimeoutMs: 60_000,
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    apiKeyEnvVar: 'NEXUS_GEMINI_API_KEY',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    baseUrlEnvVar: 'NEXUS_GEMINI_BASE_URL',
    defaultModelEnvVar: 'NEXUS_MODEL_GEMINI',
    defaultModel: 'gemini-2.0-flash',
    defaultEmbeddingModelEnvVar: 'NEXUS_EMBED_MODEL_GEMINI',
    defaultEmbeddingModel: 'text-embedding-004',
    capabilities: { streaming: true, tools: true, images: true, embeddings: true, isLocal: false, requiresApiKey: true, webSearch: true },
    timeoutMsEnvVar: 'NEXUS_TIMEOUT_GEMINI_MS',
    defaultTimeoutMs: 60_000,
  },
  {
    id: 'ollama',
    label: 'Ollama (محلي)',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    baseUrlEnvVar: 'NEXUS_OLLAMA_BASE_URL',
    defaultModelEnvVar: 'NEXUS_MODEL_OLLAMA',
    defaultModel: '', // no sane global default — the user names whatever they've pulled locally
    defaultEmbeddingModelEnvVar: 'NEXUS_EMBED_MODEL_OLLAMA',
    defaultEmbeddingModel: 'nomic-embed-text',
    capabilities: { streaming: true, tools: false, images: true, embeddings: true, isLocal: true, requiresApiKey: false, webSearch: false },
    timeoutMsEnvVar: 'NEXUS_TIMEOUT_OLLAMA_MS',
    defaultTimeoutMs: 120_000, // local inference is often slower than hosted APIs
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (محلي)',
    defaultBaseUrl: 'http://127.0.0.1:1234',
    baseUrlEnvVar: 'NEXUS_LMSTUDIO_BASE_URL',
    defaultModelEnvVar: 'NEXUS_MODEL_LMSTUDIO',
    defaultModel: '',
    defaultEmbeddingModelEnvVar: 'NEXUS_EMBED_MODEL_LMSTUDIO',
    defaultEmbeddingModel: '',
    capabilities: { streaming: true, tools: false, images: false, embeddings: true, isLocal: true, requiresApiKey: false, webSearch: false },
    timeoutMsEnvVar: 'NEXUS_TIMEOUT_LMSTUDIO_MS',
    defaultTimeoutMs: 120_000,
  },
];

export interface ResolvedProvider extends ProviderDefinition {
  apiKey: string | null;
  baseUrl: string;
  resolvedModel: string;
  resolvedEmbeddingModel: string | null;
  timeoutMs: number;
}

class ProviderRegistryImpl {
  private readonly byId = new Map<ProviderId, ProviderDefinition>();

  constructor(defs: ProviderDefinition[]) {
    for (const d of defs) this.byId.set(d.id, d);
  }

  list(): ProviderId[] {
    return [...this.byId.keys()];
  }

  has(id: string): id is ProviderId {
    return this.byId.has(id as ProviderId);
  }

  /** Resolves a provider's live config (env overrides applied). Never caches the API key beyond process memory. */
  resolve(id: ProviderId): ResolvedProvider {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Unknown provider: ${id}`);
    const apiKey = def.apiKeyEnvVar ? env(def.apiKeyEnvVar) ?? null : null;
    const baseUrl = env(def.baseUrlEnvVar) ?? def.defaultBaseUrl;
    const resolvedModel = env(def.defaultModelEnvVar) ?? def.defaultModel;
    const resolvedEmbeddingModel = def.defaultEmbeddingModelEnvVar
      ? env(def.defaultEmbeddingModelEnvVar) ?? def.defaultEmbeddingModel ?? null
      : null;
    const timeoutMs = Number(env(def.timeoutMsEnvVar)) || def.defaultTimeoutMs;
    return { ...def, apiKey, baseUrl, resolvedModel, resolvedEmbeddingModel, timeoutMs };
  }

  resolveAll(): ResolvedProvider[] {
    return this.list().map((id) => this.resolve(id));
  }

  /** Providers that are actually usable right now (local providers need a resolved model name too — an isLocal provider with no model configured isn't usable any more than a remote one with no API key is; this must match routeModel()'s own fallback-eligibility filter exactly, or the two will silently disagree about what "configured" means). */
  configuredProviders(): ProviderId[] {
    return this.resolveAll()
      .filter((p) => (p.capabilities.isLocal ? !!p.resolvedModel : !!p.apiKey))
      .map((p) => p.id);
  }

  capabilities(id: ProviderId): ProviderCapabilities {
    return this.resolve(id).capabilities;
  }

  /** Public, client-safe metadata — NEVER includes apiKey. Used by GET /v2/models and legacy compatibility. */
  publicMetadata() {
    return this.resolveAll().map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.resolvedModel,
      capabilities: p.capabilities,
      configured: p.capabilities.isLocal ? !!p.resolvedModel : !!p.apiKey,
      baseUrl: p.capabilities.isLocal ? p.baseUrl : undefined, // only local base URLs are non-sensitive to reveal
    }));
  }
}

export const ProviderRegistry = new ProviderRegistryImpl(REGISTRY_DEFINITIONS);

import type { ProviderId } from '../config/providerRegistry.js';

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}
export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolDef {
  type?: string; // server tools like 'web_search_20250305' carry a type instead of an input_schema
  name: string;
  description?: string;
  input_schema?: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens: number;
  signal?: AbortSignal;
  /**
   * Request the provider ground its answer in a live web search, IF it has
   * a native capability to do so (see ProviderCapabilities.webSearch in
   * providerRegistry.ts). This is a provider-agnostic request-level flag,
   * not a tool the caller has to know provider-specific mechanics for —
   * each adapter translates it into its own native shape (or ignores it,
   * for providers without the capability; routeModel() already refuses to
   * route a webSearch request to a provider lacking it, so in practice an
   * adapter only ever sees this set to true when it can actually honor it).
   */
  webSearch?: boolean;
}

/** One source Gemini's Google Search grounding cited while producing its answer. Raw external data — see GroundingMetadata. */
export interface GroundingCitation {
  uri: string;
  title?: string;
}

/**
 * Grounding/provenance metadata returned alongside a grounded response.
 * NEXUS §11 rule applies to everything in here: this is UNTRUSTED, UNVERIFIED
 * external data the provider retrieved from the live web — it must be
 * surfaced to the caller as citations to check, never treated or displayed
 * as verified fact by NEXUS itself.
 */
export interface GroundingMetadata {
  webSearchQueries?: string[];
  citations: GroundingCitation[];
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'cancelled';

export interface ChatResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: { inputTokens: number; outputTokens: number };
  /** Present only when webSearch was requested AND the provider actually grounded this response — see GroundingMetadata's provenance warning. */
  grounding?: GroundingMetadata;
}

export interface StreamHandlers {
  onToken?: (text: string) => void;
  onToolUseStart?: (block: { id: string; name: string }) => void;
  onToolUseDelta?: (block: { id: string; partialJson: string }) => void;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export interface EmbedResult {
  embeddings: number[][];
  model: string;
}

/** Result of a lightweight reachability probe — no chat/embedding token cost. */
export interface ProviderPingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Streams tokens via handlers AND returns the same final aggregated ChatResponse shape chat() would — mirrors the frontend's own requestStream() contract exactly, so callers never care which path was used. */
  chatStream(req: ChatRequest, handlers: StreamHandlers): Promise<ChatResponse>;
  embed(texts: string[], model?: string): Promise<EmbedResult>;
  readonly supportsEmbeddings: boolean;
  /**
   * Cheap reachability probe (e.g. GET /v1/models) used to derive live
   * READY/DEGRADED/UNAVAILABLE state for GET /v2/providers/health — never
   * spends a completion token. Optional: adapters that can't probe cheaply
   * may omit it, in which case healthRegistry.ts treats "configured" as
   * the best available signal instead of silently claiming a live check
   * happened.
   */
  health?(): Promise<ProviderPingResult>;
}

/** Injectable HTTP transport so adapters are unit-testable without real network access. */
export type FetchLike = typeof fetch;

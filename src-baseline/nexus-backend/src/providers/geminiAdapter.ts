import type {
  ChatRequest,
  ChatResponse,
  ContentBlock,
  ProviderAdapter,
  StreamHandlers,
  EmbedResult,
  FetchLike,
  ChatMessage,
  ToolDef,
  ProviderPingResult,
  GroundingMetadata,
} from './contract.js';
import { Errors } from '../core/errors.js';
import type { ResolvedProvider } from '../config/providerRegistry.js';
import { providerError } from './anthropicAdapter.js';
import { pingEndpoint } from './healthCheck.js';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    const role: GeminiContent['role'] = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      out.push({ role, parts: [{ text: m.content }] });
      continue;
    }
    const parts: GeminiPart[] = [];
    for (const block of m.content as ContentBlock[]) {
      if (block.type === 'text') parts.push({ text: block.text });
      else if (block.type === 'image') parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
      else if (block.type === 'tool_use') parts.push({ functionCall: { name: block.name, args: block.input, id: block.id } });
      else if (block.type === 'tool_result')
        parts.push({ functionResponse: { name: block.tool_use_id, response: { result: block.content }, id: block.tool_use_id } });
    }
    if (parts.length) out.push({ role, parts });
  }
  return out;
}

function toGeminiTools(tools: ToolDef[] | undefined, webSearch: boolean | undefined) {
  const out: unknown[] = [];
  if (tools) {
    const declarations = tools
      .filter((t) => t.input_schema)
      .map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema }));
    if (declarations.length) out.push({ functionDeclarations: declarations });
  }
  // Gemini's native Google Search grounding — a server tool Gemini itself
  // executes and cites, not one of our tools/registry.ts entries. Only
  // added when the caller set ChatRequest.webSearch; routeModel() already
  // guarantees this adapter is never asked for it unless capabilities.webSearch is true.
  if (webSearch) out.push({ google_search: {} });
  return out.length ? out : undefined;
}

interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string };
}
interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
}

/** Translates Gemini's native groundingMetadata shape into NEXUS's provider-agnostic GroundingMetadata — kept out of the response entirely (undefined, not an empty object) when Gemini didn't actually ground this particular answer, so callers can tell "not grounded" apart from "grounded with zero sources". */
function toNexusGrounding(gm: GeminiGroundingMetadata | undefined): GroundingMetadata | undefined {
  if (!gm) return undefined;
  const citations = (gm.groundingChunks ?? [])
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => !!w?.uri)
    .map((w) => ({ uri: w.uri, title: w.title }));
  if (citations.length === 0 && !(gm.webSearchQueries && gm.webSearchQueries.length)) return undefined;
  return { webSearchQueries: gm.webSearchQueries, citations };
}

function finishReasonToStopReason(reason: string | undefined): ChatResponse['stopReason'] {
  if (reason === 'MAX_TOKENS') return 'max_tokens';
  return 'end_turn'; // functionCall presence is what actually signals tool_use — handled by caller, not finishReason
}

export function createGeminiAdapter(cfg: ResolvedProvider, fetchImpl: FetchLike = fetch): ProviderAdapter {
  function apiKeyHeader(): Record<string, string> {
    if (!cfg.apiKey) throw Errors.provider('مفتاح Gemini غير مُعدّ على السيرفر.', false);
    return { 'x-goog-api-key': cfg.apiKey, 'Content-Type': 'application/json' };
  }

  function requestBody(req: ChatRequest) {
    return {
      contents: toGeminiContents(req.messages),
      systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
      tools: toGeminiTools(req.tools, req.webSearch),
      generationConfig: { maxOutputTokens: req.maxTokens },
    };
  }

  function partsToBlocks(parts: GeminiPart[]): ContentBlock[] {
    const content: ContentBlock[] = [];
    const textParts: string[] = [];
    for (const p of parts) {
      if (p.text) textParts.push(p.text);
      else if (p.functionCall)
        content.push({
          type: 'tool_use',
          id: p.functionCall.id || `call_${content.length}`,
          name: p.functionCall.name,
          input: p.functionCall.args || {},
        });
    }
    if (textParts.length) content.unshift({ type: 'text', text: textParts.join('') });
    return content;
  }

  return {
    id: 'gemini',
    supportsEmbeddings: true,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const res = await fetchImpl(`${cfg.baseUrl}/v1beta/models/${req.model}:generateContent`, {
        method: 'POST',
        headers: apiKeyHeader(),
        body: JSON.stringify(requestBody(req)),
        signal: req.signal,
      });
      if (!res.ok) throw await providerError(res, 'gemini');
      const data = (await res.json()) as {
        candidates: Array<{ content: { parts: GeminiPart[] }; finishReason?: string; groundingMetadata?: GeminiGroundingMetadata }>;
        usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
      };
      const candidate = data.candidates?.[0];
      const content = candidate ? partsToBlocks(candidate.content.parts) : [];
      const hasToolUse = content.some((b) => b.type === 'tool_use');
      const grounding = toNexusGrounding(candidate?.groundingMetadata);
      return {
        content,
        stopReason: hasToolUse ? 'tool_use' : finishReasonToStopReason(candidate?.finishReason),
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
        ...(grounding ? { grounding } : {}),
      };
    },

    async chatStream(req: ChatRequest, handlers: StreamHandlers): Promise<ChatResponse> {
      const res = await fetchImpl(`${cfg.baseUrl}/v1beta/models/${req.model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: apiKeyHeader(),
        body: JSON.stringify(requestBody(req)),
        signal: req.signal,
      });
      if (!res.ok) throw await providerError(res, 'gemini');
      if (!res.body) throw Errors.provider('لا يوجد جسم استجابة للبث.', true);

      const textParts: string[] = [];
      const toolBlocks: ContentBlock[] = [];
      let stopReason: ChatResponse['stopReason'] = 'end_turn';
      let inputTokens = 0;
      let outputTokens = 0;
      let toolSeq = 0;
      let groundingMeta: GeminiGroundingMetadata | undefined;

      for await (const chunkText of parseSseDataLines(res.body)) {
        let parsed: {
          candidates?: Array<{ content: { parts: GeminiPart[] }; finishReason?: string; groundingMetadata?: GeminiGroundingMetadata }>;
          usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
        };
        try {
          parsed = JSON.parse(chunkText);
        } catch {
          continue;
        }
        const candidate = parsed.candidates?.[0];
        // groundingMetadata typically arrives on the final chunk once Gemini has finished citing — keep the latest non-empty one seen.
        if (candidate?.groundingMetadata) groundingMeta = candidate.groundingMetadata;
        for (const p of candidate?.content.parts ?? []) {
          if (p.text) {
            textParts.push(p.text);
            handlers.onToken?.(p.text);
          } else if (p.functionCall) {
            const id = p.functionCall.id || `call_${toolSeq++}`;
            toolBlocks.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args || {} });
            handlers.onToolUseStart?.({ id, name: p.functionCall.name });
            handlers.onToolUseDelta?.({ id, partialJson: JSON.stringify(p.functionCall.args || {}) });
          }
        }
        if (candidate?.finishReason) stopReason = toolBlocks.length ? 'tool_use' : finishReasonToStopReason(candidate.finishReason);
        if (parsed.usageMetadata) {
          inputTokens = parsed.usageMetadata.promptTokenCount;
          outputTokens = parsed.usageMetadata.candidatesTokenCount;
        }
      }
      handlers.onUsage?.({ inputTokens, outputTokens });

      const content: ContentBlock[] = [];
      if (textParts.length) content.push({ type: 'text', text: textParts.join('') });
      content.push(...toolBlocks);
      const grounding = toNexusGrounding(groundingMeta);
      return { content, stopReason, usage: { inputTokens, outputTokens }, ...(grounding ? { grounding } : {}) };
    },

    async embed(texts: string[], model?: string): Promise<EmbedResult> {
      const useModel = model || cfg.resolvedEmbeddingModel || 'text-embedding-004';
      const res = await fetchImpl(`${cfg.baseUrl}/v1beta/models/${useModel}:batchEmbedContents`, {
        method: 'POST',
        headers: apiKeyHeader(),
        body: JSON.stringify({
          requests: texts.map((t) => ({ model: `models/${useModel}`, content: { parts: [{ text: t }] } })),
        }),
      });
      if (!res.ok) throw await providerError(res, 'gemini');
      const data = (await res.json()) as { embeddings: Array<{ values: number[] }> };
      return { embeddings: data.embeddings.map((e) => e.values), model: useModel };
    },

    /** GET /v1beta/models — Gemini's model-listing endpoint, zero token cost. */
    async health(): Promise<ProviderPingResult> {
      return pingEndpoint(fetchImpl, `${cfg.baseUrl}/v1beta/models`, apiKeyHeader(), cfg.timeoutMs);
    },
  };
}

async function* parseSseDataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

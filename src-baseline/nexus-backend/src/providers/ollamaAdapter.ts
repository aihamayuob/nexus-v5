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
} from './contract.js';
import { Errors } from '../core/errors.js';
import type { ResolvedProvider } from '../config/providerRegistry.js';
import { providerError } from './anthropicAdapter.js';
import { pingEndpoint } from './healthCheck.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

function toOllamaMessages(req: ChatRequest): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  for (const m of req.messages as ChatMessage[]) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const textParts: string[] = [];
    const images: string[] = [];
    const toolCalls: OllamaMessage['tool_calls'] = [];
    for (const block of m.content as ContentBlock[]) {
      if (block.type === 'text') textParts.push(block.text);
      else if (block.type === 'image') images.push(block.source.data);
      else if (block.type === 'tool_use') toolCalls!.push({ function: { name: block.name, arguments: block.input } });
      else if (block.type === 'tool_result') out.push({ role: 'tool', content: block.content });
    }
    if (textParts.length || images.length || toolCalls!.length) {
      out.push({
        role: m.role,
        content: textParts.join('\n'),
        ...(images.length ? { images } : {}),
        ...(toolCalls!.length ? { tool_calls: toolCalls } : {}),
      });
    }
  }
  return out;
}

function toOllamaTools(tools: ToolDef[] | undefined) {
  if (!tools) return undefined;
  const mapped = tools
    .filter((t) => t.input_schema)
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  return mapped.length ? mapped : undefined;
}

export function createOllamaAdapter(cfg: ResolvedProvider, fetchImpl: FetchLike = fetch): ProviderAdapter {
  function requestBody(req: ChatRequest, stream: boolean) {
    return { model: req.model, messages: toOllamaMessages(req), tools: toOllamaTools(req.tools), stream };
  }

  return {
    id: 'ollama',
    supportsEmbeddings: true,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (!req.model) throw Errors.validation('حدد اسم النموذج المحلي أولاً لأولاما.');
      const res = await fetchImpl(`${cfg.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(req, false)),
        signal: req.signal,
      });
      if (!res.ok) throw await providerError(res, 'ollama');
      const data = (await res.json()) as {
        message: { content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const content: ContentBlock[] = [];
      if (data.message.content) content.push({ type: 'text', text: data.message.content });
      let idx = 0;
      for (const tc of data.message.tool_calls ?? []) {
        content.push({ type: 'tool_use', id: `call_${idx++}`, name: tc.function.name, input: tc.function.arguments || {} });
      }
      return {
        content,
        stopReason: data.message.tool_calls?.length ? 'tool_use' : 'end_turn',
        usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      };
    },

    async chatStream(req: ChatRequest, handlers: StreamHandlers): Promise<ChatResponse> {
      if (!req.model) throw Errors.validation('حدد اسم النموذج المحلي أولاً لأولاما.');
      const res = await fetchImpl(`${cfg.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(req, true)),
        signal: req.signal,
      });
      if (!res.ok) throw await providerError(res, 'ollama');
      if (!res.body) throw Errors.provider('لا يوجد جسم استجابة للبث.', true);

      const textParts: string[] = [];
      const toolBlocks: ContentBlock[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let toolIdx = 0;

      for await (const line of parseNdjson(res.body)) {
        let parsed: {
          message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.message?.content) {
          textParts.push(parsed.message.content);
          handlers.onToken?.(parsed.message.content);
        }
        for (const tc of parsed.message?.tool_calls ?? []) {
          const id = `call_${toolIdx++}`;
          toolBlocks.push({ type: 'tool_use', id, name: tc.function.name, input: tc.function.arguments || {} });
          handlers.onToolUseStart?.({ id, name: tc.function.name });
          handlers.onToolUseDelta?.({ id, partialJson: JSON.stringify(tc.function.arguments || {}) });
        }
        if (parsed.done) {
          inputTokens = parsed.prompt_eval_count ?? 0;
          outputTokens = parsed.eval_count ?? 0;
        }
      }
      handlers.onUsage?.({ inputTokens, outputTokens });

      const content: ContentBlock[] = [];
      if (textParts.length) content.push({ type: 'text', text: textParts.join('') });
      content.push(...toolBlocks);
      return { content, stopReason: toolBlocks.length ? 'tool_use' : 'end_turn', usage: { inputTokens, outputTokens } };
    },

    async embed(texts: string[], model?: string): Promise<EmbedResult> {
      const useModel = model || cfg.resolvedEmbeddingModel || cfg.resolvedModel;
      if (!useModel) throw Errors.validation('حدد اسم نموذج التضمين المحلي لأولاما.');
      const res = await fetchImpl(`${cfg.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: useModel, input: texts }),
      });
      if (!res.ok) throw await providerError(res, 'ollama');
      const data = (await res.json()) as { embeddings: number[][] };
      return { embeddings: data.embeddings, model: useModel };
    },

    /** GET /api/tags — Ollama's local model listing endpoint; also the standard way to check the daemon is even running. */
    async health(): Promise<ProviderPingResult> {
      return pingEndpoint(fetchImpl, `${cfg.baseUrl}/api/tags`, {}, cfg.timeoutMs);
    },
  };
}

async function* parseNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
        if (line) yield line;
      }
    }
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.releaseLock();
  }
}

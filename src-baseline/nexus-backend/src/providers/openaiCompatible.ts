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
import type { ProviderId, ResolvedProvider } from '../config/providerRegistry.js';
import { providerError } from './anthropicAdapter.js';
import { pingEndpoint } from './healthCheck.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

function toOpenAIMessages(req: ChatRequest): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });

  for (const m of req.messages as ChatMessage[]) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    // Anthropic-shaped content blocks -> OpenAI shape. tool_result blocks
    // become their own separate {role:'tool'} messages (OpenAI has no
    // equivalent of embedding a tool result inside a user turn's content
    // array), and tool_use blocks on an assistant turn become tool_calls.
    const textParts: string[] = [];
    const imageParts: Array<{ type: string; image_url: { url: string } }> = [];
    const toolCalls: OpenAIMessage['tool_calls'] = [];
    const toolResultMessages: OpenAIMessage[] = [];

    for (const block of m.content as ContentBlock[]) {
      if (block.type === 'text') textParts.push(block.text);
      else if (block.type === 'image')
        imageParts.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } });
      else if (block.type === 'tool_use')
        toolCalls!.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } });
      else if (block.type === 'tool_result')
        toolResultMessages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
    }

    if (textParts.length || imageParts.length) {
      const content = imageParts.length
        ? [...textParts.map((t) => ({ type: 'text', text: t })), ...imageParts]
        : textParts.join('\n');
      out.push({ role: m.role, content, ...(toolCalls!.length ? { tool_calls: toolCalls } : {}) });
    } else if (toolCalls!.length) {
      out.push({ role: m.role, content: null, tool_calls: toolCalls });
    }
    out.push(...toolResultMessages);
  }
  return out;
}

function toOpenAITools(tools: ToolDef[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const mapped = tools
    .filter((t) => t.input_schema) // server-only tools like web_search_20250305 have no client-callable schema to translate
    .map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  return mapped.length ? mapped : undefined;
}

function finishReasonToStopReason(reason: string | null | undefined): ChatResponse['stopReason'] {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
    default:
      return 'end_turn';
  }
}

export interface OpenAICompatibleOptions {
  /** Some OpenAI-compatible local servers (LM Studio) accept requests with no Authorization header at all rather than a dummy Bearer token — set false to omit it entirely. */
  sendAuthHeader?: boolean;
}

export function createOpenAICompatibleAdapter(
  id: ProviderId,
  cfg: ResolvedProvider,
  fetchImpl: FetchLike = fetch,
  opts: OpenAICompatibleOptions = {}
): ProviderAdapter {
  const sendAuth = opts.sendAuthHeader ?? true;

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sendAuth) {
      if (cfg.capabilities.requiresApiKey && !cfg.apiKey) throw Errors.provider(`مفتاح ${id} غير مُعدّ على السيرفر.`, false);
      if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
    }
    return h;
  }

  function requestBody(req: ChatRequest, stream: boolean) {
    return {
      model: req.model,
      messages: toOpenAIMessages(req),
      tools: toOpenAITools(req.tools),
      max_tokens: req.maxTokens,
      stream,
    };
  }

  return {
    id,
    supportsEmbeddings: cfg.capabilities.embeddings,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const res = await fetchImpl(`${cfg.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(requestBody(req, false)),
        signal: req.signal,
      });
      if (!res.ok) throw await providerError(res, id);
      const data = (await res.json()) as {
        choices: Array<{
          message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
          finish_reason: string;
        }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const choice = data.choices[0];
      const content: ContentBlock[] = [];
      if (choice?.message.content) content.push({ type: 'text', text: choice.message.content });
      for (const tc of choice?.message.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments || '{}');
        } catch {
          /* malformed args from the model — leave empty, matches Anthropic adapter's same fallback */
        }
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      return {
        content,
        stopReason: finishReasonToStopReason(choice?.finish_reason),
        usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      };
    },

    async chatStream(req: ChatRequest, handlers: StreamHandlers): Promise<ChatResponse> {
      const res = await fetchImpl(`${cfg.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(requestBody(req, true)),
        signal: req.signal,
      });
      if (!res.ok) throw await providerError(res, id);
      if (!res.body) throw Errors.provider('لا يوجد جسم استجابة للبث.', true);

      const textParts: string[] = [];
      // OpenAI streams tool_calls by array index, not a stable id, until
      // the final chunk — accumulate by index, then resolve real ids at the end.
      const toolByIndex = new Map<number, { id: string; name: string; args: string }>();
      let stopReason: ChatResponse['stopReason'] = 'end_turn';
      let inputTokens = 0;
      let outputTokens = 0;
      const startedIndices = new Set<number>();

      for await (const chunk of parseOpenAISSE(res.body)) {
        if (chunk === '[DONE]') break;
        let parsed: {
          choices?: Array<{
            delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        try {
          parsed = JSON.parse(chunk);
        } catch {
          continue;
        }
        const choice = parsed.choices?.[0];
        if (choice?.delta?.content) {
          textParts.push(choice.delta.content);
          handlers.onToken?.(choice.delta.content);
        }
        for (const tc of choice?.delta?.tool_calls ?? []) {
          let entry = toolByIndex.get(tc.index);
          if (!entry) {
            entry = { id: tc.id || `call_${tc.index}`, name: tc.function?.name || '', args: '' };
            toolByIndex.set(tc.index, entry);
            if (!startedIndices.has(tc.index)) {
              startedIndices.add(tc.index);
              handlers.onToolUseStart?.({ id: entry.id, name: entry.name });
            }
          }
          if (tc.function?.arguments) {
            entry.args += tc.function.arguments;
            handlers.onToolUseDelta?.({ id: entry.id, partialJson: tc.function.arguments });
          }
        }
        if (choice?.finish_reason) stopReason = finishReasonToStopReason(choice.finish_reason);
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens;
          outputTokens = parsed.usage.completion_tokens;
        }
      }
      handlers.onUsage?.({ inputTokens, outputTokens });

      const content: ContentBlock[] = [];
      if (textParts.length) content.push({ type: 'text', text: textParts.join('') });
      for (const { id: toolId, name, args } of toolByIndex.values()) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(args || '{}');
        } catch {
          /* malformed — leave empty */
        }
        content.push({ type: 'tool_use', id: toolId, name, input });
      }
      return { content, stopReason, usage: { inputTokens, outputTokens } };
    },

    async embed(texts: string[], model?: string): Promise<EmbedResult> {
      if (!cfg.capabilities.embeddings) throw Errors.provider(`${id} لا يدعم endpoint تضمين.`, false);
      const useModel = model || cfg.resolvedEmbeddingModel || cfg.resolvedModel;
      const res = await fetchImpl(`${cfg.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ input: texts, model: useModel }),
      });
      if (!res.ok) throw await providerError(res, id);
      const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      return { embeddings: sorted.map((d) => d.embedding), model: useModel };
    },

    /** GET /v1/models — the OpenAI-compatible spec's standard discovery endpoint, so this one implementation covers openai, deepseek AND lmstudio. Zero token cost. */
    async health(): Promise<ProviderPingResult> {
      return pingEndpoint(fetchImpl, `${cfg.baseUrl}/v1/models`, headers(), cfg.timeoutMs);
    },
  };
}

async function* parseOpenAISSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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

import type { ChatRequest, ChatResponse, ProviderAdapter, StreamHandlers, ContentBlock, EmbedResult, FetchLike, ProviderPingResult } from './contract.js';
import { Errors } from '../core/errors.js';
import type { ResolvedProvider } from '../config/providerRegistry.js';
import { pingEndpoint } from './healthCheck.js';

const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic' as const;
  readonly supportsEmbeddings = false;

  constructor(private cfg: ResolvedProvider, private fetchImpl: FetchLike = fetch) {}

  private headers(): Record<string, string> {
    if (!this.cfg.apiKey) throw Errors.provider('مفتاح Anthropic غير مُعدّ على السيرفر.', false);
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  private body(req: ChatRequest, stream: boolean) {
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      stream,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(req, false)),
      signal: req.signal,
    });
    if (!res.ok) throw await providerError(res, 'anthropic');
    const data = (await res.json()) as {
      content: ContentBlock[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    return {
      content: data.content,
      stopReason: (data.stop_reason as ChatResponse['stopReason']) || 'end_turn',
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
    };
  }

  async chatStream(req: ChatRequest, handlers: StreamHandlers): Promise<ChatResponse> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(req, true)),
      signal: req.signal,
    });
    if (!res.ok) throw await providerError(res, 'anthropic');
    if (!res.body) throw Errors.provider('لا يوجد جسم استجابة للبث.', true);

    const textParts: string[] = [];
    const toolBlocks = new Map<string, { id: string; name: string; partialJson: string }>();
    const toolOrder: string[] = [];
    let stopReason: ChatResponse['stopReason'] = 'end_turn';
    let inputTokens = 0;
    let outputTokens = 0;
    // index -> block id, since Anthropic's stream references blocks by
    // content_block index, not by id, in the delta events.
    const indexToId = new Map<number, string>();

    for await (const evt of parseAnthropicSSE(res.body)) {
      switch (evt.type) {
        case 'message_start':
          inputTokens = evt.message?.usage?.input_tokens ?? 0;
          break;
        case 'content_block_start':
          if (evt.content_block?.type === 'tool_use') {
            const id = evt.content_block.id!;
            indexToId.set(evt.index!, id);
            toolBlocks.set(id, { id, name: evt.content_block.name!, partialJson: '' });
            toolOrder.push(id);
            handlers.onToolUseStart?.({ id, name: evt.content_block.name! });
          }
          break;
        case 'content_block_delta':
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            textParts.push(evt.delta.text);
            handlers.onToken?.(evt.delta.text);
          } else if (evt.delta?.type === 'input_json_delta' && evt.delta.partial_json != null) {
            const id = indexToId.get(evt.index!);
            if (id) {
              const t = toolBlocks.get(id)!;
              t.partialJson += evt.delta.partial_json;
              handlers.onToolUseDelta?.({ id, partialJson: evt.delta.partial_json });
            }
          }
          break;
        case 'message_delta':
          if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason as ChatResponse['stopReason'];
          if (evt.usage?.output_tokens != null) outputTokens = evt.usage.output_tokens;
          break;
        case 'error':
          throw Errors.provider(evt.error?.message || 'خطأ بث من Anthropic', true);
      }
    }
    handlers.onUsage?.({ inputTokens, outputTokens });

    const content: ContentBlock[] = [];
    if (textParts.length) content.push({ type: 'text', text: textParts.join('') });
    for (const id of toolOrder) {
      const t = toolBlocks.get(id)!;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(t.partialJson || '{}');
      } catch {
        /* malformed tool input — leave empty, same fallback the frontend already uses */
      }
      content.push({ type: 'tool_use', id: t.id, name: t.name, input });
    }
    return { content, stopReason, usage: { inputTokens, outputTokens } };
  }

  async embed(): Promise<EmbedResult> {
    throw Errors.provider('Anthropic لا يوفر endpoint تضمين (embeddings).', false);
  }

  /** GET /v1/models — same auth as chat(), zero token cost, used only for live READY/DEGRADED/UNAVAILABLE state. */
  async health(): Promise<ProviderPingResult> {
    return pingEndpoint(this.fetchImpl, `${this.cfg.baseUrl}/v1/models`, this.headers(), this.cfg.timeoutMs);
  }
}

async function providerError(res: Response, provider: string) {
  const text = await res.text().catch(() => '');
  let message = `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text);
    message = parsed?.error?.message || parsed?.message || message;
  } catch {
    if (text) message = text.slice(0, 300);
  }
  const retryable = res.status === 429 || res.status >= 500;
  return Errors.provider(`[${provider}] ${message}`, retryable, { status: res.status });
}

interface AnthropicSSEEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens: number } };
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens: number };
  error?: { message: string };
}

async function* parseAnthropicSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<AnthropicSSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          yield JSON.parse(dataLine.slice(5).trim());
        } catch {
          /* skip malformed frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export { providerError, parseAnthropicSSE };

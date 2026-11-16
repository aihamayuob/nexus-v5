import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { runChatCompletion } from '../../orchestrator/chatService.js';
import { claimTask, getAbortSignalFor, releaseTask, cancelTask } from '../../orchestrator/taskManager.js';
import { TaskObservability } from '../../observability/recorder.js';
import { getStreamRegistry } from '../../orchestrator/streamRegistry.js';
import { SseWriter, startKeepAlive } from '../../streaming/sse.js';
import { getRepos } from '../../persistence/repos.js';
import { ProviderRegistry, type ProviderId } from '../../config/providerRegistry.js';
import { idempotencyKeyFor } from '../../core/ids.js';
import { Errors, normalizeError } from '../../core/errors.js';
import type { ChatMessage, ToolDef } from '../../providers/contract.js';
import { logger } from '../../core/logger.js';

interface LegacyChatRequestBody {
  provider: string;
  model?: string;
  max_tokens: number;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  stream?: boolean;
  /** Ground this response in live Google Search results — currently honored only when provider:'gemini' (see ProviderCapabilities.webSearch); any other provider gets a capability_denied error rather than a silent no-op. */
  web_search?: boolean;
}

function assertValidBody(body: unknown): asserts body is LegacyChatRequestBody {
  const b = body as Partial<LegacyChatRequestBody>;
  if (!b || typeof b !== 'object') throw Errors.validation('جسم الطلب مفقود.');
  if (!b.provider || typeof b.provider !== 'string') throw Errors.validation('الحقل "provider" مطلوب.');
  if (!ProviderRegistry.has(b.provider)) throw Errors.validation(`مزود غير معروف: ${b.provider}`);
  if (!Array.isArray(b.messages) || b.messages.length === 0) throw Errors.validation('الحقل "messages" مطلوب ويجب أن يكون مصفوفة غير فارغة.');
  if (typeof b.max_tokens !== 'number' || b.max_tokens <= 0) throw Errors.validation('الحقل "max_tokens" مطلوب.');
}

export function registerChatRoutes(router: Router) {
  router.post('/api/chat', async (ctx: RouteContext) => {
    const body = await readJsonBody(ctx.req);
    assertValidBody(body);
    const providerId = body.provider as ProviderId;

    if (body.stream) {
      await handleStreamingChat(ctx, body, providerId);
    } else {
      await handleNonStreamingChat(ctx, body, providerId);
    }
  });

  router.get('/api/chat/resume/:requestId', async (ctx: RouteContext) => {
    const taskId = ctx.params.requestId!;
    const afterId = Number(ctx.query.get('afterId') || '0') || 0;
    const task = getRepos().tasks.get(taskId);
    if (!task) throw Errors.notFound('لا توجد محادثة بهذا المعرّف.');

    const writer = new SseWriter(ctx.res);
    const registry = getStreamRegistry();
    registry.replay(taskId, afterId, writer);
    if (registry.isDone(taskId) || task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
      writer.end();
      return;
    }
    const keepAlive = startKeepAlive(writer);
    registry.attach(taskId, writer);
    ctx.req.on('close', () => {
      clearInterval(keepAlive);
      registry.detach(taskId, writer);
    });
  });
}

async function handleNonStreamingChat(ctx: RouteContext, body: LegacyChatRequestBody, providerId: ProviderId) {
  const idemKey = idempotencyKeyFor(ctx.req.headers['idempotency-key'] as string | undefined, body);
  const { taskId } = claimTask('chat', idemKey, ctx.gw, { provider: providerId, model: body.model, promptLen: JSON.stringify(body.messages).length });
  const signal = getAbortSignalFor(taskId);
  const obs = new TaskObservability(taskId, 'chat');
  getRepos().tasks.updateStatus(taskId, 'running');

  const abortOnClose = () => {
    if (!ctx.res.writableEnded) {
      cancelTask(taskId); // client disconnected before we responded — safe cancellation, propagates via the AbortSignal already threaded into runChatCompletion
    }
  };
  ctx.req.on('close', abortOnClose);

  try {
    const result = await runChatCompletion(
      {
        provider: providerId,
        model: body.model,
        system: body.system,
        messages: body.messages,
        tools: body.tools,
        maxTokens: body.max_tokens,
        signal,
        route: 'chat',
        taskId,
        webSearch: body.web_search,
      },
      ctx.gw,
      obs
    );
    getRepos().tasks.recordServed(taskId, result.providerUsed, result.modelUsed);
    getRepos().tasks.updateStatus(taskId, 'done');
    obs.finish('ok');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(
      JSON.stringify({
        content: result.content,
        stop_reason: result.stopReason,
        usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
        // Present only when webSearch was requested and Gemini actually grounded the answer — raw external citations, NOT verified fact (see GroundingMetadata).
        grounding: result.grounding,
      })
    );
  } catch (e) {
    const err = normalizeError(e);
    getRepos().tasks.updateStatus(taskId, err.code === 'cancelled' ? 'cancelled' : 'failed', err.message);
    obs.recordFailure(err.message);
    obs.finish(err.code === 'cancelled' ? 'cancelled' : 'failed');
    throw err;
  } finally {
    releaseTask(taskId);
    ctx.req.off('close', abortOnClose);
  }
}

async function handleStreamingChat(ctx: RouteContext, body: LegacyChatRequestBody, providerId: ProviderId) {
  const idemKey = idempotencyKeyFor(ctx.req.headers['idempotency-key'] as string | undefined, body);
  const { taskId } = claimTask('chat', idemKey, ctx.gw, { provider: providerId, model: body.model, promptLen: JSON.stringify(body.messages).length });
  const signal = getAbortSignalFor(taskId);
  const obs = new TaskObservability(taskId, 'chat');
  const registry = getStreamRegistry();
  getRepos().tasks.updateStatus(taskId, 'running');

  const writer = new SseWriter(ctx.res);
  registry.attach(taskId, writer);
  const keepAlive = startKeepAlive(writer);
  registry.emit(taskId, 'start', { requestId: taskId });

  ctx.req.on('close', () => {
    if (!writer.isClosed) {
      // Real client disconnect before completion — cancel the underlying work too.
      cancelTask(taskId);
      logger.info('Client disconnected mid-stream, cancelled task', { taskId });
    }
  });

  try {
    const result = await runChatCompletion(
      {
        provider: providerId,
        model: body.model,
        system: body.system,
        messages: body.messages,
        tools: body.tools,
        maxTokens: body.max_tokens,
        signal,
        route: 'chat',
        taskId,
        webSearch: body.web_search,
      },
      ctx.gw,
      obs,
      {
        onToken: (text) => registry.emit(taskId, 'token', { text }),
        onToolUseStart: (b) => registry.emit(taskId, 'tool_use_start', { id: b.id, name: b.name }),
        onToolUseDelta: (b) => registry.emit(taskId, 'tool_use_delta', { id: b.id, partialJson: b.partialJson }),
        onUsage: (u) => registry.emit(taskId, 'usage', { inputTokens: u.inputTokens, outputTokens: u.outputTokens }),
      }
    );
    registry.emit(taskId, 'done', { stopReason: result.stopReason, grounding: result.grounding });
    getRepos().tasks.recordServed(taskId, result.providerUsed, result.modelUsed);
    getRepos().tasks.updateStatus(taskId, 'done');
    obs.finish('ok');
  } catch (e) {
    const err = normalizeError(e);
    registry.emit(taskId, 'error', { message: err.message });
    getRepos().tasks.updateStatus(taskId, err.code === 'cancelled' ? 'cancelled' : 'failed', err.message);
    obs.recordFailure(err.message);
    obs.finish(err.code === 'cancelled' ? 'cancelled' : 'failed');
  } finally {
    clearInterval(keepAlive);
    registry.markDone(taskId);
    registry.detach(taskId, writer);
    writer.end();
    releaseTask(taskId);
  }
}

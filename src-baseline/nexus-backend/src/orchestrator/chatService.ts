import type { ChatRequest, ChatResponse, StreamHandlers, ToolDef, ContentBlock } from '../providers/contract.js';
import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import { routeModel } from '../providers/modelRouter.js';
import { selectProviderForMode, type RoutingMode } from '../providers/routingModes.js';
import { getProviderAdapter } from '../providers/index.js';
import { resilientCall } from '../providers/resilientCall.js';
import { executeToolCalls } from '../tools/pipeline.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { PermissionModel } from '../capability/permissionModel.js';
import { analyzeIntent } from '../intent/intentEngine.js';
import type { TaskObservability } from '../observability/recorder.js';
import { Errors, normalizeError } from '../core/errors.js';
import { getRepos } from '../persistence/repos.js';
import { estimateCostUsd } from './budget.js';
import { isPrivacyRestrictedMode, markTaskRestricted } from '../security/cloudEgressGuard.js';

const MAX_TOOL_LOOP_ITERATIONS = 4;

export interface ChatServiceRequest {
  /** Required unless `mode` is set. The two are alternative entry points into the same routing pipeline (see providers/routingModes.ts): name a provider directly, or ask the router to pick one for an outcome (cheapest/fastest/...). */
  provider?: ProviderId;
  /** Phase 2 §3 autonomous routing mode. When set, `provider` is used only as USER_SELECTED's required target — every other mode ignores it and picks its own provider. Omit both `mode` and `provider` is a validation error. */
  mode?: RoutingMode;
  model?: string; // if omitted, ModelRouter resolves the registry default for `provider`
  system?: string;
  messages: ChatRequest['messages'];
  tools?: ToolDef[];
  maxTokens: number;
  signal?: AbortSignal;
  /** Ground this response in a live web search, if `provider` supports it natively (currently Gemini only — see ProviderCapabilities.webSearch). routeModel() rejects the request up front with capability_denied for a provider that can't. */
  webSearch?: boolean;
  /** "Task type" dimension for AdaptiveModelRouter evidence — e.g. 'chat', 'runtime_plan', or a DAG node label. Defaults to 'chat'. */
  route?: string;
  /** For provider-call-log attribution back to the owning task, when known. */
  taskId?: string;
  /** Overrides MAX_TOOL_LOOP_ITERATIONS for this call only — e.g. agentRunner.ts passes an agent's own AgentDefinition.policies.maxToolCalls here, so a stricter agent-level policy is actually enforced rather than just declared. Omit to use the module default. */
  maxToolIterations?: number;
}

export interface ChatServiceResult extends ChatResponse {
  providerUsed: ProviderId;
  modelUsed: string;
}

/**
 * Runs one full completion, including the tool-use loop, against
 * whichever provider/model ModelRouter resolves — with automatic retry
 * and provider fallback via resilientCall. Feeds observability as it
 * goes. `handlers`, if provided, receives live token/tool-use/usage
 * events (streaming); omit it for a plain non-streaming call.
 */
export async function runChatCompletion(
  req: ChatServiceRequest,
  ctx: GatewayContext,
  obs: TaskObservability,
  handlers?: StreamHandlers
): Promise<ChatServiceResult> {
  const needsTools = !!req.tools && req.tools.length > 0;
  const needsImages = req.messages.some(
    (m) => Array.isArray(m.content) && (m.content as ContentBlock[]).some((b) => b.type === 'image')
  );
  const intent = analyzeIntent(typeof req.messages.at(-1)?.content === 'string' ? (req.messages.at(-1)!.content as string) : '', {
    needsTools,
    needsImages,
  });
  intent.route = req.route ?? 'chat';
  intent.needsWebSearch = req.webSearch;

  if (!req.provider && !req.mode) {
    throw Errors.validation('يجب تحديد إمّا provider أو mode.');
  }
  PermissionModel.assertBudgetAllowed();

  // GAP-1B: record BEFORE routing/sending that this task is privacy-restricted, so later INTERNAL cloud calls for the same task (verification etc.)
  // are refused by security/cloudEgressGuard.ts. Marked even if the call then fails: the content was already meant to stay local.
  if (req.taskId && isPrivacyRestrictedMode(req.mode)) markTaskRestricted(req.taskId, 'task_privacy_mode');

  const routed = req.mode
    ? await selectProviderForMode({ mode: req.mode, intent, userSelectedProvider: req.provider })
    : routeModel(req.provider!, intent);

  if (req.taskId && routed.cloudFallbackBlocked) markTaskRestricted(req.taskId, 'task_local_provider');

  if (needsImages) PermissionModel.assertImageAllowed(routed.provider, ctx);

  const model = req.model || routed.model;

  let messages = [...req.messages];
  let finalResponse: ChatResponse | null = null;
  let providerUsed: ProviderId = routed.provider;
  let modelServed = model; // F-04: the model string actually SENT to the provider that served (differs from `model` after a fallback)
  const modelSentTo = new Map<ProviderId, string>();

  for (let iteration = 0; iteration < (req.maxToolIterations ?? MAX_TOOL_LOOP_ITERATIONS); iteration++) {
    let lastAttemptUsage: { inputTokens: number; outputTokens: number } | null = null;
    const attempts = [routed.provider, ...routed.fallbacks].map((p) => ({
      label: p,
      run: async () => {
        const adapter = getProviderAdapter(p);
        // Fallback providers use THEIR OWN registry model, never the primary's model string — different vendors don't share model namespaces.
        // (F-04, 2026-11-16: this used to read `providerModel || model`, where providerModel was undefined for a fallback, so the PRIMARY's model
        // string was silently re-sent to the fallback provider, contradicting this very comment.)
        const attemptModel = p === routed.provider ? model : ProviderRegistry.resolve(p).resolvedModel;
        modelSentTo.set(p, attemptModel);
        const runReq: ChatRequest = {
          model: attemptModel,
          system: req.system,
          messages,
          tools: req.tools,
          maxTokens: req.maxTokens,
          signal: req.signal,
          // Safe to pass unconditionally: when needsWebSearch was true, routeModel()
          // already filtered `routed.fallbacks` down to only webSearch-capable
          // providers, so every attempt here (primary or fallback) can honor it.
          webSearch: req.webSearch,
        };
        const response = handlers ? await adapter.chatStream(runReq, handlers) : await adapter.chat(runReq);
        providerUsed = p;
        modelServed = attemptModel;
        lastAttemptUsage = response.usage;
        return response;
      },
    }));

    const response = await resilientCall({
      attempts,
      signal: req.signal,
      onRetry: () => obs.recordRetry(),
      onAttemptResult: (result) => {
        // Evidence for AdaptiveModelRouter (src/providers/adaptiveModelRouter.ts)
        // — every individual attempt, success or failure, latency included.
        const costUsd = result.success && lastAttemptUsage ? estimateCostUsd(result.label, lastAttemptUsage.inputTokens, lastAttemptUsage.outputTokens) : 0;
        getRepos().providerCallLog.record({
          taskId: req.taskId ?? null,
          provider: result.label,
          model: result.label === providerUsed ? (modelSentTo.get(result.label) ?? model) : null,
          route: req.route ?? 'chat',
          success: result.success,
          latencyMs: result.latencyMs,
          costUsd,
          errorMessage: result.error?.slice(0, 200) ?? null,
        });
      },
    }).catch((e: unknown) => {
      // GAP-1 (D1 rule 5): the primary was LOCAL and cloud providers were excluded from its fallback chain (modelRouter.ts), so every attempt
      // above ran locally. Report that as a clear, testable error — never as a generic provider failure, and never by re-sending to a cloud provider.
      const err = normalizeError(e);
      if (routed.cloudFallbackBlocked && err.code !== 'cancelled') {
        throw Errors.localProviderUnavailable(
          `تعذّر تنفيذ الطلب على المزود المحلي "${routed.provider}" ولم يُرسَل أي محتوى إلى مزود سحابي (الاحتياط السحابي معطّل حمايةً للخصوصية).`,
          { localProvider: routed.provider, cloudFallback: 'blocked', cause: err.message }
        );
      }
      throw e;
    });

    obs.recordModelCall(providerUsed, modelServed, response.usage.inputTokens, response.usage.outputTokens);

    if (response.stopReason !== 'tool_use') {
      finalResponse = response;
      break;
    }

    const toolUseBlocks = response.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      finalResponse = response;
      break;
    }
    for (const b of toolUseBlocks) obs.recordTool(b.name);

    messages = [...messages, { role: 'assistant', content: response.content }];
    const results = await executeToolCalls(
      toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
      providerUsed,
      ctx,
      { taskId: req.taskId ?? null } // VEL: ties effectful tool actions to the owning task (no-op for pre-VEL tools)
    );
    messages = [
      ...messages,
      {
        role: 'user',
        content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content })),
      },
    ];
  }

  if (!finalResponse) throw Errors.internal('تجاوزت المحادثة الحد الأقصى لحلقات استدعاء الأدوات.');

  return { ...finalResponse, providerUsed, modelUsed: modelServed };
}

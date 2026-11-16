import { AgentRegistry } from './agentRegistry.js';
import type { AgentDefinition, AgentExecutionContext, AgentResult, AgentRuntimeState } from './agentTypes.js';
import { selectProviderForMode } from '../providers/routingModes.js';
import { runChatCompletion } from '../orchestrator/chatService.js';
import { TaskObservability } from '../observability/recorder.js';
import { getToolRegistry } from '../tools/registry.js';
import type { ToolDef } from '../providers/contract.js';
import { getRepos } from '../persistence/repos.js';
import { normalizeError, Errors } from '../core/errors.js';
import { getActiveSystemPrompt } from '../evolution/agentGenome.js';

/**
 * Resolves an agent's declared tool NAMES (agentTypes.ts's
 * AgentDefinition.tools — a list of tools/registry.ts tool names, never
 * trusted blindly) into real ToolDef objects the provider adapter can
 * actually see, applying constraints.allowedToolsOverride (deny-by-default
 * allowlist, if set) and constraints.deniedTools on top. A name that
 * isn't in the tool registry (typo, or a tool removed after an agent was
 * defined) is silently dropped rather than thrown — an agent should
 * degrade to fewer tools, not fail entirely, for a config drift issue.
 * Returns undefined (not []) when the agent ends up with no tools, so
 * chatService.ts's `needsTools` check behaves exactly as it does for an
 * agent that never requested tools at all.
 */
function resolveAgentTools(def: AgentDefinition): ToolDef[] | undefined {
  if (!def.tools.length) return undefined;
  const denied = new Set(def.constraints.deniedTools ?? []);
  const allowList = def.constraints.allowedToolsOverride;
  const candidateNames = allowList && allowList.length ? def.tools.filter((t) => allowList.includes(t)) : def.tools;
  const registry = getToolRegistry();
  const defs = candidateNames
    .filter((name) => !denied.has(name))
    .map((name) => registry.get(name)?.def)
    .filter((d): d is ToolDef => !!d);
  return defs.length ? defs : undefined;
}

/**
 * Runs one agent turn: resolve the agent's static definition -> select a
 * provider/model via its declared RoutingMode (NEVER a hardcoded provider
 * — Phase 2 §D) -> resolve its declared tools (Phase 3 §Sandbox closes
 * the "no agent tool loop" gap from Slice 2 — see resolveAgentTools()
 * above) -> call the SAME runChatCompletion() every other path in this
 * codebase uses, which already has a real, tested multi-turn tool loop
 * (chatService.ts) -> record failure history on error. This is the
 * "Agent Selection + Model Selection + Tool Selection + Execution" slice
 * of the Autonomous Core pipeline (autonomousCore.ts), factored out so
 * it's reusable as a DAG node's runNode() AND independently testable.
 */
export async function runAgentTask(agentId: string, ctx: AgentExecutionContext): Promise<AgentResult> {
  // Phase 3 Slice 13 (Warden ISOLATE) — enforced as the VERY FIRST line of
  // this function, before model selection, before any provider/tool work,
  // before even AgentRegistry.get(). Reads WardenIsolationRepo directly
  // (never imports warden.ts — see that repo's header comment for the
  // real circular-import reason). This is a real boundary: an agent
  // isolated via POST /v2/warden/agents/:agentId/isolate cannot run again
  // through ANY caller of runAgentTask — direct Agent Runtime DAG nodes,
  // Council (cross_exam/situation_room), or Dynamic Swarm all funnel
  // through this exact function.
  if (getRepos().wardenIsolation.isIsolated(agentId)) {
    throw Errors.capabilityDenied(`الوكيل "${agentId}" معزول (ISOLATED) بواسطة Warden — لا يمكن تنفيذ أي مهمة جديدة به حتى تتم إعادة تفعيله عبر Warden.deisolateAgent().`);
  }
  const def = AgentRegistry.get(agentId); // throws a clear error for an unknown agent id — never silently falls back
  // Controlled Agent Evolution ("Digital Genome") — the ONE runtime read
  // that can make a human-approved system-prompt mutation actually govern
  // real behavior. Falls back to the agent's static, built-in prompt
  // whenever there is no approved override, which is the overwhelmingly
  // common case for every agent that has never been through the
  // evolution pipeline at all — see evolution/agentGenome.ts's header
  // comment for the full versioned/evaluated/security-checked/approved/
  // rollbackable contract this single line depends on.
  const basePrompt = getActiveSystemPrompt(agentId) ?? def.systemPrompt;
  // G8.2-closure: a genome REPLACES the base prompt wholesale, so any policy that must survive it is appended here, at request-build time, after that
  // choice — never stored inside the replaceable prompt. Only agents that declare `fixedPolicy` are affected; all others send `basePrompt` unchanged.
  const systemPrompt = def.fixedPolicy ? `${basePrompt}\n\n${def.fixedPolicy}` : basePrompt;
  const state: AgentRuntimeState = { status: 'selecting_model', attempt: 1 };
  const startedAt = Date.now();

  const upstreamEntries = Object.entries(ctx.upstreamOutputs);
  let userMessage = ctx.taskDescription;
  if (upstreamEntries.length) {
    userMessage += '\n\nنتائج مهام سابقة ذات صلة:\n' + upstreamEntries.map(([id, out]) => `[${id}]: ${out}`).join('\n\n');
  }

  try {
    const routed = await selectProviderForMode({ mode: def.models });
    state.status = 'running';
    state.providerUsed = routed.provider;
    state.modelUsed = routed.model;

    const obs = new TaskObservability(ctx.missionId ?? `agent_${agentId}`, 'runtime_plan');
    const tools = resolveAgentTools(def);
    const result = await runChatCompletion(
      {
        mode: def.models,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        // Agent policy caps the request — never lets an agent's declared
        // maxTokens be silently exceeded by whatever the caller passes.
        maxTokens: def.policies.maxTokens,
        signal: ctx.signal,
        route: 'runtime_plan',
        taskId: ctx.missionId ?? `agent_${agentId}`,
        tools,
        // Enforces the agent's OWN declared cap (agentRegistry.ts's
        // DEFAULT_POLICIES.maxToolCalls=3 for every built-in agent today)
        // instead of chatService.ts's generic module-wide default — a
        // real enforcement of a field that previously existed in the
        // type but was never actually read anywhere.
        maxToolIterations: def.policies.maxToolCalls,
      },
      ctx.gwCtx,
      obs
    );

    const textBlock = result.content.find((b) => b.type === 'text');
    state.status = 'done';
    // Phase 3 §Learning: real evidence for AgentRegistry's evidence-aware
    // selection scoring (see agentRegistry.ts's computeAgentScore()) —
    // mirrors chatService.ts's providerCallLog.record() call exactly, one
    // level up (per-agent instead of per-provider-attempt).
    getRepos().agentCallLog.record({ agentId, success: true, latencyMs: Date.now() - startedAt });
    return {
      output: textBlock && textBlock.type === 'text' ? textBlock.text : '',
      providerUsed: routed.provider,
      modelUsed: result.content.length ? routed.model : routed.model,
      toolsUsed: obs.toolsUsedSoFar(),
      usage: result.usage,
    };
  } catch (e) {
    state.status = 'failed';
    const err = normalizeError(e);
    getRepos().agentFailures.record({
      agentId,
      missionId: ctx.missionId,
      taskNodeId: ctx.taskNodeId,
      provider: state.providerUsed ?? null,
      errorMessage: err.message,
    });
    // Same real evidence log as the success path above — a failed call is
    // evidence too, not just a detailed failure record for humans to read.
    getRepos().agentCallLog.record({ agentId, success: false, latencyMs: Date.now() - startedAt });
    throw e;
  }
}

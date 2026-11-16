import type { RoutingMode } from '../providers/routingModes.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import type { AgentFailureRecord } from '../persistence/repositories/agentFailureRepo.js';

/**
 * Static agent DEFINITION — config, not runtime state (Phase 2 §B requires
 * these four kept separate; see AgentExecutionContext/AgentRuntimeState/
 * AgentResult below). Deliberately provider-agnostic: `models` names a
 * ROUTING MODE (see providers/routingModes.ts), never a specific provider
 * — an Agent is defined once and works with whichever provider the Router
 * resolves at execution time, so this file has zero knowledge of
 * Anthropic/OpenAI/DeepSeek/Gemini/Ollama/LM Studio (Phase 2 §D).
 */
export interface AgentDefinition {
  id: string;
  version: number;
  role: string; // short human label, e.g. 'المستشار المالي'
  /** System-prompt text defining the agent's persona/expertise — mirrors the frontend's existing AGENTS[].prompt field 1:1 for the roles both share, so the two catalogs describe the same agent the same way (same drift risk this project has already hit once with provider/model defaults). */
  systemPrompt: string;
  /**
   * Optional FIXED policy text. agentRunner.ts appends it AFTER whichever base prompt governs the run (this static `systemPrompt` or an approved
   * genome's replacement), so replacing `systemPrompt` through the genome pipeline cannot drop it. It is guidance text sent to the model, NOT a
   * technical guarantee about the model's output. Absent for every agent except those that explicitly need one.
   */
  fixedPolicy?: string;
  skills: string[]; // free-text keywords used by selectAgentForTask()'s matching — see agentRegistry.ts
  models: RoutingMode; // e.g. 'BEST' | 'CHEAPEST' | 'FASTEST' | 'LOCAL_ONLY' | 'PRIVATE' — NEVER a specific provider id
  tools: string[]; // subset of tools/registry.ts tool names this agent may request — enforced by agentRunner.ts, not self-declared trust
  memoryScopes: ('task' | 'mission' | 'user' | 'project')[];
  policies: {
    maxTokens: number;
    /** Hard cap on tool calls per single agent invocation — bounds runaway tool loops, same spirit as dag.ts's bounded retries. */
    maxToolCalls: number;
  };
  constraints: {
    /** If set, ONLY these tools may be used even if tools[] lists more — an explicit deny-by-default override point for a future stricter policy tier. */
    allowedToolsOverride?: string[];
    deniedTools?: string[];
  };
  evaluationProfile: {
    requiresVerification: boolean;
  };
}

/** Input to a single agent run — everything the agent needs to act, nothing it doesn't (Phase 2 §D: no direct core/system/secrets/production-config access — this context exposes ONLY task text, upstream outputs, and a GatewayContext already scoped by the existing PermissionModel). */
export interface AgentExecutionContext {
  agentId: string;
  missionId: string | null;
  taskNodeId: string | null;
  taskDescription: string;
  upstreamOutputs: Record<string, string>;
  gwCtx: GatewayContext;
  signal?: AbortSignal;
}

/** Evolving runtime state for one agent invocation — persisted-shape but currently held in memory for the duration of a single run (dag_nodes already persists the per-node status this maps onto; a dedicated agent_runtime_state table is a natural Slice 3 extension once agents run outside a DAG node too). */
export interface AgentRuntimeState {
  status: 'idle' | 'selecting_model' | 'running' | 'done' | 'failed';
  attempt: number;
  providerUsed?: string;
  modelUsed?: string;
}

/** What an agent run produces — separate from AgentDefinition (static) and AgentRuntimeState (transient), so a caller can log/compare RESULTS without caring about the config or the in-flight state that produced them. */
export interface AgentResult {
  output: string;
  providerUsed: string;
  modelUsed: string;
  toolsUsed: string[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentWithFailureHistory extends AgentDefinition {
  failureHistory: AgentFailureRecord[];
}

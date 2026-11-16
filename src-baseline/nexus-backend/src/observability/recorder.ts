import { getRepos } from '../persistence/repos.js';
import type { ObservabilityRecord } from '../persistence/repositories/observabilityRepo.js';
import { estimateCostUsd } from '../orchestrator/budget.js';

export type FinalStatus = 'ok' | 'failed' | 'cancelled';

/**
 * One instance per top-level task (a chat completion OR a whole DAG plan).
 * The backend runs many tasks concurrently, unlike the frontend's browser
 * UI which only ever has one active task — so unlike NexusObservability's
 * single `_current` pointer, this is an explicit per-task object threaded
 * through the call chain (chatService, dag executor, tool pipeline).
 *
 * Records exactly the fields the spec calls out: task, route, agents,
 * models, tools, latency, retries, failures, tokens, cost, verification,
 * final status. NEVER the raw prompt, completion text, or a model's
 * chain-of-thought — every method below only ever accepts metadata
 * (names, counts, verdicts), never content.
 */
export class TaskObservability {
  private readonly taskId: string;
  private readonly route: string;
  private readonly startedAt: number;
  private models: Array<{ provider: string; model: string }> = [];
  private tools: string[] = [];
  private agents: string[] = [];
  private retries = 0;
  private failures: Array<{ message: string; at: number }> = [];
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;
  private verification: ObservabilityRecord['verification'] = null;

  constructor(taskId: string, route: string) {
    this.taskId = taskId;
    this.route = route;
    this.startedAt = Date.now();
  }

  recordModelCall(provider: string, model: string, inputTokens: number, outputTokens: number) {
    this.models.push({ provider, model });
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.costUsd += estimateCostUsd(provider, inputTokens, outputTokens);
  }

  recordTool(name: string) {
    if (!this.tools.includes(name)) this.tools.push(name);
  }

  /** Read-only snapshot of tool names invoked so far — lets a caller (e.g. agentRunner.ts's AgentResult.toolsUsed) report accurately after a call completes, without needing its own separate tracking. */
  toolsUsedSoFar(): string[] {
    return [...this.tools];
  }

  recordAgent(id: string) {
    if (!this.agents.includes(id)) this.agents.push(id);
  }

  recordRetry() {
    this.retries += 1;
  }

  /** message must already be a short error SUMMARY (e.g. err.message) — never pass raw model output here. */
  recordFailure(message: string) {
    this.failures.push({ message: message.slice(0, 300), at: Date.now() - this.startedAt });
  }

  recordVerification(v: { ran: boolean; verdict?: string; issueCount?: number }) {
    this.verification = v;
  }

  finish(status: FinalStatus) {
    const record: ObservabilityRecord = {
      taskId: this.taskId,
      route: this.route,
      agents: this.agents,
      models: this.models,
      tools: this.tools,
      latencyMs: Date.now() - this.startedAt,
      retries: this.retries,
      failures: this.failures,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsd: this.costUsd,
      verification: this.verification,
      finalStatus: status,
      createdAt: this.startedAt,
    };
    getRepos().observability.upsert(record);
    return record;
  }
}

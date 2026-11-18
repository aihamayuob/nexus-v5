import { ServerConfig } from '../config/env.js';
import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { getRepos } from '../persistence/repos.js';
import type { TaskStatus } from '../persistence/repositories/taskRepo.js';
import { claimUnifiedTask, dispatchUnifiedTask } from '../orchestrator/taskEntryPoint.js';
import { cancelTask } from '../orchestrator/taskManager.js';
import { auditSecurityEvent } from '../security/audit.js';

/**
 * NEXUS A2A SERVER (A1) — A2A protocol v1.0, JSON-RPC binding, NEXUS as SERVER only. Facts below were read from the official specification
 * (a2a-protocol.org/latest/specification, sections 4/5/8/9) and cross-checked against the official @a2a-js/sdk 1.3.0 client source; anything not verified is listed under
 * "Not implemented / unverified".
 *
 * Mapping: an A2A task IS a NEXUS task (same id, same engine as POST /v2/tasks: intent -> execution policy -> chat fast path or planner/DAG, same budget/egress/Warden
 * machinery). Nothing is re-implemented and no second state store exists; a2a_tasks only records which peer created the task.
 *
 * Implemented: GET /.well-known/agent-card.json (public discovery), POST /a2a with SendMessage (blocking by default, `returnImmediately` supported), GetTask, CancelTask.
 * Security: gateway bearer auth on /a2a (the card is public by design and carries no secret); tasks are visible only to the creating peer (a foreign/unknown id are
 * indistinguishable); the peer cannot choose provider/model (operator-configured NEXUS_A2A_PROVIDER); text parts only (no url/raw/data => no peer-supplied URL is ever fetched).
 *
 * Not implemented / unverified: streaming (SendStreamingMessage, SubscribeToTask), push notifications, ListTasks, extended agent card, the HTTP+JSON and gRPC bindings,
 * Agent Card signing, multi-turn (a message with an existing taskId), peer-supplied contextId (contextId is always the task id), history, and conformance against another
 * vendor's A2A implementation. A task escalated for human approval is reported as TASK_STATE_INPUT_REQUIRED but a peer has NO way to approve it (approval happens in NEXUS).
 * The result artifact is rebuilt from the task's stored `done`/token events, which the retention sweeper prunes after a grace window.
 */

export const A2A_PROTOCOL_VERSION = '1.0';
const DOMAIN = 'a2a-protocol.org';

export type A2aTaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED';

export function mapTaskState(status: TaskStatus, approvalPending: boolean): A2aTaskState {
  if (status === 'done') return 'TASK_STATE_COMPLETED';
  if (status === 'failed') return 'TASK_STATE_FAILED';
  if (status === 'cancelled') return 'TASK_STATE_CANCELED';
  if (approvalPending) return 'TASK_STATE_INPUT_REQUIRED';
  return status === 'running' ? 'TASK_STATE_WORKING' : 'TASK_STATE_SUBMITTED';
}

export function isA2aEnabled(): boolean {
  return !!ServerConfig.a2aProvider && ProviderRegistry.has(ServerConfig.a2aProvider);
}

export function buildAgentCard(baseUrl: string): Record<string, unknown> {
  return {
    name: 'NEXUS',
    description: 'NEXUS multi-agent platform. Accepts a text task and returns a text result; execution policy, budget and privacy guards of the NEXUS gateway apply.',
    version: '5.0.0',
    supportedInterfaces: [{ url: `${baseUrl.replace(/\/+$/, '')}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 'general-task', name: 'General task', description: 'Answer a question or carry out a text task using the operator-configured model.', tags: ['general', 'text'] }],
    securitySchemes: { gatewayBearer: { httpAuthSecurityScheme: { scheme: 'Bearer', description: 'NEXUS gateway key as a Bearer token.' } } },
    security: [{ schemes: { gatewayBearer: { list: [] } } }],
  };
}

class RpcError extends Error {
  constructor(public code: number, message: string, public reason?: string) {
    super(message);
  }
}
const rpcError = (id: unknown, e: RpcError) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code: e.code, message: e.message, ...(e.reason ? { data: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: e.reason, domain: DOMAIN }] } : {}) },
});
const notFound = () => new RpcError(-32001, 'Task not found.', 'TASK_NOT_FOUND');
const invalid = (m: string) => new RpcError(-32602, `Invalid params: ${m}`);

function visibleTask(taskId: unknown, ctx: GatewayContext) {
  if (typeof taskId !== 'string' || !taskId) throw invalid('"id" is required.');
  const own = getRepos().a2aTasks.get(taskId);
  if (!own || own.owner !== ctx.clientKey) throw notFound(); // foreign and unknown ids are indistinguishable
  const task = getRepos().tasks.get(taskId);
  if (!task) throw notFound();
  return task;
}

function toA2aTask(taskId: string): Record<string, unknown> {
  const repos = getRepos();
  const t = repos.tasks.get(taskId)!;
  const approval = repos.approvals.get(taskId);
  const state = mapTaskState(t.status, approval?.status === 'pending');
  const status: Record<string, unknown> = { state, timestamp: new Date(t.updatedAt).toISOString() };
  if (state === 'TASK_STATE_FAILED' && t.errorMessage) status.message = { messageId: `${taskId}-status`, role: 'ROLE_AGENT', parts: [{ text: t.errorMessage.slice(0, 300) }] };
  if (state === 'TASK_STATE_INPUT_REQUIRED') status.message = { messageId: `${taskId}-status`, role: 'ROLE_AGENT', parts: [{ text: 'Awaiting a human approval decision inside NEXUS.' }] };
  const out: Record<string, unknown> = { id: taskId, contextId: taskId, status };
  if (state === 'TASK_STATE_COMPLETED') {
    const events = repos.streamEvents.since(taskId, 0);
    const done = [...events].reverse().find((e) => e.event === 'done');
    const finalOutput = String((done?.data as { finalOutput?: unknown } | undefined)?.finalOutput ?? '');
    const text = finalOutput || events.filter((e) => e.event === 'token').map((e) => String((e.data as { text?: unknown })?.text ?? '')).join('');
    if (text) out.artifacts = [{ artifactId: `${taskId}-result`, name: 'result', parts: [{ text }] }];
  }
  return out;
}

const isTerminal = (s: TaskStatus) => s === 'done' || s === 'failed' || s === 'cancelled';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractText(params: unknown): string {
  const message = (params as { message?: Record<string, unknown> } | null)?.message;
  if (!message || typeof message !== 'object') throw invalid('"message" is required.');
  if (message.role !== 'ROLE_USER') throw invalid('message.role must be ROLE_USER.');
  if (!Array.isArray(message.parts) || message.parts.length === 0) throw invalid('At least one part is required.');
  let text = '';
  for (const p of message.parts as Array<Record<string, unknown>>) {
    if (!p || typeof p.text !== 'string' || ['raw', 'url', 'data'].some((k) => k in p)) throw invalid('only text parts are supported (no raw/url/data).');
    text += (text ? '\n' : '') + p.text;
  }
  if (!text.trim()) throw invalid('message text is empty.');
  if (text.length > ServerConfig.a2aMaxInputChars) throw invalid(`message text exceeds ${ServerConfig.a2aMaxInputChars} characters.`);
  return text;
}

async function sendMessage(params: unknown, ctx: GatewayContext): Promise<unknown> {
  const text = extractText(params);
  const messageId = String(((params as { message: { messageId?: unknown } }).message.messageId ?? '') || Math.random());
  const returnImmediately = (params as { configuration?: { returnImmediately?: unknown } }).configuration?.returnImmediately === true;
  const provider = ServerConfig.a2aProvider as ProviderId;
  const { taskId, decision, reusedExisting } = claimUnifiedTask(text, provider, ctx, { idempotencyKey: `a2a:${ctx.clientKey}:${messageId}` });
  getRepos().a2aTasks.claim(taskId, ctx.clientKey);
  auditSecurityEvent('info', 'A2A task submitted', { taskId, peer: ctx.clientKey, chars: text.length, provider });
  dispatchUnifiedTask(taskId, decision, reusedExisting, text, provider, ctx);
  if (!returnImmediately) {
    const deadline = Date.now() + ServerConfig.a2aWaitMs;
    while (Date.now() < deadline) {
      const t = getRepos().tasks.get(taskId)!;
      if (isTerminal(t.status) || getRepos().approvals.get(taskId)?.status === 'pending') break;
      await sleep(100);
    }
  }
  return { task: toA2aTask(taskId) };
}

async function cancel(params: unknown, ctx: GatewayContext): Promise<unknown> {
  const task = visibleTask((params as { id?: unknown } | null)?.id, ctx);
  if (isTerminal(task.status)) throw new RpcError(-32002, 'Task cannot be canceled in its current state.', 'TASK_NOT_CANCELABLE');
  const aborted = cancelTask(task.id);
  if (!aborted) getRepos().tasks.updateStatus(task.id, 'cancelled'); // not running in this process (e.g. waiting for approval): record the cancellation
  for (let i = 0; i < 30 && !isTerminal(getRepos().tasks.get(task.id)!.status); i++) await sleep(100);
  if (!isTerminal(getRepos().tasks.get(task.id)!.status)) getRepos().tasks.updateStatus(task.id, 'cancelled');
  auditSecurityEvent('info', 'A2A task canceled', { taskId: task.id, peer: ctx.clientKey });
  return toA2aTask(task.id);
}

/** Handles one parsed JSON-RPC request object (already authenticated by the gateway). Never throws: every failure is a JSON-RPC error object. */
export async function handleA2aRpc(msg: unknown, headers: Record<string, string | string[] | undefined>, ctx: GatewayContext): Promise<unknown> {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return rpcError(null, new RpcError(-32600, 'Invalid Request: a single JSON-RPC object is required.'));
  const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcError(m.id, new RpcError(-32600, 'Invalid Request'));
  try {
    const v = String(headers['a2a-version'] ?? '').trim() || '0.3'; // spec: an empty A2A-Version header is treated as 0.3
    if (v !== A2A_PROTOCOL_VERSION) throw new RpcError(-32009, `Version ${v} is not supported; this server supports ${A2A_PROTOCOL_VERSION}.`, 'VERSION_NOT_SUPPORTED');
    switch (m.method) {
      case 'SendMessage':
        return { jsonrpc: '2.0', id: m.id ?? null, result: await sendMessage(m.params, ctx) };
      case 'GetTask': {
        const task = visibleTask((m.params as { id?: unknown } | null)?.id, ctx);
        return { jsonrpc: '2.0', id: m.id ?? null, result: toA2aTask(task.id) };
      }
      case 'CancelTask':
        return { jsonrpc: '2.0', id: m.id ?? null, result: await cancel(m.params, ctx) };
      case 'SendStreamingMessage':
      case 'SubscribeToTask':
      case 'ListTasks':
      case 'GetExtendedAgentCard':
      case 'CreateTaskPushNotificationConfig':
      case 'GetTaskPushNotificationConfig':
      case 'ListTaskPushNotificationConfigs':
      case 'DeleteTaskPushNotificationConfig':
        throw new RpcError(-32004, `${m.method} is not supported by this server.`, 'UNSUPPORTED_OPERATION');
      default:
        throw new RpcError(-32601, `Method not found: ${m.method.slice(0, 80)}`);
    }
  } catch (e) {
    if (e instanceof RpcError) return rpcError(m.id, e);
    return rpcError(m.id, new RpcError(-32603, 'Internal error.'));
  }
}

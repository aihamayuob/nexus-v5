import { getStreamRegistry } from '../orchestrator/streamRegistry.js';

/**
 * v2 event contract version. Bump this ONLY for a breaking change to the
 * envelope shape itself (never for adding a new optional field or a new
 * event `type` — those are additive and don't require a version bump).
 * Clients should treat unknown `type` values as ignorable, not fatal.
 */
export const V2_EVENT_SCHEMA_VERSION = 1;

export type V2EventType =
  | 'task_meta' // {taskId, tier, route} — the very first event, describes the execution-policy decision
  | 'token'
  | 'agent_start'
  | 'agent_done'
  | 'tool_use_start'
  | 'tool_use_delta'
  | 'verification'
  | 'approval_required'
  | 'done'
  | 'error';

/**
 * Wraps a payload in the versioned envelope and emits it through the same
 * durable StreamRegistry every other stream (legacy and v2) already uses
 * — resumability, persistence-before-broadcast, and the `id:` sequence
 * field are all inherited for free, not reimplemented here.
 */
export function emitV2Event(taskId: string, type: V2EventType, data: Record<string, unknown> = {}): void {
  getStreamRegistry().emit(taskId, type, { v: V2_EVENT_SCHEMA_VERSION, type, taskId, ...data });
}

import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import { Errors } from '../core/errors.js';
import { auditSecurityEvent } from './audit.js';

/**
 * GAP-1B (owner decision 2026-10-19, building on D1/D2): ONE choke point that INTERNAL, direct provider calls (Verifier, EvaluationEngine,
 * Digital Genome judge, Knowledge Freshness judge/research) must pass before they may talk to a CLOUD provider.
 *
 * Why it exists: those calls name a provider ("anthropic") directly and never go through routeModel()/selectProviderForMode(), so the
 * GAP-1 router fix (a local primary never falls back to cloud) could not reach them. They also never knew the privacy mode of the work
 * they were judging.
 *
 * What counts as a RESTRICTED scope (cloud egress is DENIED — there is intentionally NO approval/opt-in path in this release; see the
 * D1.3 design document, which is a proposal and is NOT implemented here):
 *   - the caller passed privacyMode LOCAL_ONLY | PRIVATE (a request field can only TIGHTEN, never loosen);
 *   - the call is about an agent whose declared routing mode is LOCAL_ONLY | PRIVATE;
 *   - the owning task (taskId) already ran a model call whose primary was a LOCAL provider or whose mode was LOCAL_ONLY | PRIVATE
 *     (recorded by chatService via markTaskRestricted). Output of such a task must not be shipped to a cloud judge.
 *
 * Known limits (documented, not hidden): the task marks live in process memory only (lost on restart); a call with no taskId and no
 * privacyMode/agentMode has no privacy attribute at all (e.g. a memory item) and is treated as open, exactly as before.
 *
 * Audit rule: a denial is recorded with {purpose, provider, reason, taskId, scope-kind} only — NEVER message/claim/evidence/prompt content.
 */

export type EgressPurpose = 'verification' | 'evaluation' | 'genome_judge' | 'freshness_judge' | 'freshness_research';
export type RestrictionReason = 'privacy_mode' | 'agent_privacy_mode' | 'task_privacy_mode' | 'task_local_provider';

export interface EgressContext {
  purpose: EgressPurpose;
  /** The cloud provider the caller is about to use. A local provider is never blocked by this guard. */
  provider: ProviderId;
  taskId?: string | null;
  /** Routing mode attached to the call by its caller (HTTP body or code). Only LOCAL_ONLY | PRIVATE has any effect. */
  privacyMode?: unknown;
  /** Declared routing mode of the agent whose data the call would carry (AgentDefinition.models). */
  agentMode?: unknown;
}

export type EgressDecision = { allowed: true } | { allowed: false; reason: RestrictionReason };

const RESTRICTED_MODES: ReadonlySet<string> = new Set(['LOCAL_ONLY', 'PRIVATE']);
export function isPrivacyRestrictedMode(mode: unknown): boolean {
  return typeof mode === 'string' && RESTRICTED_MODES.has(mode);
}

const MAX_TRACKED_TASKS = 10_000;
const restrictedTasks = new Map<string, 'task_privacy_mode' | 'task_local_provider'>();

/** Called by chatService when a task's model call is routed LOCAL_ONLY/PRIVATE or to a local primary. The strongest reason wins (privacy mode over local provider). */
export function markTaskRestricted(taskId: string, reason: 'task_privacy_mode' | 'task_local_provider'): void {
  if (!taskId) return;
  const prior = restrictedTasks.get(taskId);
  if (prior === 'task_privacy_mode') return;
  if (restrictedTasks.size >= MAX_TRACKED_TASKS && !restrictedTasks.has(taskId)) {
    const oldest = restrictedTasks.keys().next().value;
    if (oldest !== undefined) restrictedTasks.delete(oldest);
  }
  restrictedTasks.set(taskId, reason);
}

export function isTaskRestricted(taskId: string | null | undefined): boolean {
  return !!taskId && restrictedTasks.has(taskId);
}

/** Test-only reset of the in-memory marks. */
export function _resetRestrictedTasksForTests(): void {
  restrictedTasks.clear();
}

export function decideCloudEgress(ctx: EgressContext): EgressDecision {
  if (ProviderRegistry.resolve(ctx.provider).capabilities.isLocal) return { allowed: true };
  if (isPrivacyRestrictedMode(ctx.privacyMode)) return { allowed: false, reason: 'privacy_mode' };
  if (isPrivacyRestrictedMode(ctx.agentMode)) return { allowed: false, reason: 'agent_privacy_mode' };
  const taskReason = ctx.taskId ? restrictedTasks.get(ctx.taskId) : undefined;
  if (taskReason) return { allowed: false, reason: taskReason };
  return { allowed: true };
}

/** Decides AND audits a denial. Returns true if the caller may proceed to the cloud provider. */
export function checkCloudEgress(ctx: EgressContext): boolean {
  const d = decideCloudEgress(ctx);
  if (d.allowed) return true;
  auditSecurityEvent('warn', 'cloud_egress_denied', {
    purpose: ctx.purpose,
    provider: ctx.provider,
    reason: d.reason,
    taskId: ctx.taskId ?? null,
    decision: 'deny',
  });
  return false;
}

/** Throwing variant for callers that have no fail-open semantics. */
export function assertCloudEgressAllowed(ctx: EgressContext): void {
  if (checkCloudEgress(ctx)) return;
  throw Errors.cloudEgressDenied(
    'مُنع الاتصال بمزود سحابي: هذا العمل مقيَّد بوضع خصوصية (LOCAL_ONLY/PRIVATE أو مزود محلي) ولم يُرسَل أي محتوى إلى أي مزود سحابي.',
    { purpose: ctx.purpose, provider: ctx.provider }
  );
}

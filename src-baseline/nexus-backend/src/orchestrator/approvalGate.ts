import { getRepos } from '../persistence/repos.js';
import { getStreamRegistry } from './streamRegistry.js';
import { ExecutionCheckpoint } from './checkpoint.js';
import { logger } from '../core/logger.js';
import { auditSecurityEvent } from '../security/audit.js';
import { Errors } from '../core/errors.js';

/**
 * Called instead of delivering a HIGH_RISK task's result directly. Persists
 * the draft final output (checkpoint phase 'awaiting_approval'), creates a
 * pending approval record, and emits `approval_required` on the task's
 * durable stream — a client watching live sees it as an event; a client
 * that comes back later sees it via resume/poll either way, since it's
 * written to stream_events like every other event.
 */
export function requestApproval(taskId: string, finalOutput: string, reason: string): void {
  ExecutionCheckpoint.save(taskId, 'awaiting_approval', { finalOutput });
  getRepos().approvals.create(taskId, reason);
  getStreamRegistry().emit(taskId, 'approval_required', { taskId, reason });
  auditSecurityEvent('info', 'Task held for human approval (HIGH_RISK execution tier)', { taskId, reason });
  logger.info('Task awaiting human approval', { taskId, reason });
}

/**
 * Releases (or rejects) a task that was held by requestApproval(). Reads
 * the checkpointed draft back out, emits the real terminal event
 * (`plan_done` on approval, `plan_error` on rejection) on the SAME
 * durable stream, and updates the task's own status — all through
 * existing infrastructure (streamRegistry, ExecutionCheckpoint, TaskRepo),
 * nothing new invented for this one flow.
 */
export function decideApproval(taskId: string, decision: 'approved' | 'rejected', decidedBy: string | null): { finalOutput?: string } {
  const approval = getRepos().approvals.get(taskId);
  if (!approval) throw Errors.notFound('لا يوجد طلب موافقة بهذا المعرّف.');
  if (approval.status !== 'pending') throw Errors.conflict('تم اتخاذ قرار بخصوص هذا الطلب مسبقاً.', { status: approval.status });

  getRepos().approvals.decide(taskId, decision, decidedBy);
  auditSecurityEvent('info', `Human approval decision: ${decision}`, { taskId, decidedBy });

  const checkpoint = ExecutionCheckpoint.latest(taskId);
  const finalOutput = checkpoint?.phase === 'awaiting_approval' ? (checkpoint.state as { finalOutput: string }).finalOutput : undefined;

  const streamRegistry = getStreamRegistry();
  if (decision === 'approved') {
    streamRegistry.emit(taskId, 'plan_done', { finalOutput });
    getRepos().tasks.updateStatus(taskId, 'done');
    void ExecutionCheckpoint.clear(taskId);
  } else {
    streamRegistry.emit(taskId, 'plan_error', { message: 'رُفضت النتيجة من قبل المراجع البشري.' });
    getRepos().tasks.updateStatus(taskId, 'cancelled', 'rejected by human approver');
  }
  streamRegistry.markDone(taskId);

  // Additive Mission-state sync (Phase 3 / Warden): a mission's id IS its
  // task id (see missionRunner.ts's createMission()), so this only fires
  // for taskIds that are actually missions — plain (non-mission) tasks
  // held via requestApproval() are unaffected, since repos.missions.get()
  // simply returns null for them.
  const mission = getRepos().missions.get(taskId);
  if (mission) {
    if (decision === 'approved') {
      getRepos().missions.transition(taskId, 'COMPLETED', 'وافق المراجع البشري على النتيجة رغم الملاحظات.');
    } else {
      getRepos().missions.transition(taskId, 'FAILED', 'رفض المراجع البشري النتيجة.');
    }
  }

  return { finalOutput };
}

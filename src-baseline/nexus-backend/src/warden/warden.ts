import { getRepos } from '../persistence/repos.js';
import { cancelTask, requestPause } from '../orchestrator/taskManager.js';
import { runMission } from '../orchestrator/missionRunner.js';
import { TERMINAL_MISSION_STATES } from '../orchestrator/missionTypes.js';
import { cancelCouncilSession, getCouncilSession } from '../council/councilRunner.js';
import { BudgetGuard } from '../orchestrator/budget.js';
import { auditSecurityEvent } from '../security/audit.js';
import { logger } from '../core/logger.js';
import { Errors } from '../core/errors.js';
import type { GatewayContext } from '../capability/permissionModel.js';

/**
 * Warden — the single control surface for pausing/cancelling running work
 * and observing system-wide operational state (Phase 3 §Warden).
 *
 * IMPORTANT, VERIFIED DESIGN FACT (documented here rather than papered
 * over): every route in this backend — including every Warden route added
 * in this slice — already passes through `authenticate()`
 * (gateway/middleware/auth.ts) BEFORE the route handler runs at all. That
 * middleware either returns `{authenticated: true, ...}` or throws
 * Errors.auth() (401); it can never hand a route an unauthenticated
 * GatewayContext. This means:
 *   (a) There is no separate "elevated" Warden bypass path — Warden
 *       actions are bound by the exact same gateway key requirement as
 *       every other endpoint, which is precisely what "Warden لا يستطيع
 *       تجاوز... security boundary" requires structurally.
 *   (b) Re-checking `ctx.authenticated === true` inside Warden functions
 *       would be dead code that can never be false by the time it runs —
 *       adding it would be security theater, not a real control. It is
 *       deliberately NOT added here for that reason; this comment (and
 *       PHASE3_SLICE2_REPORT.md) is the honest record of that decision.
 *
 * What THIS slice actually adds beyond what already existed pre-Warden:
 *   1. An AUDITED cancel path — routes/v2/missions.ts and
 *      routes/v2/council.ts previously called cancelTask()/
 *      cancelCouncilSession() directly with zero audit trail. Every
 *      Warden.cancel* call now logs a real security-audit event
 *      (queryable via GET /v2/observability or auditRepo.listSecurity()).
 *   2. A single operational status view (budget + active mission/council
 *      counts) that did not exist as one call before.
 *   3. requireApprovalOnIssues human-approval gating for Missions — see
 *      missionRunner.ts and approvalGate.ts's decideApproval().
 */
export const Warden = {
  cancelMission(missionId: string, reason: string): { cancelled: boolean } {
    const mission = getRepos().missions.get(missionId);
    if (!mission) throw Errors.notFound('Mission غير موجودة.');
    const cancelled = cancelTask(missionId);
    auditSecurityEvent('info', 'Warden: mission cancellation requested', { missionId, reason, cancelled, priorState: mission.state });
    return { cancelled };
  },

  cancelCouncilSession(sessionId: string, reason: string): { cancelled: boolean } {
    const session = getCouncilSession(sessionId);
    if (!session) throw Errors.notFound('جلسة المجلس غير موجودة.');
    const cancelled = cancelCouncilSession(sessionId);
    auditSecurityEvent('info', 'Warden: council session cancellation requested', { sessionId, reason, cancelled, priorState: session.state });
    return { cancelled };
  },

  /**
   * Phase 3 Slice 13 — PAUSE. Reuses the exact same abort-signal mechanism
   * as cancelMission() above (via taskManager.ts's requestPause(), a
   * pause-tagged sibling of cancelTask()) rather than inventing a second
   * interruption pathway. Only valid from a genuinely in-flight state —
   * pausing something already terminal, already PAUSED, or held in
   * AWAITING_APPROVAL (a different kind of hold, with its own resolution
   * via /v2/approvals) is a real usage error, not a silent no-op.
   *
   * If there is no live in-process execution to interrupt (requestPause()
   * returns false — e.g. the mission is DB-state RUNNING but nothing in
   * THIS process currently holds its AbortController), the mission is
   * transitioned to PAUSED directly here instead of left to drift: the
   * whole point of an explicit human PAUSE is that the mission must not
   * silently auto-resume later (see missionRepo.ts's
   * interruptedMissionIds()), which requires it to actually be PAUSED in
   * the DB one way or the other, not just "abort requested and hope".
   */
  pauseMission(missionId: string, reason: string): { paused: boolean } {
    const repos = getRepos();
    const mission = repos.missions.get(missionId);
    if (!mission) throw Errors.notFound('Mission غير موجودة.');
    if (TERMINAL_MISSION_STATES.has(mission.state)) {
      throw Errors.validation(`لا يمكن إيقاف Mission في حالة نهائية (${mission.state}) مؤقتاً.`);
    }
    if (mission.state === 'PAUSED') throw Errors.validation('Mission متوقفة مؤقتاً بالفعل.');
    if (mission.state === 'AWAITING_APPROVAL') {
      throw Errors.validation('Mission بانتظار قرار موافقة بشرية بالفعل (AWAITING_APPROVAL) — استخدم /v2/approvals بدلاً من الإيقاف المؤقت.');
    }

    const activelyRunning = requestPause(missionId);
    if (!activelyRunning) {
      repos.missions.transition(missionId, 'PAUSED', reason || 'أُوقفت المهمة مؤقتاً بطلب بشري عبر Warden — لا تنفيذ نشط في هذه العملية.');
    }
    auditSecurityEvent('info', 'Warden: mission pause requested', { missionId, reason, activelyRunning, priorState: mission.state });
    return { paused: true };
  },

  /**
   * Phase 3 Slice 13 — RESUME. Deliberately reuses runMission() as-is —
   * the SAME function resumeInterruptedMissions() (crash recovery) already
   * calls — rather than a bespoke "continue from here" path: this slice
   * adds orchestration AROUND the existing checkpoint/resume mechanics, it
   * does not change what "resuming a mission" itself does at the DAG
   * level (still: re-plan from the objective, then execute — see
   * missionRunner.ts's runMission() and its honest header comment on
   * this). Only valid from PAUSED — resuming anything else is a real
   * usage error (e.g. a COMPLETED mission has nothing to resume; a
   * RUNNING one is already running).
   */
  resumeMission(missionId: string, ctx: GatewayContext): { resuming: boolean } {
    const repos = getRepos();
    const mission = repos.missions.get(missionId);
    if (!mission) throw Errors.notFound('Mission غير موجودة.');
    if (mission.state !== 'PAUSED') {
      throw Errors.validation(`لا يمكن استئناف Mission ليست متوقفة مؤقتاً (الحالة الحالية: ${mission.state}).`);
    }
    auditSecurityEvent('info', 'Warden: mission resume requested', { missionId, priorState: mission.state });
    void runMission(missionId, ctx).catch((e) => logger.error('Mission resume (manual, via Warden) failed', { missionId, message: (e as Error).message }));
    return { resuming: true };
  },

  /**
   * Phase 3 Slice 13 — ISOLATE. Writes directly to WardenIsolationRepo
   * (see its header comment for exactly why this does not call into
   * agents/agentRunner.ts, and vice versa — a real circular-import
   * constraint, not a style choice). Enforcement is real and immediate:
   * agentRunner.ts's runAgentTask() checks this repo as its very first
   * line, so an isolated agent can accept NO new task — not mid-DAG, not
   * via Council, not via Swarm — the instant this call returns, for every
   * caller in the process (and any other process sharing this DB).
   */
  isolateAgent(agentId: string, reason: string): { isolated: boolean } {
    getRepos().wardenIsolation.isolate(agentId, reason || 'عزل بطلب بشري عبر Warden.');
    auditSecurityEvent('warn', 'Warden: agent isolated', { agentId, reason });
    return { isolated: true };
  },

  deisolateAgent(agentId: string): { deisolated: boolean } {
    const wasIsolated = getRepos().wardenIsolation.deisolate(agentId);
    auditSecurityEvent('info', 'Warden: agent de-isolated', { agentId, wasIsolated });
    return { deisolated: wasIsolated };
  },

  listIsolatedAgents() {
    return getRepos().wardenIsolation.list();
  },

  status() {
    const repos = getRepos();
    return {
      budget: BudgetGuard.status(),
      activeMissions: repos.missions.resumableMissionIds().length,
      activeCouncilSessions: repos.council.activeCount(),
      pendingApprovals: repos.approvals.pending(200).length,
      isolatedAgents: repos.wardenIsolation.list().length,
    };
  },
};

import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { runAutonomousMission } from '../../orchestrator/autonomousCore.js';
import { Warden } from '../../warden/warden.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';
import type { CompletionCriteria } from '../../orchestrator/missionTypes.js';

interface CreateMissionRequestBody {
  objective?: string;
  completionCriteria?: CompletionCriteria;
  maxReplans?: number;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export function registerMissionRoutes(router: Router) {
  /** Fire-and-poll, same contract as POST /api/runtime/plan — returns immediately with a missionId; poll GET /v2/missions/:id or attach to the existing SSE stream (same taskId) for live progress. */
  router.post('/v2/missions', async (ctx: RouteContext) => {
    const body = await readJsonBody<CreateMissionRequestBody>(ctx.req);
    if (!body.objective || !body.objective.trim()) {
      throw Errors.validation('الحقل "objective" مطلوب.');
    }
    const { missionId } = await runAutonomousMission(body.objective, ctx.gw, {
      completionCriteria: body.completionCriteria,
      maxReplans: body.maxReplans,
      metadata: body.metadata,
      idempotencyKey: body.idempotencyKey,
      awaitCompletion: false,
    });
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ missionId }));
  });

  router.get('/v2/missions/:id', async (ctx: RouteContext) => {
    const mission = getRepos().missions.get(ctx.params.id!);
    if (!mission) throw Errors.notFound('Mission غير موجودة.');
    const task = getRepos().tasks.get(mission.id);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(
      JSON.stringify({
        id: mission.id,
        objective: mission.objective,
        state: mission.state,
        completionCriteria: mission.completionCriteria,
        failures: mission.failures,
        retryCount: mission.retryCount,
        replanCount: mission.replanCount,
        maxReplans: mission.maxReplans,
        result: mission.result,
        createdAt: mission.createdAt,
        startedAt: mission.startedAt,
        completedAt: mission.completedAt,
        taskStatus: task?.status ?? null,
      })
    );
  });

  router.get('/v2/missions/:id/transitions', async (ctx: RouteContext) => {
    const mission = getRepos().missions.get(ctx.params.id!);
    if (!mission) throw Errors.notFound('Mission غير موجودة.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ transitions: getRepos().missions.transitions(mission.id) }));
  });

  router.post('/v2/missions/:id/cancel', async (ctx: RouteContext) => {
    // Dedicated resilience-gap fix — see warden.ts's isolate handler for the full
    // rationale: readJsonBody() already returns {} for a genuinely empty body, so
    // wrapping it in .catch(() => ({})) here was over-broad and was silently
    // swallowing real 413/400 errors too, not just "no reason given".
    const body = await readJsonBody<{ reason?: string }>(ctx.req);
    const { cancelled } = Warden.cancelMission(ctx.params.id!, body.reason ?? 'requested via API');
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ cancelling: cancelled }));
  });

  /** Phase 3 Slice 13 — PAUSE. See Warden.pauseMission() for the full state-machine contract (only valid from a genuinely in-flight state). Validation errors (already terminal/already paused/awaiting approval) surface as a real 400, not a silently-ignored request. */
  router.post('/v2/missions/:id/pause', async (ctx: RouteContext) => {
    // Dedicated resilience-gap fix — see warden.ts's isolate handler for rationale.
    const body = await readJsonBody<{ reason?: string }>(ctx.req);
    const { paused } = Warden.pauseMission(ctx.params.id!, body.reason ?? 'requested via API');
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ pausing: paused }));
  });

  /** Phase 3 Slice 13 — RESUME. Only valid from PAUSED — see Warden.resumeMission(). Uses the caller's own gateway context (ctx.gw), same as POST /v2/missions above, NOT a synthetic 'system-resume' context (that context is reserved for the real startup crash-recovery path in missionRunner.ts's resumeInterruptedMissions()). */
  router.post('/v2/missions/:id/resume', async (ctx: RouteContext) => {
    const { resuming } = Warden.resumeMission(ctx.params.id!, ctx.gw);
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ resuming }));
  });
}

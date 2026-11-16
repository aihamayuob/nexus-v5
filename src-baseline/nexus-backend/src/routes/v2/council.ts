import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { runCouncilSession, getCouncilSession } from '../../council/councilRunner.js';
import { Warden } from '../../warden/warden.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';
import type { CreateCouncilSessionInput } from '../../council/councilTypes.js';

interface CreateCouncilRequestBody {
  mode?: 'cross_exam' | 'situation_room';
  topic?: string;
  // cross_exam (default mode when omitted — Slice 1, unchanged contract)
  proposerAgentId?: string;
  criticAgentId?: string;
  // situation_room (Slice 4)
  participantAgentIds?: string[];
  supervisorAgentId?: string;
  // situation_room only (Slice 5b) — off by default
  humanitarianVeto?: boolean;
}

export function registerCouncilRoutes(router: Router) {
  /** Fire-and-poll, same contract as POST /v2/missions. `mode` defaults to 'cross_exam' when omitted — every existing caller from Slice 1 keeps working unchanged. */
  router.post('/v2/council', async (ctx: RouteContext) => {
    const body = await readJsonBody<CreateCouncilRequestBody>(ctx.req);
    if (!body.topic || !body.topic.trim()) throw Errors.validation('الحقل "topic" مطلوب.');
    const mode = body.mode ?? 'cross_exam';

    let input: CreateCouncilSessionInput;
    if (mode === 'situation_room') {
      if (!Array.isArray(body.participantAgentIds) || body.participantAgentIds.length < 2) {
        throw Errors.validation('وضع "situation_room" يتطلب "participantAgentIds" بخبيرين على الأقل.');
      }
      input = {
        mode: 'situation_room',
        topic: body.topic,
        participantAgentIds: body.participantAgentIds,
        supervisorAgentId: body.supervisorAgentId,
        humanitarianVeto: body.humanitarianVeto === true,
      };
    } else {
      if (!body.proposerAgentId) throw Errors.validation('الحقل "proposerAgentId" مطلوب.');
      if (!body.criticAgentId) throw Errors.validation('الحقل "criticAgentId" مطلوب.');
      input = { mode: 'cross_exam', topic: body.topic, proposerAgentId: body.proposerAgentId, criticAgentId: body.criticAgentId, supervisorAgentId: body.supervisorAgentId };
    }

    let sessionId: string;
    try {
      const result = await runCouncilSession(input, ctx.gw);
      sessionId = result.sessionId;
    } catch (e) {
      throw Errors.validation((e as Error).message);
    }
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ sessionId }));
  });

  router.get('/v2/council/:id', async (ctx: RouteContext) => {
    const session = getCouncilSession(ctx.params.id!);
    if (!session) throw Errors.notFound('جلسة المجلس غير موجودة.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(session));
  });

  router.get('/v2/council/:id/rounds', async (ctx: RouteContext) => {
    const session = getCouncilSession(ctx.params.id!);
    if (!session) throw Errors.notFound('جلسة المجلس غير موجودة.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ rounds: getRepos().council.rounds(session.id) }));
  });

  router.post('/v2/council/:id/cancel', async (ctx: RouteContext) => {
    // Dedicated resilience-gap fix — see warden.ts's isolate handler for rationale.
    const body = await readJsonBody<{ reason?: string }>(ctx.req);
    const { cancelled } = Warden.cancelCouncilSession(ctx.params.id!, body.reason ?? 'requested via API');
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ cancelling: cancelled }));
  });
}

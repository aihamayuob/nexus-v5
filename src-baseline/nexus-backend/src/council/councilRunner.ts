import { randomUUID } from 'node:crypto';
import { runAgentTask } from '../agents/agentRunner.js';
import { AgentRegistry } from '../agents/agentRegistry.js';
import { Verifier } from '../orchestrator/verifier.js';
import { getRepos } from '../persistence/repos.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import type { CreateCouncilSessionInput, CreateCrossExamInput, CouncilRound, CouncilRoundKind, CouncilSession } from './councilTypes.js';
import { logger } from '../core/logger.js';

/** In-memory cancellation registry, scoped to this process — same "fire, then let the caller cancel by id" shape as taskManager.ts's abort-signal map, kept local here because a council session is not a DAG-tracked task. */
const abortControllers = new Map<string, AbortController>();

export function cancelCouncilSession(sessionId: string): boolean {
  const ctrl = abortControllers.get(sessionId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

function resolveSupervisorId(supervisorAgentId: string | undefined): string {
  const id = supervisorAgentId ?? 'supervisor';
  if (!AgentRegistry.has(id)) throw new Error(`وكيل الإشراف غير معروف: ${id}`);
  return id;
}

export async function runCouncilSession(input: CreateCouncilSessionInput, gwCtx: GatewayContext): Promise<{ sessionId: string }> {
  if (input.mode === 'situation_room') return startSituationRoom(input, gwCtx);
  return startCrossExam(input, gwCtx);
}

// ---------------------------------------------------------------------
// cross_exam (Slice 1) — unchanged behavior, only re-homed into this
// dispatch structure so both modes share one create/cancel/get surface.
// ---------------------------------------------------------------------

async function startCrossExam(input: Extract<CreateCouncilSessionInput, { mode?: 'cross_exam' }>, gwCtx: GatewayContext): Promise<{ sessionId: string }> {
  if (!AgentRegistry.has(input.proposerAgentId)) throw new Error(`وكيل الاقتراح غير معروف: ${input.proposerAgentId}`);
  if (!AgentRegistry.has(input.criticAgentId)) throw new Error(`وكيل النقد غير معروف: ${input.criticAgentId}`);
  if (input.proposerAgentId === input.criticAgentId) throw new Error('يجب أن يكون وكيل الاقتراح ووكيل النقد مختلفين.');
  const supervisorAgentId = resolveSupervisorId(input.supervisorAgentId);

  const id = `council_${Date.now()}_${randomUUID().slice(0, 8)}`;
  getRepos().council.create({
    id,
    mode: 'cross_exam',
    topic: input.topic,
    proposerAgentId: input.proposerAgentId,
    criticAgentId: input.criticAgentId,
    supervisorAgentId,
  });

  const controller = new AbortController();
  abortControllers.set(id, controller);
  void executeCrossExam(id, input, supervisorAgentId, gwCtx, controller.signal).finally(() => abortControllers.delete(id));
  return { sessionId: id };
}

/**
 * Phase 3 Slice 14 (Council/Swarm resume) — one reusable "did we already
 * persist this step?" check shared by executeCrossExam() below (and, from
 * Slice 15 onward, situation_room's per-participant rounds too). If a
 * round of this `kind` already exists for the session (i.e. a previous,
 * now-dead process already completed it before being interrupted), its
 * persisted content is reused verbatim and NO new provider call is made —
 * that's the entire point of resumability: never re-spend real tokens
 * re-doing work that already finished and was durably saved. Otherwise
 * `run()` is executed for real and its result is persisted exactly as the
 * original (pre-Slice-14) code always did.
 *
 * Deliberately NOT applied to the 'verification' round in either mode:
 * verification is cheap, stateless, and judge-provider-config-dependent,
 * so both cross_exam (this slice) and situation_room (Slice 15) always
 * re-run it fresh on resume rather than trusting a possibly-stale
 * persisted verdict — see executeCrossExam()'s verification step below,
 * unchanged from before this slice.
 */
async function stepOrReuse(
  existingRounds: CouncilRound[],
  kind: CouncilRoundKind,
  sessionId: string,
  agentId: string | null,
  run: () => Promise<{ output: string; providerUsed?: string | null; modelUsed?: string | null }>
): Promise<{ output: string; providerUsed: string | null; modelUsed: string | null }> {
  const repos = getRepos();
  const existing = existingRounds.find((r) => r.kind === kind);
  if (existing) {
    logger.info('Council resume: reusing already-persisted round, skipping re-execution', { sessionId, kind });
    return { output: existing.content, providerUsed: existing.providerUsed, modelUsed: existing.modelUsed };
  }
  const result = await run();
  repos.council.appendRound(sessionId, kind, agentId, result.output, result.providerUsed ?? null, result.modelUsed ?? null);
  return { output: result.output, providerUsed: result.providerUsed ?? null, modelUsed: result.modelUsed ?? null };
}

/**
 * Runs one bounded cross-examination round: Proposal -> Critique -> Rebuttal
 * -> independent Verification -> Supervisor Synthesis. Every text-producing
 * step goes through runAgentTask() (Slice 2) — this file adds ZERO new
 * provider-calling code; it only sequences existing, tested calls and
 * persists the transcript. Mirrors the frontend's runCrossExamination()
 * round-by-round (see councilTypes.ts's file doc comment).
 *
 * Phase 3 Slice 14: also resume-aware — every step (except verification,
 * see stepOrReuse()'s doc comment) checks whether it was already
 * completed and persisted by an earlier, now-dead process before doing
 * any real work, via stepOrReuse(). Called BOTH for a brand-new session
 * (startCrossExam(), existingRounds always []) and for resuming an
 * interrupted one (resumeInterruptedCouncilSessions() below, existingRounds
 * populated from whatever the dead process managed to persist).
 */
async function executeCrossExam(
  sessionId: string,
  input: Extract<CreateCouncilSessionInput, { mode?: 'cross_exam' }>,
  supervisorAgentId: string,
  gwCtx: GatewayContext,
  signal: AbortSignal
): Promise<void> {
  const repos = getRepos();
  const ctxBase = { missionId: sessionId, gwCtx, signal };
  const existingRounds = repos.council.rounds(sessionId);

  try {
    // Round 1 — Proposal
    const proposal = await stepOrReuse(existingRounds, 'proposal', sessionId, input.proposerAgentId, () =>
      runAgentTask(input.proposerAgentId, {
        ...ctxBase,
        agentId: input.proposerAgentId,
        taskNodeId: 'proposal',
        taskDescription: input.topic,
        upstreamOutputs: {},
      })
    );

    // Round 2 — Critique (attacks the actual proposal, not an independent view)
    const critique = await stepOrReuse(existingRounds, 'critique', sessionId, input.criticAgentId, () =>
      runAgentTask(input.criticAgentId, {
        ...ctxBase,
        agentId: input.criticAgentId,
        taskNodeId: 'critique',
        taskDescription:
          `السؤال الأصلي: ${input.topic}\n\n` +
          'مهمتك تحديداً الآن: هاجم الاقتراح التالي بصرامة وموضوعية من زاوية تخصصك، واكشف كل ثغرة أو خطر أو نقطة ضعف فيه. لا تطرح حلاً بديلاً كاملاً، ركّز فقط على النقد المحدد.',
        upstreamOutputs: { proposal: proposal.output },
      })
    );

    // Round 3 — Rebuttal
    const rebuttal = await stepOrReuse(existingRounds, 'rebuttal', sessionId, input.proposerAgentId, () =>
      runAgentTask(input.proposerAgentId, {
        ...ctxBase,
        agentId: input.proposerAgentId,
        taskNodeId: 'rebuttal',
        taskDescription: 'مهمتك تحديداً الآن: رد على نقد زميلك لاقتراحك — دافع عن النقاط الصحيحة، وعدّل اقتراحك بما يعالج أي ثغرة حقيقية أثارها.',
        upstreamOutputs: { proposal: proposal.output, critique: critique.output },
      })
    );

    // Round 4 — independent Verification (existing Verifier module, hardcoded to anthropic — pre-existing, documented limitation, not addressed by this slice). ALWAYS re-run, even on resume — see stepOrReuse()'s doc comment for why.
    const verdict = await Verifier.verify(input.topic, rebuttal.output, { taskId: sessionId });
    repos.council.appendRound(
      sessionId,
      'verification',
      null,
      verdict.ran
        ? `verdict=${verdict.verdict}; issues=${JSON.stringify(verdict.issues)}`
        : verdict.blockedReason
          ? 'verification did not run (cloud egress denied by privacy policy)'
          : 'verification did not run (judge provider not configured)',
      'anthropic',
      null
    );

    // Round 5 — Supervisor Synthesis
    const verifierNote = verdict.ran && verdict.issues.length ? `\n\nملاحظات مراجع مستقل (${verdict.verdict}): ${verdict.issues.join('؛ ')}` : '';
    const synthesis = await stepOrReuse(existingRounds, 'synthesis', sessionId, supervisorAgentId, () =>
      runAgentTask(supervisorAgentId, {
        ...ctxBase,
        agentId: supervisorAgentId,
        taskNodeId: 'synthesis',
        taskDescription:
          'بناءً على المناظرة الكاملة (اقتراح ← نقد ← رد)، اصغ الحل النهائي الأمتن: ادمج أفضل ما في الاقتراح الأصلي مع معالجة كل ثغرة حقيقية كشفها النقد. كن حاسماً وعملياً، ونظّم ردّك بعناوين واضحة.' +
            verifierNote,
        upstreamOutputs: { proposal: proposal.output, critique: critique.output, rebuttal: rebuttal.output },
      })
    );

    repos.council.complete(sessionId, synthesis.output, verdict.ran ? verdict.verdict : 'unavailable', verdict.ran ? verdict.issues.length : null);
  } catch (e) {
    const err = e as Error;
    if (signal.aborted) {
      repos.council.fail(sessionId, 'تم إلغاء الجلسة يدويًا.');
      logger.info('Council session cancelled', { sessionId });
      return;
    }
    repos.council.fail(sessionId, err.message);
    logger.warn('Council session failed', { sessionId, message: err.message });
  }
}

// ---------------------------------------------------------------------
// situation_room (Slice 4) — N parallel specialists -> supervisor tension
// analysis + per-agent follow-up -> targeted round 2 -> verification ->
// unified synthesis. See councilTypes.ts's file doc comment for the exact
// frontend pattern this ports (runSituationRoom()). The humanitarian-veto
// review pass is explicitly NOT ported in this slice — see
// PHASE3_SLICE4_REPORT.md.
// ---------------------------------------------------------------------

async function startSituationRoom(input: Extract<CreateCouncilSessionInput, { mode: 'situation_room' }>, gwCtx: GatewayContext): Promise<{ sessionId: string }> {
  const ids = input.participantAgentIds;
  if (!Array.isArray(ids) || ids.length < 2) throw new Error('غرفة العمليات تحتاج اختيار خبيرين متخصصين على الأقل.');
  if (new Set(ids).size !== ids.length) throw new Error('لا يمكن تكرار نفس الوكيل أكثر من مرة ضمن المشاركين.');
  const supervisorAgentId = resolveSupervisorId(input.supervisorAgentId);
  if (ids.includes(supervisorAgentId)) throw new Error('لا يمكن أن يكون المشرف نفسه أحد المشاركين المتخصصين.');
  for (const id of ids) {
    if (!AgentRegistry.has(id)) throw new Error(`وكيل متخصص غير معروف: ${id}`);
  }
  if (input.humanitarianVeto === true && !resolveVetoReviewerAgentId()) {
    throw new Error('تم طلب مراجعة الفيتو الإنساني لكن لا يوجد وكيل humanitarian_aid أو conflict_resolution مسجّل على هذا الخادم.');
  }

  const id = `council_${Date.now()}_${randomUUID().slice(0, 8)}`;
  getRepos().council.create({
    id,
    mode: 'situation_room',
    topic: input.topic,
    participantAgentIds: ids,
    supervisorAgentId,
    humanitarianVeto: input.humanitarianVeto === true,
  });

  const controller = new AbortController();
  abortControllers.set(id, controller);
  void executeSituationRoom(id, input.topic, ids, supervisorAgentId, gwCtx, controller.signal).finally(() => abortControllers.delete(id));
  return { sessionId: id };
}

interface SpecialistTurn {
  agentId: string;
  output: string;
}

/** Mirrors the frontend's own tolerance for partial round failures (Promise.allSettled, continue with whoever succeeded) rather than an all-or-nothing Promise.all — a genuinely different, deliberate reliability choice from cross_exam's strict sequential chain, ported faithfully rather than simplified away. */
async function runParallelSpecialists(
  ids: string[],
  buildTask: (agentId: string) => { taskNodeId: string; taskDescription: string; upstreamOutputs: Record<string, string> },
  ctxBase: { missionId: string; gwCtx: GatewayContext; signal: AbortSignal }
): Promise<SpecialistTurn[]> {
  const settled = await Promise.allSettled(
    ids.map((agentId) => {
      const t = buildTask(agentId);
      return runAgentTask(agentId, { ...ctxBase, agentId, ...t });
    })
  );
  const results: SpecialistTurn[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') results.push({ agentId: ids[i]!, output: r.value.output });
    else logger.warn('Situation room: a specialist turn failed, continuing with the rest', { agentId: ids[i], message: (r.reason as Error)?.message });
  });
  return results;
}

/**
 * Phase 3 Slice 15 — the situation_room counterpart to
 * stepOrReuse()/executeCrossExam()'s per-round resumability, but for a
 * round made of MULTIPLE independent per-participant turns rather than
 * one single call. For each participant, if a round of this `kind`
 * already exists for them (persisted by an earlier, now-dead process),
 * their output is reused verbatim and they are NOT re-run — only the
 * participants genuinely missing a persisted turn for this round are
 * actually called. Freshly-run turns are appended exactly as
 * runParallelSpecialists() always did; reused turns are NOT re-appended
 * (they are already durably there). The returned list is re-ordered back
 * to the original `ids` order so downstream prompt-building (round1Combined
 * etc.) is stable regardless of which subset was reused vs freshly run.
 */
async function runParallelSpecialistsResumable(
  ids: string[],
  existingRounds: CouncilRound[],
  kind: CouncilRoundKind,
  sessionId: string,
  buildTask: (agentId: string) => { taskNodeId: string; taskDescription: string; upstreamOutputs: Record<string, string> },
  ctxBase: { missionId: string; gwCtx: GatewayContext; signal: AbortSignal }
): Promise<SpecialistTurn[]> {
  const repos = getRepos();
  const alreadyPersisted = existingRounds.filter((r) => r.kind === kind);
  const alreadyIds = new Set(alreadyPersisted.map((r) => r.agentId).filter((a): a is string => a !== null));
  const missingIds = ids.filter((id) => !alreadyIds.has(id));

  if (alreadyPersisted.length > 0) {
    logger.info('Situation room resume: reusing already-persisted participant turns, only running the rest', { sessionId, kind, reused: alreadyPersisted.length, toRun: missingIds.length });
  }

  const freshlyRun = missingIds.length > 0 ? await runParallelSpecialists(missingIds, buildTask, ctxBase) : [];
  for (const r of freshlyRun) repos.council.appendRound(sessionId, kind, r.agentId, r.output, null, null);

  const byAgent = new Map<string, string>();
  for (const r of alreadyPersisted) byAgent.set(r.agentId!, r.content);
  for (const r of freshlyRun) byAgent.set(r.agentId, r.output);
  return ids.filter((id) => byAgent.has(id)).map((id) => ({ agentId: id, output: byAgent.get(id)! }));
}

function parseSupervisorAnalysis(raw: string): { tensionSummary: string; followups: Record<string, string> } {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as { tension_summary?: string; followups?: Record<string, string> };
    return { tensionSummary: parsed.tension_summary ?? '', followups: parsed.followups ?? {} };
  } catch {
    return { tensionSummary: '', followups: {} };
  }
}

/** Ported EXACTLY from the frontend's parseVetoRejectedItems() (same regex, same group order) so a raw review generated by either the frontend's client-side flow or this server-side flow parses identically. */
function parseVetoRejectedItems(reviewText: string): { item: string; reason: string }[] {
  if (!reviewText) return [];
  const items: { item: string; reason: string }[] = [];
  const re = /❌\s*مرفوض:\s*(.+?)\s*—\s*السبب:\s*(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reviewText))) {
    items.push({ item: m[1]!.trim(), reason: m[2]!.trim() });
  }
  return items;
}

/** Same fallback precedence as the frontend: humanitarian_aid first, conflict_resolution second. Returns null (not a throw) when neither exists, so the caller can decide how to degrade — see the humanitarianVeto branch in executeSituationRoom(), which fails the whole session rather than silently skipping the review a caller explicitly asked for. */
function resolveVetoReviewerAgentId(): string | null {
  if (AgentRegistry.has('humanitarian_aid')) return 'humanitarian_aid';
  if (AgentRegistry.has('conflict_resolution')) return 'conflict_resolution';
  return null;
}

/**
 * Phase 3 Slice 15: fully resume-aware, per-participant, matching the
 * design established for cross_exam in Slice 14 but extended to
 * situation_room's parallel-turn rounds:
 *  - round1_opinion / round2_followup: runParallelSpecialistsResumable()
 *    (above) — only participants missing a persisted turn are re-run.
 *  - supervisor_analysis / humanitarian_veto / synthesis: single-call
 *    steps, reused via the SAME stepOrReuse() executeCrossExam() uses.
 *  - verification: ALWAYS re-run on resume, same policy (and same
 *    reasoning — cheap, stateless) as cross_exam. Unchanged from before
 *    this slice.
 *  - humanitarianVeto is no longer a caller-supplied parameter — it is
 *    read directly off the persisted session row (migration 011), so a
 *    fresh start and a resume can never disagree about whether the
 *    review was requested (see councilTypes.ts's CouncilSession doc
 *    comment). The audit-trail log (AuditRepo.logVeto()) only fires the
 *    FIRST time the review genuinely runs — reusing a persisted review on
 *    resume must not duplicate that audit entry.
 */
async function executeSituationRoom(sessionId: string, topic: string, participantIds: string[], supervisorAgentId: string, gwCtx: GatewayContext, signal: AbortSignal): Promise<void> {
  const repos = getRepos();
  const ctxBase = { missionId: sessionId, gwCtx, signal };
  const session = repos.council.get(sessionId)!;
  const humanitarianVetoRequested = session.humanitarianVetoRequested;
  const existingRounds = repos.council.rounds(sessionId);

  try {
    // Round 1 — independent opinions, genuinely in parallel (resume-aware: only missing participants are re-run)
    const round1 = await runParallelSpecialistsResumable(participantIds, existingRounds, 'round1_opinion', sessionId, () => ({ taskNodeId: 'round1', taskDescription: topic, upstreamOutputs: {} }), ctxBase);
    if (round1.length === 0) {
      repos.council.fail(sessionId, 'فشل كل المشاركين في الجولة الأولى — لا يمكن المتابعة.');
      return;
    }
    const round1Combined = round1.map((r) => `[${r.agentId}]: ${r.output}`).join('\n\n');

    // Supervisor analyzes Round 1: tensions + targeted per-agent follow-ups
    const analysisRaw = await stepOrReuse(existingRounds, 'supervisor_analysis', sessionId, supervisorAgentId, () =>
      runAgentTask(supervisorAgentId, {
        ...ctxBase,
        agentId: supervisorAgentId,
        taskNodeId: 'supervisor_analysis',
        taskDescription:
          'أنت تدير "غرفة عمليات" بين عدة خبراء حول موضوع المستخدم. اقرأ آراءهم الأولية أدناه، وحدد: (1) أي تعارض أو نقطة تحتاج توضيح أو تكامل بين آرائهم، (2) سؤال متابعة قصير ومحدد لكل خبير (بمعرّفه) ليتعمّق أو يعلّق على رأي غيره. ' +
          `أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، بهذا الشكل بالضبط: {"tension_summary": "...", "followups": {${participantIds.map((id) => `"${id}": "..."`).join(', ')}}}\n\nالموضوع الأصلي: ${topic}\n\nآراء الجولة الأولى:\n${round1Combined}`,
        upstreamOutputs: {},
      })
    );
    const analysis = parseSupervisorAnalysis(analysisRaw.output);

    // Round 2 — each specialist answers THEIR OWN targeted follow-up, seeing every round-1 opinion (resume-aware, same as round 1)
    const round2 = await runParallelSpecialistsResumable(
      participantIds,
      existingRounds,
      'round2_followup',
      sessionId,
      (agentId) => ({
        taskNodeId: 'round2',
        taskDescription:
          `الموضوع الأصلي: ${topic}\n\nآراء كل الخبراء في الجولة الأولى:\n${round1Combined}\n\n` +
          `سؤال المشرف الموجّه لك تحديداً: ${analysis.followups[agentId] ?? 'راجع آراء بقية الخبراء أعلاه وأضف أي تعديل أو تأكيد على رأيك الأولي إن وجد.'}`,
        upstreamOutputs: {},
      }),
      ctxBase
    );
    const round2Combined = round2.map((r) => `[${r.agentId}]: ${r.output}`).join('\n\n');

    // Optional humanitarian-veto review (Slice 5b) — a real server-side
    // port of the frontend's opt-in review pass. Runs AFTER round 2 (so
    // the reviewer sees the fully-developed discussion, not just initial
    // opinions) and BEFORE synthesis (so its findings can actually gate
    // what the final report is allowed to recommend).
    let vetoInstruction = '';
    if (humanitarianVetoRequested) {
      const reviewerAgentId = resolveVetoReviewerAgentId()!; // already validated to exist in startSituationRoom()
      const existingVetoRound = existingRounds.find((r) => r.kind === 'humanitarian_veto');
      const vetoReview = await stepOrReuse(existingRounds, 'humanitarian_veto', sessionId, reviewerAgentId, () =>
        runAgentTask(reviewerAgentId, {
          ...ctxBase,
          agentId: reviewerAgentId,
          taskNodeId: 'humanitarian_veto',
          taskDescription:
            'راجع النقاش الكامل أدناه من منظورك الإنساني/الأخلاقي البحت. لأي بند أو توصية تراها ضارة أو غير مقبولة إنسانياً، اكتب سطراً بهذه الصيغة الحرفية بالضبط (لكل بند مرفوض سطر منفصل): "❌ مرفوض: <وصف مختصر للبند> — السبب: <السبب>". إن لم يكن هناك أي بند مرفوض، اذكر ذلك صراحة بدون استخدام هذه الصيغة.\n\n' +
            `الموضوع: ${topic}\n\nالجولة 1:\n${round1Combined}\n\nالجولة 2:\n${round2Combined}`,
          upstreamOutputs: {},
        })
      );

      const rejectedItems = parseVetoRejectedItems(vetoReview.output);
      if (!existingVetoRound) {
        // Only log to the (pre-existing) audit trail the FIRST time this review genuinely runs — reusing a persisted review on resume must never duplicate the audit entry.
        repos.audit.logVeto(topic, reviewerAgentId, rejectedItems, vetoReview.output);
      }

      if (rejectedItems.length) {
        vetoInstruction =
          '\n\nإلزامي: لا تُدرج أي بند وُسم بـ"❌ مرفوض" في مراجعة الفيتو الإنساني التالية ضمن الحل/التوصية النهائية تحت أي صياغة، حتى لو بدا مفيداً من زوايا أخرى. أضف قسماً منفصلاً وواضحاً بعنوان "🕊️ بنود مستبعدة (فيتو إنساني)" يسرد كل بند مرفوض وسببه كما ورد أدناه حرفياً:\n\n' +
          vetoReview.output;
      }
    }

    // Independent Verification (same pre-existing anthropic-only limitation as cross_exam). ALWAYS re-run, even on resume — see the stepOrReuse()/executeCrossExam() doc comment for why.
    const verdict = await Verifier.verify(topic, round2Combined || round1Combined, { taskId: sessionId });
    repos.council.appendRound(
      sessionId,
      'verification',
      null,
      verdict.ran
        ? `verdict=${verdict.verdict}; issues=${JSON.stringify(verdict.issues)}`
        : verdict.blockedReason
          ? 'verification did not run (cloud egress denied by privacy policy)'
          : 'verification did not run (judge provider not configured)',
      'anthropic',
      null
    );

    // Final unified synthesis
    const verifierNote = verdict.ran && verdict.issues.length ? `\n\nملاحظات مراجع مستقل (${verdict.verdict}): ${verdict.issues.join('؛ ')}` : '';
    const synthesis = await stepOrReuse(existingRounds, 'synthesis', sessionId, supervisorAgentId, () =>
      runAgentTask(supervisorAgentId, {
        ...ctxBase,
        agentId: supervisorAgentId,
        taskNodeId: 'synthesis',
        taskDescription:
          'بناءً على نقاش غرفة العمليات الكامل (جولتين من الخبراء المشاركين فعلاً)، اكتب تقريراً تنفيذياً واحداً موحداً بأقسام واضحة حسب تخصصات الخبراء الذين شاركوا فعلاً، ثم قسم أخير بعنوان "التوصية التنفيذية" يلخص الموقف بخطوات عملية قابلة للتنفيذ. لا تخترع تخصصات لم تشارك.' +
            verifierNote +
            vetoInstruction,
        upstreamOutputs: { round1: round1Combined, round2: round2Combined },
      })
    );

    repos.council.complete(sessionId, synthesis.output, verdict.ran ? verdict.verdict : 'unavailable', verdict.ran ? verdict.issues.length : null);
  } catch (e) {
    const err = e as Error;
    if (signal.aborted) {
      repos.council.fail(sessionId, 'تم إلغاء الجلسة يدويًا.');
      logger.info('Council session cancelled', { sessionId });
      return;
    }
    repos.council.fail(sessionId, err.message);
    logger.warn('Council session failed', { sessionId, message: err.message });
  }
}

export function getCouncilSession(id: string): CouncilSession | null {
  return getRepos().council.get(id);
}

/**
 * Phase 3 Slice 14/15 — council-layer counterpart to
 * missionRunner.ts's resumeInterruptedMissions(), called once at process
 * startup (see index.ts).
 *
 * cross_exam: a REAL resume — executeCrossExam() is invoked directly
 * (bypassing startCrossExam()'s repos.council.create(), since the session
 * row already exists) with a freshly reconstructed input built from the
 * persisted session row, and its own stepOrReuse()-driven round-skipping
 * (see executeCrossExam()'s doc comment) picks up exactly where the dead
 * process left off.
 *
 * situation_room (Slice 15): also a REAL resume now — executeSituationRoom()
 * is invoked directly with the persisted topic/participants/supervisor;
 * its own per-participant resumability (runParallelSpecialistsResumable())
 * and stepOrReuse()-driven single-step resumability pick up exactly where
 * the dead process left off, including a correctly-remembered
 * humanitarianVetoRequested flag (migration 011) rather than a guess.
 */
export async function resumeInterruptedCouncilSessions(): Promise<void> {
  const repos = getRepos();
  const sessions = repos.council.interruptedSessions();
  for (const session of sessions) {
    if (session.mode === 'situation_room') {
      if (!session.participantAgentIds || session.participantAgentIds.length < 2) {
        repos.council.fail(session.id, 'بيانات جلسة situation_room ناقصة (أقل من مشاركين اثنين) — لا يمكن استئنافها بأمان.');
        logger.warn('situation_room session missing/insufficient participantAgentIds on resume attempt — marked FAILED, not resumed', { sessionId: session.id });
        continue;
      }
      logger.info('Resuming interrupted situation_room council session', { sessionId: session.id, humanitarianVetoRequested: session.humanitarianVetoRequested });
      const controller = new AbortController();
      abortControllers.set(session.id, controller);
      const gwCtx: GatewayContext = { authenticated: true, clientKey: 'system-resume', projectId: null, userId: null };
      void executeSituationRoom(session.id, session.topic, session.participantAgentIds, session.supervisorAgentId, gwCtx, controller.signal)
        .catch((e) => logger.error('situation_room resume (startup) failed', { sessionId: session.id, message: (e as Error).message }))
        .finally(() => abortControllers.delete(session.id));
      continue;
    }
    if (!session.proposerAgentId || !session.criticAgentId) {
      repos.council.fail(session.id, 'بيانات جلسة cross_exam ناقصة (proposer/critic) — لا يمكن استئنافها بأمان.');
      logger.warn('cross_exam session missing proposer/critic on resume attempt — marked FAILED, not resumed', { sessionId: session.id });
      continue;
    }
    logger.info('Resuming interrupted cross_exam council session', { sessionId: session.id });
    const controller = new AbortController();
    abortControllers.set(session.id, controller);
    const gwCtx: GatewayContext = { authenticated: true, clientKey: 'system-resume', projectId: null, userId: null };
    const input: CreateCrossExamInput = {
      mode: 'cross_exam',
      topic: session.topic,
      proposerAgentId: session.proposerAgentId,
      criticAgentId: session.criticAgentId,
      supervisorAgentId: session.supervisorAgentId,
    };
    void executeCrossExam(session.id, input, session.supervisorAgentId, gwCtx, controller.signal)
      .catch((e) => logger.error('cross_exam resume (startup) failed', { sessionId: session.id, message: (e as Error).message }))
      .finally(() => abortControllers.delete(session.id));
  }
}

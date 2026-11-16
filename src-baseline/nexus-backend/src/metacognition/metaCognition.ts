import { runAgentTask } from '../agents/agentRunner.js';
import { getRepos } from '../persistence/repos.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import type { ImprovementProposal, ProposalCategory } from '../persistence/repositories/improvementProposalRepo.js';
import { Errors } from '../core/errors.js';
import { logger } from '../core/logger.js';

const VALID_CATEGORIES: ProposalCategory[] = ['planning', 'agent_selection', 'model_selection', 'verification', 'reliability', 'other'];

/**
 * Meta-Cognition (Phase 3 §Meta-Cognition — "أنشئ طبقة تراجع... لا تعدل
 * production مباشرة؛ أنشئ Improvement Proposal"). This file has
 * DELIBERATELY no "apply" or "auto-fix" function anywhere in it, and
 * ImprovementProposalRepo has no such method either — a finding here can
 * only ever become a row a human later reads and acknowledges/dismisses
 * via POST /v2/metacognition/proposals/:id/decide. Nothing in this
 * module can change an agent's definition, a routing mode, or any other
 * production config, by construction, not just by convention.
 *
 * Two independent sources of findings:
 *   1. reviewMission() — a real, bounded LLM reflection pass over ONE
 *      already-completed Mission's REAL persisted data (objective,
 *      failures, retryCount, replanCount, verification verdict, final
 *      output — all from missionTypes.ts's Mission, nothing invented).
 *      Uses the SAME runAgentTask() as every other agent call in this
 *      codebase — no new provider-calling logic.
 *   2. detectRepeatedFailurePatterns() — ZERO LLM calls. A real
 *      deterministic SQL aggregation over agentFailures (recorded by
 *      agentRunner.ts's catch block since Slice 2) via
 *      AgentFailureRepo.agentsWithFailuresSince(). A pattern here is a
 *      literal, countable fact, never a guess.
 */

function parseMetaFindings(raw: string): { category: ProposalCategory; observation: string; suggestedChange: string }[] | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as { findings?: Array<{ category?: string; observation?: string; suggested_change?: string }> };
    if (!Array.isArray(parsed.findings)) return null;
    return parsed.findings
      .map((f) => ({
        category: (VALID_CATEGORIES.includes(f.category as ProposalCategory) ? f.category : 'other') as ProposalCategory,
        observation: String(f.observation ?? '').trim(),
        suggestedChange: String(f.suggested_change ?? '').trim(),
      }))
      .filter((f) => f.observation.length > 0);
  } catch {
    return null; // malformed — distinct from "genuinely found nothing" (an empty array), handled differently by the caller
  }
}

/**
 * Reviews ONE completed mission. Requires a TERMINAL mission state
 * (COMPLETED/FAILED/CANCELLED) — reflecting on a still-RUNNING mission's
 * partial state would be reviewing a moving target, not a real outcome.
 * Returns the real proposals created — [] genuinely means the reviewer
 * found nothing worth flagging, not that the review failed silently (a
 * parse failure instead persists ONE fallback 'other' proposal with the
 * raw text, so a real paid-for API call is never just discarded).
 */
export async function reviewMission(missionId: string, gwCtx: GatewayContext): Promise<ImprovementProposal[]> {
  const repos = getRepos();
  const mission = repos.missions.get(missionId);
  if (!mission) throw Errors.notFound('Mission غير موجودة.');
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(mission.state)) {
    throw Errors.validation(`لا يمكن مراجعة مهمة لا تزال في حالة "${mission.state}" — انتظر حالة نهائية (COMPLETED/FAILED/CANCELLED).`);
  }

  const reviewPrompt =
    'أنت في وضع "تراجع ما بعد التنفيذ" (Meta-Cognition) — لا تنفّذ أي مهمة، فقط راجع مهمة سابقة اكتملت فعلياً بالبيانات التالية، وقيّم بصرامة: جودة التخطيط الأصلي، ملاءمة اختيار الوكلاء لطبيعة المهمة، عدد إعادة التخطيط والمحاولات الفاشلة، ونتيجة التحقق النهائي إن وجدت. لكل ملاحظة حقيقية ومحددة (وليست عامة أو مجاملة)، أضف بنداً. إن لم تجد أي ملاحظة حقيقية تستحق التسجيل، أعد findings فارغة — لا تخترع ملاحظات لمجرد ملء القائمة.\n\n' +
    `أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي: {"findings": [{"category": "planning|agent_selection|model_selection|verification|reliability|other", "observation": "...", "suggested_change": "..."}]}\n\n` +
    `الهدف الأصلي للمهمة: ${mission.objective}\n` +
    `الحالة النهائية: ${mission.state}\n` +
    `عدد إعادات التخطيط: ${mission.replanCount} (من أصل ${mission.maxReplans} مسموحة)\n` +
    `عدد المحاولات: ${mission.retryCount}\n` +
    `الإخفاقات المسجّلة أثناء التنفيذ: ${mission.failures.length ? JSON.stringify(mission.failures) : 'لا شيء'}\n` +
    `نتيجة التحقق المستقل: ${mission.result?.verification ? JSON.stringify(mission.result.verification) : 'لم يُشغَّل'}\n` +
    `الناتج النهائي (مختصر إلى 1500 حرف): ${(mission.result?.finalOutput ?? '(لا يوجد)').slice(0, 1500)}`;

  const review = await runAgentTask('supervisor', {
    agentId: 'supervisor',
    missionId: `metacog_${missionId}`,
    taskNodeId: 'meta_review',
    taskDescription: reviewPrompt,
    upstreamOutputs: {},
    gwCtx,
    signal: undefined,
  });

  const findings = parseMetaFindings(review.output);
  if (findings === null) {
    logger.warn('MetaCognition: mission review response failed to parse as structured findings — persisting a raw fallback proposal', { missionId });
    return [
      repos.improvementProposals.create({
        subjectType: 'mission',
        subjectId: missionId,
        category: 'other',
        observation: 'تعذّر تحليل استجابة المراجعة كـJSON منظّم — النص الخام محفوظ أدناه للمراجعة اليدوية.',
        suggestedChange: review.output,
      }),
    ];
  }

  return findings.map((f) =>
    repos.improvementProposals.create({
      subjectType: 'mission',
      subjectId: missionId,
      category: f.category,
      observation: f.observation,
      suggestedChange: f.suggestedChange || '(لم يقترح المراجع تغييراً محدداً)',
    })
  );
}

/**
 * Zero LLM calls — pure real aggregation over agentFailures. Returns the
 * newly created proposals only (agents already flagged with a still-open
 * proposal are skipped via ImprovementProposalRepo.hasOpenProposalFor(),
 * so calling this repeatedly, e.g. on a schedule, doesn't spam duplicate
 * rows for a pattern nobody has acted on yet).
 */
export function detectRepeatedFailurePatterns(windowMs: number, minCount: number): ImprovementProposal[] {
  const repos = getRepos();
  const patterns = repos.agentFailures.agentsWithFailuresSince(Date.now() - windowMs, minCount);
  const created: ImprovementProposal[] = [];
  for (const p of patterns) {
    if (repos.improvementProposals.hasOpenProposalFor('failure_pattern', p.agentId)) continue;
    created.push(
      repos.improvementProposals.create({
        subjectType: 'failure_pattern',
        subjectId: p.agentId,
        category: 'reliability',
        observation: `الوكيل "${p.agentId}" فشل ${p.count} مرة خلال آخر ${Math.round(windowMs / 60000)} دقيقة — هذا عدد حقيقي من agent_failures، وليس تقديراً.`,
        suggestedChange: `راجع آخر إخفاقات هذا الوكيل عبر AgentFailureRepo.recentForAgent('${p.agentId}') لتحديد السبب الجذري (مزوّد، حد maxTokens، توقيت) قبل أي تعديل على تعريفه في agentRegistry.ts.`,
      })
    );
  }
  return created;
}

import { getRepos } from '../persistence/repos.js';
import { cosineSimilarity } from '../memory/contextFabric.js';
import { runAgentTask } from '../agents/agentRunner.js';
import type { MemoryKind, MemoryItem } from '../persistence/repositories/memoryRepo.js';
import type { ConsolidationCandidate } from '../persistence/repositories/memoryConsolidationRepo.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { Errors } from '../core/errors.js';

/**
 * Dreaming / Memory Consolidation (Phase 3 §Dreaming — "اختبر أن Dreaming
 * لا يفسد أو يحذف المعرفة المهمة"). Enforced structurally, not just by
 * convention: NOTHING in this file calls MemoryRepo.remove() on an
 * original item, ever, under any code path. A "merge" only ever ADDS a
 * new, separate memory_items row; the two originals stay exactly as they
 * were, forever, unless a human separately and explicitly deletes them
 * later through the pre-existing memory-management flow (out of scope
 * for this file).
 *
 * Detection (findConsolidationCandidates): real cosine-similarity
 * pairwise comparison, reusing contextFabric.ts's EXACT similarity
 * function — zero LLM cost, zero new math. Only compares items that both
 * already have a populated embedding; an item with no embedding is
 * simply never a detection candidate (real, not fabricated coverage).
 *
 * Merging (mergeCandidate): the ONE place an LLM is used — a bounded,
 * explicit instruction to combine two items' content WITHOUT dropping
 * any real information from either, via the same runAgentTask() every
 * other agent call in this codebase uses.
 */

const MAX_SCAN_ITEMS = 200; // bounds the O(n^2) pairwise comparison cost of a single scan call

export function findConsolidationCandidates(projectId: string | null, kind: MemoryKind, threshold: number = 0.92): ConsolidationCandidate[] {
  if (threshold <= 0 || threshold > 1) throw Errors.validation('threshold يجب أن يكون بين 0 و1 (حصرياً فوق الصفر).');
  const repos = getRepos();
  const items = repos.memory.listForProject(projectId, kind, MAX_SCAN_ITEMS).filter((it) => it.embedding !== null);
  const created: ConsolidationCandidate[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const sim = cosineSimilarity(a.embedding!, b.embedding!);
      if (sim < threshold) continue;
      if (repos.memoryConsolidation.hasOpenCandidateFor(a.id, b.id)) continue;
      created.push(repos.memoryConsolidation.create({ projectId, kind, itemIdA: a.id, itemIdB: b.id, similarity: sim }));
    }
  }
  return created;
}

export function dismissCandidate(candidateId: string): ConsolidationCandidate {
  const existing = getRepos().memoryConsolidation.get(candidateId);
  if (!existing) throw Errors.notFound('اقتراح الدمج غير موجود.');
  if (existing.status !== 'open') throw Errors.validation(`تم البت في هذا الاقتراح مسبقاً (${existing.status}).`);
  return getRepos().memoryConsolidation.dismiss(candidateId)!;
}

/**
 * Requires explicit human confirmation to call at all (see
 * routes/v2/dreaming.ts — there is no automatic path into this
 * function). Creates a NEW memory item; the two originals are read-only
 * inputs here and are never touched.
 */
export async function mergeCandidate(candidateId: string, gwCtx: GatewayContext): Promise<{ candidate: ConsolidationCandidate; mergedItem: MemoryItem }> {
  const repos = getRepos();
  const candidate = repos.memoryConsolidation.get(candidateId);
  if (!candidate) throw Errors.notFound('اقتراح الدمج غير موجود.');
  if (candidate.status !== 'open') throw Errors.validation(`تم البت في هذا الاقتراح مسبقاً (${candidate.status}).`);

  const pool = repos.memory.listForProject(candidate.projectId, candidate.kind as MemoryKind, MAX_SCAN_ITEMS);
  const itemA = pool.find((it) => it.id === candidate.itemIdA);
  const itemB = pool.find((it) => it.id === candidate.itemIdB);
  if (!itemA || !itemB) throw Errors.notFound('أحد عنصري الذاكرة الأصليين لم يعد موجوداً — تعذّر الدمج.');

  const merge = await runAgentTask('supervisor', {
    agentId: 'supervisor',
    missionId: `dreaming_${candidateId}`,
    taskNodeId: 'memory_merge',
    taskDescription:
      'العنصران التاليان من الذاكرة متشابهان جداً بدلالياً (تشابه تضمين عالٍ). ادمجهما في عنصر معرفة واحد أكثر اكتمالاً وتماسكاً. إلزامي: لا تُسقِط أي معلومة حقيقية موجودة في أي من العنصرين، حتى لو بدت تفصيلاً ثانوياً — الهدف دمج وتوحيد الصياغة، وليس التلخيص أو الاختصار.\n\n' +
      `العنصر الأول (${itemA.title ?? 'بدون عنوان'}): ${itemA.content}\n\nالعنصر الثاني (${itemB.title ?? 'بدون عنوان'}): ${itemB.content}`,
    upstreamOutputs: {},
    gwCtx,
    signal: undefined,
  });

  const mergedItem = repos.memory.add({
    projectId: candidate.projectId,
    userId: null,
    kind: candidate.kind as MemoryKind,
    title: itemA.title ?? itemB.title,
    content: merge.output,
    embedding: null, // fresh content — a later embedding pass populates this when needed, never copied from either original
  });

  repos.memoryConsolidation.markMerged(candidateId, mergedItem.id);
  return { candidate: repos.memoryConsolidation.get(candidateId)!, mergedItem };
}

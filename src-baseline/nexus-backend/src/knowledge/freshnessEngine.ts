import { getProviderAdapter } from '../providers/index.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import { ServerConfig } from '../config/env.js';
import { getRepos } from '../persistence/repos.js';
import { runWebResearch } from '../research/webResearch.js';
import { fence } from '../security/promptInjectionGuard.js';
import { Errors } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { auditSecurityEvent } from '../security/audit.js';
import { assertCloudEgressAllowed } from '../security/cloudEgressGuard.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import type { FreshnessCheckRecord, Volatility, FreshnessStatus, RefreshComparison } from '../persistence/repositories/knowledgeFreshnessRepo.js';

/**
 * Knowledge Freshness Engine. A memory item stored today can silently
 * become wrong tomorrow — a stock price, a "current CEO of X", a live
 * status — while a historical fact or a definition never does. Nothing
 * in the pre-existing Memory system (memory/contextFabric.ts,
 * persistence/repositories/memoryRepo.ts) ever assessed this; a stored
 * item was retrieved the same way regardless of age or subject matter.
 *
 * Same judge-provider-call convention as verifier.ts/evaluationEngine.ts/
 * evolution/agentGenome.ts: a fixed judge provider (anthropic), called
 * directly via the low-level provider adapter, not through
 * runAgentTask()/the Agent Runtime.
 *
 * Real orchestration-level reuse, zero new provider-calling code:
 * refreshing a stale item calls runWebResearch() (Slice 12) exactly as
 * any other caller would. The refresh is NEVER applied automatically —
 * acceptRefresh() always requires an explicit human decision, the same
 * "propose, don't auto-apply" contract Meta-Cognition, Dreaming, and
 * Digital Genome all already follow. Accepting a refresh only ever ADDS a
 * new memory item (via the same MemoryRepo.add() every other writer
 * uses) — the original is never edited or deleted, matching Dreaming's
 * established "never delete originals" precedent for this exact table.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** GAP-1B: memory items carry no privacy label of their own, so the ONLY scope signal is one the caller attaches. It can only restrict (LOCAL_ONLY|PRIVATE), never widen. */
export interface FreshnessScope {
  privacyMode?: unknown;
}

function judgeConfigured(): boolean {
  return !!ProviderRegistry.resolve('anthropic').apiKey;
}

async function judgeCall(system: string, userContent: string, maxTokens: number): Promise<string | null> {
  if (!judgeConfigured()) return null;
  try {
    const adapter = getProviderAdapter('anthropic');
    const res = await adapter.chat({
      model: ProviderRegistry.resolve('anthropic').resolvedModel,
      system,
      messages: [{ role: 'user', content: userContent }],
      maxTokens,
      signal: AbortSignal.timeout(ServerConfig.judgeCallTimeoutMs), // dedicated resilience testing fix — see env.ts's judgeCallTimeoutMs doc comment
    });
    const block = res.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : null;
  } catch (e) {
    logger.warn('Knowledge Freshness judge call failed (non-fatal — treated as unavailable)', { message: (e as Error).message });
    return null;
  }
}

const VALID_VOLATILITY: Volatility[] = ['low', 'medium', 'high'];

async function classifyVolatility(content: string): Promise<{ volatility: Volatility; suggestedTtlDays: number; rationale: string }> {
  const raw = await judgeCall(
    'أنت مصنّف تقادم معرفة صارم. مهمتك: الحكم على مدى سرعة تغيّر حقيقة أو معلومة معينة في الواقع، بغض النظر عن محتواها الحالي. أمثلة: سعر سهم أو عملة (high، أيام قليلة)، "الرئيس التنفيذي الحالي لشركة" أو حالة حدث جارٍ (high إلى medium، أسابيع لأشهر)، إحصائية تنظيمية عامة غير حيّة (medium، شهور)، حقيقة تاريخية أو تعريف أو نظرية علمية ثابتة (low، سنوات). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي: {"volatility": "low"|"medium"|"high", "suggested_ttl_days": عدد صحيح موجب, "rationale": "شرح موجز"}',
    fence('محتوى المعرفة المطلوب تصنيفه', content),
    400
  );
  if (!raw) return { volatility: 'medium', suggestedTtlDays: 90, rationale: 'مزود الحكم غير متاح — قيمة افتراضية متحفظة (medium) بانتظار تقييم حقيقي لاحق.' };
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as { volatility?: string; suggested_ttl_days?: number; rationale?: string };
    const volatility = VALID_VOLATILITY.includes(parsed.volatility as Volatility) ? (parsed.volatility as Volatility) : 'medium';
    const suggestedTtlDays = Number.isInteger(parsed.suggested_ttl_days) && parsed.suggested_ttl_days! > 0 ? parsed.suggested_ttl_days! : 90;
    return { volatility, suggestedTtlDays, rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim() ? parsed.rationale.trim() : '(بلا مبرر نصي)' };
  } catch {
    return { volatility: 'medium', suggestedTtlDays: 90, rationale: 'تعذّر تحليل استجابة التصنيف — قيمة افتراضية متحفظة.' };
  }
}

function statusFromAge(ageDays: number, suggestedTtlDays: number): FreshnessStatus {
  if (ageDays >= suggestedTtlDays) return 'stale';
  if (ageDays >= suggestedTtlDays * 0.5) return 'aging';
  return 'fresh';
}

/** Runs (or re-runs) a freshness check for one memory item, right now — classifies volatility fresh each time (deliberately not cached/reused across checks, unlike stepOrReuse()'s pattern elsewhere: volatility classification is cheap, and reusing a STALE classification defeats the point of a freshness check). */
export async function checkFreshness(memoryItemId: string, scope: FreshnessScope = {}): Promise<FreshnessCheckRecord> {
  const repos = getRepos();
  const item = repos.memory.get(memoryItemId);
  if (!item) throw Errors.notFound('عنصر الذاكرة غير موجود.');
  // GAP-1B: the classifier is a fixed CLOUD provider and receives the memory item's content. Refuse (403) rather than storing a fake default classification.
  assertCloudEgressAllowed({ purpose: 'freshness_judge', provider: 'anthropic', privacyMode: scope.privacyMode });

  const ageDays = (Date.now() - item.createdAt) / MS_PER_DAY;
  const { volatility, suggestedTtlDays } = await classifyVolatility(item.content);
  const status = statusFromAge(ageDays, suggestedTtlDays);

  return repos.knowledgeFreshness.create({
    memoryItemId,
    ageDaysAtCheck: ageDays,
    volatility,
    suggestedTtlDays,
    status,
    refreshResearched: false,
    refreshNewContent: null,
    refreshComparison: null,
    refreshComparisonRationale: null,
  });
}

/**
 * For a check already flagged 'stale' (or 'aging' — refreshing early is a
 * legitimate caller choice, not restricted to only 'stale'), actually
 * re-researches the topic via Web Research and compares the new answer to
 * the original content. Still produces nothing more than a PROPOSAL —
 * the check row is updated with the new content + comparison, but no
 * memory item changes until a human calls acceptRefresh().
 */
export async function refreshStaleItem(checkId: string, gwCtx: GatewayContext, scope: FreshnessScope = {}): Promise<FreshnessCheckRecord> {
  const repos = getRepos();
  // GAP-1B: this path re-researches the item's text through Web Research (Gemini, CLOUD) and then a cloud judge — refuse BEFORE any of it runs.
  assertCloudEgressAllowed({ purpose: 'freshness_research', provider: 'gemini', privacyMode: scope.privacyMode });
  const check = repos.knowledgeFreshness.get(checkId);
  if (!check) throw Errors.notFound('فحص التقادم غير موجود.');
  if (check.status === 'fresh') throw Errors.validation('لا داعي لإعادة البحث — العنصر لا يزال ضمن فترة صلاحيته المقترحة (fresh).');
  if (check.decided) throw Errors.validation(`تم اتخاذ قرار بالفعل بشأن هذا الفحص (${check.decided}) — أنشئ فحصاً جديداً عبر checkFreshness() إن لزم.`);

  const item = repos.memory.get(check.memoryItemId);
  if (!item) throw Errors.notFound('عنصر الذاكرة الأصلي لم يعد موجوداً.');

  const researchQuestion = item.title?.trim() ? item.title : item.content.slice(0, 300);
  const research = await runWebResearch(researchQuestion, gwCtx, { persistToMemory: false, evaluate: false });
  if (!research.ran || !research.answer) {
    throw Errors.internal('تعذّر إجراء بحث حقيقي لتحديث هذا العنصر — مزود البحث (Gemini) غير متاح أو لم يُعِد إجابة.');
  }

  const comparisonRaw = await judgeCall(
    'أنت حكم مقارنة معرفة صارم. قارن بين محتوى قديم محفوظ ومحتوى جديد مُعاد بحثه لنفس الموضوع، واحكم هل المعلومة الجديدة: "unchanged" (تؤكد القديمة دون تغيير جوهري)، "updated" (تحدّث القديمة بمعلومة أحدث دون تناقض جذري)، أو "conflicting" (تتناقض جذرياً مع القديمة). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي: {"comparison": "unchanged"|"updated"|"conflicting", "rationale": "شرح موجز"}',
    `${fence('المحتوى القديم المحفوظ', item.content)}\n${fence('المحتوى الجديد من البحث', research.answer)}`,
    500
  );

  let comparison: RefreshComparison = 'updated';
  let rationale = '(مزود الحكم غير متاح — تُرك للمراجعة البشرية دون تصنيف تلقائي موثوق)';
  if (comparisonRaw) {
    try {
      const match = comparisonRaw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : comparisonRaw) as { comparison?: string; rationale?: string };
      const valid: RefreshComparison[] = ['unchanged', 'updated', 'conflicting'];
      comparison = valid.includes(parsed.comparison as RefreshComparison) ? (parsed.comparison as RefreshComparison) : 'updated';
      rationale = typeof parsed.rationale === 'string' && parsed.rationale.trim() ? parsed.rationale.trim() : rationale;
    } catch {
      /* keep the honest defaults above */
    }
  }

  const updated = repos.knowledgeFreshness.get(checkId)!; // re-read defensively in case anything changed concurrently
  return repos.knowledgeFreshness.recordRefreshResult(updated.id, research.answer, comparison, rationale);
}

/** Accepts a researched refresh: creates a NEW memory item with the refreshed content (the original is never touched) and marks the check decided. */
export function acceptRefresh(checkId: string, decidedBy: string): FreshnessCheckRecord {
  if (!decidedBy || !decidedBy.trim()) throw Errors.validation('decidedBy مطلوب — لا يمكن قبول تحديث بلا هوية بشرية حقيقية.');
  const repos = getRepos();
  const check = repos.knowledgeFreshness.get(checkId);
  if (!check) throw Errors.notFound('فحص التقادم غير موجود.');
  if (!check.refreshResearched || !check.refreshNewContent) throw Errors.validation('لا يوجد محتوى مُعاد بحثه لهذا الفحص بعد — نفّذ refreshStaleItem() أولاً.');
  if (check.decided) throw Errors.validation(`تم اتخاذ قرار بالفعل (${check.decided}).`);

  const original = repos.memory.get(check.memoryItemId);
  if (!original) throw Errors.notFound('عنصر الذاكرة الأصلي لم يعد موجوداً.');

  const newItem = repos.memory.add({
    projectId: original.projectId,
    userId: original.userId,
    kind: original.kind,
    title: original.title,
    content: check.refreshNewContent,
    embedding: null,
  });
  const decided = repos.knowledgeFreshness.decide(checkId, 'accepted', decidedBy, newItem.id);
  auditSecurityEvent('info', 'Knowledge Freshness: refresh accepted — new memory item created', { checkId, originalMemoryItemId: check.memoryItemId, newMemoryItemId: newItem.id, decidedBy });
  return decided;
}

export function dismissRefresh(checkId: string, decidedBy: string): FreshnessCheckRecord {
  if (!decidedBy || !decidedBy.trim()) throw Errors.validation('decidedBy مطلوب.');
  const repos = getRepos();
  const check = repos.knowledgeFreshness.get(checkId);
  if (!check) throw Errors.notFound('فحص التقادم غير موجود.');
  if (check.decided) throw Errors.validation(`تم اتخاذ قرار بالفعل (${check.decided}).`);
  return repos.knowledgeFreshness.decide(checkId, 'dismissed', decidedBy, null);
}

/** Batch entry point — checks freshness for every memory item in a project that hasn't been checked in the last day (skip-recent guard keeps a repeated scan from re-classifying the same items pointlessly). Returns every check performed, fresh included — callers filter for 'stale' via GET /v2/knowledge-freshness/stale for the actionable subset. */
export async function scanForStaleness(projectId: string | null, limit = 50, scope: FreshnessScope = {}): Promise<FreshnessCheckRecord[]> {
  const repos = getRepos();
  const items = repos.memory.listForProject(projectId, undefined, limit);
  const results: FreshnessCheckRecord[] = [];
  for (const item of items) {
    const latest = repos.knowledgeFreshness.latestForItem(item.id);
    if (latest && Date.now() - latest.checkedAt < MS_PER_DAY) continue; // checked recently enough — skip, not a re-classification churn
    results.push(await checkFreshness(item.id, scope));
  }
  return results;
}

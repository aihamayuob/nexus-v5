import type { ProviderId } from '../config/providerRegistry.js';
import { getProviderAdapter } from '../providers/index.js';
import { routeModel } from '../providers/modelRouter.js';
import type { DagPlan, DagTaskDef } from './dagTypes.js';
import { Errors } from '../core/errors.js';
import { ServerConfig } from '../config/env.js';

const PLANNER_SYSTEM_PROMPT = `أنت مخطط مهام. تُقسّم هدفاً معقداً إلى مهام فرعية صغيرة قابلة للتنفيذ المتوازي حيثما أمكن.
أجب حصراً بصيغة JSON بهذا الشكل ولا شيء غيره:
{"tasks": [{"id": "معرف_قصير_بالإنجليزية", "description": "وصف عملي واضح لما يجب إنجازه بهذه المهمة تحديداً", "dependsOn": ["معرفات المهام التي يجب إنجازها أولاً، أو مصفوفة فارغة"]}]}
قواعد:
- بين 2 و7 مهام فرعية، لا أكثر ولا أقل حسب تعقيد الهدف الفعلي.
- استخدم dependsOn فقط عندما تحتاج مهمة فعلياً لنتيجة مهمة أخرى قبل أن تبدأ — لا تجعل كل شيء متسلسلاً إن كان يمكن تنفيذه بالتوازي.
- كل id فريد، مختصر، بأحرف إنجليزية صغيرة وشرطات سفلية فقط (مثل "gather_data" أو "draft_summary").
- لا تكرر الهدف نفسه كمهمة واحدة — قسّمه فعلياً.`;

function validatePlanShape(parsed: unknown): DagTaskDef[] {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    throw Errors.provider('استجابة التخطيط بصيغة غير صالحة.', false);
  }
  const rawTasks = (parsed as { tasks: unknown[] }).tasks;
  const ids = new Set<string>();
  const tasks: DagTaskDef[] = [];
  for (const raw of rawTasks) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof (raw as { id?: unknown }).id !== 'string' ||
      typeof (raw as { description?: unknown }).description !== 'string'
    ) {
      continue; // skip malformed entries rather than failing the whole plan
    }
    const t = raw as { id: string; description: string; dependsOn?: unknown };
    const dependsOn = Array.isArray(t.dependsOn) ? t.dependsOn.filter((d): d is string => typeof d === 'string') : [];
    if (ids.has(t.id)) continue; // drop duplicate ids defensively
    ids.add(t.id);
    tasks.push({ id: t.id, description: t.description, dependsOn });
  }
  if (tasks.length === 0) throw Errors.provider('لم يُنتج التخطيط أي مهام صالحة.', false);
  // Drop dependsOn references to ids that don't exist in the plan — the
  // DAG executor's depsSatisfied()/depsBlocked() would otherwise treat a
  // dangling reference as permanently unsatisfied and the node would never
  // become ready, silently hanging that branch of the plan forever.
  const validIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.dependsOn = t.dependsOn.filter((d) => validIds.has(d) && d !== t.id);
  return tasks;
}

export async function planGoal(goal: string, providerId: ProviderId, signal?: AbortSignal): Promise<DagPlan> {
  const routed = routeModel(providerId, { complexity: 'high' });
  const adapter = getProviderAdapter(routed.provider);
  // Dedicated resilience-gap fix: this call used to pass only the mission's own
  // cancellation signal straight through — meaning an unresponsive provider during
  // PLANNING (the single most central call in a mission's whole lifecycle) had NO
  // bounded timeout at all, only the 10-minute NEXUS_PLAN_TIMEOUT_MS whole-mission
  // wall-clock ceiling (ServerConfig.planTimeoutMs). That's the exact same class of gap
  // the earlier resilience pass fixed for Verifier/EvaluationEngine/Digital
  // Genome/Knowledge Freshness/Web Research (see env.ts's judgeCallTimeoutMs doc
  // comment) — it just didn't reach this call site. Uses defaultTaskTimeoutMs (not the
  // shorter judgeCallTimeoutMs) since planning is a full plan-generation completion,
  // not a quick classification call — same reasoning webResearch.ts already uses.
  // Combines (rather than replaces) the caller's signal via AbortSignal.any() so a
  // real user-initiated mission cancel during planning still works exactly as before.
  const timeoutSignal = AbortSignal.timeout(ServerConfig.defaultTaskTimeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await adapter.chat({
    model: routed.model,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `الهدف: ${goal}` }],
    maxTokens: 1500,
    signal: combinedSignal,
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw Errors.provider('لم يُرجع التخطيط أي JSON قابل للتحليل.', true);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw Errors.provider('تعذّر تحليل استجابة التخطيط.', true);
  }
  const tasks = validatePlanShape(parsed);
  return { goal, provider: routed.provider, tasks };
}

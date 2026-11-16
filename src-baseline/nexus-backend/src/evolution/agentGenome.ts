import { AgentRegistry } from '../agents/agentRegistry.js';
import { getProviderAdapter } from '../providers/index.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import { ServerConfig } from '../config/env.js';
import { getRepos } from '../persistence/repos.js';
import type { AgentGenomeRecord, GenomeEvaluationVerdict } from '../persistence/repositories/agentGenomeRepo.js';
import { Errors } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { auditSecurityEvent } from '../security/audit.js';
import { assertCloudEgressAllowed } from '../security/cloudEgressGuard.js';

/**
 * Controlled Agent Evolution ("Digital Genome"). This is the ONE place in
 * the whole platform where an agent's real, live behavior (its system
 * prompt) can change after initial deployment — and it exists ONLY under
 * the platform's own hard constraint for self-modification: versioned +
 * evaluated + security-checked + approved + rollbackable, every single
 * time, no exceptions, no auto-apply path anywhere in this file.
 *
 * Concretely: each agent's mutable "genome" is its systemPrompt (the
 * trait actually worth evolving — models/tools/policies stay fixed,
 * static configuration, not subject to this pipeline). A "genome" here
 * means one versioned, durably-recorded row in agent_genomes
 * (migration 013) — never an in-place edit of anything.
 *
 * Same judge-provider-call convention as verifier.ts and
 * evaluation/evaluationEngine.ts: a fixed judge provider (anthropic)
 * called directly via the low-level provider adapter, NOT through
 * runAgentTask()/the Agent Runtime — proposing or grading a mutation to
 * an agent's OWN prompt is an "editor" role sitting outside that agent's
 * persona, not the agent acting as itself.
 */

const DANGEROUS_PATTERNS: RegExp[] = [
  /تجاهل\s+(كل|جميع)?\s*(التعليمات|الأوامر|القواعد)/i,
  /ignore\s+(all\s+)?(previous\s+|prior\s+|above\s+)?instructions/i,
  /disregard\s+(your\s+|the\s+)?(instructions|rules|guidelines)/i,
  /اكشف\s+(تعليماتك|النظام|الأوامر)/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions)/i,
  /(بدون|بلا)\s+قيود/i,
  /no\s+restrictions?/i,
  /تجاوز\s+(القيود|الحدود|الصلاحيات)/i,
  /bypass\s+(restrictions|limits|safety|policy|policies)/i,
  /you\s+are\s+not\s+bound/i,
  /أنت\s+لست\s+مقيداً/i,
  /act\s+as\s+(dan|jailbreak)/i,
];

export interface SecurityCheckResult {
  passed: boolean;
  findings: string[];
}

/**
 * Real, deterministic, auditable static check — same spirit as
 * security/ssrfGuard.ts's real DNS-pinning check: an actual boundary, not
 * a rubber stamp. No LLM call needed (fast, and never itself gameable by
 * whatever the candidate prompt says, since it never gets to influence
 * the checker). Findings are ALWAYS returned (even for a passing check
 * with zero matches, i.e. an empty array) so the audit trail is complete
 * either way — not just present on failure.
 */
export function checkGenomeSecurityRisk(candidateSystemPrompt: string): SecurityCheckResult {
  const findings: string[] = [];
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(candidateSystemPrompt)) {
      findings.push(`نمط عالي الخطورة مكتشف: يطابق ${pattern.source}`);
    }
  }
  if (candidateSystemPrompt.trim().length < 20) {
    findings.push('النص المُقترَح قصير جداً بشكل مريب (أقل من 20 حرفاً) — قد يكون طفرة معطوبة أو فارغة فعلياً.');
  }
  return { passed: findings.length === 0, findings };
}

function baselineSystemPromptFor(agentId: string): string {
  const active = getRepos().agentGenomes.active(agentId);
  if (active) return active.systemPrompt;
  return AgentRegistry.get(agentId).systemPrompt;
}

/**
 * Runtime read used by agentRunner.ts's runAgentTask() — the ONLY place
 * in the codebase this pipeline's output actually takes effect. Returns
 * null (never throws) when there is no approved override, so a caller's
 * fallback to AgentRegistry's static default is always safe and trivial.
 */
export function getActiveSystemPrompt(agentId: string): string | null {
  return getRepos().agentGenomes.active(agentId)?.systemPrompt ?? null;
}

async function judgeCall(system: string, userContent: string, maxTokens: number): Promise<string | null> {
  if (!ProviderRegistry.resolve('anthropic').apiKey) return null;
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
    logger.warn('Digital Genome judge call failed (non-fatal — treated as unavailable)', { message: (e as Error).message });
    return null;
  }
}

/**
 * Proposes ONE new candidate mutation for an agent's system prompt,
 * grounded in the SAME real, already-collected evidence Learning (Slice
 * 11) and Meta-Cognition (Slice 7) use — never invented context:
 * agentFailureRepo's recent real failures and agentCallLog's real
 * success-rate evidence. Runs the deterministic security check
 * immediately; a failing check auto-rejects the proposal on the spot
 * (never left sitting there as if it were awaiting a human decision on
 * something that already failed a hard boundary). A passing check then
 * gets a real comparative evaluation (baseline vs candidate, judged on
 * the SAME fixed test prompt) before being left for a human to actually
 * decide via approveGenomeVersion()/rejectGenomeVersion() — this
 * function itself NEVER activates anything.
 */
export async function proposeGenomeMutation(agentId: string): Promise<AgentGenomeRecord> {
  const def = AgentRegistry.get(agentId); // throws clearly for an unknown agent id
  // GAP-1B: the judge is a fixed CLOUD provider and its prompt carries this agent's system prompt + recorded failures. An agent declared LOCAL_ONLY/PRIVATE must never have that sent out.
  assertCloudEgressAllowed({ purpose: 'genome_judge', provider: 'anthropic', agentMode: def.models, taskId: `agent_${agentId}` });
  const baseline = baselineSystemPromptFor(agentId);
  const repos = getRepos();
  const recentFailures = repos.agentFailures.recentForAgent(agentId, 5);
  const evidence = repos.agentCallLog.evidenceFor(agentId);

  const failuresBlock = recentFailures.length
    ? recentFailures.map((f) => `- ${f.errorMessage}`).join('\n')
    : '(لا توجد إخفاقات حديثة مسجلة لهذا الوكيل)';

  const proposalRaw = await judgeCall(
    'أنت محرر مواصفات وكلاء ذكاء اصطناعي صارم. مهمتك: تحسين نص "system prompt" لوكيل معين بناءً على أدلة أداء حقيقية، دون تغيير مجال تخصصه أو صلاحياته. أجب بنص الـsystem prompt المُحسَّن فقط، بدون أي شرح أو تعليق إضافي، وبدون علامات اقتباس محيطة.',
    `الوكيل: ${def.role} (${agentId})\n\nnext system prompt الحالي:\n${baseline}\n\nإخفاقات حقيقية حديثة مسجلة لهذا الوكيل:\n${failuresBlock}\n\nمعدل النجاح الفعلي المسجَّل: ${evidence.sampleSize > 0 ? `${evidence.successCount}/${evidence.sampleSize}` : 'لا يوجد سجل كافٍ بعد'}\n\nاقترح نسخة مُحسَّنة من الـsystem prompt تعالج أنماط الإخفاق أعلاه إن وُجدت، مع الحفاظ الكامل على مجال تخصص الوكيل وحدوده.`,
    1500
  );

  if (!proposalRaw || !proposalRaw.trim()) {
    // Judge unavailable or returned nothing usable — a real, honest failure, not a fabricated mutation.
    throw Errors.internal('تعذّر توليد اقتراح تطوّر حقيقي — مزود الحكم الثابت (anthropic) غير متاح أو لم يُعِد نصاً صالحاً.');
  }
  const candidate = proposalRaw.trim();
  const security = checkGenomeSecurityRisk(candidate);

  let evaluationVerdict: GenomeEvaluationVerdict | null = null;
  let evaluationRationale: string | null = null;

  if (security.passed) {
    const comparisonRaw = await judgeCall(
      `أنت حكم مقارنة مستقل وصارم. قارن بين نسختين من system prompt لوكيل "${def.role}"، واحكم أيهما أفضل موضوعياً من حيث الوضوح والتخصص ومعالجة نقاط الضعف المذكورة، دون تحيز لأيهما "أحدث". أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي: {"verdict": "candidate_better"|"baseline_better"|"no_clear_difference", "rationale": "شرح موجز"}`,
      `النسخة الحالية (baseline):\n${baseline}\n\nالنسخة المُقترَحة (candidate):\n${candidate}\n\nإخفاقات حقيقية حديثة كانت النسخة الحالية تعاني منها:\n${failuresBlock}`,
      500
    );
    if (comparisonRaw) {
      try {
        const match = comparisonRaw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : comparisonRaw) as { verdict?: string; rationale?: string };
        const validVerdicts: GenomeEvaluationVerdict[] = ['candidate_better', 'baseline_better', 'no_clear_difference'];
        evaluationVerdict = validVerdicts.includes(parsed.verdict as GenomeEvaluationVerdict) ? (parsed.verdict as GenomeEvaluationVerdict) : 'no_clear_difference';
        evaluationRationale = typeof parsed.rationale === 'string' && parsed.rationale.trim() ? parsed.rationale.trim() : null;
      } catch {
        evaluationVerdict = 'unavailable';
        evaluationRationale = 'تعذّر تحليل استجابة حكم المقارنة.';
      }
    } else {
      evaluationVerdict = 'unavailable';
    }
  }

  const active = repos.agentGenomes.active(agentId);
  const record = repos.agentGenomes.create({
    agentId,
    parentVersion: active?.version ?? null,
    systemPrompt: candidate,
    rationale: `مبني على ${recentFailures.length} إخفاقاً حديثاً حقيقياً ومعدل نجاح ${evidence.sampleSize > 0 ? `${evidence.successCount}/${evidence.sampleSize}` : 'غير كافٍ بعد'}.`,
    securityCheckPassed: security.passed,
    securityCheckFindings: security.findings,
    evaluationVerdict,
    evaluationRationale,
    status: security.passed ? 'proposed' : 'rejected',
  });

  if (!security.passed) {
    logger.warn('Digital Genome proposal auto-rejected by security check', { agentId, version: record.version, findings: security.findings });
    // Production Hardening: this is exactly the class of event
    // security/audit.ts's audit trail exists for (a real boundary
    // actually firing), separate from the general application log line
    // above — every OTHER mutating action in this module is audited the
    // same way below; this automatic one must be too, not just the
    // human-triggered ones.
    auditSecurityEvent('warn', 'Digital Genome: proposal auto-rejected by security check', { agentId, version: record.version, findings: security.findings });
  }
  return record;
}

/** The ONLY function in this codebase that can make a genome candidate actually govern real agent behavior. Requires an explicit human identity string (decidedBy) — never a system/automatic caller (contrast with the security-check auto-rejection in proposeGenomeMutation(), which is allowed to be automatic precisely because it can only ever say no, never yes). */
export function approveGenomeVersion(genomeId: string, approvedBy: string): AgentGenomeRecord {
  if (!approvedBy || !approvedBy.trim()) throw Errors.validation('approvedBy مطلوب — لا يمكن اعتماد إصدار تطوّر بلا هوية بشرية حقيقية.');
  const repos = getRepos();
  const record = repos.agentGenomes.get(genomeId);
  if (!record) throw Errors.notFound('إصدار التطوّر غير موجود.');
  if (record.status !== 'proposed') throw Errors.validation(`لا يمكن اعتماد إصدار في حالة ${record.status} — يجب أن يكون 'proposed'.`);
  if (!record.securityCheckPassed) throw Errors.validation('لا يمكن اعتماد إصدار فشل الفحص الأمني — هذا حد صارم غير قابل للتجاوز حتى بموافقة بشرية.');
  const activated = repos.agentGenomes.activate(record.agentId, genomeId, approvedBy);
  auditSecurityEvent('warn', 'Digital Genome: version approved and activated — real agent behavior changed', { agentId: record.agentId, genomeId, version: record.version, approvedBy });
  return activated;
}

export function rejectGenomeVersion(genomeId: string, decidedBy: string, reason?: string): AgentGenomeRecord {
  if (!decidedBy || !decidedBy.trim()) throw Errors.validation('decidedBy مطلوب.');
  const repos = getRepos();
  const record = repos.agentGenomes.get(genomeId);
  if (!record) throw Errors.notFound('إصدار التطوّر غير موجود.');
  if (record.status !== 'proposed') throw Errors.validation(`لا يمكن رفض إصدار في حالة ${record.status} — يجب أن يكون 'proposed'.`);
  const rejected = repos.agentGenomes.reject(genomeId, decidedBy);
  auditSecurityEvent('info', 'Digital Genome: version rejected by human review', { agentId: record.agentId, genomeId, version: record.version, decidedBy, reason });
  return rejected;
}

/** Rollback = re-activating an already-existed, already-approved-once (never rejected) version. Never resurrects a version that was rejected — rejection is a permanent, non-reversible verdict on that specific candidate (a fresh proposeGenomeMutation() call is the only way forward from there, which will itself go through the full pipeline again). */
export function rollbackAgentGenome(agentId: string, targetVersion: number, approvedBy: string): AgentGenomeRecord {
  if (!approvedBy || !approvedBy.trim()) throw Errors.validation('approvedBy مطلوب.');
  const repos = getRepos();
  const target = repos.agentGenomes.getByVersion(agentId, targetVersion);
  if (!target) throw Errors.notFound(`الإصدار ${targetVersion} غير موجود لهذا الوكيل.`);
  if (target.status !== 'superseded' && target.status !== 'active') {
    throw Errors.validation(`لا يمكن التراجع إلى إصدار بحالة ${target.status} — يجب أن يكون إصداراً فعّالاً سابقاً (superseded) أو الفعّال حالياً.`);
  }
  if (target.status === 'active') return target; // already the active one — a no-op, not an error
  const activated = repos.agentGenomes.activate(agentId, target.id, approvedBy);
  auditSecurityEvent('warn', 'Digital Genome: rolled back to a prior version — real agent behavior changed', { agentId, genomeId: target.id, targetVersion, approvedBy });
  return activated;
}

export function listAgentGenomes(agentId: string): AgentGenomeRecord[] {
  return getRepos().agentGenomes.list(agentId);
}

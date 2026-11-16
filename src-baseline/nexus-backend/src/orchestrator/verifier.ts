import { getProviderAdapter } from '../providers/index.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import { ServerConfig } from '../config/env.js';
import { logger } from '../core/logger.js';
import { checkCloudEgress } from '../security/cloudEgressGuard.js';

export interface VerificationVerdict {
  ran: boolean;
  ok: boolean;
  verdict: 'ok' | 'issues_found' | 'unavailable';
  issues: string[];
  /** GAP-1B: set (and `ran` false) when the cloud judge was NOT called because the work is privacy-restricted — distinct from 'judge not configured'. */
  blockedReason?: 'cloud_egress_denied';
}

const VERIFY_SYSTEM_PROMPT = `أنت مراجع مستقل صارم. مهمتك الوحيدة فحص إجابة مقترحة على سؤال، والبحث عن أخطاء واقعية، تناقضات منطقية، أو ادعاءات غير مدعومة. لا تُعد صياغة الإجابة ولا تحسّنها. أجب حصراً بصيغة JSON بالشكل التالي ولا شيء غيره:
{"verdict": "ok" | "issues_found", "issues": ["وصف موجز لكل مشكلة حقيقية، إن وجدت"]}
إن لم تجد أي مشكلة جوهرية، أعد verdict:"ok" وissues:[] فارغة. لا تخترع مشاكل شكلية بسيطة — فقط ما يؤثر فعلياً على صحة أو موثوقية الإجابة.`;

export const Verifier = {
  shouldVerify(intent: { requiresVerification?: boolean }): boolean {
    return !!intent.requiresVerification;
  },

  async verify(question: string, draftAnswer: string, scope: { taskId?: string | null; privacyMode?: unknown } = {}): Promise<VerificationVerdict> {
    if (!ProviderRegistry.resolve('anthropic').apiKey) {
      // Verification is a nice-to-have safety net, not a hard requirement
      // — if the fixed judge provider isn't configured, degrade to "did
      // not run" rather than blocking the whole response.
      return { ran: false, ok: false, verdict: 'unavailable', issues: [] };
    }
    // GAP-1B: the judge is a fixed CLOUD provider. A privacy-restricted task's output must never reach it — fail closed (verification did not run).
    if (!checkCloudEgress({ purpose: 'verification', provider: 'anthropic', taskId: scope.taskId, privacyMode: scope.privacyMode })) {
      return { ran: false, ok: false, verdict: 'unavailable', issues: [], blockedReason: 'cloud_egress_denied' };
    }
    try {
      const adapter = getProviderAdapter('anthropic');
      const res = await adapter.chat({
        model: ProviderRegistry.resolve('anthropic').resolvedModel,
        system: VERIFY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `السؤال: ${question}\n\nالإجابة المقترحة:\n${draftAnswer}` }],
        maxTokens: 500,
        signal: AbortSignal.timeout(ServerConfig.judgeCallTimeoutMs), // Dedicated resilience testing fix — see env.ts's judgeCallTimeoutMs doc comment; this call had no timeout at all before, confirmed to hang indefinitely against an unresponsive endpoint.
      });
      const textBlock = res.content.find((b) => b.type === 'text');
      const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}') as { verdict?: string; issues?: string[] };
      const verdict = parsed.verdict === 'issues_found' ? 'issues_found' : 'ok';
      return { ran: true, ok: true, verdict, issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 10) : [] };
    } catch (e) {
      logger.warn('Verifier call failed (non-fatal — treated as did-not-run)', { message: (e as Error).message });
      return { ran: false, ok: false, verdict: 'unavailable', issues: [] };
    }
  },
};

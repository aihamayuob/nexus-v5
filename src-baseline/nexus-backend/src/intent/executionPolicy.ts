import type { AnalyzedIntent } from './intentEngine.js';

/**
 * LOW        -> fast path: one model call, no planner, no verifier, no approval.
 * MEDIUM     -> targeted multi-step: may use tools, may involve a short DAG, no mandatory verifier.
 * HIGH       -> planner + parallel agents + verifier (Verifier.shouldVerify already gates on this).
 * HIGH_RISK  -> everything HIGH gets, PLUS a human approval gate before final execution/delivery
 *               (see orchestrator/approvalGate.ts) — for requests whose subject matter carries
 *               real-world consequence (medical/legal/financial-irreversible/safety), not just
 *               requests that are merely long or analytically complex.
 */
export type ExecutionTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGH_RISK';

/**
 * Deliberately reuses analyzeIntent()'s existing risk/complexity signals
 * rather than introducing a second classifier — one heuristic source of
 * truth, read by both Verifier.shouldVerify() and this policy, so the two
 * can never disagree about what counts as "risky" for the same request.
 */
export function classifyExecutionTier(intent: AnalyzedIntent): ExecutionTier {
  if (intent.risk === 'high') return 'HIGH_RISK';
  if (intent.complexity === 'high') return 'HIGH';
  if (intent.complexity === 'medium' || intent.needsTools) return 'MEDIUM';
  return 'LOW';
}

export interface ExecutionPlanDecision {
  tier: ExecutionTier;
  useMultiAgent: boolean;
  useMultiModel: boolean;
  useToolsAllowed: boolean;
  requireVerification: boolean;
  requireApproval: boolean;
  reasoning: string;
}

/**
 * The single decision point for "how much machinery does this request
 * actually need" — called once per incoming request, before any model
 * call is made, so a simple question never pays the cost/latency of the
 * full DAG+verifier+approval pipeline, and a genuinely high-stakes
 * request never SKIPS the safeguards that pipeline provides.
 */
export function decideExecutionPlan(intent: AnalyzedIntent): ExecutionPlanDecision {
  const tier = classifyExecutionTier(intent);
  switch (tier) {
    case 'LOW':
      return {
        tier,
        useMultiAgent: false,
        useMultiModel: false,
        useToolsAllowed: intent.needsTools ?? false,
        requireVerification: false,
        requireApproval: false,
        reasoning: 'سؤال بسيط منخفض المخاطر — مسار سريع بمكالمة نموذج واحدة.',
      };
    case 'MEDIUM':
      return {
        tier,
        useMultiAgent: false,
        useMultiModel: false,
        useToolsAllowed: true,
        requireVerification: false,
        requireApproval: false,
        reasoning: 'يحتاج خطوات مستهدفة أو أدوات، لكن لا يستدعي تعدد وكلاء أو مراجعة إلزامية.',
      };
    case 'HIGH':
      return {
        tier,
        useMultiAgent: true,
        useMultiModel: false,
        useToolsAllowed: true,
        requireVerification: true,
        requireApproval: false,
        reasoning: 'معقد تحليلياً — يستفيد من تخطيط ووكلاء متوازيين ومراجعة مستقلة قبل التسليم.',
      };
    case 'HIGH_RISK':
      return {
        tier,
        useMultiAgent: true,
        useMultiModel: false,
        useToolsAllowed: true,
        requireVerification: true,
        requireApproval: true,
        reasoning: 'موضوع عالي الحساسية (طبي/قانوني/مالي حرج/سلامة) — يتطلب أدلة ومراجعة مستقلة وموافقة بشرية قبل التسليم النهائي.',
      };
  }
}

import type { RouteIntent } from '../providers/modelRouter.js';

const RISK_WORDS = /جرعة|تشخيص|عقد ملزم|دعوى|استثمر كل|طلاق|وصية|عملية جراحية|أعراض خطيرة|dosage|diagnosis|lawsuit|surgery/i;
const COMPLEXITY_WORDS = /قارن|حلل|خطة شاملة|استراتيجية|multi-step|analyze|strategy|compare/i;
/** Simple factual/lookup phrasing — a strong signal this is a genuinely LOW-tier request, not just "not flagged as complex". */
const SIMPLE_PATTERNS = /^(ما هو|ما هي|من هو|متى|كم|what is|who is|when is|how many)\b/i;

export interface AnalyzedIntent extends RouteIntent {
  text: string;
  requiresVerification: boolean;
}

/**
 * Deliberately NOT an extra model call — same design rationale as the
 * frontend's NexusIntentEngine (cheap heuristic scoring on the hot path,
 * not latency/cost-adding). Callers depend only on the returned shape.
 *
 * BUGFIX (Phase 3 regression review — root cause): complexity used to be
 * computed as `COMPLEXITY_WORDS.test(text) ? 'high' : 'medium'` — there was
 * NO path to 'low' at all, which silently defeated executionPolicy.ts's
 * LOW-tier fast path for every single simple request ("what time is it"
 * would classify the same as a genuinely multi-step question). Short,
 * simple, tool-free, non-flagged text now correctly produces 'low'.
 */
export function analyzeIntent(text: string, opts: { needsTools?: boolean; needsImages?: boolean } = {}): AnalyzedIntent {
  const risk: RouteIntent['risk'] = RISK_WORDS.test(text) ? 'high' : 'low';
  let complexity: NonNullable<RouteIntent['complexity']>;
  if (COMPLEXITY_WORDS.test(text) || text.length > 800) {
    complexity = 'high';
  } else if (text.length <= 120 && (SIMPLE_PATTERNS.test(text.trim()) || text.split(/\s+/).length <= 12) && !opts.needsTools) {
    complexity = 'low';
  } else {
    complexity = 'medium';
  }
  return {
    text,
    risk,
    complexity,
    needsTools: opts.needsTools ?? false,
    needsImages: opts.needsImages ?? false,
    requiresVerification: risk === 'high' || complexity === 'high',
  };
}

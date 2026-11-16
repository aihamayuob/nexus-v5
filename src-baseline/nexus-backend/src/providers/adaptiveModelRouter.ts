import type { ProviderId } from '../config/providerRegistry.js';
import { getRepos } from '../persistence/repos.js';

/**
 * IMPORTANT — what this does and doesn't measure:
 *
 * This module ranks providers by OPERATIONAL reliability signals actually
 * observed in this deployment's own history: did the call succeed, how
 * long did it take, what did it cost, did the independent Verifier flag
 * problems with outputs that went through it, and what did users say
 * (thumbs up/down). These are real, measurable, evidence-based signals.
 *
 * What this does NOT do, and never will without labeled ground truth: claim
 * to measure "accuracy" or "correctness" of a provider's actual answers. No
 * component of this system has a labeled dataset of right/wrong answers to
 * score against — verification is an independent MODEL's opinion (useful
 * signal, not ground truth), and user feedback is subjective and sparse.
 * Any dashboard or API surface built on this MUST describe these numbers as
 * "success rate", "verification pass rate", "user sentiment" — never
 * "accuracy". Overclaiming here would be actively misleading.
 */

export interface ProviderScore {
  provider: ProviderId;
  sampleSize: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  avgCostUsd: number | null;
  verificationPassRate: number | null;
  userFeedbackScore: number | null; // [-1, 1], null if no feedback recorded yet
  recentFailureReasons: string[];
  /** Composite ranking score — HIGHER is better. See computeCompositeScore() for the exact weighting and its rationale. Not a probability, not an accuracy figure — a ranking heuristic only. */
  compositeScore: number;
  /** True when sampleSize is below MIN_SAMPLE_FOR_CONFIDENCE — the score exists but shouldn't be trusted to reorder a cold-start deployment's fallback chain aggressively. */
  lowConfidence: boolean;
}

const MIN_SAMPLE_FOR_CONFIDENCE = 8;

function verificationPassRateFor(provider: ProviderId, route: string | undefined): number | null {
  // Verification outcomes are recorded at the TASK level (TaskObservability),
  // not per-provider-call, and a task's models array can include multiple
  // providers if a fallback happened mid-task. We approximate by looking at
  // tasks whose FIRST model call used this provider — good enough for a
  // ranking signal, not claimed as precise attribution.
  const recent = getRepos().observability.recent(100, route);
  const withThisProvider = recent.filter((r) => r.models[0]?.provider === provider && r.verification?.ran);
  if (withThisProvider.length === 0) return null;
  const passed = withThisProvider.filter((r) => r.verification?.verdict === 'ok').length;
  return passed / withThisProvider.length;
}

export function scoreProvider(provider: ProviderId, opts: { route?: string; sampleSize?: number } = {}): ProviderScore {
  const evidence = getRepos().providerCallLog.evidenceFor(provider, opts);
  const feedbackScore = opts.route ? getRepos().feedback.recentScoreForRoute(opts.route) : null;
  const verificationPassRate = verificationPassRateFor(provider, opts.route);

  const successRate = evidence.sampleSize > 0 ? evidence.successCount / evidence.sampleSize : null;
  const score: ProviderScore = {
    provider,
    sampleSize: evidence.sampleSize,
    successRate,
    avgLatencyMs: evidence.sampleSize > 0 ? evidence.avgLatencyMs : null,
    avgCostUsd: evidence.sampleSize > 0 ? evidence.avgCostUsd : null,
    verificationPassRate,
    userFeedbackScore: feedbackScore,
    recentFailureReasons: evidence.recentFailureReasons,
    compositeScore: 0,
    lowConfidence: evidence.sampleSize < MIN_SAMPLE_FOR_CONFIDENCE,
  };
  score.compositeScore = computeCompositeScore(score);
  return score;
}

/**
 * Weighting rationale (deliberately conservative and documented, not
 * tuned-and-hidden): success rate dominates (a provider that fails often is
 * disqualifying regardless of how fast/cheap it is when it works), latency
 * and cost are secondary tie-breakers, verification pass rate and user
 * feedback are soft signals that nudge but never override reliability.
 * With fewer than MIN_SAMPLE_FOR_CONFIDENCE calls, the registry's own
 * declared capability order should dominate instead — see rankFallbacks().
 */
function computeCompositeScore(s: ProviderScore): number {
  if (s.sampleSize === 0) return 0;
  let score = (s.successRate ?? 0) * 100;
  if (s.avgLatencyMs != null) score -= Math.min(20, s.avgLatencyMs / 1000); // up to -20 for very slow providers
  if (s.avgCostUsd != null) score -= Math.min(10, s.avgCostUsd * 1000); // up to -10 for very expensive calls
  if (s.verificationPassRate != null) score += (s.verificationPassRate - 0.5) * 10; // +/-5
  if (s.userFeedbackScore != null) score += s.userFeedbackScore * 5; // +/-5
  return score;
}

/**
 * Re-orders a fallback candidate list using evidence when there's enough
 * of it; otherwise returns the input order unchanged (the registry's own
 * declared order — see modelRouter.ts — which is the only sane default
 * for a fresh deployment with no history yet). This function NEVER adds
 * or removes candidates — routeModel() already filtered the list down to
 * providers that are actually configured and capability-eligible; this
 * only changes the ORDER they're tried in.
 */
export function rankFallbacks(candidates: ProviderId[], route?: string): ProviderId[] {
  if (candidates.length <= 1) return candidates;
  const scores = candidates.map((p) => scoreProvider(p, { route }));
  const anyConfident = scores.some((s) => !s.lowConfidence);
  if (!anyConfident) return candidates; // cold start — not enough evidence anywhere to justify reordering

  return [...scores]
    .sort((a, b) => {
      // Confident scores always sort ahead of low-confidence ones — a
      // provider we've barely tried shouldn't leapfrog one we have real
      // track record for, even if its tiny sample happened to look good.
      if (a.lowConfidence !== b.lowConfidence) return a.lowConfidence ? 1 : -1;
      return b.compositeScore - a.compositeScore;
    })
    .map((s) => s.provider);
}

export function scoreboardForRoute(candidates: ProviderId[], route?: string): ProviderScore[] {
  return candidates.map((p) => scoreProvider(p, { route }));
}

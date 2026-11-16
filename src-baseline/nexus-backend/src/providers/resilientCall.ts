import { ServerConfig } from '../config/env.js';
import { normalizeError } from '../core/errors.js';
import { logger } from '../core/logger.js';

export interface RetryEvent {
  attempt: number;
  reason: string;
  provider?: string;
}

export interface AttemptResult {
  label: string;
  success: boolean;
  latencyMs: number;
  error?: string;
}

export interface ResilientCallOptions<T> {
  /** Ordered list of attempts to try — first element is the primary call, subsequent are fallbacks (e.g. a different provider/model). Each is only invoked if the previous one fails with a retryable error and attempts are exhausted or non-retryable. */
  attempts: Array<{ label: string; run: () => Promise<T> }>;
  maxRetriesPerAttempt?: number;
  baseDelayMs?: number;
  onRetry?: (evt: RetryEvent) => void;
  /** Fired after EVERY individual attempt (success or final failure of that attempt) — this is what feeds per-provider evidence (AdaptiveModelRouter) instead of only the retry-count the task-level observability already tracks. */
  onAttemptResult?: (result: AttemptResult) => void;
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

/**
 * Tries each `attempts` entry in order. Within an attempt, retries up to
 * maxRetriesPerAttempt times with exponential backoff on retryable errors
 * before moving to the next attempt (typically the next provider in a
 * fallback chain). Non-retryable errors (validation, auth, cancellation)
 * abort immediately without burning through the rest of the chain.
 */
export async function resilientCall<T>(opts: ResilientCallOptions<T>): Promise<T> {
  const maxRetries = opts.maxRetriesPerAttempt ?? ServerConfig.maxRetries;
  const baseDelay = opts.baseDelayMs ?? ServerConfig.retryBaseDelayMs;
  let lastError: unknown = null;

  for (const attempt of opts.attempts) {
    for (let i = 0; i <= maxRetries; i++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const startedAt = Date.now();
      try {
        const result = await attempt.run();
        opts.onAttemptResult?.({ label: attempt.label, success: true, latencyMs: Date.now() - startedAt });
        return result;
      } catch (e) {
        lastError = e;
        const httpErr = normalizeError(e);
        const latencyMs = Date.now() - startedAt;
        logger.warn('resilientCall attempt failed', { label: attempt.label, i, message: httpErr.message, retryable: httpErr.retryable });
        // Cancellation always propagates immediately — never retried,
        // never falls through to try the next provider in the chain, and
        // is NOT recorded as evidence (it isn't a provider reliability
        // signal — the user/system chose to stop, the provider didn't fail).
        if (httpErr.code === 'cancelled') throw httpErr;
        opts.onAttemptResult?.({ label: attempt.label, success: false, latencyMs, error: httpErr.message });
        if (!httpErr.retryable) break; // this attempt is done, but DO fall through to the next attempt (e.g. next provider) in the chain
        if (i < maxRetries) {
          opts.onRetry?.({ attempt: i + 1, reason: httpErr.message, provider: attempt.label });
          await sleep(baseDelay * Math.pow(2, i), opts.signal);
        }
      }
    }
  }
  throw normalizeError(lastError ?? new Error('كل محاولات التنفيذ فشلت.'));
}

import { Errors } from '../core/errors.js';
import type { FetchLike } from './contract.js';

/**
 * Enforces the per-provider request timeout (ProviderDefinition.timeoutMsEnvVar / defaultTimeoutMs) on real calls.
 * Before this wrapper that value was only used by health probes, so a provider that accepted the connection and then went
 * silent kept /api/chat open indefinitely (found by e2e/real-provider-validation.mjs R4).
 *
 * Semantics (deliberately NOT a total-duration cap, so long healthy streams are never killed):
 *   - time-to-response-headers must be <= timeoutMs;
 *   - once streaming, the gap between two body chunks (idle time) must be <= timeoutMs.
 * Expiry throws Errors.timeout (504, retryable) — the existing resilientCall retry/fallback chain handles it like any provider failure.
 * A caller abort (init.signal) is passed through unchanged, so cancellation is still reported as cancellation, never as a timeout.
 */
export function withProviderTimeout(fetchImpl: FetchLike, timeoutMs: number): FetchLike {
  if (!(timeoutMs > 0)) return fetchImpl;

  const wrapped = async (input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]): Promise<Response> => {
    const outer = init?.signal ?? undefined;
    if (outer?.aborted) throw new DOMException('Aborted', 'AbortError');

    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    };
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener('abort', onOuterAbort, { once: true });
    const cleanup = () => { clearTimeout(timer); outer?.removeEventListener('abort', onOuterAbort); };
    const timeoutError = () => Errors.timeout(`انتهت مهلة المزود (${timeoutMs}ms) دون استجابة.`);

    arm();
    let res: Response;
    try {
      res = await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (e) {
      cleanup();
      if (timedOut && !outer?.aborted) throw timeoutError();
      throw e;
    }
    clearTimeout(timer);

    if (!res.body) { cleanup(); return res; }

    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        arm(); // idle watchdog: restarts for every read
        try {
          const { done, value } = await reader.read();
          clearTimeout(timer);
          if (done) { cleanup(); ctrl.close(); } else ctrl.enqueue(value);
        } catch (e) {
          cleanup();
          ctrl.error(timedOut && !outer?.aborted ? timeoutError() : e);
        }
      },
      cancel(reason) { cleanup(); controller.abort(); return reader.cancel(reason).catch(() => undefined); },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  return wrapped as FetchLike;
}

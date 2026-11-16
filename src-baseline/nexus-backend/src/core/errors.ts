/**
 * Unified error schema. Every error that reaches an HTTP response goes
 * through toHttpBody() below, which ALWAYS includes `error.message` (the
 * one field the existing frontend already reads via `errBody?.error?.message`
 * across every endpoint it calls) plus a machine-readable `error.code` and
 * `error.retryable` flag for newer (v2) clients, without breaking the old
 * shape.
 */

export type ErrorCode =
  | 'validation_error'
  | 'auth_error'
  | 'rate_limited'
  | 'payload_too_large'
  | 'budget_exceeded'
  | 'provider_error'
  | 'timeout'
  | 'not_found'
  | 'conflict'
  | 'tool_permission_denied'
  | 'tool_validation_error'
  | 'ssrf_blocked'
  | 'capability_denied'
  | 'cancelled'
  | 'not_configured'
  | 'local_provider_unavailable'
  | 'cloud_egress_denied'
  | 'internal_error';

export class NexusHttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  /**
   * Production Hardening — server-side-only detail, NEVER included in
   * toHttpBody()'s output. Exists specifically for normalizeError()'s
   * catch-all fallback below: an arbitrary, unreviewed JS Error thrown
   * somewhere deep in the codebase (a bug, a SQLite constraint message, a
   * stray TypeError) can carry internal detail — variable/table names,
   * file-shaped hints — that was never vetted as safe to show a caller,
   * including an unauthenticated one on a skipAuth route. Every
   * DELIBERATELY constructed NexusHttpError elsewhere in the app (e.g.
   * every Errors.* call written by hand, with a message a developer
   * actually chose to show a client) is unaffected — those already return
   * unchanged from the `e instanceof NexusHttpError` passthrough at the
   * top of normalizeError(), never touching this field.
   */
  readonly logDetail?: string;

  constructor(status: number, code: ErrorCode, message: string, opts: { retryable?: boolean; details?: Record<string, unknown>; logDetail?: string } = {}) {
    super(message);
    this.name = 'NexusHttpError';
    this.status = status;
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
    this.logDetail = opts.logDetail;
  }

  toHttpBody() {
    return {
      error: {
        message: this.message,
        code: this.code,
        retryable: this.retryable,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const Errors = {
  validation: (message: string, details?: Record<string, unknown>) =>
    new NexusHttpError(400, 'validation_error', message, { details }),
  auth: (message = 'مفتاح الدخول غير صالح أو مفقود.') => new NexusHttpError(401, 'auth_error', message),
  rateLimited: (message = 'عدد كبير جداً من الطلبات — حاول لاحقاً.', retryAfterMs?: number) =>
    new NexusHttpError(429, 'rate_limited', message, { retryable: true, details: retryAfterMs ? { retryAfterMs } : undefined }),
  payloadTooLarge: (message = 'حجم الطلب أكبر من المسموح.') => new NexusHttpError(413, 'payload_too_large', message),
  budgetExceeded: (message: string) => new NexusHttpError(402, 'budget_exceeded', message),
  provider: (message: string, retryable = true, details?: Record<string, unknown>) =>
    new NexusHttpError(502, 'provider_error', message, { retryable, details }),
  timeout: (message = 'انتهت مهلة الطلب.') => new NexusHttpError(504, 'timeout', message, { retryable: true }),
  notFound: (message = 'غير موجود.') => new NexusHttpError(404, 'not_found', message),
  conflict: (message: string, details?: Record<string, unknown>) => new NexusHttpError(409, 'conflict', message, { details }),
  toolPermissionDenied: (message: string) => new NexusHttpError(403, 'tool_permission_denied', message),
  toolValidation: (message: string, details?: Record<string, unknown>) =>
    new NexusHttpError(400, 'tool_validation_error', message, { details }),
  ssrfBlocked: (message = 'الرابط المطلوب غير مسموح به لأسباب أمنية (SSRF).') => new NexusHttpError(400, 'ssrf_blocked', message),
  capabilityDenied: (message: string) => new NexusHttpError(403, 'capability_denied', message),
  cancelled: (message = 'أُلغيت العملية.') => new NexusHttpError(499, 'cancelled', message),
  // Restoration-pass fix: /api/market-context used to return 200 with an
  // { available:false, ... } stub body that shares NO field names with what
  // the frontend actually reads (data.fetchedAt, data.goldPriceUsdPerOz,
  // etc.) — so a 200 response silently produced "Invalid Date"/"undefined$"
  // text injected straight into the chat context. The frontend already has
  // a correct, existing fail-silent path for exactly this situation
  // (`if(!res.ok) throw ...` -> caught -> returns ''), it just needs a
  // non-2xx status to reach it. 503 signals "the server understands this
  // endpoint but the underlying data source isn't configured right now" —
  // matching the endpoint's own "غير مُعدّ على هذا الخادم بعد" message —
  // without implying the caller did anything wrong (unlike 404/400).
  notConfigured: (message: string) => new NexusHttpError(503, 'not_configured', message, { retryable: false }),
  /** GAP-1 (D1 rule 5): the request was routed locally, the local provider failed, and cloud fallback is blocked — so NOTHING was sent to a cloud provider. 503 + retryable (a local server may come back). */
  localProviderUnavailable: (message: string, details?: Record<string, unknown>) =>
    new NexusHttpError(503, 'local_provider_unavailable', message, { retryable: true, details }),
  /** GAP-1B: an internal cloud call (verification/evaluation/judge/research) was refused because its scope is privacy-restricted. 403, NOT retryable — retrying can never succeed without a policy change. Details carry names only, never content. */
  cloudEgressDenied: (message: string, details?: Record<string, unknown>) =>
    new NexusHttpError(403, 'cloud_egress_denied', message, { retryable: false, details }),
  internal: (message = 'خطأ داخلي غير متوقع.', details?: Record<string, unknown>) =>
    new NexusHttpError(500, 'internal_error', message, { details }),
};

/** Normalizes ANY thrown value (including non-NexusHttpError exceptions from provider SDKs/fetch) into a NexusHttpError. */
export function normalizeError(e: unknown): NexusHttpError {
  if (e instanceof NexusHttpError) return e;
  if (e instanceof Error) {
    if (e.name === 'AbortError') return Errors.cancelled('أُلغيت العملية من قبل المستخدم.');
    if (e.name === 'TimeoutError') return Errors.timeout();
    if (isNetworkConnectivityError(e)) {
      // Node's fetch() throws a generic TypeError("fetch failed") for
      // connection-level failures (ECONNREFUSED, DNS failure, socket
      // reset...) with the real cause nested in `.cause`. This is exactly
      // the transient-infrastructure class of failure resilientCall
      // exists to retry/fall back on — classifying it as a non-retryable
      // internal_error (the pre-fix default below) would silently defeat
      // retry/fallback for the single most common real-world failure mode.
      return Errors.provider(`تعذّر الاتصال بالمزود: ${networkErrorSummary(e)}`, true);
    }
    return new NexusHttpError(500, 'internal_error', 'خطأ داخلي غير متوقع. تم تسجيل التفاصيل من جهة الخادم للمراجعة.', { logDetail: e.message });
  }
  return new NexusHttpError(500, 'internal_error', 'خطأ داخلي غير متوقع. تم تسجيل التفاصيل من جهة الخادم للمراجعة.', { logDetail: String(e) });
}

const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EPIPE']);

function isNetworkConnectivityError(e: Error): boolean {
  if (e instanceof TypeError && e.message === 'fetch failed') return true;
  const code = (e as NodeJS.ErrnoException).code || ((e.cause as NodeJS.ErrnoException | undefined)?.code ?? undefined);
  return !!code && NETWORK_ERROR_CODES.has(code);
}

function networkErrorSummary(e: Error): string {
  const cause = e.cause as NodeJS.ErrnoException | undefined;
  return cause?.code || cause?.message || e.message;
}

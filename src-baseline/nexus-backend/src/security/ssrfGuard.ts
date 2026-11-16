import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { Errors } from '../core/errors.js';
import { auditSecurityEvent } from './audit.js';

const MAX_REDIRECTS = 4;
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Blocks the classic SSRF target ranges: loopback, RFC1918 private space,
 * link-local (which is ALSO where every major cloud's instance-metadata
 * service lives — 169.254.169.254 AWS/GCP/Azure, 100.100.100.200-style
 * Alibaba links land in the same /16), unique-local/link-local IPv6,
 * multicast, and the "this network" 0.0.0.0/8 block.
 */
function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (carrier-grade NAT, also used by some cloud metadata proxies)
    if (a >= 224) return true; // multicast (224-239) + reserved (240-255)
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb'))
      return true; // link-local fe80::/10
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
    if (lower.startsWith('ff')) return true; // multicast
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — validate the embedded v4 address too
      const v4 = lower.slice('::ffff:'.length);
      if (isIP(v4) === 4) return isBlockedIp(v4);
    }
    return false;
  }
  return true; // couldn't parse — fail closed
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  finalUrl: string;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBodyBytes?: number;
  headers?: Record<string, string>;
}

/** Resolves hostname -> a validated public IP, or throws Errors.ssrfBlocked(). Exported for unit testing the pure validation logic without a real socket. */
export async function resolveAndValidate(hostname: string): Promise<{ address: string; family: number }> {
  // A bare IP literal in the URL still goes through isBlockedIp — dns.lookup
  // on a literal just echoes it back, so this path is uniform either way.
  let resolved: { address: string; family: number };
  try {
    resolved = await dnsLookup(hostname, { family: 0 });
  } catch {
    throw Errors.ssrfBlocked('تعذّر تحليل عنوان النطاق.');
  }
  if (isBlockedIp(resolved.address)) {
    // Production Hardening: this MUST go through auditSecurityEvent()
    // (which itself calls logger.security() internally AND persists to
    // the durable security_audit_log table) rather than calling
    // logger.security() directly — a direct call, as this line used to
    // be, only ever reached ephemeral console output, so a real blocked
    // SSRF attempt against this backend would never show up in
    // AuditRepo.listSecurity() at all, contradicting logger.ts's own
    // documented claim that security-level log lines are "also mirrored
    // into the durable audit table". One of the single most
    // security-critical events in this whole system was silently
    // exempt from the durable audit trail before this fix.
    auditSecurityEvent('critical', 'SSRF blocked: private/reserved IP target', { hostname, resolvedIp: resolved.address });
    throw Errors.ssrfBlocked();
  }
  return resolved;
}

/**
 * Fetches a URL with the connection PINNED to the already-validated IP
 * (via a custom `lookup` passed to the http/https agent), so a hostname
 * that resolves differently between our check and the actual TCP connect
 * (DNS rebinding) cannot bypass the check — the socket is forced to dial
 * the exact address we validated, not whatever the resolver says a moment
 * later. Every redirect hop is independently re-validated the same way,
 * up to MAX_REDIRECTS.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBodyBytes = opts.maxBodyBytes ?? 2_000_000;

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = safeParseUrl(currentUrl);
    if (!ALLOWED_SCHEMES.has(url.protocol)) throw Errors.ssrfBlocked('بروتوكول الرابط غير مسموح — http/https فقط.');
    if (url.username || url.password) throw Errors.ssrfBlocked('روابط تحتوي بيانات اعتماد مضمّنة غير مسموحة.');

    const { address, family } = await resolveAndValidate(url.hostname);

    const result = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer; location?: string }>(
      (resolve, reject) => {
        const isHttps = url.protocol === 'https:';
        const reqFn = isHttps ? httpsRequest : httpRequest;
        // PIN the connection to the pre-validated IP regardless of what the
        // OS resolver would return at connect time — this is what actually
        // closes the DNS-rebinding TOCTOU gap between resolveAndValidate()
        // above and the real TCP connect happening here.
        const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
          callback(null, address, family as 4 | 6);
        };
        const requestOptions: RequestOptions = {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'GET',
          headers: { 'User-Agent': 'NexusBackend/2.0 (+web_fetch tool)', ...opts.headers },
          timeout: timeoutMs,
          lookup: pinnedLookup,
        };
        const req = reqFn(
          requestOptions,
          (res: IncomingMessage) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
              res.resume(); // drain, we're not reading this body
              resolve({ status, headers: {}, body: Buffer.alloc(0), location: res.headers.location });
              return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            res.on('data', (chunk: Buffer) => {
              total += chunk.length;
              if (total > maxBodyBytes) {
                req.destroy();
                reject(Errors.payloadTooLarge('محتوى الاستجابة أكبر من المسموح.'));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              const headers: Record<string, string> = {};
              for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers[k] = v;
              resolve({ status, headers, body: Buffer.concat(chunks) });
            });
            res.on('error', reject);
          }
        );
        req.on('timeout', () => {
          req.destroy();
          reject(Errors.timeout('انتهت مهلة جلب الرابط.'));
        });
        req.on('error', (e) => reject(Errors.provider(`فشل الاتصال: ${e.message}`, true)));
        req.end();
      }
    );

    if (result.location) {
      currentUrl = new URL(result.location, currentUrl).toString();
      continue; // re-validate the redirect target from scratch on the next loop iteration
    }

    return {
      status: result.status,
      headers: result.headers,
      bodyText: result.body.toString('utf-8'),
      finalUrl: currentUrl,
    };
  }
  throw Errors.ssrfBlocked('عدد كبير جداً من إعادة التوجيه.');
}

function safeParseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw Errors.validation('رابط غير صالح.');
  }
}

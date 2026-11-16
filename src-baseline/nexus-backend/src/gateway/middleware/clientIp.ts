import { isIP } from 'node:net';

/**
 * F06-a (2026-11-16): client identity for rate limiting / audit.
 *
 * `X-Forwarded-For` is attacker-controlled unless the TCP peer that delivered the request is a proxy the OPERATOR
 * explicitly trusts. Default (no trusted peers) => the header is ignored and the socket address is the identity.
 * Entries are exact IPs or IPv4 CIDRs; anything else ("true", "*", garbage) is ignored => fail closed.
 */

export interface TrustedPeers { exact: Set<string>; cidrs: Array<{ net: number; mask: number }>; }

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0) >>> 0;
}

/** "::ffff:1.2.3.4" -> "1.2.3.4"; everything else lower-cased. */
export function normalizeIp(ip: string): string {
  const s = ip.trim().toLowerCase();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  return m && isIP(m[1]!) === 4 ? m[1]! : s;
}

export function parseTrustedPeers(raw: string | string[] | undefined): TrustedPeers {
  const out: TrustedPeers = { exact: new Set(), cidrs: [] };
  const items = Array.isArray(raw) ? raw : (raw ?? '').split(',');
  for (const item of items) {
    const e = item.trim();
    if (!e) continue;
    const slash = e.indexOf('/');
    if (slash === -1) {
      if (isIP(e)) out.exact.add(normalizeIp(e));
      continue; // not an IP (e.g. "true", "*") -> ignored, never "trust everyone"
    }
    const base = e.slice(0, slash); const bitsStr = e.slice(slash + 1);
    if (isIP(base) !== 4 || !/^\d{1,2}$/.test(bitsStr)) continue; // IPv4 CIDR only
    const bits = Number(bitsStr);
    if (bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    out.cidrs.push({ net: (v4ToInt(base) & mask) >>> 0, mask });
  }
  return out;
}

function isTrusted(ip: string, t: TrustedPeers): boolean {
  const n = normalizeIp(ip);
  if (t.exact.has(n)) return true;
  if (isIP(n) === 4) {
    const v = v4ToInt(n);
    return t.cidrs.some((c) => ((v & c.mask) >>> 0) === c.net);
  }
  return false;
}

/**
 * @param remote  socket.remoteAddress (the actual TCP peer)
 * @param xff     raw X-Forwarded-For header value (Node joins repeated headers with ", ")
 */
export function resolveClientIp(remote: string | undefined, xff: string | undefined, trusted: TrustedPeers): string {
  const peer = remote || 'unknown';
  if (!xff || (trusted.exact.size === 0 && trusted.cidrs.length === 0) || !isTrusted(peer, trusted)) return peer;
  const hops = xff.split(',').map((s) => s.trim());
  // Any malformed hop => the chain cannot be trusted => attribute to the proxy itself (shared bucket, never an attacker-chosen string).
  if (hops.some((h) => !h || !isIP(h))) return peer;
  // Walk from the right (nearest hop, appended by trusted infrastructure) to the first untrusted address.
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrusted(hops[i]!, trusted)) return hops[i]!;
  }
  return hops[0]!; // every hop is trusted infrastructure
}

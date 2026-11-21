#!/usr/bin/env node
// NEXUS — same-network (phone) HTTPS front. Zero dependencies. LOCAL/TRUSTED-LAN USE ONLY.
//
// Why: browsers disable WebCrypto / Service Worker outside a "secure context" (HTTPS or loopback), so the page opened from a phone via
// http://<LAN-IP> cannot start (docs/DEPLOYMENT-LAN.md §4). This script is the in-repo equivalent of docs/DEPLOYMENT-TLS.md (nginx): ONE https
// origin on the machine's private LAN address that (a) serves the standalone page and (b) reverse-proxies /api /v2 /mcp /health to the BUILT
// backend, which stays bound to 127.0.0.1 (never exposed). Same origin => no CORS loosening; NEXUS_CORS_ORIGINS is still set to that exact origin.
//
//   npm --prefix src-baseline/nexus-backend ci && npm --prefix src-baseline/nexus-backend run build   # once
//   node scripts/nexus-lan-https.mjs                          # auto-picks the machine's private LAN IPv4
//   node scripts/nexus-lan-https.mjs --host 192.168.1.20 --port 8443
//   node scripts/nexus-lan-https.mjs --cert my.pem --key my-key.pem     # e.g. mkcert output instead of the generated self-signed cert
//
// Hard rules enforced here (not just documented):
//  * the bind host must be a private/loopback/link-local IPv4 (RFC1918, 127/8, 169.254/16) — 0.0.0.0, hostnames and public IPs are refused;
//  * every TCP peer must also be private/loopback/link-local, otherwise the socket is destroyed before TLS (a router port-forward from the Internet is refused);
//  * only the page(s) and the four proxied prefixes are reachable; incoming X-Forwarded-*/Forwarded/X-Real-IP are DROPPED and X-Forwarded-For is
//    set to the real peer; the backend trusts only 127.0.0.1 (NEXUS_TRUST_PROXY) so the per-IP failed-auth throttle sees the phone, not the proxy;
//  * the gateway key is never written to a file or put in a URL; the generated key/cert live in .nexus-lan-tls/ (git-ignored, key mode 0600, cert 30 days).
// Not provided: DoS/rate protection at the proxy, WebSocket upgrade proxying, a CA-trusted cert (self-signed => one browser warning; see docs/LAN-HTTPS-PHONE.md).
import { spawn, execFileSync } from 'node:child_process';
import { createServer as createHttps } from 'node:https';
import { request as httpRequest } from 'node:http';
import { X509Certificate, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_DIR = path.join(ROOT, 'src-baseline/nexus-backend');
const PAGES = {
  '/': path.join(ROOT, 'standalone/NEXUS-Standalone.html'),
  '/NEXUS-Standalone.html': path.join(ROOT, 'standalone/NEXUS-Standalone.html'),
  '/NEXUS-single-file.html': path.join(ROOT, 'frontend/dist/NEXUS-single-file.html'), // optional: node scripts/build-single-file.mjs
};
const PROXY_PATH = /^\/(api|v2|mcp|health)(\/|$)/;
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

// ---------- pure helpers (exported for the E2E) ----------
export function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || ''));
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}
/** private (RFC1918), loopback (127/8) or link-local (169.254/16). Everything else — incl. 0.0.0.0, CGNAT, documentation ranges, public — is false. */
export function isPrivateIPv4(s) {
  const o = parseIPv4(s);
  if (!o) return false;
  return o[0] === 10 || o[0] === 127 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 169 && o[1] === 254);
}
export function normalizePeer(addr) { return String(addr || '').replace(/^::ffff:/i, ''); }
export function isAllowedPeer(addr) { const a = normalizePeer(addr); return a === '::1' || isPrivateIPv4(a); }
export function isProxyPath(p) { return PROXY_PATH.test(p); }
export function candidateHosts(ifaces = networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) for (const i of list || []) if ((i.family === 'IPv4' || i.family === 4) && !i.internal && isPrivateIPv4(i.address) && !i.address.startsWith('169.254.')) out.push(i.address);
  return out;
}
export function proxyRequestHeaders(inH, peer, apiPort) {
  const out = {};
  for (const [k, v] of Object.entries(inH)) {
    const lk = k.toLowerCase();
    if (HOP.has(lk) || lk === 'host' || lk === 'forwarded' || lk === 'x-real-ip' || lk.startsWith('x-forwarded-')) continue;
    out[lk] = v;
  }
  out.host = `127.0.0.1:${apiPort}`;
  out['x-forwarded-for'] = normalizePeer(peer);
  out['x-forwarded-proto'] = 'https';
  return out;
}
export function proxyResponseHeaders(inH) {
  const out = {};
  for (const [k, v] of Object.entries(inH)) if (!HOP.has(k.toLowerCase())) out[k] = v;
  return out;
}
export function ensureCert(dir, host) {
  const certPath = path.join(dir, 'cert.pem'), keyPath = path.join(dir, 'key.pem');
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const x = new X509Certificate(readFileSync(certPath));
      if (x.checkIP(host) && new Date(x.validTo).getTime() > Date.now() + 7 * 864e5) return { certPath, keyPath, generated: false };
    } catch { /* regenerate */ }
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '30', '-subj', '/CN=nexus-lan',
      '-keyout', keyPath, '-out', certPath,
      '-addext', `subjectAltName=IP:${host},IP:127.0.0.1,DNS:localhost`, '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=serverAuth'], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`could not generate a self-signed certificate with openssl (${e.code === 'ENOENT' ? 'openssl not found' : String(e.stderr || e.message).slice(0, 200)}). Provide your own with --cert <pem> --key <pem> (e.g. mkcert).`);
  }
  try { chmodSync(keyPath, 0o600); } catch { /* best effort (Windows) */ }
  return { certPath, keyPath, generated: true };
}

// ---------- main ----------
async function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help') || argv.includes('-h')) { console.log('usage: node scripts/nexus-lan-https.mjs [--host <private-ipv4>] [--port 8443] [--cert pem --key pem]\nenv: NEXUS_LAN_PORT, NEXUS_PORT (backend, 8787), NEXUS_GATEWAY_KEYS (random if empty), any NEXUS_* backend variable'); return; }
  const die = (m) => { console.error(m); process.exit(2); };

  let host = opt('--host');
  if (!host) {
    const c = candidateHosts();
    if (!c.length) die('No private LAN IPv4 address found. Connect to the Wi-Fi/LAN, or pass --host <your private IPv4> (use --host 127.0.0.1 for a same-machine test).');
    host = c[0];
    if (c.length > 1) console.error(`(several private addresses found: ${c.join(', ')} — using ${host}; pass --host to choose)`);
  }
  if (!isPrivateIPv4(host)) die(`Refusing --host ${host}: only private (10/8, 172.16/12, 192.168/16), loopback or link-local IPv4 addresses are allowed. This script never binds 0.0.0.0, a hostname or a public address.`);
  const port = Number(opt('--port') || process.env.NEXUS_LAN_PORT || 8443);
  const apiPort = Number(process.env.NEXUS_PORT || 8787);
  if (!(port > 0 && port < 65536) || !(apiPort > 0 && apiPort < 65536) || port === apiPort) die('invalid/colliding ports');
  if (!existsSync(path.join(BACKEND_DIR, 'dist/index.js'))) die('Backend is not built. Run:\n  npm --prefix src-baseline/nexus-backend ci && npm --prefix src-baseline/nexus-backend run build');
  if (!existsSync(PAGES['/'])) die('standalone/NEXUS-Standalone.html not found');

  let certPath = opt('--cert'), keyPath = opt('--key'), generated = false;
  if (!!certPath !== !!keyPath) die('--cert and --key must be given together');
  if (!certPath) { try { ({ certPath, keyPath, generated } = ensureCert(path.join(ROOT, '.nexus-lan-tls'), host)); } catch (e) { die(String(e.message)); } }
  const certPem = readFileSync(certPath), keyPem = readFileSync(keyPath);
  const x509 = new X509Certificate(certPem);
  const origin = `https://${host}:${port}`;
  const origins = [origin, ...(host.startsWith('127.') ? [`https://localhost:${port}`] : [])];
  const key = process.env.NEXUS_GATEWAY_KEYS || randomBytes(24).toString('base64url');

  const be = spawn(process.execPath, ['--experimental-sqlite', '--enable-source-maps', 'dist/index.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, NODE_ENV: 'production', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(apiPort), NEXUS_GATEWAY_KEYS: key,
      NEXUS_TRUST_PROXY: '127.0.0.1', NEXUS_CORS_ORIGINS: process.env.NEXUS_CORS_ORIGINS || origins.join(',') },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  be.on('exit', (c) => { console.error(`backend exited (${c})`); process.exit(c ?? 1); });

  const secHeaders = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
  const server = createHttps({ key: keyPem, cert: certPem, minVersion: 'TLSv1.2' }, async (req, res) => {
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (isProxyPath(p)) {
        const up = httpRequest({ host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: proxyRequestHeaders(req.headers, req.socket.remoteAddress, apiPort) }, (ur) => {
          res.writeHead(ur.statusCode || 502, proxyResponseHeaders(ur.headers));
          res.flushHeaders();
          ur.pipe(res);
        });
        up.setTimeout(300_000, () => up.destroy(new Error('upstream timeout')));
        up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json', ...secHeaders }); res.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: 'backend unreachable' } })); } else res.destroy(); });
        res.on('close', () => { if (!res.writableEnded) up.destroy(); }); // client went away (e.g. SSE cancel) -> cancel upstream
        req.pipe(up);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, secHeaders); return res.end(); }
      const file = PAGES[p];
      if (!file || !existsSync(file)) { res.writeHead(404, secHeaders); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...secHeaders });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch { if (!res.headersSent) { res.writeHead(500, secHeaders); } res.end('error'); }
  });
  server.maxConnections = 256;
  server.on('connection', (sock) => { if (!isAllowedPeer(sock.remoteAddress)) { console.error(`refused non-private peer ${normalizePeer(sock.remoteAddress)}`); sock.destroy(); } });
  server.on('upgrade', (_req, sock) => sock.destroy()); // WebSocket upgrade is not proxied
  server.on('tlsClientError', () => { /* handshake failures (e.g. a browser rejecting the self-signed cert) are expected noise */ });
  server.listen(port, host, () => {
    const fp = x509.fingerprint256;
    console.log(`\nNEXUS phone/LAN HTTPS front is up (backend stays on 127.0.0.1:${apiPort}).\n` +
      `  On the phone (same Wi-Fi) open:  ${origin}/NEXUS-Standalone.html\n` +
      `  API address field:               ${origin}      (same origin as the page)\n` +
      `  Gateway key:                     ${key}\n` +
      `  Certificate SHA-256:             ${fp}${generated ? '  (just generated, self-signed, 30 days)' : ''}\n` +
      `  The browser warns once about the self-signed certificate: compare the fingerprint above, then proceed. The key lives in page memory only.\n` +
      `  Optional single-file page:       ${origin}/NEXUS-single-file.html  (needs: node scripts/build-single-file.mjs)\n` +
      `  Do NOT forward this port on your router. Stop: Ctrl+C\n`);
  });
  server.on('error', (e) => { console.error(`listen failed: ${e.code || e.message}`); be.kill('SIGTERM'); process.exit(2); });
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { be.kill('SIGTERM'); server.close(); setTimeout(() => process.exit(0), 300); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

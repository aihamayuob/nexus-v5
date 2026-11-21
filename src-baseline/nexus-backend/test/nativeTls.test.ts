import './helpers/setTlsTestEnv.js';
// Optional native TLS (NEXUS_TLS_CERT_FILE / NEXUS_TLS_KEY_FILE). Server-level cases run a REAL https listener and a real TLS client that
// PINS the generated certificate (no rejectUnauthorized:false), plus negative controls (plain HTTP to the TLS port, one-sided config, missing file).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { loadTlsMaterial } from '../src/gateway/tls.js';

const READY = process.env.NEXUS_TEST_TLS_READY === '1';
const SKIP = READY ? false : 'openssl not available: cannot generate a test certificate (server-level TLS cases NOT exercised)';
let server: Server;
let port = 0;

before(async () => {
  if (!READY) return;
  server = createNexusServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
after(async () => { if (READY) await new Promise((r) => server.close(r)); });

const get = (p: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
  const r = httpsRequest({ host: '127.0.0.1', port, path: p, ca: process.env.NEXUS_TEST_TLS_CA, headers, rejectUnauthorized: true }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers })); });
  r.on('error', reject); r.end();
});

test('loader: both unset => null (plain HTTP default unchanged)', () => { assert.equal(loadTlsMaterial('', ''), null); });
test('loader: only one of cert/key set => throws (fail closed, no silent plaintext)', () => {
  assert.throws(() => loadTlsMaterial('/x/cert.pem', ''), /must be set together/);
  assert.throws(() => loadTlsMaterial('', '/x/key.pem'), /must be set together/);
});
test('loader: unreadable file => throws with the errno code only', () => {
  assert.throws(() => loadTlsMaterial('/nonexistent/cert.pem', '/nonexistent/key.pem'), (e: Error) => /ENOENT/.test(e.message) && !e.message.includes('/nonexistent'));
});

test('HTTPS: pinned-cert client gets 200 on public health with HSTS + secure headers', { skip: SKIP }, async () => {
  const r = await get('/v2/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers['strict-transport-security'], 'max-age=15552000; includeSubDomains');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
test('HTTPS: auth is still enforced (no key => 401) and a valid key => 200', { skip: SKIP }, async () => {
  assert.equal((await get('/v2/models')).status, 401);
  assert.equal((await get('/v2/models', { Authorization: 'Bearer ' + process.env.NEXUS_GATEWAY_KEYS })).status, 200);
});
test('negative control: plain HTTP to the TLS port gets no application response', { skip: SKIP }, async () => {
  const out = await new Promise<string>((resolve) => {
    const r = httpRequest({ host: '127.0.0.1', port, path: '/v2/health', timeout: 3000 }, (res) => { res.resume(); resolve('responded ' + res.statusCode); });
    r.on('error', (e: NodeJS.ErrnoException) => resolve('error ' + e.code)); r.on('timeout', () => { r.destroy(); resolve('timeout'); }); r.end();
  });
  assert.ok(!/^responded 2/.test(out), out);
});
test('negative control: a client that does NOT trust the cert is rejected (no CA => handshake error)', { skip: SKIP }, async () => {
  const err = await new Promise<string>((resolve) => {
    const r = httpsRequest({ host: '127.0.0.1', port, path: '/v2/health', rejectUnauthorized: true }, () => resolve('connected'));
    r.on('error', (e: NodeJS.ErrnoException) => resolve(String(e.code))); r.end();
  });
  assert.match(err, /SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|CERT/);
});

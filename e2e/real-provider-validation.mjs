// NEXUS — REAL PROVIDER VALIDATION harness (drives the BUILT backend, dist/, as a separate OS process over real HTTP).
//
// Purpose: separate, in one report, (a) what was proven against REAL provider endpoints / REAL transports and (b) what is BLOCKED because
// no real key / runtime / network route exists in the environment this ran in. It never uses a simulated provider as evidence of a real
// integration: simulated servers are used ONLY for transport-behaviour tests (hang / canary) and are labelled as such in the output.
//
// Evidence classes printed per check:
//   REAL-PROVIDER   a real provider endpoint answered (needs a real key/runtime supplied by the owner via NEXUS_*_API_KEY / NEXUS_MODEL_OLLAMA ...)
//   REAL-ENDPOINT-REJECT  a real provider endpoint answered a deliberately INVALID credential (no real key used)
//   REAL-TRANSPORT  a real OS-level network failure (refused port / silent peer) — proves NEXUS behaviour, NOT any provider's behaviour
//   BLOCKED         could not run here; reason given (NO_KEY / NETWORK_BLOCKED / NO_LOCAL_RUNTIME / NEEDS_2_PROVIDERS)
//
// Usage:  (cd src-baseline/nexus-backend && npm ci && npm run build) && [NEXUS_ANTHROPIC_API_KEY=… NEXUS_OPENAI_API_KEY=… …] node e2e/real-provider-validation.mjs
// Real keys are read from the environment only, are never printed, and the run asserts they never appear in any response or backend log.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BACKEND_DIR = path.resolve(HERE, '../src-baseline/nexus-backend');
const OUT = process.env.NEXUS_RPV_OUT || path.resolve(HERE, '../real-provider-validation-out');
mkdirSync(OUT, { recursive: true });
const WORK = mkdtempSync(path.join(tmpdir(), 'nexus-rpv-'));
const GW_KEY = 'rpv-gw-' + 'Qm4Xz8Lp2Wv7Tn3B';
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GW_KEY };
const INVALID_KEY = 'sk-invalid-nexus-validation-0000000000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLOUD = [
  { id: 'anthropic', keyVar: 'NEXUS_ANTHROPIC_API_KEY', baseVar: 'NEXUS_ANTHROPIC_BASE_URL', base: 'https://api.anthropic.com', timeoutVar: 'NEXUS_TIMEOUT_ANTHROPIC_MS' },
  { id: 'openai', keyVar: 'NEXUS_OPENAI_API_KEY', baseVar: 'NEXUS_OPENAI_BASE_URL', base: 'https://api.openai.com', timeoutVar: 'NEXUS_TIMEOUT_OPENAI_MS' },
  { id: 'deepseek', keyVar: 'NEXUS_DEEPSEEK_API_KEY', baseVar: 'NEXUS_DEEPSEEK_BASE_URL', base: 'https://api.deepseek.com', timeoutVar: 'NEXUS_TIMEOUT_DEEPSEEK_MS' },
  { id: 'gemini', keyVar: 'NEXUS_GEMINI_API_KEY', baseVar: 'NEXUS_GEMINI_BASE_URL', base: 'https://generativelanguage.googleapis.com', timeoutVar: 'NEXUS_TIMEOUT_GEMINI_MS' },
];
const LOCAL = [
  { id: 'ollama', baseVar: 'NEXUS_OLLAMA_BASE_URL', base: 'http://127.0.0.1:11434', modelVar: 'NEXUS_MODEL_OLLAMA', probe: '/api/tags' },
  { id: 'lmstudio', baseVar: 'NEXUS_LMSTUDIO_BASE_URL', base: 'http://127.0.0.1:1234', modelVar: 'NEXUS_MODEL_LMSTUDIO', probe: '/v1/models' },
];

const results = [];
function check(id, status, cls, detail) {
  results.push({ id, status, evidenceClass: cls, detail: String(detail ?? '').slice(0, 400) });
  console.log(`[${status}] (${cls}) ${id}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
}
const pass = (id, cls, d) => check(id, 'PASS', cls, d);
const fail = (id, cls, d) => check(id, 'FAIL', cls, d);
const blocked = (id, why) => check(id, 'BLOCKED', 'BLOCKED', why);
const verdict = (id, ok, cls, d) => (ok ? pass(id, cls, d) : fail(id, cls, d));

// ---------------- backend process ----------------
let seq = 0;
async function startBackend(extraEnv, secrets = []) {
  const port = 19000 + Math.floor(Math.random() * 900) + seq++;
  const db = path.join(WORK, `nexus-${seq}.db`);
  let log = '';
  const p = spawn(process.execPath, ['--experimental-sqlite', '--enable-source-maps', 'dist/index.js'], {
    cwd: BACKEND_DIR,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(port), NEXUS_DB_PATH: db,
      NEXUS_GATEWAY_KEYS: GW_KEY, NEXUS_LOG_LEVEL: 'warn', NEXUS_RATE_LIMIT_PER_MINUTE: '6000', NEXUS_RATE_LIMIT_BURST: '1000',
      ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || '/root/.ccr/ca-bundle.crt' } : {}),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/v2/health`)).ok) break; } catch { /* not up yet */ }
    if (Date.now() - t0 > 15000) { p.kill('SIGKILL'); throw new Error('backend did not start: ' + log.slice(0, 400)); }
    await sleep(150);
  }
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, url, body, ms = 30000) => {
    const t = Date.now();
    try {
      const r = await fetch(base + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(ms) });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch { /* sse/plain */ }
      return { status: r.status, text, json, ms: Date.now() - t };
    } catch (e) {
      return { status: 0, text: '', json: null, ms: Date.now() - t, clientError: e.name + ': ' + e.message };
    }
  };
  const stop = async () => { p.kill('SIGTERM'); await Promise.race([new Promise((r) => p.once('exit', r)), sleep(4000)]); if (p.exitCode === null) p.kill('SIGKILL'); };
  const callLog = async () => {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const d = new DatabaseSync(db, { readOnly: true });
      const rows = d.prepare('SELECT provider, success, error_message FROM provider_call_log ORDER BY created_at').all();
      d.close(); return rows;
    } catch (e) { return null; }
  };
  const leaks = (extra = '') => secrets.filter((s) => s && (log.includes(s) || extra.includes(s)));
  return { api, stop, callLog, getLog: () => log, leaks };
}
const chatBody = (provider, stream = false) => ({ provider, max_tokens: 32, stream, messages: [{ role: 'user', content: 'Reply with exactly the word: NEXUS_OK' }] });

// ---------------- R0 preflight ----------------
async function reachable(url) {
  try { const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) }); return { ok: true, status: r.status }; }
  catch (e) { return { ok: false, error: (e.cause && e.cause.code) || e.name }; }
}
const facts = { cloud: {}, local: {} };
console.log('== R0 preflight (keys are only tested for presence; values never printed) ==');
for (const c of CLOUD) {
  const key = (process.env[c.keyVar] || '').trim();
  const reach = await reachable(process.env[c.baseVar] || c.base);
  facts.cloud[c.id] = { keyPresent: !!key, reachable: reach.ok, detail: reach.ok ? `HTTP ${reach.status}` : reach.error };
  console.log(`   ${c.id}: key=${key ? 'present' : 'ABSENT'} endpoint=${reach.ok ? 'reachable (HTTP ' + reach.status + ')' : 'UNREACHABLE (' + reach.error + ')'}`);
}
for (const l of LOCAL) {
  const model = (process.env[l.modelVar] || '').trim();
  const reach = await reachable((process.env[l.baseVar] || l.base) + l.probe);
  facts.local[l.id] = { modelConfigured: !!model, reachable: reach.ok, detail: reach.ok ? `HTTP ${reach.status}` : reach.error };
  console.log(`   ${l.id}: model=${model ? model : 'NOT SET'} runtime=${reach.ok ? 'reachable' : 'UNREACHABLE (' + reach.error + ')'}`);
}

// ---------------- R1 real success path (needs owner-supplied key/runtime) ----------------
console.log('\n== R1 real provider success path (non-stream, stream, health, key never leaks) ==');
const realReady = [];
for (const c of CLOUD) {
  const f = facts.cloud[c.id];
  if (!f.keyPresent) { blocked(`R1.${c.id}`, `NO_KEY (${c.keyVar} not supplied)`); continue; }
  if (!f.reachable) { blocked(`R1.${c.id}`, `NETWORK_BLOCKED (${f.detail}) — key present but endpoint unreachable from this environment`); continue; }
  realReady.push(c.id);
}
for (const l of LOCAL) {
  const f = facts.local[l.id];
  if (!f.modelConfigured || !f.reachable) { blocked(`R1.${l.id}`, `NO_LOCAL_RUNTIME (${!f.modelConfigured ? l.modelVar + ' not set' : 'runtime unreachable: ' + f.detail})`); continue; }
  realReady.push(l.id);
}
if (realReady.length) {
  const secrets = CLOUD.map((c) => (process.env[c.keyVar] || '').trim()).filter(Boolean);
  const be = await startBackend({ ...Object.fromEntries(Object.keys(process.env).filter((k) => /^NEXUS_(.*_API_KEY|.*BASE_URL|MODEL_.*|TIMEOUT_.*)$/.test(k)).map((k) => [k, process.env[k]])) }, secrets);
  const health = await be.api('GET', '/v2/providers/health?probe=1');
  for (const id of realReady) {
    const h = health.json?.providers?.find((p) => p.id === id);
    verdict(`R1.${id}.health`, h && h.state === 'READY' && h.live === true, 'REAL-PROVIDER', h ? `state=${h.state} live=${h.live} ${h.latencyMs ?? ''}ms ${h.error ?? ''}` : 'no health row');
    const r = await be.api('POST', '/api/chat', chatBody(id), 90000);
    const text = (r.json?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    verdict(`R1.${id}.chat`, r.status === 200 && text.length > 0 && (r.json?.usage?.input_tokens ?? 0) > 0, 'REAL-PROVIDER', `status=${r.status} ${r.ms}ms text="${text.slice(0, 40).replace(/\n/g, ' ')}" usage=${JSON.stringify(r.json?.usage)} ${r.json?.error?.message ?? ''}`);
    const s = await be.api('POST', '/api/chat', chatBody(id, true), 90000);
    const tokens = [...s.text.matchAll(/event: token\ndata: (.*)/g)].length;
    verdict(`R1.${id}.stream`, s.status === 200 && tokens > 0 && /event: done/.test(s.text) && !/event: error/.test(s.text), 'REAL-PROVIDER', `status=${s.status} tokenEvents=${tokens} done=${/event: done/.test(s.text)} ${s.ms}ms`);
  }
  const lk = be.leaks(health.text);
  verdict('R1.no-secret-leak', lk.length === 0, 'REAL-PROVIDER', lk.length ? 'a real key appeared in output/logs' : 'no real key found in responses or backend log');
  await be.stop();
}

// ---------------- R2 invalid credential against the REAL endpoint ----------------
console.log('\n== R2 authentication failure: deliberately INVALID key sent to the REAL endpoint (no real credential used) ==');
for (const c of CLOUD) {
  const f = facts.cloud[c.id];
  if (!f.reachable) { blocked(`R2.${c.id}`, `NETWORK_BLOCKED (${f.detail}) — real endpoint cannot be reached from this environment`); continue; }
  const be = await startBackend({ [c.keyVar]: INVALID_KEY, NEXUS_MAX_RETRIES: '2', NEXUS_RETRY_BASE_DELAY_MS: '200' }, [INVALID_KEY]);
  const r = await be.api('POST', '/api/chat', chatBody(c.id), 40000);
  const h = await be.api('GET', '/v2/providers/health?probe=1');
  const hp = h.json?.providers?.find((p) => p.id === c.id);
  await sleep(300);
  const rows = (await be.callLog()) || [];
  const attempts = rows.filter((x) => x.provider === c.id).length;
  const msg = r.json?.error?.message || '';
  verdict(`R2.${c.id}.error-surfaced`, r.status >= 400 && r.status < 600 && msg.includes(`[${c.id}]`) && r.json?.error?.code === 'provider_error', 'REAL-ENDPOINT-REJECT', `http=${r.status} code=${r.json?.error?.code} retryable=${r.json?.error?.retryable} msg="${msg.slice(0, 120)}"`);
  verdict(`R2.${c.id}.no-retry-storm`, attempts === 1, 'REAL-ENDPOINT-REJECT', `provider attempts logged=${attempts} (auth failure must not be retried)`);
  verdict(`R2.${c.id}.health-unavailable`, hp && hp.state === 'UNAVAILABLE' && hp.live === true, 'REAL-ENDPOINT-REJECT', hp ? `state=${hp.state} err=${String(hp.error).slice(0, 100)}` : 'no row');
  const lk = be.leaks(r.text + h.text);
  verdict(`R2.${c.id}.key-not-leaked`, lk.length === 0, 'REAL-ENDPOINT-REJECT', lk.length ? 'invalid key echoed in response/log' : 'key absent from responses and backend log');
  await be.stop();
}

// ---------------- R3 real transport failure (refused port) — all six adapters ----------------
console.log('\n== R3 connection failure: provider base URL -> closed local port (real ECONNREFUSED). Proves NEXUS behaviour, not a provider outage ==');
for (const c of CLOUD) {
  const be = await startBackend({ [c.keyVar]: 'fake-key-for-transport-test-0000', [c.baseVar]: 'http://127.0.0.1:1', NEXUS_MAX_RETRIES: '1', NEXUS_RETRY_BASE_DELAY_MS: '100' }, ['fake-key-for-transport-test-0000']);
  const r = await be.api('POST', '/api/chat', chatBody(c.id), 20000);
  const h = await be.api('GET', '/v2/providers/health?probe=1');
  const hp = h.json?.providers?.find((p) => p.id === c.id);
  await sleep(300);
  const attempts = ((await be.callLog()) || []).filter((x) => x.provider === c.id).length;
  verdict(`R3.${c.id}.clear-error`, r.status >= 400 && !!r.json?.error?.message && r.ms < 10000, 'REAL-TRANSPORT', `http=${r.status} code=${r.json?.error?.code} retryable=${r.json?.error?.retryable} ${r.ms}ms msg="${(r.json?.error?.message || r.clientError || '').slice(0, 100)}"`);
  verdict(`R3.${c.id}.bounded-retries`, attempts === 2, 'REAL-TRANSPORT', `attempts=${attempts} (1 try + MAX_RETRIES=1)`);
  verdict(`R3.${c.id}.health-unavailable`, hp && hp.state === 'UNAVAILABLE', 'REAL-TRANSPORT', hp ? `state=${hp.state}` : 'no row');
  await be.stop();
}
for (const l of LOCAL) {
  // canary = a fake "cloud" listener: ANY request reaching it means content left the machine although the primary was local.
  let canaryHits = 0;
  const canary = createServer((req, res) => { canaryHits++; res.writeHead(500); res.end('{}'); });
  await new Promise((r) => canary.listen(0, '127.0.0.1', r));
  const be = await startBackend({ [l.baseVar]: 'http://127.0.0.1:1', [l.modelVar]: 'any-model', NEXUS_ANTHROPIC_API_KEY: 'fake-key-for-canary-0000000', NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${canary.address().port}`, NEXUS_MAX_RETRIES: '0' });
  const r = await be.api('POST', '/api/chat', chatBody(l.id), 20000);
  verdict(`R3.${l.id}.local-down-no-cloud-egress`, r.json?.error?.code === 'local_provider_unavailable' && canaryHits === 0, 'REAL-TRANSPORT', `code=${r.json?.error?.code} http=${r.status} cloudCanaryHits=${canaryHits}`);
  await be.stop(); canary.close();
}

// ---------------- R4 silent peer: accepts the connection, never answers ----------------
console.log('\n== R4 silent provider: peer accepts and never answers; NEXUS must honour NEXUS_TIMEOUT_<PROVIDER>_MS (real TCP, simulated peer) ==');
{
  const sockets = new Set();
  const silent = createServer((req, res) => { req.resume(); /* never respond */ });
  silent.on('connection', (s) => sockets.add(s));
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${silent.address().port}`;
  const TIMEOUT = 1500;
  for (const c of CLOUD) {
    const be = await startBackend({ [c.keyVar]: 'fake-key-for-silent-test-0000', [c.baseVar]: base, [c.timeoutVar]: String(TIMEOUT), NEXUS_MAX_RETRIES: '0' });
    const r = await be.api('POST', '/api/chat', chatBody(c.id), TIMEOUT + 6000);
    verdict(`R4.${c.id}.non-stream-timeout-honoured`, r.status >= 400 && r.ms < TIMEOUT + 4000 && !r.clientError, 'REAL-TRANSPORT', r.clientError ? `NO RESPONSE from backend within ${TIMEOUT + 6000}ms (${r.clientError}) — configured timeout ${TIMEOUT}ms was NOT enforced` : `http=${r.status} code=${r.json?.error?.code} in ${r.ms}ms`);
    await be.stop();
  }
  for (const s of sockets) s.destroy();
  silent.close();
}
{
  // streaming variant: headers + one SSE frame, then silence (idle stall mid-stream)
  const sockets = new Set();
  const stall = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1 } } })}\n\n`);
  });
  stall.on('connection', (s) => sockets.add(s));
  await new Promise((r) => stall.listen(0, '127.0.0.1', r));
  const TIMEOUT = 1500;
  const be = await startBackend({ NEXUS_ANTHROPIC_API_KEY: 'fake-key-for-stall-test-0000', NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${stall.address().port}`, NEXUS_TIMEOUT_ANTHROPIC_MS: String(TIMEOUT), NEXUS_MAX_RETRIES: '0' });
  const r = await be.api('POST', '/api/chat', chatBody('anthropic', true), TIMEOUT + 6000);
  verdict('R4.anthropic.stream-idle-timeout-honoured', !r.clientError && /event: error/.test(r.text) && r.ms < TIMEOUT + 4000, 'REAL-TRANSPORT', r.clientError ? `stream never terminated within ${TIMEOUT + 6000}ms (${r.clientError}) — idle stall not bounded` : `error event after ${r.ms}ms`);
  await be.stop();
  for (const s of sockets) s.destroy();
  stall.close();
}

// ---------------- R5 fallback between REAL providers ----------------
console.log('\n== R5 fallback / switching between real providers ==');
if (realReady.length >= 2) {
  const [a, b] = realReady;
  const cfgA = CLOUD.find((c) => c.id === a);
  const secrets = CLOUD.map((c) => (process.env[c.keyVar] || '').trim()).filter(Boolean);
  const passthrough = Object.fromEntries(Object.keys(process.env).filter((k) => /^NEXUS_(.*_API_KEY|.*BASE_URL|MODEL_.*)$/.test(k)).map((k) => [k, process.env[k]]));
  // primary gets an INVALID key (real endpoint rejects it), the secondary is the real, working provider.
  const be = await startBackend({ ...passthrough, ...(cfgA ? { [cfgA.keyVar]: INVALID_KEY } : {}), NEXUS_MAX_RETRIES: '0' }, [...secrets, INVALID_KEY]);
  const r = await be.api('POST', '/api/chat', chatBody(a), 90000);
  await sleep(300);
  const rows = (await be.callLog()) || [];
  verdict(`R5.${a}->${b}.fallback-served`, r.status === 200 && rows.some((x) => x.provider === a && x.success === 0) && rows.some((x) => x.provider !== a && x.success === 1), 'REAL-PROVIDER', `http=${r.status} callLog=${JSON.stringify(rows.map((x) => [x.provider, x.success]))}`);
  await be.stop();
} else {
  blocked('R5.fallback-between-real-providers', `NEEDS_2_PROVIDERS (usable real providers in this run: ${realReady.length})`);
}

// ---------------- summary ----------------
const tally = (s) => results.filter((x) => x.status === s).length;
const summary = { generatedAt: new Date().toISOString(), node: process.version, pass: tally('PASS'), fail: tally('FAIL'), blocked: tally('BLOCKED'), facts, results };
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
console.log(`\nSUMMARY: PASS=${summary.pass} FAIL=${summary.fail} BLOCKED=${summary.blocked}  (results: ${path.join(OUT, 'results.json')})`);
console.log('NOTE: PASS on REAL-TRANSPORT / REAL-ENDPOINT-REJECT proves NEXUS behaviour only. A provider counts as supported only when its R1.* checks are PASS under REAL-PROVIDER.');
rmSync(WORK, { recursive: true, force: true });
process.exit(summary.fail ? 1 : 0);

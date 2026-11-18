// NEXUS latency smoke (INDICATIVE ONLY): sequential + concurrent requests against the BUILT backend on loopback, no model calls.
// Not a capacity/SLA claim: one machine, one run, loopback, no TLS, no real provider. Build first: (cd src-baseline/nexus-backend && npm run build)
// Run: node scripts/perf-smoke.mjs   (prints JSON; exit 0 always unless the backend fails to start)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import path from 'node:path';
const BACKEND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src-baseline/nexus-backend');
const KEY = 'perf-gw-' + 'Zk3Lm8Qw5Rt2Yp7N';
const port = 19900 + Math.floor(Math.random() * 90);
const db = path.join(mkdtempSync(path.join(tmpdir(), 'nexus-perf-')), 'n.db');
const spawnBe = (extra) => spawn(process.execPath, ['--experimental-sqlite', 'dist/index.js'], { cwd: BACKEND, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(port), NEXUS_DB_PATH: db, NEXUS_GATEWAY_KEYS: KEY, NEXUS_LOG_LEVEL: 'error', ...extra }, stdio: 'ignore' });
// Phase 1: DEFAULT rate limits — proves the limiter engages under a burst (a protection, not a defect). Phase 2: limiter raised so the handlers (not the limiter) are measured.
let be = spawnBe({});
const base = `http://127.0.0.1:${port}`;
async function up() { for (let i = 0; ; i++) { try { if ((await fetch(base + '/v2/health')).status !== 0) return; } catch { /* wait */ } if (i > 100) { be.kill('SIGKILL'); console.error('backend did not start'); process.exit(1); } await new Promise((r) => setTimeout(r, 150)); } }
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const stats = (a) => ({ n: a.length, p50_ms: +pct(a, 50).toFixed(2), p95_ms: +pct(a, 95).toFixed(2), p99_ms: +pct(a, 99).toFixed(2), max_ms: +Math.max(...a).toFixed(2) });
async function timed(fn) { const t = performance.now(); const r = await fn(); return [performance.now() - t, r]; }
const auth = { Authorization: `Bearer ${KEY}` };
async function seq(name, n, fn) { for (let i = 0; i < 50; i++) await fn(); const lat = []; const t0 = performance.now(); for (let i = 0; i < n; i++) lat.push((await timed(fn))[0]); const dur = (performance.now() - t0) / 1000; return { name, mode: 'sequential', ...stats(lat), req_per_s: +(n / dur).toFixed(0) }; }
async function conc(name, n, c, fn) { const lat = []; let next = 0; const t0 = performance.now(); await Promise.all(Array.from({ length: c }, async () => { while (next < n) { next++; lat.push((await timed(fn))[0]); } })); const dur = (performance.now() - t0) / 1000; return { name, mode: `concurrent x${c}`, ...stats(lat), req_per_s: +(n / dur).toFixed(0) }; }
const health = async () => { const r = await fetch(base + '/v2/health'); await r.arrayBuffer(); if (!r.ok) throw new Error('health ' + r.status); };
const authed = async () => { const r = await fetch(base + '/v2/warden/status', { headers: auth }); await r.arrayBuffer(); if (!r.ok) throw new Error('status ' + r.status); };
const unauth = async () => { const r = await fetch(base + '/v2/warden/status'); await r.arrayBuffer(); if (r.status !== 401) throw new Error('expected 401 got ' + r.status); };
const out = { note: 'INDICATIVE ONLY — single run, loopback, no TLS, no model calls; not a capacity or SLA claim', env: { node: process.version, cpus: cpus().length, cpuModel: cpus()[0]?.model, memGB: +(totalmem() / 2 ** 30).toFixed(1) }, results: [] };
await up();
// Phase 1 — default limiter: 300 rapid unauthenticated requests to a protected route; count how many were rate limited (429) vs auth-rejected (401).
{ const codes = {}; for (let i = 0; i < 300; i++) { const r = await fetch(base + '/v2/warden/status'); await r.arrayBuffer(); codes[r.status] = (codes[r.status] || 0) + 1; } out.rateLimiterUnderBurst = { requests: 300, statusCounts: codes, note: 'default NEXUS_RATE_LIMIT_PER_MINUTE=60 / BURST=20; failed authentication is throttled per client IP (401 first, then 429)' }; }
be.kill('SIGKILL'); await new Promise((r) => be.once('exit', r));
be = spawnBe({ NEXUS_RATE_LIMIT_PER_MINUTE: '100000000', NEXUS_RATE_LIMIT_BURST: '100000000' });
await up();
out.results.push(await seq('GET /v2/health', 2000, health));
out.results.push(await seq('GET /v2/warden/status (authenticated, DB reads)', 1000, authed));
out.results.push(await seq('GET /v2/warden/status (no credentials → 401)', 1000, unauth));
out.results.push(await conc('GET /v2/health', 3000, 50, health));
out.results.push(await conc('GET /v2/warden/status (authenticated)', 2000, 25, authed));
be.kill('SIGKILL');
console.log(JSON.stringify(out, null, 2));

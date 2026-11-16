// NEXUS MCP server <-> OFFICIAL third-party MCP client (@modelcontextprotocol/sdk) interoperability check.
// The client is the real vendor SDK (not written by us); the server is the BUILT NEXUS backend as a separate process.
// Install the client outside the repo:  mkdir /tmp/mcp-sdk && cd /tmp/mcp-sdk && npm i @modelcontextprotocol/sdk   then  MCP_SDK_DIR=/tmp/mcp-sdk node e2e/mcp-third-party-interop.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BACKEND = path.resolve(HERE, '../src-baseline/nexus-backend');
const SDK_DIR = process.env.MCP_SDK_DIR;
if (!SDK_DIR) { console.error('set MCP_SDK_DIR to a dir where @modelcontextprotocol/sdk is installed'); process.exit(2); }
const req = createRequire(path.join(SDK_DIR, 'x.js'));
const sdkVersion = JSON.parse((await import('node:fs')).readFileSync(path.join(SDK_DIR, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version;
const imp = (p) => import(pathToFileURL(req.resolve(p)).href);
const { Client } = await imp('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await imp('@modelcontextprotocol/sdk/client/streamableHttp.js');

const OUT = process.env.NEXUS_MCP_OUT || path.resolve(HERE, '../mcp-interop-out'); mkdirSync(OUT, { recursive: true });
const KEY = 'mcp-gw-' + 'Hk3Vx9Qm2Lp7Wn4B';
const port = 19900 + Math.floor(Math.random() * 90);
const work = mkdtempSync(path.join(tmpdir(), 'nexus-mcp-'));
let log = '';
const be = spawn(process.execPath, ['--experimental-sqlite', 'dist/index.js'], { cwd: BACKEND, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(port), NEXUS_DB_PATH: path.join(work, 'n.db'), NEXUS_GATEWAY_KEYS: KEY, NEXUS_LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
be.stdout.on('data', (d) => (log += d)); be.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/v2/health`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 150)); }

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 300) }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 250) : ''}`); };
const url = new URL(`http://127.0.0.1:${port}/mcp`);

try {
  // 1. no credentials -> the SDK must surface an auth failure, not a hang
  {
    const c = new Client({ name: 'interop-noauth', version: '1.0.0' });
    let err = null;
    try { await c.connect(new StreamableHTTPClientTransport(url)); } catch (e) { err = e; }
    check('I1 unauthenticated connect is rejected by the official client', !!err, err ? String(err.message).slice(0, 120) : 'connected without a key!');
    try { await c.close(); } catch { /* ignore */ }
  }
  // 2. authenticated session
  const client = new Client({ name: 'interop-official-sdk', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer ' + KEY } } });
  await client.connect(transport);
  const info = client.getServerVersion?.();
  check('I2 initialize handshake via official SDK (protocol negotiation)', !!info, JSON.stringify(info));
  check('I3 server capabilities advertise tools only', JSON.stringify(Object.keys(client.getServerCapabilities() || {})) === '["tools"]', JSON.stringify(client.getServerCapabilities()));
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  check('I4 tools/list returns the pure allow-list (calculate) and nothing effectful', names.includes('calculate') && !names.includes('web_fetch') && !names.includes('code_execution'), JSON.stringify(names));
  check('I5 tool descriptor has a valid inputSchema (official SDK validated it)', tools.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'), '');
  const call = await client.callTool({ name: 'calculate', arguments: { expression: '6*7' } });
  const text = (call.content || []).map((c) => c.text).join('');
  check('I6 tools/call calculate(6*7) returns 42', !call.isError && /42/.test(text), text);
  const bad = await client.callTool({ name: 'calculate', arguments: {} }).catch((e) => ({ thrown: e }));
  check('I7 invalid arguments yield isError result or protocol error (not a crash)', !!(bad.isError || bad.thrown), bad.thrown ? String(bad.thrown.message).slice(0, 100) : 'isError');
  const refused = await client.callTool({ name: 'web_fetch', arguments: { url: 'http://127.0.0.1:1/' } }).catch((e) => ({ thrown: e }));
  check('I8 non-exposed tool (web_fetch) is refused', !!(refused.thrown || refused.isError), refused.thrown ? String(refused.thrown.message).slice(0, 100) : 'isError');
  await client.ping();
  check('I9 ping', true, '');
  check('I10 gateway key never appears in backend log', !log.includes(KEY), '');
  await client.close();
} catch (e) {
  check('INTEROP-RUN', false, 'unexpected: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
}
be.kill('SIGTERM');
const failed = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ sdk: '@modelcontextprotocol/sdk@' + sdkVersion, generatedAt: new Date().toISOString(), results }, null, 2));
console.log(`SUMMARY: ${results.length - failed}/${results.length} pass (client: @modelcontextprotocol/sdk@${sdkVersion})`);
process.exit(failed ? 1 : 0);

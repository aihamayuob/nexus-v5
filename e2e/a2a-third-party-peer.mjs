// NEXUS A2A SERVER (A1) <-> OFFICIAL third-party A2A CLIENT (@a2a-js/sdk) + real process restart (SIGKILL). ADR-007 A-A1.1..A-A1.4.
// The peer is the real vendor SDK (not written by us); the server is the BUILT NEXUS backend as a separate process; the model provider is a local fake.
// Install the SDK outside the repo: mkdir /tmp/a2a-sdk && cd /tmp/a2a-sdk && npm i @a2a-js/sdk
// Run: A2A_SDK_DIR=/tmp/a2a-sdk node e2e/a2a-third-party-peer.mjs   (build first: cd src-baseline/nexus-backend && npm run build)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SDK_DIR = process.env.A2A_SDK_DIR;
if (!SDK_DIR) { console.error('set A2A_SDK_DIR'); process.exit(2); }
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BACKEND = path.resolve(HERE, '../src-baseline/nexus-backend');
const req = createRequire(path.join(SDK_DIR, 'x.js'));
const imp = (p) => import(pathToFileURL(req.resolve(p)).href);
const sdkVersion = JSON.parse(readFileSync(path.join(SDK_DIR, 'node_modules/@a2a-js/sdk/package.json'), 'utf8')).version;
const { Role } = await imp('@a2a-js/sdk');
const { ClientFactory, ClientFactoryOptions, JsonRpcTransportFactory, DefaultAgentCardResolver } = await imp('@a2a-js/sdk/client');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 240) : ''}`); };

// fake model provider (Anthropic Messages streaming), with a controllable delay per request text
let providerHits = 0;
const fake = createServer(async (rq, rs) => {
  providerHits++;
  let raw = ''; for await (const c of rq) raw += c;
  let text = ''; try { text = String(JSON.parse(raw).messages?.[0]?.content ?? ''); } catch { /* */ }
  const delay = text.includes('SLOW') ? 6000 : 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const ev = (n, d) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`;
  rs.writeHead(200, { 'Content-Type': 'text/event-stream' });
  rs.end(ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', usage: { input_tokens: 3, output_tokens: 0 } } }) +
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The answer is four.' } }) +
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }) + ev('message_stop', { type: 'message_stop' }));
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

const KEY = 'a2a-gw-' + 'Qm7Xk2Lp9Wn4BvHs';
const port = 19800 + Math.floor(Math.random() * 90);
const work = mkdtempSync(path.join(tmpdir(), 'nexus-a2a-'));
const dbPath = path.join(work, 'n.db');
let be = null; let log = '';
async function startBackend() {
  be = spawn(process.execPath, ['--experimental-sqlite', 'dist/index.js'], { cwd: BACKEND, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(port), NEXUS_DB_PATH: dbPath, NEXUS_GATEWAY_KEYS: KEY, NEXUS_LOG_LEVEL: 'warn', NEXUS_A2A_PROVIDER: 'anthropic', NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key', NEXUS_ANTHROPIC_BASE_URL: fakeUrl, NEXUS_MODEL_ANTHROPIC: 'claude-fake', NEXUS_MAX_RETRIES: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  be.stdout.on('data', (d) => (log += d)); be.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/v2/health`)).ok) return; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('backend did not start: ' + log.slice(-400));
}
const base = `http://127.0.0.1:${port}`;
const authedFetch = (input, init = {}) => fetch(input, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${KEY}` } });
const mkClient = (fetchImpl) => new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
  transports: [new JsonRpcTransportFactory({ fetchImpl })], cardResolver: new DefaultAgentCardResolver({ fetchImpl: fetch }),
})).createFromUrl(base);
const userMsg = (text) => ({ tenant: '', message: { messageId: 'm-' + Math.random(), contextId: '', taskId: '', role: Role.ROLE_USER, parts: [{ content: { $case: 'text', value: text }, metadata: undefined, filename: '', mediaType: '' }], metadata: undefined, extensions: [], referenceTaskIds: [] }, configuration: undefined, metadata: undefined });
const cfgImmediate = () => ({ acceptedOutputModes: [], taskPushNotificationConfig: undefined, historyLength: undefined, returnImmediately: true });
const stateName = (t) => (typeof t.status?.state === 'number' ? ['UNSPEC', 'SUBMITTED', 'WORKING', 'COMPLETED', 'FAILED', 'CANCELED', 'INPUT_REQUIRED', 'REJECTED', 'AUTH_REQUIRED'][t.status.state] : String(t.status?.state));
const textOf = (t) => t.artifacts?.[0]?.parts?.[0]?.content?.value ?? t.artifacts?.[0]?.parts?.[0]?.text;

try {
  await startBackend();
  const client = await mkClient(authedFetch);
  check('P1 the official SDK discovers and parses the NEXUS Agent Card (/.well-known/agent-card.json) and selects the JSON-RPC 1.0 interface', !!client, '');
  const done = await client.sendMessage(userMsg('what is 2+2?'));
  check('P2 official-SDK SendMessage returns a COMPLETED Task whose artifact carries the model answer', done?.id && stateName(done) === 'COMPLETED' && textOf(done) === 'The answer is four.', `${stateName(done)} / ${textOf(done)}`);
  const got = await client.getTask({ tenant: '', id: done.id, historyLength: undefined });
  check('P3 official-SDK GetTask returns the same Task', got.id === done.id && stateName(got) === 'COMPLETED', stateName(got));

  const slow = await client.sendMessage({ ...userMsg('SLOW task please'), configuration: cfgImmediate() });
  check('P4 returnImmediately yields a non-terminal Task', ['SUBMITTED', 'WORKING'].includes(stateName(slow)), stateName(slow));
  const quick = await client.sendMessage(userMsg('another quick one'));
  const canceled = await client.cancelTask({ tenant: '', id: slow.id, metadata: undefined });
  check('P5 official-SDK CancelTask cancels the slow task while a different task completes (A-A1.2)', stateName(canceled) === 'CANCELED' && stateName(quick) === 'COMPLETED', `${stateName(canceled)} / ${stateName(quick)}`);

  const noAuth = await mkClient(fetch);
  let rejected = null; const before = providerHits;
  try { await noAuth.sendMessage(userMsg('what is 2+2?')); } catch (e) { rejected = e; }
  check('P6 the same official client WITHOUT credentials is rejected and causes no provider traffic (A-A1.3)', !!rejected && providerHits === before, rejected ? String(rejected.message).slice(0, 100) : 'accepted!');

  // restart recovery (A-A1.4): SIGKILL while a task is in flight, then restart on the same DB
  const inflight = await client.sendMessage({ ...userMsg('SLOW restart test'), configuration: cfgImmediate() });
  await new Promise((r) => setTimeout(r, 500));
  be.kill('SIGKILL'); await new Promise((r) => be.once('exit', r));
  await startBackend();
  const client2 = await mkClient(authedFetch);
  const doneAfter = await client2.getTask({ tenant: '', id: done.id, historyLength: undefined });
  check('P7 a task completed before SIGKILL is intact after restart (state + artifact survive)', stateName(doneAfter) === 'COMPLETED' && textOf(doneAfter) === 'The answer is four.', `${stateName(doneAfter)} / ${textOf(doneAfter)}`);
  const inflightAfter = await client2.getTask({ tenant: '', id: inflight.id, historyLength: undefined });
  const s = stateName(inflightAfter);
  check('P8 a task that was IN FLIGHT at SIGKILL is not reported as still working forever: after restart it resolves to a terminal state', ['FAILED', 'COMPLETED', 'CANCELED'].includes(s), `state after restart = ${s}`);
  const fresh = await client2.sendMessage(userMsg('what is 2+2?'));
  check('P9 the restarted server accepts and completes a new task', stateName(fresh) === 'COMPLETED', stateName(fresh));
} catch (e) {
  check('E2E harness ran without an unexpected exception', false, e?.stack || e);
} finally {
  try { be?.kill('SIGKILL'); } catch { /* */ }
  fake.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n@a2a-js/sdk ${sdkVersion}: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

import './helpers/setA2aTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { ServerConfig } from '../src/config/env.js';
import { getRepos } from '../src/persistence/repos.js';
import { mapTaskState } from '../src/a2a/a2aServer.js';

/**
 * A1 — A2A SERVER (ADR-007 §2; owner R4 authorization). Target: A2A v1.0, JSON-RPC binding, NEXUS as SERVER only. Wire facts were read from the official spec
 * (a2a-protocol.org/latest/specification) and cross-checked against the official @a2a-js/sdk 1.3.0 client source (see e2e/a2a-third-party-peer.mjs). Every "0 requests"
 * claim measures the FAKE provider's own counter and sits beside a control.
 */
let nexus: Server, fake: Server, url = '';
let providerHits = 0;
let providerDelayMs = 0;
let seenUserText: string[] = [];
const KEY = 'secret-key-abc', OTHER = 'another-key-xyz';

const listen = (s: Server) => new Promise<string>((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as { port: number }).port}`)));
before(async () => {
  fake = createServer(async (req, res) => {
    providerHits++;
    let raw = ''; for await (const c of req) raw += c;
    let streaming = false;
    try { const j = JSON.parse(raw); streaming = j.stream === true; seenUserText.push(String(j.messages?.[0]?.content ?? '')); } catch { /* ignore */ }
    if (providerDelayMs) await new Promise((r) => setTimeout(r, providerDelayMs));
    if (streaming) {
      // Anthropic Messages streaming (SSE) — the adapter streams whenever the caller wants tokens.
      const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', usage: { input_tokens: 3, output_tokens: 0 } } }) +
          ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
          ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The answer is four.' } }) +
          ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
          ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }) +
          ev('message_stop', { type: 'message_stop' })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'The answer is four.' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 4 } }));
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(fake);
  nexus = createNexusServer();
  url = await listen(nexus);
});
after(async () => { await Promise.all([nexus, fake].map((s) => new Promise((r) => s.close(r)))); });
beforeEach(() => { providerHits = 0; providerDelayMs = 0; seenUserText = []; (ServerConfig as { a2aProvider: string }).a2aProvider = 'anthropic'; });

const rpc = async (method: string, params: unknown, o: { key?: string | null; version?: string | null; id?: number | string } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.version !== null) headers['A2A-Version'] = o.version ?? '1.0';
  if (o.key !== null) headers.Authorization = `Bearer ${o.key ?? KEY}`;
  const res = await fetch(`${url}/a2a`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: o.id ?? 1, method, params }) });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const msg = (text: string, extra: Record<string, unknown> = {}) => ({ message: { messageId: 'm-' + Math.random(), role: 'ROLE_USER', parts: [{ text }], ...extra } });
const waitState = async (id: string, want: string, key = KEY) => {
  for (let i = 0; i < 60; i++) { const r = await rpc('GetTask', { id }, { key }); if (r.body?.result?.status?.state === want) return r.body.result; await new Promise((x) => setTimeout(x, 100)); }
  throw new Error('timeout waiting for ' + want);
};

test('A1 (A-A1.1): the Agent Card is public, at /.well-known/agent-card.json, has every v1.0-required field, declares only what is implemented and leaks no secret', async () => {
  const res = await fetch(`${url}/.well-known/agent-card.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const raw = await res.text();
  const c = JSON.parse(raw);
  for (const k of ['name', 'description', 'supportedInterfaces', 'version', 'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills']) assert.ok(k in c, `card.${k} missing`);
  const i = c.supportedInterfaces[0];
  assert.equal(i.protocolBinding, 'JSONRPC'); assert.equal(i.protocolVersion, '1.0'); assert.match(i.url, /\/a2a$/);
  assert.equal(c.capabilities.streaming, false); assert.equal(c.capabilities.pushNotifications, false); assert.equal(c.capabilities.extendedAgentCard, false);
  for (const s of c.skills) for (const k of ['id', 'name', 'description', 'tags']) assert.ok(k in s, `skill.${k}`);
  assert.ok(c.skills.length >= 1);
  assert.ok(JSON.stringify(c.securitySchemes).toLowerCase().includes('bearer'), 'bearer auth must be declared');
  for (const secret of [KEY, OTHER, 'fake-anthropic-key-a2a']) assert.ok(!raw.includes(secret), 'secret leaked into the card');
});

test('A1 (A-A1.3): POST /a2a rejects missing/wrong credentials (401) and does NOT start any work (provider 0 hits); control: the valid key does', async () => {
  const none = await rpc('SendMessage', msg('what is 2+2?'), { key: null });
  const wrong = await rpc('SendMessage', msg('what is 2+2?'), { key: 'nope' });
  assert.equal(none.status, 401); assert.equal(wrong.status, 401);
  assert.equal(providerHits, 0, 'unauthenticated peer caused provider traffic');
  const ok = await rpc('SendMessage', msg('what is 2+2?'));
  assert.equal(ok.status, 200);
  assert.ok(providerHits >= 1, 'CONTROL: authenticated call reaches the provider');
});

test('A1: A2A-Version is enforced — absent (treated as 0.3 per spec) and unsupported versions get VersionNotSupportedError (-32009) with ErrorInfo; "1.0" works', async () => {
  for (const v of [null, '0.3', '2.0']) {
    const r = await rpc('GetTask', { id: 'x' }, { version: v });
    assert.equal(r.body.error.code, -32009, `version=${v}`);
    assert.equal(r.body.error.data?.[0]?.['@type'], 'type.googleapis.com/google.rpc.ErrorInfo');
    assert.equal(r.body.error.data?.[0]?.reason, 'VERSION_NOT_SUPPORTED');
  }
  const ok = await rpc('GetTask', { id: 'x' }, { version: '1.0' });
  assert.equal(ok.body.error.code, -32001, 'with a supported version the call proceeds (task simply not found)');
});

test('A1 (A-A1.2): SendMessage runs a REAL NEXUS task to completion; Task carries the answer as an artifact; GetTask returns the same Task; the provider saw exactly the peer\'s text', async () => {
  const r = await rpc('SendMessage', msg('what is 2+2?'));
  const t = r.body.result.task;
  assert.ok(t, 'result must be {task}');
  assert.equal(t.status.state, 'TASK_STATE_COMPLETED');
  assert.match(t.status.timestamp, /^\d{4}-\d\d-\d\dT/);
  assert.equal(t.contextId, t.id);
  assert.equal(t.artifacts[0].parts[0].text, 'The answer is four.');
  assert.ok(t.artifacts[0].artifactId);
  assert.deepEqual(seenUserText, ['what is 2+2?']);
  const g = await rpc('GetTask', { id: t.id });
  assert.equal(g.body.result.id, t.id);
  assert.equal(g.body.result.status.state, 'TASK_STATE_COMPLETED');
  assert.equal(g.body.result.artifacts[0].parts[0].text, 'The answer is four.');
  const nexusTask = getRepos().tasks.get(t.id)!;
  assert.equal(nexusTask.status, 'done', 'the A2A task IS the NEXUS task (no parallel state)');
  assert.ok(getRepos().a2aTasks.get(t.id), 'ownership row persisted');
});

test('A1: returnImmediately returns a non-terminal Task fast; GetTask later shows COMPLETED', async () => {
  providerDelayMs = 700;
  const t0 = Date.now();
  const r = await rpc('SendMessage', { ...msg('what is 2+2?'), configuration: { returnImmediately: true } });
  assert.ok(Date.now() - t0 < 600, 'must not block on the provider');
  const t = r.body.result.task;
  assert.ok(['TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING'].includes(t.status.state), t.status.state);
  const done = await waitState(t.id, 'TASK_STATE_COMPLETED');
  assert.equal(done.artifacts[0].parts[0].text, 'The answer is four.');
});

test('A1 (A-A1.3): a task is visible ONLY to the peer (key) that created it — another key gets TaskNotFound (-32001) for Get AND Cancel, indistinguishable from an unknown id', async () => {
  const t = (await rpc('SendMessage', msg('what is 2+2?'))).body.result.task;
  const foreign = await rpc('GetTask', { id: t.id }, { key: OTHER });
  const unknown = await rpc('GetTask', { id: 'does-not-exist' }, { key: OTHER });
  const foreignCancel = await rpc('CancelTask', { id: t.id }, { key: OTHER });
  assert.equal(foreign.body.error.code, -32001); assert.equal(foreignCancel.body.error.code, -32001);
  assert.equal(foreign.body.error.message, unknown.body.error.message, 'no existence oracle');
  assert.equal(foreign.body.error.data[0].reason, 'TASK_NOT_FOUND'); assert.equal(foreign.body.error.data[0].domain, 'a2a-protocol.org');
  assert.equal((await rpc('GetTask', { id: t.id })).body.result.id, t.id, 'control: the owner still sees it');
});

test('A1 (A-A1.2): CancelTask aborts a running task (CANCELED); cancelling a finished task is TaskNotCancelableError (-32002)', async () => {
  providerDelayMs = 2500;
  const t = (await rpc('SendMessage', { ...msg('what is 2+2?'), configuration: { returnImmediately: true } })).body.result.task;
  await new Promise((r) => setTimeout(r, 300));
  const c = await rpc('CancelTask', { id: t.id });
  assert.equal(c.body.result.status.state, 'TASK_STATE_CANCELED', JSON.stringify(c.body));
  assert.equal(getRepos().tasks.get(t.id)!.status, 'cancelled');
  const again = await rpc('CancelTask', { id: t.id });
  assert.equal(again.body.error.code, -32002);
  providerDelayMs = 0;
  const fin = (await rpc('SendMessage', msg('what is 2+2?'))).body.result.task;
  assert.equal((await rpc('CancelTask', { id: fin.id })).body.error.code, -32002);
});

test('A1: malformed / unsupported requests get the right JSON-RPC errors and start NO work (provider 0 hits)', async () => {
  const bad = async (m: string, p: unknown) => (await rpc(m, p)).body.error?.code;
  assert.equal(await bad('SendMessage', {}), -32602);
  assert.equal(await bad('SendMessage', { message: { messageId: 'x', role: 'ROLE_USER', parts: [] } }), -32602);
  assert.equal(await bad('SendMessage', { message: { messageId: 'x', role: 'ROLE_USER', parts: [{ url: 'http://169.254.169.254/' }] } }), -32602);
  assert.equal(await bad('SendMessage', { message: { messageId: 'x', role: 'ROLE_AGENT', parts: [{ text: 'hi' }] } }), -32602);
  assert.equal(await bad('SendMessage', msg('x'.repeat(30_000))), -32602);
  assert.equal(await bad('GetTask', {}), -32602);
  assert.equal(await bad('SendStreamingMessage', msg('hi')), -32004);
  assert.equal(await bad('SubscribeToTask', { id: 'x' }), -32004);
  assert.equal(await bad('GetExtendedAgentCard', {}), -32004);
  assert.equal(await bad('NoSuchMethod', {}), -32601);
  const raw = await fetch(`${url}/a2a`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0', Authorization: `Bearer ${KEY}` }, body: '{not json' });
  assert.equal((await raw.json() as any).error.code, -32700);
  const batch = await fetch(`${url}/a2a`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0', Authorization: `Bearer ${KEY}` }, body: '[]' });
  assert.equal((await batch.json() as any).error.code, -32600);
  assert.equal(providerHits, 0, 'a rejected request started provider traffic');
});

test('A1: a peer cannot choose the provider/model — metadata is ignored; the operator-configured provider is the only one used', async () => {
  const r = await rpc('SendMessage', { ...msg('what is 2+2?'), metadata: { provider: 'openai', model: 'gpt-x' } });
  assert.equal(r.body.result.task.status.state, 'TASK_STATE_COMPLETED');
  assert.equal(getRepos().tasks.get(r.body.result.task.id)!.provider, 'anthropic');
});

test('A1: when NEXUS_A2A_PROVIDER is not configured the surface is OFF — card 404, /a2a refuses, provider 0 hits (opt-in)', async () => {
  (ServerConfig as { a2aProvider: string }).a2aProvider = '';
  assert.equal((await fetch(`${url}/.well-known/agent-card.json`)).status, 404);
  const r = await rpc('SendMessage', msg('what is 2+2?'));
  assert.ok(r.status === 404 || r.body?.error, JSON.stringify(r));
  assert.equal(providerHits, 0);
});

test('A1: NEXUS task status maps to A2A task states (pure mapping)', () => {
  assert.equal(mapTaskState('pending', false), 'TASK_STATE_SUBMITTED');
  assert.equal(mapTaskState('running', false), 'TASK_STATE_WORKING');
  assert.equal(mapTaskState('done', false), 'TASK_STATE_COMPLETED');
  assert.equal(mapTaskState('failed', false), 'TASK_STATE_FAILED');
  assert.equal(mapTaskState('cancelled', false), 'TASK_STATE_CANCELED');
  assert.equal(mapTaskState('running', true), 'TASK_STATE_INPUT_REQUIRED', 'a task paused for human approval is input-required');
});

test('A1: a part mixing text with url/raw/data is refused (no peer-supplied URL or blob is ever accepted)', async () => {
  for (const extra of [{ url: 'http://169.254.169.254/latest' }, { raw: 'AAAA' }, { data: { a: 1 } }]) {
    const r = await rpc('SendMessage', { message: { messageId: 'x', role: 'ROLE_USER', parts: [{ text: 'hello', ...extra }] } });
    assert.equal(r.body.error?.code, -32602, JSON.stringify(extra));
  }
  assert.equal(providerHits, 0);
});

test('A1: retrying the same messageId returns the SAME task while it is running, but another peer with the same messageId/text gets its OWN task (no cross-peer sharing)', async () => {
  providerDelayMs = 900;
  const send = (key: string) => rpc('SendMessage', { message: { messageId: 'dup-1', role: 'ROLE_USER', parts: [{ text: 'what is 2+2?' }] }, configuration: { returnImmediately: true } }, { key });
  const a1 = (await send(KEY)).body.result.task.id;
  const a2 = (await send(KEY)).body.result.task.id;
  const b1 = (await send(OTHER)).body.result.task.id;
  assert.equal(a1, a2, 'same peer + same messageId => same task');
  assert.notEqual(a1, b1, 'a different peer must never share the task');
  assert.equal((await rpc('GetTask', { id: a1 }, { key: OTHER })).body.error.code, -32001);
});

test('A1: CancelTask on a non-terminal task that is not running in this process (e.g. waiting for approval / after a restart) still records CANCELED', async () => {
  const id = 'chat_manual_' + Math.random().toString(36).slice(2);
  getRepos().tasks.create({ id, kind: 'chat', idempotencyKey: null, provider: 'anthropic', model: null, goalOrPromptLen: 3, projectId: null, userId: null, errorMessage: null });
  const owner = (await rpc('GetTask', { id: 'zz' })).status; void owner;
  const keyIdentity = (await import('../src/gateway/middleware/auth.js')).keyIdentity(KEY);
  getRepos().a2aTasks.claim(id, keyIdentity);
  const c = await rpc('CancelTask', { id });
  assert.equal(c.body.result.status.state, 'TASK_STATE_CANCELED', JSON.stringify(c.body));
  assert.equal(getRepos().tasks.get(id)!.status, 'cancelled');
});

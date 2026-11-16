// F-04 (owner-closed 2026-11-15; re-implemented 2026-11-16 from the R3 specification — NOT a copy of R3's file, which is not in the available tree).
// Defect A: claimTask writes the REQUESTED provider/model before routing; after a fallback the task row still named the failed provider.
// Defect B (same root): chatService re-sent the PRIMARY's model string to the fallback provider (`providerModel || model`).
import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { getRepos } from '../src/persistence/repos.js';

const OPENAI_OWN = 'openai-own-model';
const ANTHROPIC_OWN = 'claude-own-model';
const CLIENT_EXPLICIT = 'CLIENT-EXPLICIT-claude-model';
process.env.NEXUS_MODEL_OPENAI = OPENAI_OWN;
process.env.NEXUS_MODEL_ANTHROPIC = ANTHROPIC_OWN;

let nexus: Server, nexusUrl: string, anthropic: Server, openai: Server;
let seen: { anthropic: string[]; openai: string[] };
let mode: { anthropic: 'fail' | 'ok'; openai: 'fail' | 'ok' };

const listen = (s: Server): Promise<string> => new Promise((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as any).port}`)));
const readBody = async (req: any) => { let t = ''; for await (const c of req) t += c; try { return JSON.parse(t); } catch { return {}; } };

before(async () => {
  anthropic = createServer(async (req, res) => {
    const b = await readBody(req); seen.anthropic.push(b.model);
    if (mode.anthropic === 'fail') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'upstream overloaded' } })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'answered by PRIMARY' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 4 } }));
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(anthropic); process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic';
  openai = createServer(async (req, res) => {
    const b = await readBody(req); seen.openai.push(b.model);
    if (mode.openai === 'fail') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'down' } })); }
    if (b.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'answered by FALLBACK' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 4 } })}\n\n`);
      res.write('data: [DONE]\n\n'); return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'answered by FALLBACK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 4 } }));
  });
  process.env.NEXUS_OPENAI_BASE_URL = await listen(openai); process.env.NEXUS_OPENAI_API_KEY = 'fake-openai';
  nexus = createNexusServer(); nexusUrl = await listen(nexus);
});
after(async () => { await Promise.all([nexus, anthropic, openai].map((s) => new Promise((r) => s.close(r)))); });
beforeEach(() => { seen = { anthropic: [], openai: [] }; mode = { anthropic: 'fail', openai: 'ok' }; });

const chat = (extra: Record<string, unknown>, tag: string) => fetch(`${nexusUrl}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'anthropic', max_tokens: 50, messages: [{ role: 'user', content: `F04 ${tag} ${Math.random()}` }], ...extra }),
});
const lastTask = () => getRepos().tasks.recent(1)[0]!;

test('F-04 B: the fallback provider receives ITS OWN configured model, never the primary\'s (client model applies to the requested provider only)', async () => {
  const res = await chat({ model: CLIENT_EXPLICIT }, 'B');
  assert.equal(res.status, 200);
  assert.deepEqual(seen.anthropic, [CLIENT_EXPLICIT], 'primary gets the explicit client model');
  assert.deepEqual(seen.openai, [OPENAI_OWN], 'fallback gets openai\'s own model, not the claude/client string');
});

test('F-04 A (non-stream): after a fallback the task row names the provider/model that actually SERVED', async () => {
  const res = await chat({ model: CLIENT_EXPLICIT }, 'A1');
  assert.equal(res.status, 200);
  const t = lastTask();
  assert.equal(t.status, 'done');
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, OPENAI_OWN);
});

test('F-04 A (stream): same for /api/chat with stream:true', async () => {
  const res = await chat({ stream: true, model: CLIENT_EXPLICIT }, 'A2');
  assert.equal(res.status, 200);
  await res.text();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen.openai, [OPENAI_OWN]);
  const t = lastTask();
  assert.equal(t.status, 'done');
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, OPENAI_OWN);
});

test('F-04 A (v2 unified fast path): same for POST /v2/tasks', async () => {
  const res = await fetch(`${nexusUrl}/v2/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: `hi ${Math.random()}`, provider: 'anthropic' }) });
  assert.equal(res.status, 200);
  await res.text();
  const t = lastTask();
  assert.equal(t.status, 'done');
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, OPENAI_OWN);
  assert.deepEqual(seen.openai, [OPENAI_OWN]);
});

test('F-04 scope guard: when nothing is served (all providers fail) the failed task keeps the REQUESTED provider', async () => {
  mode.openai = 'fail';
  const res = await chat({ model: CLIENT_EXPLICIT }, 'fail');
  assert.notEqual(res.status, 200);
  const t = lastTask();
  assert.equal(t.status, 'failed');
  assert.equal(t.provider, 'anthropic');
});

test('F-04 scope guard: no fallback needed => row = primary + the model actually sent (explicit client model)', async () => {
  mode.anthropic = 'ok';
  const res = await chat({ model: CLIENT_EXPLICIT }, 'primary-ok');
  assert.equal(res.status, 200);
  assert.deepEqual(seen.openai, [], 'fallback must not be called');
  const t = lastTask();
  assert.equal(t.provider, 'anthropic');
  assert.equal(t.model, CLIENT_EXPLICIT);
});

test('F-04: without an explicit client model each provider is called with its own registry model', async () => {
  const res = await chat({}, 'no-explicit');
  assert.equal(res.status, 200);
  assert.deepEqual(seen.anthropic, [ANTHROPIC_OWN]);
  assert.deepEqual(seen.openai, [OPENAI_OWN]);
  assert.equal(lastTask().model, OPENAI_OWN);
});

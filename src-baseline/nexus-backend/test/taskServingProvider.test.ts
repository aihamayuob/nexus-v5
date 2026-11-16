// F-04 (2026-11-15): after a provider fallback, the task row used to keep the REQUESTED provider/model (written by claimTask before routing),
// so /v2/tasks and any audit built on it blamed the wrong vendor. Diagnosis also showed the fallback attempt was sent the PRIMARY's model
// string (`providerModel || model`), i.e. a real OpenAI endpoint would have received "claude-…". Both are covered here on real HTTP servers.
import './helpers/setFallbackTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { getRepos } from '../src/persistence/repos.js';

let nexus: Server;
let nexusUrl: string;
let failingAnthropic: Server;
let workingOpenAI: Server;
const openaiSeenModels: string[] = [];
let primaryAlsoWorks = false;
let anthropicHits = 0;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

before(async () => {
  failingAnthropic = createServer(async (req, res) => {
    anthropicHits++;
    for await (const _ of req) void _;
    if (primaryAlsoWorks) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'primary ok' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } }));
      return;
    }
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream overloaded' } }));
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(failingAnthropic);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
  process.env.NEXUS_MODEL_ANTHROPIC = 'claude-primary-model';

  workingOpenAI = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    try { openaiSeenModels.push(JSON.parse(raw).model); } catch { openaiSeenModels.push('<unparsable>'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'answered by the FALLBACK provider' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 4 } }));
  });
  process.env.NEXUS_OPENAI_BASE_URL = await listen(workingOpenAI);
  process.env.NEXUS_OPENAI_API_KEY = 'fake-openai-key';
  process.env.NEXUS_MODEL_OPENAI = 'gpt-fallback-model';

  nexus = createNexusServer();
  nexusUrl = await listen(nexus);
});

after(async () => {
  await Promise.all([nexus, failingAnthropic, workingOpenAI].map((s) => new Promise((r) => s.close(r))));
});

async function chat(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ provider: 'anthropic', max_tokens: 50, messages: [{ role: 'user', content: 'hello ' + Math.random() }], ...extra }),
  });
  return res;
}

function newestTask() {
  const t = getRepos().tasks.recent(1)[0];
  assert.ok(t, 'a task row must exist');
  return t;
}

test('F-04: after fallback the task row records the SERVING provider and its own model, not the requested ones', async () => {
  primaryAlsoWorks = false;
  const res = await chat();
  assert.equal(res.status, 200);
  const t = newestTask();
  assert.equal(t.status, 'done');
  assert.equal(t.provider, 'openai', 'task.provider must be the provider that actually answered');
  assert.equal(t.model, 'gpt-fallback-model', 'task.model must be the model the serving provider actually used');
});

test('F-04 (root of the model half): the fallback provider is sent ITS OWN default model, never the primary\'s model string', async () => {
  primaryAlsoWorks = false;
  openaiSeenModels.length = 0;
  await chat();
  assert.deepEqual(openaiSeenModels, ['gpt-fallback-model']);
});

test('F-04: an explicit client model applies to the requested provider only — the fallback still gets its own model, and the row says so', async () => {
  primaryAlsoWorks = false;
  openaiSeenModels.length = 0;
  await chat({ model: 'claude-explicit-choice' });
  assert.deepEqual(openaiSeenModels, ['gpt-fallback-model']);
  const t = newestTask();
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, 'gpt-fallback-model');
});

test('F-04 scope guard: when the primary serves, the row keeps the primary provider and the explicit model (no regression)', async () => {
  primaryAlsoWorks = true;
  anthropicHits = 0;
  const res = await chat({ model: 'claude-explicit-choice' });
  assert.equal(res.status, 200);
  assert.ok(anthropicHits >= 1);
  const t = newestTask();
  assert.equal(t.status, 'done');
  assert.equal(t.provider, 'anthropic');
  assert.equal(t.model, 'claude-explicit-choice');
});

test('F-04 scope guard: when every provider fails the row stays failed and keeps the requested provider (nothing served)', async () => {
  primaryAlsoWorks = false;
  const saved = process.env.NEXUS_OPENAI_API_KEY;
  delete process.env.NEXUS_OPENAI_API_KEY; // no fallback configured any more
  try {
    const res = await chat();
    assert.notEqual(res.status, 200);
    const t = newestTask();
    assert.equal(t.status, 'failed');
    assert.equal(t.provider, 'anthropic', 'nothing served the request, so the requested provider is the only truthful value');
  } finally {
    process.env.NEXUS_OPENAI_API_KEY = saved;
  }
});

test('F-04: streaming path records the serving provider too', async () => {
  primaryAlsoWorks = false;
  const res = await chat({ stream: true });
  assert.equal(res.status, 200);
  await res.text(); // drain SSE to completion
  const t = newestTask();
  assert.equal(t.status, 'done');
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, 'gpt-fallback-model');
});

test('F-04: the v2 unified fast path (POST /v2/tasks, LOW tier) records the serving provider too', async () => {
  primaryAlsoWorks = false;
  const res = await fetch(`${nexusUrl}/v2/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', input: 'hi there ' + Math.random() }),
  });
  assert.equal(res.status, 200);
  const sse = await res.text();
  assert.match(sse, /"tier":"LOW"/, 'precondition: this input must take the single-completion fast path');
  const t = newestTask();
  assert.equal(t.kind, 'chat');
  assert.equal(t.status, 'done');
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, 'gpt-fallback-model');
});

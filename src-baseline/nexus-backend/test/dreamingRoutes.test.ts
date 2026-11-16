import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;
let fakeAnthropic: Server;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } });
}

before(async () => {
  fakeAnthropic = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('عنصر مدمج عبر HTTP.'));
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(fakeAnthropic);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

after(async () => {
  await Promise.all([new Promise((r) => nexusServer.close(r)), new Promise((r) => fakeAnthropic.close(r))]);
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
});

function addItem(content: string, embedding: number[] | null) {
  return getRepos().memory.add({ projectId: null, userId: null, kind: 'knowledge', title: null, content, embedding });
}

test('POST /v2/dreaming/scan finds a real candidate pair via HTTP', async () => {
  addItem('نص أ', [1, 0, 0]);
  addItem('نص ب', [0.99, 0.01, 0]);
  const res = await fetch(`${nexusUrl}/v2/dreaming/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'knowledge', threshold: 0.9 }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { candidates: unknown[] };
  assert.equal(body.candidates.length, 1);
});

test('POST /v2/dreaming/scan with a missing kind is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/dreaming/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test('GET /v2/dreaming/candidates lists real candidates with real status filtering', async () => {
  addItem('نص أ', [1, 0, 0]);
  addItem('نص ب', [0.99, 0.01, 0]);
  await fetch(`${nexusUrl}/v2/dreaming/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'knowledge' }) });

  const openRes = await fetch(`${nexusUrl}/v2/dreaming/candidates?status=open`);
  const openBody = (await openRes.json()) as { candidates: unknown[] };
  assert.equal(openBody.candidates.length, 1);

  const mergedRes = await fetch(`${nexusUrl}/v2/dreaming/candidates?status=merged`);
  const mergedBody = (await mergedRes.json()) as { candidates: unknown[] };
  assert.equal(mergedBody.candidates.length, 0);
});

test('POST /v2/dreaming/candidates/:id/merge actually creates a new item and preserves both originals — full HTTP round trip', async () => {
  addItem('محتوى أ الأصلي', [1, 0, 0]);
  addItem('محتوى ب الأصلي', [0.99, 0.01, 0]);
  const scanRes = await fetch(`${nexusUrl}/v2/dreaming/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'knowledge' }),
  });
  const { candidates } = (await scanRes.json()) as { candidates: Array<{ id: string }> };

  const beforeCount = getRepos().memory.listForProject(null, 'knowledge').length;
  const mergeRes = await fetch(`${nexusUrl}/v2/dreaming/candidates/${candidates[0]!.id}/merge`, { method: 'POST' });
  assert.equal(mergeRes.status, 200);
  const mergeBody = (await mergeRes.json()) as { mergedItem: { content: string }; candidate: { status: string } };
  assert.equal(mergeBody.candidate.status, 'merged');

  const afterCount = getRepos().memory.listForProject(null, 'knowledge').length;
  assert.equal(afterCount, beforeCount + 1);
  const contents = getRepos().memory.listForProject(null, 'knowledge').map((it) => it.content);
  assert.ok(contents.includes('محتوى أ الأصلي'));
  assert.ok(contents.includes('محتوى ب الأصلي'));
});

test('POST /v2/dreaming/candidates/:id/dismiss actually marks it dismissed via HTTP', async () => {
  addItem('نص أ', [1, 0, 0]);
  addItem('نص ب', [0.99, 0.01, 0]);
  const scanRes = await fetch(`${nexusUrl}/v2/dreaming/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'knowledge' }),
  });
  const { candidates } = (await scanRes.json()) as { candidates: Array<{ id: string }> };

  const res = await fetch(`${nexusUrl}/v2/dreaming/candidates/${candidates[0]!.id}/dismiss`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'dismissed');
});

test('POST /v2/dreaming/candidates/:id/merge for an unknown id is a real 404', async () => {
  const res = await fetch(`${nexusUrl}/v2/dreaming/candidates/does-not-exist/merge`, { method: 'POST' });
  assert.equal(res.status, 404);
});

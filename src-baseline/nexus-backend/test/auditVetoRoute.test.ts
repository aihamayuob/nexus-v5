import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;

before(async () => {
  nexusServer = createNexusServer();
  await new Promise<void>((resolve) => {
    nexusServer.listen(0, '127.0.0.1', () => {
      const addr = nexusServer.address();
      nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((r) => nexusServer.close(r));
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
});

test('POST /api/audit/veto (pre-existing, previously-untested route) actually persists a real event', async () => {
  const res = await fetch(`${nexusUrl}/api/audit/veto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: 'اختبار مباشر لواجهة التدقيق',
      reviewerAgentId: 'humanitarian_aid',
      rejectedItems: [{ item: 'بند تجريبي', reason: 'سبب تجريبي' }],
      rawReviewText: '❌ مرفوض: بند تجريبي — السبب: سبب تجريبي',
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string; createdAt: number };
  assert.ok(body.id);
  assert.ok(body.createdAt > 0);
});

test('POST /api/audit/veto with missing required fields is a validation error, not a 500', async () => {
  const res = await fetch(`${nexusUrl}/api/audit/veto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'ناقص' }),
  });
  assert.equal(res.status, 400);
});

test('GET /api/audit/veto returns real, previously-written events in real reverse-chronological order', async () => {
  for (const topic of ['موضوع أول', 'موضوع ثانٍ']) {
    await fetch(`${nexusUrl}/api/audit/veto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, reviewerAgentId: 'humanitarian_aid', rejectedItems: [], rawReviewText: 'لا شيء مرفوض' }),
    });
    await new Promise((r) => setTimeout(r, 5)); // guarantee distinct createdAt ordering
  }
  const res = await fetch(`${nexusUrl}/api/audit/veto?limit=10`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { events: Array<{ topic: string; createdAt: number }> };
  assert.equal(body.events.length, 2);
  assert.equal(body.events[0]!.topic, 'موضوع ثانٍ', 'most recent first');
  assert.ok(body.events[0]!.createdAt >= body.events[1]!.createdAt);
});

test('GET /api/audit/veto with no events yet returns a real empty list, not an error', async () => {
  const res = await fetch(`${nexusUrl}/api/audit/veto`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { events: unknown[] };
  assert.deepEqual(body.events, []);
});

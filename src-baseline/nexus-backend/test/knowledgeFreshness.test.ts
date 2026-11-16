import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import type { DatabaseSync } from 'node:sqlite';
import { checkFreshness, refreshStaleItem, acceptRefresh, dismissRefresh, scanForStaleness } from '../src/knowledge/freshnessEngine.js';
import { createNexusServer } from '../src/gateway/server.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

let currentDb: DatabaseSync;

function freshDb() {
  currentDb = openTestDb();
  resetReposSingletonForTests(buildRepos(currentDb));
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

let fakeGemini: Server;
let fakeAnthropic: Server;
let nextVolatilityJson: string;
let nextComparisonJson: string;
let researchAnswer: string;

function resetBehavior() {
  nextVolatilityJson = JSON.stringify({ volatility: 'high', suggested_ttl_days: 1, rationale: 'معلومة سريعة التغيّر.' });
  nextComparisonJson = JSON.stringify({ comparison: 'updated', rationale: 'معلومة جديدة أحدث.' });
  researchAnswer = 'إجابة بحث جديدة حقيقية عن الموضوع.';
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } });
}

before(async () => {
  fakeGemini = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: researchAnswer }] }, finishReason: 'STOP', groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      })
    );
  });
  process.env.NEXUS_GEMINI_BASE_URL = await listen(fakeGemini);
  process.env.NEXUS_GEMINI_API_KEY = 'fake-gemini-key';

  fakeAnthropic = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { system?: string } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    const system = body.system ?? '';
    if (system.includes('حكم مقارنة معرفة')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(nextComparisonJson));
      return;
    }
    if (system.includes('مصنّف تقادم معرفة')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(nextVolatilityJson));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('{}'));
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(fakeAnthropic);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  await new Promise((r) => fakeGemini.close(r));
  await new Promise((r) => fakeAnthropic.close(r));
});

beforeEach(() => {
  freshDb();
  resetBehavior();
});

function seedMemoryItem(ageDays: number, content = 'محتوى معرفة تجريبي حول سعر الذهب اليوم.') {
  const repos = getRepos();
  const item = repos.memory.add({ projectId: null, userId: null, kind: 'knowledge', title: 'سعر الذهب', content, embedding: null });
  // Directly backdate created_at to simulate real age — the same "insert/manipulate rows directly to simulate a real scenario" methodology used throughout this project's compiled verifications.
  currentDb.prepare('UPDATE memory_items SET created_at = ? WHERE id = ?').run(Date.now() - ageDays * 24 * 60 * 60 * 1000, item.id);
  return item;
}

// ---- checkFreshness() ----

test('a freshly-created, high-volatility memory item is classified stale immediately given a 1-day suggested TTL', async () => {
  const item = seedMemoryItem(5); // 5 days old, TTL suggested = 1 day (from nextVolatilityJson default)
  const check = await checkFreshness(item.id);
  assert.equal(check.volatility, 'high');
  assert.equal(check.suggestedTtlDays, 1);
  assert.equal(check.status, 'stale');
  assert.ok(check.ageDaysAtCheck >= 4.9);
});

test('a low-volatility item with a long TTL stays fresh even when fairly old', async () => {
  nextVolatilityJson = JSON.stringify({ volatility: 'low', suggested_ttl_days: 3650, rationale: 'حقيقة تاريخية ثابتة.' });
  const item = seedMemoryItem(30);
  const check = await checkFreshness(item.id);
  assert.equal(check.status, 'fresh');
});

test('an item past half its TTL but not yet past it is classified aging', async () => {
  nextVolatilityJson = JSON.stringify({ volatility: 'medium', suggested_ttl_days: 10, rationale: 'x' });
  const item = seedMemoryItem(6); // 60% of a 10-day TTL
  const check = await checkFreshness(item.id);
  assert.equal(check.status, 'aging');
});

test('checkFreshness on an unknown memory item throws not_found', async () => {
  await assert.rejects(() => checkFreshness('does-not-exist'), /غير موجود/);
});

test('checkFreshness degrades gracefully to a conservative medium/90-day default when the judge provider is unavailable, rather than fabricating a classification', async () => {
  delete process.env.NEXUS_ANTHROPIC_API_KEY;
  const item = seedMemoryItem(1);
  const check = await checkFreshness(item.id);
  assert.equal(check.volatility, 'medium');
  assert.equal(check.suggestedTtlDays, 90);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

// ---- refreshStaleItem() / acceptRefresh() / dismissRefresh() ----

test('refreshing a stale item performs a real web research call and a real comparison judgment, without deciding anything yet', async () => {
  const item = seedMemoryItem(5);
  const check = await checkFreshness(item.id);
  assert.equal(check.status, 'stale');

  researchAnswer = 'الذهب اليوم بسعر مختلف تماماً عن المحتوى القديم.';
  const refreshed = await refreshStaleItem(check.id, ctx);
  assert.equal(refreshed.refreshResearched, true);
  assert.equal(refreshed.refreshNewContent, researchAnswer);
  assert.equal(refreshed.refreshComparison, 'updated');
  assert.equal(refreshed.decided, null, 'a refresh proposal must never auto-decide itself');
});

test('refreshStaleItem refuses a check that is still fresh', async () => {
  nextVolatilityJson = JSON.stringify({ volatility: 'low', suggested_ttl_days: 3650, rationale: 'x' });
  const item = seedMemoryItem(1);
  const check = await checkFreshness(item.id);
  assert.equal(check.status, 'fresh');
  await assert.rejects(() => refreshStaleItem(check.id, ctx), /لا داعي/);
});

test('acceptRefresh creates a real NEW memory item and leaves the original completely untouched', async () => {
  const item = seedMemoryItem(5);
  const originalContent = item.content;
  const check = await checkFreshness(item.id);
  researchAnswer = 'محتوى مُحدَّث حقيقي بعد إعادة البحث.';
  const refreshed = await refreshStaleItem(check.id, ctx);

  const accepted = acceptRefresh(refreshed.id, 'aiham');
  assert.equal(accepted.decided, 'accepted');
  assert.ok(accepted.newMemoryItemId);

  const original = getRepos().memory.get(item.id)!;
  assert.equal(original.content, originalContent, 'the original memory item must never be edited');

  const newItem = getRepos().memory.get(accepted.newMemoryItemId!)!;
  assert.equal(newItem.content, 'محتوى مُحدَّث حقيقي بعد إعادة البحث.');
  assert.equal(newItem.title, item.title, 'the refreshed item keeps the same title for continuity');
});

test('acceptRefresh requires a non-empty decidedBy and refuses a check with no researched refresh yet', async () => {
  const item = seedMemoryItem(5);
  const check = await checkFreshness(item.id);
  assert.throws(() => acceptRefresh(check.id, 'aiham'), /لا يوجد محتوى/);
  await refreshStaleItem(check.id, ctx);
  const freshCopy = getRepos().knowledgeFreshness.get(check.id)!;
  assert.throws(() => acceptRefresh(freshCopy.id, ''), /decidedBy مطلوب/);
});

test('dismissRefresh marks the check dismissed without creating any new memory item', async () => {
  const item = seedMemoryItem(5);
  const check = await checkFreshness(item.id);
  await refreshStaleItem(check.id, ctx);
  const before = getRepos().memory.listForProject(null).length;
  const dismissed = dismissRefresh(check.id, 'aiham');
  assert.equal(dismissed.decided, 'dismissed');
  assert.equal(dismissed.newMemoryItemId, null);
  assert.equal(getRepos().memory.listForProject(null).length, before, 'dismissing must never create a memory item');
});

test('a check that already has a decision refuses a second decision', async () => {
  const item = seedMemoryItem(5);
  const check = await checkFreshness(item.id);
  await refreshStaleItem(check.id, ctx);
  dismissRefresh(check.id, 'aiham');
  assert.throws(() => acceptRefresh(check.id, 'aiham'), /تم اتخاذ قرار بالفعل/);
});

// ---- scanForStaleness() ----

test('scanForStaleness checks every memory item in a project and skips items checked within the last day', async () => {
  const a = seedMemoryItem(5, 'عنصر أول');
  const b = seedMemoryItem(5, 'عنصر ثانٍ');
  const results1 = await scanForStaleness(null, 50);
  assert.equal(results1.length, 2);

  // Immediately scanning again must skip both — they were "just checked".
  const results2 = await scanForStaleness(null, 50);
  assert.equal(results2.length, 0);
  void a;
  void b;
});

test('GET /v2/knowledge-freshness/stale lists only stale, undecided checks — via a real Nexus server', async () => {
  const item = seedMemoryItem(5);
  await checkFreshness(item.id);

  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const res = await fetch(`${nexusUrl}/v2/knowledge-freshness/stale`);
    const body = (await res.json()) as { stale: { memoryItemId: string }[] };
    assert.equal(body.stale.length, 1);
    assert.equal(body.stale[0]!.memoryItemId, item.id);
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

test('HTTP: full check -> refresh -> accept cycle via a real Nexus server', async () => {
  const item = seedMemoryItem(5);
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const checkRes = await fetch(`${nexusUrl}/v2/knowledge-freshness/items/${item.id}/check`, { method: 'POST' });
    assert.equal(checkRes.status, 200);
    const check = (await checkRes.json()) as { id: string; status: string };
    assert.equal(check.status, 'stale');

    const refreshRes = await fetch(`${nexusUrl}/v2/knowledge-freshness/checks/${check.id}/refresh`, { method: 'POST' });
    assert.equal(refreshRes.status, 200);

    const acceptRes = await fetch(`${nexusUrl}/v2/knowledge-freshness/checks/${check.id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decidedBy: 'aiham' }),
    });
    assert.equal(acceptRes.status, 200);
    const accepted = (await acceptRes.json()) as { decided: string; newMemoryItemId: string };
    assert.equal(accepted.decided, 'accepted');
    assert.ok(accepted.newMemoryItemId);
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

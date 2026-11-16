import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { findConsolidationCandidates, dismissCandidate, mergeCandidate } from '../src/dreaming/dreaming.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { stream?: boolean } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    const mergedText = 'العنصر المدمج: يحتوي على معلومات من كلا العنصرين الأصليين — السعر 100 دولار والموقع الرياض.';
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } });
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: mergedText } });
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
      frame('message_stop', { type: 'message_stop' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse(mergedText));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_BASE_URL = serverUrl;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  freshDb();
});

function addItem(content: string, embedding: number[] | null, title = 'عنصر') {
  return getRepos().memory.add({ projectId: null, userId: null, kind: 'knowledge', title, content, embedding });
}

test('findConsolidationCandidates flags a real near-identical pair above threshold via genuine cosine similarity', () => {
  const a = addItem('السعر 100 دولار والموقع الرياض', [1, 0, 0]);
  const b = addItem('السعر مئة دولار، الموقع مدينة الرياض', [0.99, 0.05, 0]);
  const candidates = findConsolidationCandidates(null, 'knowledge', 0.9);
  assert.equal(candidates.length, 1);
  assert.deepEqual([candidates[0]!.itemIdA, candidates[0]!.itemIdB].sort(), [a.id, b.id].sort());
  assert.ok(candidates[0]!.similarity >= 0.9);
});

test('findConsolidationCandidates does NOT flag genuinely dissimilar items — a real threshold, not a rubber stamp', () => {
  addItem('معلومة عن الطقس', [1, 0, 0]);
  addItem('معلومة عن القانون التجاري', [0, 1, 0]);
  const candidates = findConsolidationCandidates(null, 'knowledge', 0.9);
  assert.equal(candidates.length, 0);
});

test('findConsolidationCandidates skips items with no embedding at all — real coverage, not fabricated', () => {
  addItem('عنصر بلا تضمين', null);
  addItem('عنصر آخر بلا تضمين', null);
  const candidates = findConsolidationCandidates(null, 'knowledge', 0.5);
  assert.equal(candidates.length, 0);
});

test('findConsolidationCandidates does not re-flag a pair that already has an open candidate', () => {
  addItem('نص أ', [1, 0, 0]);
  addItem('نص ب', [0.99, 0.01, 0]);
  const first = findConsolidationCandidates(null, 'knowledge', 0.9);
  assert.equal(first.length, 1);
  const second = findConsolidationCandidates(null, 'knowledge', 0.9);
  assert.equal(second.length, 0, 'the same still-open pair must not be re-flagged');
});

test('findConsolidationCandidates rejects an invalid threshold', () => {
  assert.throws(() => findConsolidationCandidates(null, 'knowledge', 0), /threshold/);
  assert.throws(() => findConsolidationCandidates(null, 'knowledge', 1.5), /threshold/);
});

test('dismissCandidate marks a real candidate dismissed and rejects re-deciding it', () => {
  addItem('نص أ', [1, 0, 0]);
  addItem('نص ب', [0.99, 0.01, 0]);
  const [candidate] = findConsolidationCandidates(null, 'knowledge', 0.9);
  const dismissed = dismissCandidate(candidate!.id);
  assert.equal(dismissed.status, 'dismissed');
  assert.throws(() => dismissCandidate(candidate!.id), /تم البت/);
});

test('dismissCandidate on an unknown id is a real not_found', () => {
  assert.throws(() => dismissCandidate('does-not-exist'), /غير موجود/);
});

test('mergeCandidate creates a real NEW memory item and leaves BOTH originals completely untouched — the core non-destructive guarantee', async () => {
  const a = addItem('السعر 100 دولار', [1, 0, 0], 'عنصر أ');
  const b = addItem('الموقع الرياض', [0.99, 0.05, 0], 'عنصر ب');
  const [candidate] = findConsolidationCandidates(null, 'knowledge', 0.9);

  const beforeCount = getRepos().memory.listForProject(null, 'knowledge').length;
  const result = await mergeCandidate(candidate!.id, ctx);
  const afterCount = getRepos().memory.listForProject(null, 'knowledge').length;

  assert.equal(afterCount, beforeCount + 1, 'merging must ADD one new item, never remove any');
  assert.match(result.mergedItem.content, /100 دولار/);
  assert.match(result.mergedItem.content, /الرياض/);
  assert.equal(result.candidate.status, 'merged');
  assert.equal(result.candidate.mergedItemId, result.mergedItem.id);

  const stillA = getRepos().memory.listForProject(null, 'knowledge').find((it) => it.id === a.id);
  const stillB = getRepos().memory.listForProject(null, 'knowledge').find((it) => it.id === b.id);
  assert.equal(stillA!.content, 'السعر 100 دولار');
  assert.equal(stillB!.content, 'الموقع الرياض');
});

test('mergeCandidate rejects merging an already-decided candidate', async () => {
  addItem('نص أ', [1, 0, 0]);
  addItem('نص ب', [0.99, 0.01, 0]);
  const [candidate] = findConsolidationCandidates(null, 'knowledge', 0.9);
  dismissCandidate(candidate!.id);
  await assert.rejects(() => mergeCandidate(candidate!.id, ctx), /تم البت/);
});

test('mergeCandidate on an unknown candidate id is a real not_found', async () => {
  await assert.rejects(() => mergeCandidate('does-not-exist', ctx), /غير موجود/);
});

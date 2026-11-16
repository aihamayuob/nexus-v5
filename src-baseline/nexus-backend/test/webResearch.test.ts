import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { runWebResearch } from '../src/research/webResearch.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let fakeGemini: Server;
let fakeAnthropic: Server;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

before(async () => {
  // Exact same fake-Gemini response shape as the pre-existing, proven
  // test/googleGrounding.test.ts fixture from Phase 1 — not reinvented.
  fakeGemini = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: 'الذهب يُتداول حالياً بالقرب من مستويات مرتفعة تاريخياً.' }] },
            finishReason: 'STOP',
            groundingMetadata: {
              webSearchQueries: ['gold price today'],
              groundingChunks: [
                { web: { uri: 'https://example.com/gold-analysis', title: 'Gold Analysis' } },
                { web: { uri: 'https://example.org/market-news' } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12 },
      })
    );
  });
  process.env.NEXUS_GEMINI_BASE_URL = await listen(fakeGemini);
  process.env.NEXUS_GEMINI_API_KEY = 'fake-gemini-key';

  // Phase 3 Slice 16 — needed so EvaluationEngine.evaluate() (now called
  // by default from runWebResearch()) gets past its "is the judge
  // provider configured" check at all. Every source's fetch genuinely
  // fails in this sandbox (see the fetchOk:false test below), so evidence
  // is always empty and evaluate()'s zero-evidence fast path always
  // returns before this fake server would ever actually receive a
  // request — it only needs to exist so ProviderRegistry sees a
  // configured key.
  fakeAnthropic = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: '{"verdict":"UNCERTAIN","confidence":0.5,"rationale":"x","supporting_count":0,"conflicting_count":0}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
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
});

test('runWebResearch rejects an empty question', async () => {
  await assert.rejects(() => runWebResearch('', ctx), /السؤال مطلوب/);
});

test("runWebResearch degrades gracefully (ran:false, no throw) when Gemini is not configured — mirrors verifier.ts's pattern", async () => {
  const savedKey = process.env.NEXUS_GEMINI_API_KEY;
  delete process.env.NEXUS_GEMINI_API_KEY;
  try {
    const result = await runWebResearch('سؤال بلا Gemini', ctx);
    assert.equal(result.ran, false);
    assert.equal(result.answer, '');
    assert.equal(result.sources.length, 0);
  } finally {
    process.env.NEXUS_GEMINI_API_KEY = savedKey;
  }
});

test('runWebResearch produces a real grounded answer with real webSearchQueries and correctly-extracted source domains', async () => {
  const result = await runWebResearch('ما هو سعر الذهب اليوم؟', ctx, { persistToMemory: false });
  assert.equal(result.ran, true);
  assert.match(result.answer, /الذهب/);
  assert.deepEqual(result.webSearchQueries, ['gold price today']);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0]!.domain, 'example.com');
  assert.equal(result.sources[1]!.domain, 'example.org');
});

test('a citation whose follow-up fetch genuinely fails (real SSRF/network constraint in this environment) is recorded with fetchOk:false, not silently dropped', async () => {
  const result = await runWebResearch('سؤال آخر', ctx, { persistToMemory: false });
  assert.equal(result.sources.length, 2);
  for (const s of result.sources) {
    assert.equal(s.fetchOk, false);
    assert.equal(s.contentPreview, '');
    assert.equal(s.contentHash, '');
  }
  assert.equal(result.ran, true, 'a failed follow-up fetch must not fail the whole research call');
});

test('runWebResearch persists a real Memory item by default, with real provenance included', async () => {
  const result = await runWebResearch('ما هو سعر الذهب اليوم؟', ctx);
  assert.ok(result.memoryItemId);
  const items = getRepos().memory.listForProject(null, 'knowledge');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, result.memoryItemId);
  assert.match(items[0]!.content, /example\.com/);
  assert.match(items[0]!.content, /الذهب/);
});

test('runWebResearch skips Memory persistence when explicitly told to', async () => {
  const result = await runWebResearch('سؤال بلا حفظ', ctx, { persistToMemory: false });
  assert.equal(result.memoryItemId, null);
  assert.equal(getRepos().memory.listForProject(null, 'knowledge').length, 0);
});

// ---- Phase 3 Slice 16: Unified Evaluation Engine integration ----
// Every source's follow-up fetch genuinely fails in this sandboxed test
// environment (see the fetchOk:false test above — a real, documented,
// pre-existing network constraint, not something these tests fake). That
// means the ONLY evaluation outcome actually reachable through the full
// runWebResearch() integration here is the zero-evidence fast path — full
// verdict-path coverage (VERIFIED/SUPPORTED/CONFLICTING/etc, with real
// evidence) lives in test/evaluationEngine.test.ts, which calls
// EvaluationEngine.evaluate() directly with evidence it controls, exactly
// because it doesn't depend on a real fetch succeeding.

test('runWebResearch evaluates the answer by default — zero fetched evidence in this sandbox correctly yields UNVERIFIED via evaluationEngine.ts\'s fast path, persisted to claim_evaluations', async () => {
  const result = await runWebResearch('سؤال للتقييم', ctx, { persistToMemory: false });
  assert.ok(result.evaluation);
  assert.equal(result.evaluation!.ran, true);
  assert.equal(result.evaluation!.verdict, 'UNVERIFIED');

  const records = getRepos().claimEvaluations.list(20, 'web_research');
  assert.equal(records.length, 1);
  assert.equal(records[0]!.claim, result.answer);
  assert.equal(records[0]!.verdict, 'UNVERIFIED');
  assert.equal(records[0]!.evidence.length, 0, 'sources with fetchOk:false must never be counted as evidence');
});

test('runWebResearch skips evaluation entirely when evaluate:false — no claim_evaluations row, evaluation:null', async () => {
  const result = await runWebResearch('سؤال بلا تقييم', ctx, { persistToMemory: false, evaluate: false });
  assert.equal(result.evaluation, null);
  assert.equal(getRepos().claimEvaluations.list(20).length, 0);
});

test('runWebResearch never attempts evaluation when Gemini itself is not configured (no answer exists to evaluate)', async () => {
  const savedKey = process.env.NEXUS_GEMINI_API_KEY;
  delete process.env.NEXUS_GEMINI_API_KEY;
  try {
    const result = await runWebResearch('سؤال بلا Gemini للتقييم', ctx);
    assert.equal(result.evaluation, null);
    assert.equal(getRepos().claimEvaluations.list(20).length, 0);
  } finally {
    process.env.NEXUS_GEMINI_API_KEY = savedKey;
  }
});

// ---- Evidence Integrity (CP-16, AC-9): the zero-evidence path in this sandbox also persists its integrity reason ----

test('runWebResearch (sandbox: no fetched evidence) persists integrityReason NO_EVIDENCE on the claim_evaluations row and returns it on the evaluation', async () => {
  const result = await runWebResearch('سؤال لسبب النزاهة', ctx, { persistToMemory: false });
  assert.ok(result.evaluation);
  assert.equal(result.evaluation!.integrityReason, 'NO_EVIDENCE');
  const records = getRepos().claimEvaluations.list(20, 'web_research');
  assert.equal(records.length, 1);
  assert.equal(records[0]!.integrityReason, 'NO_EVIDENCE');
});

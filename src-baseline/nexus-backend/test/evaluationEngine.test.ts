import '../test/helpers/setFallbackTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { EvaluationEngine } from '../src/evaluation/evaluationEngine.js';

let server: Server;
let nextResponseText: string;

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    for await (const _c of req) {
      /* drain */
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse(nextResponseText));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  process.env.NEXUS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test('EvaluationEngine.evaluate degrades gracefully (ran:false) when the fixed judge provider is not configured', async () => {
  const savedKey = process.env.NEXUS_ANTHROPIC_API_KEY;
  delete process.env.NEXUS_ANTHROPIC_API_KEY;
  try {
    const result = await EvaluationEngine.evaluate('ادعاء ما', [{ source: 'x', content: 'y' }]);
    assert.equal(result.ran, false);
    assert.equal(result.verdict, 'UNVERIFIED');
    assert.equal(result.confidence, null);
  } finally {
    process.env.NEXUS_ANTHROPIC_API_KEY = savedKey;
  }
});

test('EvaluationEngine.evaluate with zero evidence returns UNVERIFIED via a fast path — makes no provider call at all', async () => {
  nextResponseText = 'يجب ألا يظهر هذا — لا استدعاء متوقع';
  const result = await EvaluationEngine.evaluate('ادعاء بلا أي دليل', []);
  assert.equal(result.ran, true);
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.equal(result.supportingEvidenceCount, 0);
});

test('EvaluationEngine.evaluate returns a real VERIFIED verdict with parsed confidence and rationale from the judge', async () => {
  nextResponseText = JSON.stringify({ verdict: 'VERIFIED', confidence: 0.95, rationale: 'مصدران مستقلان يؤكدان الادعاء بوضوح.', supporting_count: 2, conflicting_count: 0 });
  const result = await EvaluationEngine.evaluate('الذهب ارتفع اليوم', [
    { source: 'https://a.example', content: 'الذهب ارتفع بنسبة 2% اليوم حسب رويترز.', kind: 'INDEPENDENT_SOURCE' },
    { source: 'https://b.example', content: 'أسعار الذهب سجلت ارتفاعاً ملحوظاً اليوم.', kind: 'INDEPENDENT_SOURCE' },
  ]);
  assert.equal(result.ran, true);
  assert.equal(result.verdict, 'VERIFIED');
  assert.equal(result.confidence, 0.95);
  assert.equal(result.supportingEvidenceCount, 2);
  assert.equal(result.conflictingEvidenceCount, 0);
  assert.match(result.rationale, /مصدران/);
});

test('EvaluationEngine.evaluate returns CONFLICTING when told the evidence disagrees', async () => {
  nextResponseText = JSON.stringify({ verdict: 'CONFLICTING', confidence: 0.6, rationale: 'مصدر يؤكد ومصدر آخر ينفي.', supporting_count: 1, conflicting_count: 1 });
  const result = await EvaluationEngine.evaluate('ادعاء متناقض', [
    { source: 'https://a.example', content: 'الحدث وقع فعلاً.', kind: 'INDEPENDENT_SOURCE' },
    { source: 'https://b.example', content: 'الحدث لم يقع إطلاقاً.', kind: 'INDEPENDENT_SOURCE' },
  ]);
  assert.equal(result.verdict, 'CONFLICTING');
  assert.equal(result.conflictingEvidenceCount, 1);
});

test('EvaluationEngine.evaluate returns SUPPORTED for a single-source, uncorroborated but uncontradicted claim', async () => {
  nextResponseText = JSON.stringify({ verdict: 'SUPPORTED', confidence: 0.7, rationale: 'مصدر واحد موثوق يدعم الادعاء.', supporting_count: 1, conflicting_count: 0 });
  const result = await EvaluationEngine.evaluate('ادعاء بمصدر واحد', [{ source: 'https://a.example', content: 'محتوى داعم.', kind: 'INDEPENDENT_SOURCE' }]);
  assert.equal(result.verdict, 'SUPPORTED');
});

test('EvaluationEngine.evaluate returns UNCERTAIN when evidence is present but insufficient/ambiguous', async () => {
  nextResponseText = JSON.stringify({ verdict: 'UNCERTAIN', confidence: 0.3, rationale: 'الأدلة غير كافية للحكم.', supporting_count: 0, conflicting_count: 0 });
  const result = await EvaluationEngine.evaluate('ادعاء غامض', [{ source: 'https://a.example', content: 'محتوى غير حاسم.', kind: 'INDEPENDENT_SOURCE' }]);
  assert.equal(result.verdict, 'UNCERTAIN');
});

test('EvaluationEngine.evaluate falls back to UNCERTAIN when the judge returns an invalid/unrecognized verdict string', async () => {
  nextResponseText = JSON.stringify({ verdict: 'NOT_A_REAL_VERDICT', confidence: 0.5, rationale: 'x', supporting_count: 0, conflicting_count: 0 });
  const result = await EvaluationEngine.evaluate('ادعاء', [{ source: 'x', content: 'y', kind: 'INDEPENDENT_SOURCE' }]);
  assert.equal(result.verdict, 'UNCERTAIN');
});

test('EvaluationEngine.evaluate ignores an out-of-range confidence value (returns null rather than trusting a bad number)', async () => {
  nextResponseText = JSON.stringify({ verdict: 'SUPPORTED', confidence: 5, rationale: 'x', supporting_count: 1, conflicting_count: 0 });
  const result = await EvaluationEngine.evaluate('ادعاء', [{ source: 'x', content: 'y', kind: 'INDEPENDENT_SOURCE' }]);
  assert.equal(result.confidence, null);
});

test('EvaluationEngine.evaluate degrades to unavailable (not a throw) on a genuinely malformed, non-JSON judge response', async () => {
  nextResponseText = 'هذا ليس JSON إطلاقاً بل نص عادي طويل بلا أي أقواس معقوفة';
  const result = await EvaluationEngine.evaluate('ادعاء', [{ source: 'x', content: 'y', kind: 'INDEPENDENT_SOURCE' }]);
  // No matching {...} block => JSON.parse('{}') succeeds trivially => verdict undefined => falls back to UNCERTAIN, not a throw.
  assert.equal(result.ran, true);
  assert.equal(result.verdict, 'UNCERTAIN');
});

test('EvaluationEngine.evaluate degrades to unavailable (ran:false) when the judge response contains braces but genuinely invalid JSON inside them', async () => {
  nextResponseText = '{ "verdict": "SUPPORTED", this is not valid json at all !!! }';
  const result = await EvaluationEngine.evaluate('ادعاء', [{ source: 'x', content: 'y', kind: 'INDEPENDENT_SOURCE' }]);
  assert.equal(result.ran, false);
  assert.equal(result.verdict, 'UNVERIFIED');
});

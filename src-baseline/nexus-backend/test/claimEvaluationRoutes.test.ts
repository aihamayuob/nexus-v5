import '../test/helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let fakeAnthropic: Server;
let nextResponseText: string;

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  fakeAnthropic = createServer(async (req, res) => {
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
  await new Promise<void>((resolve) => fakeAnthropic.listen(0, '127.0.0.1', resolve));
  const addr = fakeAnthropic.address();
  process.env.NEXUS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  await new Promise((r) => fakeAnthropic.close(r));
});

beforeEach(() => {
  freshDb();
  nextResponseText = JSON.stringify({ verdict: 'SUPPORTED', confidence: 0.8, rationale: 'دليل واحد يدعم الادعاء.', supporting_count: 1, conflicting_count: 0 });
});

async function withServer(fn: (url: string) => Promise<void>) {
  const server = createNexusServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    await fn(url);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('POST /v2/evaluation/claim evaluates a real claim against real supplied evidence and persists it', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/v2/evaluation/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim: 'الذهب ارتفع اليوم', evidence: [{ source: 'https://a.example', content: 'الذهب ارتفع 2%.', kind: 'INDEPENDENT_SOURCE' }], subjectType: 'test' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; verdict: string; confidence: number; ran: boolean; evidence: unknown[] };
    assert.equal(body.verdict, 'SUPPORTED');
    assert.equal(body.confidence, 0.8);
    assert.equal(body.ran, true);
    assert.equal(body.evidence.length, 1);
    assert.ok(body.id);
  });
});

test('POST /v2/evaluation/claim rejects a missing claim with a real 400', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/v2/evaluation/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evidence: [] }) });
    assert.equal(res.status, 400);
  });
});

test('GET /v2/evaluation/claims/:id retrieves a persisted evaluation by id; an unknown id is a real 404', async () => {
  await withServer(async (url) => {
    const createRes = await fetch(`${url}/v2/evaluation/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim: 'ادعاء آخر', evidence: [] }),
    });
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${url}/v2/evaluation/claims/${created.id}`);
    assert.equal(getRes.status, 200);
    const fetched = (await getRes.json()) as { id: string; claim: string };
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.claim, 'ادعاء آخر');

    const missingRes = await fetch(`${url}/v2/evaluation/claims/does-not-exist`);
    assert.equal(missingRes.status, 404);
  });
});

test('GET /v2/evaluation/claims lists persisted evaluations, filterable by subjectType', async () => {
  await withServer(async (url) => {
    await fetch(`${url}/v2/evaluation/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: 'ادعاء 1', evidence: [], subjectType: 'alpha' }) });
    await fetch(`${url}/v2/evaluation/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: 'ادعاء 2', evidence: [], subjectType: 'beta' }) });

    const allRes = await fetch(`${url}/v2/evaluation/claims`);
    const all = (await allRes.json()) as { evaluations: unknown[] };
    assert.equal(all.evaluations.length, 2);

    const filteredRes = await fetch(`${url}/v2/evaluation/claims?subjectType=alpha`);
    const filtered = (await filteredRes.json()) as { evaluations: { claim: string }[] };
    assert.equal(filtered.evaluations.length, 1);
    assert.equal(filtered.evaluations[0]!.claim, 'ادعاء 1');
  });
});

test('POST /v2/evaluation/claim with zero evidence uses the fast path (UNVERIFIED, ran:true) end to end over real HTTP', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/v2/evaluation/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: 'ادعاء بلا دليل', evidence: [] }) });
    const body = (await res.json()) as { verdict: string; ran: boolean };
    assert.equal(body.verdict, 'UNVERIFIED');
    assert.equal(body.ran, true);
  });
});

import './helpers/setResilienceTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { Verifier } from '../src/orchestrator/verifier.js';
import { EvaluationEngine } from '../src/evaluation/evaluationEngine.js';
import { proposeGenomeMutation, approveGenomeVersion } from '../src/evolution/agentGenome.js';
import { checkFreshness } from '../src/knowledge/freshnessEngine.js';
import { runWebResearch } from '../src/research/webResearch.js';
import { createNexusServer } from '../src/gateway/server.js';
import { resetRateLimitBucketsForTests } from '../src/gateway/middleware/rateLimit.js';
import { clearAdapterCacheForTests } from '../src/providers/index.js';
import { acquireGlobalSlot } from '../src/orchestrator/taskManager.js';
import { ServerConfig } from '../src/config/env.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let hangingAnthropic: Server;
let hangingGemini: Server;

before(async () => {
  // A server that accepts the TCP connection but NEVER responds and NEVER closes — the exact real-world failure mode (a stuck/overloaded provider) this whole test file exists to prove is now survivable.
  hangingAnthropic = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    // deliberately never respond to POST
  });
  await new Promise<void>((resolve) => hangingAnthropic.listen(0, '127.0.0.1', resolve));
  const addrA = hangingAnthropic.address();
  process.env.NEXUS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addrA === 'object' && addrA ? addrA.port : 0}`;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-key';

  hangingGemini = createServer(() => {
    /* never respond */
  });
  await new Promise<void>((resolve) => hangingGemini.listen(0, '127.0.0.1', resolve));
  const addrG = hangingGemini.address();
  process.env.NEXUS_GEMINI_BASE_URL = `http://127.0.0.1:${typeof addrG === 'object' && addrG ? addrG.port : 0}`;
  process.env.NEXUS_GEMINI_API_KEY = 'fake-key';
});

after(async () => {
  // closeAllConnections() (not just close()) — a plain close() waits for
  // existing connections to end naturally, but these servers deliberately
  // never respond, so a client whose fetch() was aborted client-side can
  // leave the server-side socket in a state close() will wait on
  // indefinitely. Same fix already used elsewhere in this test suite for
  // the same reason.
  hangingAnthropic.closeAllConnections();
  await new Promise((r) => hangingAnthropic.close(r));
  hangingGemini.closeAllConnections();
  await new Promise((r) => hangingGemini.close(r));
});

beforeEach(() => {
  freshDb();
  resetRateLimitBucketsForTests();
});

// ---- Fix: judge-call / research-call timeout enforcement (previously unbounded — confirmed empirically to hang forever) ----

test('Verifier.verify() degrades to unavailable within the configured timeout against a hanging provider, instead of hanging forever', async () => {
  const start = Date.now();
  const result = await Verifier.verify('سؤال', 'إجابة مقترحة');
  const elapsed = Date.now() - start;
  assert.equal(result.ran, false);
  assert.equal(result.verdict, 'unavailable');
  assert.ok(elapsed < 5000, `expected a bounded wait, got ${elapsed}ms`);
});

test('EvaluationEngine.evaluate() degrades to unavailable within the configured timeout against a hanging provider', async () => {
  const start = Date.now();
  const result = await EvaluationEngine.evaluate('ادعاء', [{ source: 'x', content: 'دليل حقيقي بما يكفي للمرور عبر مسار الاستدعاء الفعلي.', kind: 'INDEPENDENT_SOURCE' }]);
  const elapsed = Date.now() - start;
  assert.equal(result.ran, false);
  assert.ok(elapsed < 5000, `expected a bounded wait, got ${elapsed}ms`);
});

test('Digital Genome proposeGenomeMutation() fails with a real, honest error within the configured timeout against a hanging provider', async () => {
  const start = Date.now();
  await assert.rejects(() => proposeGenomeMutation('financial'));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `expected a bounded wait, got ${elapsed}ms`);
});

test('Knowledge Freshness checkFreshness() degrades to a conservative default within the configured timeout against a hanging provider', async () => {
  const repos = getRepos();
  const item = repos.memory.add({ projectId: null, userId: null, kind: 'knowledge', title: 't', content: 'محتوى تجريبي', embedding: null });
  const start = Date.now();
  const result = await checkFreshness(item.id);
  const elapsed = Date.now() - start;
  assert.equal(result.volatility, 'medium');
  assert.ok(elapsed < 5000, `expected a bounded wait, got ${elapsed}ms`);
});

test('runWebResearch() does not hang forever against a hanging Gemini endpoint', async () => {
  // Unlike the four direct-adapter judge calls above, runWebResearch() goes
  // through chatService.ts's runChatCompletion() -> resilientCall(), which
  // treats a TimeoutError as a retryable condition by existing, deliberate
  // design (Errors.timeout() sets retryable:true) — so the real total wait
  // here is legitimately (attempts × judgeCallTimeoutMs) plus backoff, not
  // a single bare timeout. The fix's actual claim is "bounded, not
  // infinite" (confirmed directly against geminiAdapter.chat() alone: it
  // rejects in ~600ms every time) — this test's bound is set generously
  // above the real retried total, not tightened to a single attempt.
  const start = Date.now();
  await assert.rejects(() => runWebResearch('سؤال بحث', ctx, { persistToMemory: false, evaluate: false }));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 15000, `expected a bounded wait/failure even with retries, got ${elapsed}ms`);
});

// ---- Post-restoration gap fix: mission PLANNING itself was missed by the original resilience pass ----
// Found during a fresh from-zip audit, prompted by a real mission getting stuck in the
// 'PLANNING' state for well over ten seconds during an unrelated concurrency test run.
// planGoal() — the single most central call in a mission's entire lifecycle, since every
// mission goes through it before any DAG task ever executes — passed its caller's signal
// straight through to adapter.chat() with no timeout of its own, unlike the five sites
// above (Verifier/EvaluationEngine/Digital Genome/Knowledge Freshness/Web Research) that
// this exact resilience-testing effort already fixed. A hanging provider during planning
// was therefore bounded only by NEXUS_PLAN_TIMEOUT_MS — 10 minutes by default — instead
// of the same real per-call bound everything else in this codebase now gets. Fixed by
// combining the mission's own cancellation signal with AbortSignal.timeout(defaultTaskTimeoutMs)
// via AbortSignal.any(), so a genuine user-initiated cancel during planning still works
// exactly as before, but a stuck provider no longer needs the full 10-minute ceiling to
// recover.
test('planGoal() fails within the configured task timeout against a hanging provider, instead of only the 10-minute whole-mission ceiling', async () => {
  const { planGoal } = await import('../src/orchestrator/planner.js');
  const start = Date.now();
  await assert.rejects(() => planGoal('هدف تجريبي', 'anthropic'));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `expected a bounded wait around defaultTaskTimeoutMs (600ms in this test env), got ${elapsed}ms`);
});

test('planGoal() still honors a real external cancellation signal during planning (the fix must not swallow legitimate user cancel)', async () => {
  const { planGoal } = await import('../src/orchestrator/planner.js');
  const controller = new AbortController();
  const start = Date.now();
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(() => planGoal('هدف تجريبي آخر', 'anthropic', controller.signal));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `an explicit user cancel at 50ms must win, not wait for the 600ms task timeout — got ${elapsed}ms`);
});

// ---- Concurrent/racing mutations on the same resource ----

test('two concurrent approve() calls on the same Digital Genome proposal: exactly one succeeds, the other fails cleanly — no corrupted double-activation', async () => {
  // Use a fast, non-hanging fake so the proposal itself can actually be built for this test.
  const fastServer = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    for await (const c of req) {
      /* drain */
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'نص بديل آمن وواضح بما يكفي لتجاوز فحص الطول.' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }));
  });
  await new Promise<void>((resolve) => fastServer.listen(0, '127.0.0.1', resolve));
  const addr = fastServer.address();
  const savedUrl = process.env.NEXUS_ANTHROPIC_BASE_URL;
  process.env.NEXUS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  clearAdapterCacheForTests(); // getProviderAdapter() caches per process lifetime (by design, for the normal case where env never changes mid-process) — a real fix this test itself needed once discovered, not a hypothetical
  try {
    const proposal = await proposeGenomeMutation('financial');
    // Wrapped in Promise.resolve().then(...) rather than calling the
    // synchronous approveGenomeVersion() directly inside the array literal:
    // a bare synchronous throw inside Promise.allSettled([...]) propagates
    // immediately out of the array construction itself, before
    // allSettled() is even invoked — this is exactly the real bug this
    // test itself had until caught here, not a hypothetical concern.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => approveGenomeVersion(proposal.id, 'aiham')),
      Promise.resolve().then(() => approveGenomeVersion(proposal.id, 'someone-else')),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one concurrent approval must win');
    assert.equal(rejected.length, 1, 'the other must fail cleanly, not corrupt state');
    const genomes = getRepos().agentGenomes.list('financial');
    assert.equal(genomes.filter((g) => g.status === 'active').length, 1, 'never more than one active genome, even under a real race');
  } finally {
    process.env.NEXUS_ANTHROPIC_BASE_URL = savedUrl;
    clearAdapterCacheForTests(); // restore so any LATER test in this file gets an adapter bound to the hanging server again, matching what it expects
    await new Promise((r) => fastServer.close(r));
  }
});

// ---- Malformed / adversarial input resilience ----

test('malformed (non-JSON) request bodies are rejected with a clean 400, not a server crash or 500', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const res = await fetch(`${nexusUrl}/v2/evaluation/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not valid json at all' });
    assert.equal(res.status, 400);
    // The server must still be alive and answering normally afterward.
    const healthRes = await fetch(`${nexusUrl}/v2/health`);
    assert.equal(healthRes.status, 200);
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

test('a request body with deeply nested JSON is accepted or cleanly rejected, never crashes the server', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    let deep: unknown = 'x';
    for (let i = 0; i < 500; i++) deep = { nested: deep };
    const res = await fetch(`${nexusUrl}/v2/evaluation/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: 'test', evidence: [], extra: deep }) });
    assert.ok(res.status === 200 || res.status === 400, `expected a clean response, got ${res.status}`);
    const healthRes = await fetch(`${nexusUrl}/v2/health`);
    assert.equal(healthRes.status, 200, 'server must still be alive afterward');
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

test('an oversized request body is rejected with 413, not accepted or crashed on', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const oversized = 'x'.repeat(15 * 1024 * 1024); // 15MB — comfortably over any reasonable body limit
    const res = await fetch(`${nexusUrl}/v2/evaluation/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: oversized }) });
    assert.equal(res.status, 413);
    const healthRes = await fetch(`${nexusUrl}/v2/health`);
    assert.equal(healthRes.status, 200);
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

// ---- Real concurrent HTTP burst against the rate limiter ----

test('a genuine concurrent burst of requests (not sequential) is still counted and limited correctly', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    // Fire 40 requests genuinely in parallel (Promise.all, not a loop with awaits) from the same simulated caller.
    const requests = Array.from({ length: 40 }, () => fetch(`${nexusUrl}/v2/health`, { headers: { 'X-Forwarded-For': '203.0.113.77' } }));
    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);
    const okCount = statuses.filter((s) => s === 200).length;
    const limitedCount = statuses.filter((s) => s === 429).length;
    assert.equal(okCount + limitedCount, 40, 'every request must get a real, clean response — none dropped or crashed');
    assert.ok(limitedCount > 0, 'a genuine burst of 40 concurrent requests must trip the rate limiter at some point (default burst is well under 40)');
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

// ---- DB resilience under genuine concurrent writers ----

test('many genuinely concurrent mission creations succeed without SQLITE_BUSY errors, thanks to busy_timeout', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const requests = Array.from({ length: 15 }, (_, i) =>
      fetch(`${nexusUrl}/v2/missions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objective: `مهمة تزامن ${i}` }) })
    );
    const responses = await Promise.all(requests);
    for (const res of responses) assert.equal(res.status, 202, 'every concurrent mission-creation write must succeed cleanly');

    // Dedicated test-isolation fix (found during a fresh from-zip audit): each 202 here
    // only means the mission ROW was created — actual execution is dispatched
    // fire-and-forget (same runAutonomousMission contract as production) and keeps
    // running in the background against the shared, module-level global-concurrency
    // slot pool. Closing the server right after the 202s (as this test used to) does
    // NOT stop that background work — with no real provider configured, every one of
    // these missions is guaranteed to eventually fail (either a real connection error,
    // or — for whichever ones exceed NEXUS_MAX_CONCURRENCY — a real busy/backpressure
    // error after the slot-wait ceiling). If this test returns before that background
    // work finishes, those straggling missions keep running into and past WHATEVER
    // test runs next in this file, holding real global slots the whole time. That's
    // exactly what caused this file to be reported as failed even when every single
    // named test in it passed: a straggler's rejection surfacing during a later test's
    // execution window. Draining every mission to a real terminal state here — the
    // same fix philosophy as everywhere else in this codebase (verify to completion,
    // don't just fire and hope) — closes that gap at the source instead of leaving
    // later tests to cope with leftover load.
    const missionIds = await Promise.all(responses.map(async (res) => ((await res.json()) as { missionId: string }).missionId));
    const drainStart = Date.now();
    for (const id of missionIds) {
      let mission = getRepos().missions.get(id);
      while (mission && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(mission.state) && Date.now() - drainStart < 15000) {
        await new Promise((r) => setTimeout(r, 100));
        mission = getRepos().missions.get(id);
      }
      assert.ok(
        mission && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(mission.state),
        `mission ${id} must reach a real terminal state before this test hands off to the next one (got ${mission?.state})`,
      );
    }
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

// ---- Post-restoration gap fix: "optional body" routes must not silently swallow real body errors ----
// Found during a fresh from-zip audit: six routes with a genuinely-optional JSON body
// (warden isolate, mission cancel/pause, council cancel, knowledge-freshness scan,
// finetuning build-dataset) wrapped readJsonBody() in .catch(() => ({})) to make an
// absent body harmless. But readJsonBody() already returns {} for a truly empty body
// (total === 0) on its own — the .catch was strictly broader than that and was also
// swallowing REAL errors: an oversized body silently became "no reason given" (200)
// instead of the 413 this same file already proves works correctly on required-body
// routes like /v2/evaluation/claim, and malformed JSON silently became {} instead of a
// 400. Fixed by removing the redundant/over-broad .catch at all six call sites.

test('an oversized body on an "optional body" route (warden isolate) is rejected with 413, not silently treated as empty', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const oversized = 'x'.repeat(15 * 1024 * 1024);
    const res = await fetch(`${nexusUrl}/v2/warden/agents/some-agent/isolate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: oversized }),
    });
    assert.equal(res.status, 413, 'an oversized body must never be silently accepted as "no reason given"');
    assert.equal(getRepos().wardenIsolation.isIsolated('some-agent'), false, 'the isolate action must not have actually applied when the body was rejected');
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

test('a genuinely empty body on the same "optional body" route still works exactly as before (regression guard for the fix above)', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const res = await fetch(`${nexusUrl}/v2/warden/agents/some-other-agent/isolate`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { isolated: boolean };
    assert.equal(json.isolated, true);
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

test('malformed JSON on an "optional body" route is rejected with a real validation error, not silently treated as empty', async () => {
  const nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const res = await fetch(`${nexusUrl}/v2/warden/agents/some-third-agent/isolate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    assert.equal(res.status, 400, 'malformed JSON must surface as a real validation error, not be swallowed into an implicit empty body');
    assert.equal(getRepos().wardenIsolation.isIsolated('some-third-agent'), false);
  } finally {
    await new Promise((r) => nexusServer.close(r));
  }
});

// ---- Post-restoration gap fix: a mission that times out waiting for a concurrency slot must not crash the process ----
// Found the same way as the body-swallowing gap above: a fresh from-zip audit plus this
// file's own tests running long enough (for the first time) for a slow, real-world
// failure mode to actually surface. runMission() used to call `await
// acquireGlobalSlot(signal)` BEFORE its own try/catch began. acquireGlobalSlot() throws
// a real Errors.rateLimited() ("server busy") after waiting 5s with no free global
// concurrency slot — genuine, expected backpressure under real load, not a hang or a
// crash inside execution. But because the throw happened before try/catch, it escaped
// runMission() entirely; runMission() is dispatched fire-and-forget (`void runPromise`
// in autonomousCore.ts) with nothing ever awaiting or .catch()-ing it, so this became a
// real unhandled promise rejection — which, in production Node.js with no global
// unhandledRejection handler anywhere in this codebase (confirmed absent by grep),
// TERMINATES THE ENTIRE PROCESS. Fixed by moving acquireGlobalSlot() inside the try
// block so a slot-wait failure now takes the exact same, already-tested path as any
// other early mission failure: caught, mission cleanly transitioned to FAILED, no crash.
// This test proves it directly and deterministically (not incidentally via timing):
// saturate every global slot by hand, then run a real mission that has no choice but to
// wait for one — with a temporary process-level unhandledRejection listener acting as a
// tripwire that fails the test immediately if the old bug's escape hatch ever reopens.
test('a mission that waits out the full concurrency-slot ceiling fails cleanly instead of becoming an unhandled rejection', async () => {
  freshDb();
  const { runAutonomousMission } = await import('../src/orchestrator/autonomousCore.js');

  let leaked: unknown = null;
  const tripwire = (reason: unknown) => {
    leaked = reason;
  };
  process.on('unhandledRejection', tripwire);

  // Occupy every global concurrency slot by hand and never release them, forcing the
  // mission below to hit the real 5s wait ceiling in acquireGlobalSlot() and throw.
  const holders = await Promise.all(Array.from({ length: ServerConfig.maxConcurrency }, () => acquireGlobalSlot()));
  try {
    // runAutonomousMission with the default awaitCompletion:false is the EXACT same
    // fire-and-forget dispatch POST /v2/missions uses in production (`void runPromise`
    // inside autonomousCore.ts) — not runMission() awaited directly, which would not
    // reproduce the original bug (a direct await turns the throw into an ordinary
    // rejection at the call site, never an unhandled one).
    const start = Date.now();
    const { missionId } = await runAutonomousMission('مهمة اختبار تشبع الفتحات المتزامنة', ctx);

    // Poll for the mission to reach a terminal state, same pattern other tests in this
    // suite use for background work — no direct await/handle on the fire-and-forget
    // promise is available here, by construction (that's the exact scenario being tested).
    let mission = getRepos().missions.get(missionId)!;
    while (mission.state !== 'FAILED' && Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 100));
      mission = getRepos().missions.get(missionId)!;
    }
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 4900, `expected the real ~5s slot-wait ceiling to have been hit, got ${elapsed}ms`);
    assert.equal(mission.state, 'FAILED', 'a mission that never got a concurrency slot must end up cleanly FAILED, not stuck forever');
    const lastFailure = mission.failures[mission.failures.length - 1];
    assert.match(lastFailure?.message ?? '', /مشغول/, 'the recorded failure reason must be the real busy/backpressure message, not something generic');

    // Give any still-pending microtask/timer queue a moment to surface a rejection if one exists.
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(leaked, null, `an unhandled promise rejection leaked out of the fire-and-forget mission dispatch: ${String(leaked)}`);
  } finally {
    process.off('unhandledRejection', tripwire);
    for (const release of holders) release();
  }
});

import '../test/helpers/setMissionTimeoutTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { createMission, runMission } from '../src/orchestrator/missionRunner.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

let server: Server;
let hangForever = false;

before(async () => {
  server = createServer(async (req, res) => {
    // Live health probes (GET /v1/models — see healthRegistry.ts, triggered
    // by BEST-mode routing before every agent call) must always answer
    // quickly, REGARDLESS of `hangForever` — that flag targets the actual
    // chat POST under test, not the unrelated probe with its own 5s ceiling.
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
    // Only the planner call needs to actually succeed for this test —
    // the single agent task call is the one that hangs.
    if (system.includes('أنت مخطط مهام')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({ tasks: [{ id: 'hangs', description: 'مهمة ستتوقف عن الاستجابة', dependsOn: [] }] }) }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 5 },
        })
      );
      return;
    }
    if (hangForever) return; // never respond -> the thing under test
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  process.env.NEXUS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  // closeAllConnections() is required, not optional: the hangForever test
  // above deliberately leaves a connection open forever (never calls
  // res.end()) — a plain server.close() waits for existing connections to
  // finish and would hang this hook (and therefore the NEXT test file)
  // indefinitely.
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
  hangForever = false;
});

test(
  'timeout: a hanging agent call is bounded by dag.ts timeoutMs (NEXUS_TASK_TIMEOUT_MS=300ms here) and fails the mission instead of hanging for the real ~90s default',
  { timeout: 15_000 },
  async () => {
    hangForever = true;
    const { missionId } = createMission('مهمة ستتوقف عن الاستجابة', ctx, { maxReplans: 0 });
    const startedAt = Date.now();
    await runMission(missionId, ctx);
    const elapsedMs = Date.now() - startedAt;
    const mission = getRepos().missions.get(missionId)!;
    assert.equal(mission.state, 'FAILED');
    assert.ok(elapsedMs < 5_000, `expected the 300ms task timeout to bound this well under 5s; took ${elapsedMs}ms`);
    assert.ok(
      mission.failures.some((f) => f.message.includes('انتهت مهلة')),
      `expected a timeout-worded failure entry; got: ${JSON.stringify(mission.failures)}`
    );
  }
);

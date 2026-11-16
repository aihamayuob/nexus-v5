import './helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

// Worst case on purpose: operator flag ON. The shipped 'data' agent must still neither declare nor promise code_execution.
process.env.NEXUS_ENABLE_CODE_EXECUTION_TOOL = 'true';

const { openTestDb } = await import('../src/persistence/db.js');
const { buildRepos, resetReposSingletonForTests } = await import('../src/persistence/repos.js');
const { runAgentTask } = await import('../src/agents/agentRunner.js');
const { AgentRegistry } = await import('../src/agents/agentRegistry.js');
const { bootstrapTools } = await import('../src/tools/bootstrap.js');
const { getToolRegistry } = await import('../src/tools/registry.js');
import type { GatewayContext } from '../src/capability/permissionModel.js';

/**
 * G8.2 — the built-in 'data' agent no longer declares code_execution nor tells the model it can use it (that tool is not registered by default since G8.1).
 * Proves: the SHIPPED definition (static data + the request actually sent to a provider) carries no such declaration/promise, and no built-in agent declares a
 * tool the default registry lacks. Does NOT prove: anything about prompt overrides already stored in a live database (agent genome), or any isolation.
 */

const gw: GatewayContext = { authenticated: true, clientKey: 'key:g82', projectId: null, userId: null };
let server: Server;
let lastBodyRaw = '';
let providerCalls = 0;

before(async () => {
  bootstrapTools();
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    lastBodyRaw = Buffer.concat(chunks).toString('utf-8');
    providerCalls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'تحليل نصي.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  process.env.NEXUS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});
after(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
  lastBodyRaw = '';
  providerCalls = 0;
});

test("G82-1 the shipped 'data' definition: no tools, and no mention of code_execution in its prompt", () => {
  const def = AgentRegistry.get('data');
  assert.deepEqual(def.tools, []);
  assert.ok(!/code_execution/i.test(def.systemPrompt), 'prompt must not promise code_execution');
  assert.ok(def.systemPrompt.trim().length > 40, 'the prompt itself is still a real persona prompt');
  assert.match(def.systemPrompt, /محلل بيانات خبير/);
});

test('G82-2 no built-in agent declares a tool the default registry lacks, and none mentions code_execution (declared == available, for every agent)', () => {
  const registered = new Set(getToolRegistry().list().map((t) => t.name));
  for (const def of AgentRegistry.list()) {
    for (const t of def.tools) assert.ok(registered.has(t), `agent "${def.id}" declares unregistered tool "${t}"`);
    assert.ok(!/code_execution/i.test(def.systemPrompt), `agent "${def.id}" prompt mentions code_execution`);
    assert.ok(!def.tools.includes('code_execution'), `agent "${def.id}" declares code_execution`);
  }
});

test("G82-3 what is actually SENT to the provider for a 'data' task carries no code_execution (neither prompt nor tools)", async () => {
  const r = await runAgentTask('data', { agentId: 'data', missionId: null, taskNodeId: null, taskDescription: 'حلّل هذه المؤشرات.', upstreamOutputs: {}, gwCtx: gw });
  assert.equal(providerCalls, 1);
  assert.ok(lastBodyRaw.includes('محلل بيانات خبير'), 'the persona prompt was really sent (so the absence below is meaningful)');
  assert.ok(!lastBodyRaw.includes('code_execution'), 'request body must not mention code_execution');
  assert.deepEqual(r.toolsUsed, []);
});

test("G82-4 agent selection is unchanged: data/statistics tasks still route to 'data' (skills untouched)", () => {
  assert.equal(AgentRegistry.selectAgentForTask('أحتاج تحليل بيانات وإحصاء').id, 'data');
  assert.deepEqual(AgentRegistry.get('data').skills, ['بيانات', 'إحصاء', 'مؤشرات', 'data', 'analytics']);
});

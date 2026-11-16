import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

process.env.NEXUS_ENABLE_CODE_EXECUTION_TOOL = 'true';

const { openTestDb } = await import('../src/persistence/db.js');
const { buildRepos, resetReposSingletonForTests, getRepos } = await import('../src/persistence/repos.js');
const { runAgentTask } = await import('../src/agents/agentRunner.js');
const { bootstrapTools } = await import('../src/tools/bootstrap.js');
const { AgentRegistry } = await import('../src/agents/agentRegistry.js');
const { getToolRegistry } = await import('../src/tools/registry.js');
const { codeExecutionTool } = await import('../src/tools/builtin/codeExecutionTool.js');
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;
let callCount = 0;
let forceFail = false;

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  bootstrapTools();
  // G8.1: 'code_execution' is no longer registered by bootstrapTools() (owner decision). This TEST-ONLY file opts in explicitly so it still proves what it always did —
  // the real agent tool loop end to end through a real executing tool and the real Sandbox. Production code has no such registration
  // (test/codeExecutionNotRegistered.test.ts asserts the default registry and guards src/ against one).
  getToolRegistry().register(codeExecutionTool);
  // G8.2: the built-in 'data' agent no longer declares code_execution (agentRegistry.ts). To keep proving the real agent tool loop, this TEST-ONLY file gives the in-memory
  // 'data' definition the declaration explicitly, and restores it in after(). The shipped definition is asserted tool-free by test/agentDataNoCodeExecution.test.ts.
  AgentRegistry.get('data').tools.push('code_execution');
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { messages?: Array<{ role: string; content: unknown }>; tools?: unknown[] } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    callCount++;
    if (forceFail) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'فشل مزود مقصود للاختبار' } }));
      return;
    }

    const lastMsg = body.messages?.[body.messages.length - 1];
    const lastContent = lastMsg?.content;
    const isToolResultTurn = Array.isArray(lastContent) && lastContent.some((c: { type?: string }) => c?.type === 'tool_result');

    if (isToolResultTurn) {
      // second round-trip: the model has seen the real tool_result and now answers
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('بناءً على نتيجة الأداة، الناتج النهائي هو 42.'));
      return;
    }

    // A real Anthropic API can only ever return stop_reason='tool_use' when
    // the request actually offered tools — mirror that constraint here so
    // this fixture can't produce a tool_use response for a tool-less agent
    // (which would be unrealistic and mask a real bug either way).
    if (!body.tools || body.tools.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('رد نصي عادي بلا أدوات.'));
      return;
    }

    // first round-trip: demand a real tool_use call
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        content: [{ type: 'tool_use', id: 'toolu_test1', name: 'code_execution', input: { language: 'javascript', code: 'console.log(6*7)' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 10 },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_BASE_URL = serverUrl;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  const tools = AgentRegistry.get('data').tools;
  tools.splice(0, tools.length);
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  freshDb();
  callCount = 0;
  forceFail = false;
});

// G8.2: was "the 'data' agent genuinely declares the code_execution tool". The shipped agent no longer does (owner decision); this now only checks the PRECONDITION of the
// end-to-end test below — that this file's explicit opt-in (before()) is in effect on both the agent definition and the tool registry.
test("this file's explicit test-level opt-in is in effect: 'data' declares code_execution and it is registered", () => {
  const def = AgentRegistry.get('data');
  assert.ok(def.tools.includes('code_execution'));
  assert.ok(getToolRegistry().get('code_execution'));
});

test('a real tool-bearing agent call actually round-trips through a genuine tool_use -> Sandbox execution -> tool_result -> final answer, end to end', async () => {
  const result = await runAgentTask('data', {
    agentId: 'data',
    missionId: null,
    taskNodeId: null,
    taskDescription: 'احسب 6 في 7 باستخدام كود فعلي.',
    upstreamOutputs: {},
    gwCtx: ctx,
  });

  assert.equal(callCount, 2, 'expected exactly 2 real provider round-trips: one demanding tool_use, one after the real tool_result');
  assert.match(result.output, /42/);
  assert.deepEqual(result.toolsUsed, ['code_execution'], 'AgentResult.toolsUsed should now be populated for real, not hardcoded []');
});

test('an agent WITHOUT any declared tools never has req.tools sent at all, and toolsUsed stays empty — regression for the other 23 built-in agents', async () => {
  const result = await runAgentTask('general', {
    agentId: 'general',
    missionId: null,
    taskNodeId: null,
    taskDescription: 'مرحباً',
    upstreamOutputs: {},
    gwCtx: ctx,
  });
  assert.equal(callCount, 1, 'a tool-less agent should never trigger a second round-trip');
  assert.deepEqual(result.toolsUsed, []);
});

test('runAgentTask actually records a real success entry in agent_call_log on a real successful call (Phase 3 §Learning)', async () => {
  await runAgentTask('general', { agentId: 'general', missionId: null, taskNodeId: null, taskDescription: 'مرحباً', upstreamOutputs: {}, gwCtx: ctx });
  const evidence = getRepos().agentCallLog.evidenceFor('general');
  assert.equal(evidence.sampleSize, 1);
  assert.equal(evidence.successCount, 1);
  assert.ok(evidence.avgLatencyMs >= 0);
});

test('runAgentTask actually records a real FAILURE entry in agent_call_log when the underlying call genuinely fails', async () => {
  forceFail = true;
  await assert.rejects(() =>
    runAgentTask('general', { agentId: 'general', missionId: null, taskNodeId: null, taskDescription: 'x', upstreamOutputs: {}, gwCtx: ctx })
  );
  const evidence = getRepos().agentCallLog.evidenceFor('general');
  assert.equal(evidence.sampleSize, 1);
  assert.equal(evidence.successCount, 0);
});

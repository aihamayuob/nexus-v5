import './helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// WORST CASE ON PURPOSE: the operator flag is ON. G8.1's claim is that this no longer makes the tool available (it is not registered at all).
process.env.NEXUS_ENABLE_CODE_EXECUTION_TOOL = 'true';
process.env.NEXUS_CODE_EXECUTION_TIMEOUT_MS = '4000';

const { ServerConfig } = await import('../src/config/env.js');
const { openTestDb } = await import('../src/persistence/db.js');
const { buildRepos, resetReposSingletonForTests } = await import('../src/persistence/repos.js');
const { bootstrapTools } = await import('../src/tools/bootstrap.js');
const { getToolRegistry } = await import('../src/tools/registry.js');
const { executeToolCall, executeToolCalls } = await import('../src/tools/pipeline.js');
const { codeExecutionTool } = await import('../src/tools/builtin/codeExecutionTool.js');
const { Sandbox } = await import('../src/sandbox/sandbox.js');
const { CapabilityGraph } = await import('../src/capability/capabilityGraph.js');
const { runAgentTask } = await import('../src/agents/agentRunner.js');
const { AgentRegistry } = await import('../src/agents/agentRegistry.js');
import type { GatewayContext } from '../src/capability/permissionModel.js';

/**
 * G8.1 — 'code_execution' removed from DEFAULT registration (owner decision OPTION C). What these tests prove: with the operator flag ON, the default registry
 * (as built by bootstrapTools()) has no such tool; every in-repo way to ask for it (pipeline, batch, agent loop, a provider that demands it unprompted,
 * client-supplied tool defs) fails BEFORE any code runs — observed on the filesystem and on Sandbox.runCode, not on message text; src/ has no import/registration
 * of it. What they do NOT prove: any isolation (none was added), or anything about a deployment that edits src/.
 */

const gw: GatewayContext = { authenticated: true, clientKey: 'key:g81', projectId: null, userId: null };
const dir = mkdtempSync(join(tmpdir(), 'g81-'));
const markerJs = join(dir, 'marker-js');
const markerPy = join(dir, 'marker-py');
const jsCode = `require('fs').writeFileSync(${JSON.stringify(markerJs)}, 'ran')`;
const pyCode = `open(${JSON.stringify(markerPy)}, 'w').write('ran')`;

let runCodeCalls = 0;
const realRunCode = Sandbox.runCode;
let server: Server;
let mode: 'text' | 'force_tool_use' = 'text';
let offeredTools: unknown[] | undefined;
let providerCalls = 0;

before(async () => {
  Sandbox.runCode = ((...a: Parameters<typeof realRunCode>) => {
    runCodeCalls++;
    return realRunCode(...a);
  }) as typeof realRunCode;
  bootstrapTools();
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
    providerCalls++;
    offeredTools = body.tools;
    const last = body.messages?.[body.messages.length - 1];
    const hasToolResult = Array.isArray(last?.content) && (last!.content as Array<{ type?: string }>).some((b) => b.type === 'tool_result');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (mode === 'force_tool_use' && !hasToolResult) {
      // A misbehaving / compromised provider response: demands code_execution although it was never offered.
      res.end(
        JSON.stringify({
          content: [{ type: 'tool_use', id: 'toolu_g81', name: 'code_execution', input: { language: 'javascript', code: jsCode } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      );
      return;
    }
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'رد نصي.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  process.env.NEXUS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  Sandbox.runCode = realRunCode;
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
  runCodeCalls = 0;
  providerCalls = 0;
  offeredTools = undefined;
  mode = 'text';
});

const nothingRan = (label: string) => {
  assert.equal(existsSync(markerJs), false, `${label}: JS marker must not exist (no code ran)`);
  assert.equal(existsSync(markerPy), false, `${label}: Python marker must not exist (no code ran)`);
  assert.equal(runCodeCalls, 0, `${label}: Sandbox.runCode must not have been called`);
};

test('G81-1 precondition: the operator flag really is ON, yet the default registry has no code_execution', () => {
  assert.equal(ServerConfig.codeExecutionEnabled, true);
  const reg = getToolRegistry();
  assert.equal(reg.get('code_execution'), undefined);
  assert.ok(!reg.list().some((t) => t.name === 'code_execution'));
  assert.deepEqual(reg.list().map((t) => t.name).sort(), ['calculate', 'web_fetch']);
  assert.deepEqual(reg.listLegacyExemptions(), []);
  // what agents/providers are offered, and capability checks
  assert.ok(!CapabilityGraph.eligibleToolsForProvider('anthropic').some((t) => t.name === 'code_execution'));
  assert.equal(CapabilityGraph.checkToolEligible('anthropic', 'code_execution').allowed, false);
});

test('G81-2 a direct pipeline call fails clearly BEFORE any code runs (JS and Python)', async () => {
  for (const [language, code] of [['javascript', jsCode], ['python', pyCode]] as const) {
    const r = await executeToolCall({ id: 'tu', name: 'code_execution', input: { language, code } }, 'anthropic', gw);
    assert.equal(r.isError, true);
    assert.match(r.content, /code_execution/);
    assert.match(r.content, /غير مسجّلة/);
  }
  nothingRan('direct');
});

test('G81-3 the batch path used by the chat loop: code_execution fails, calculate in the same batch still works', async () => {
  const rs = await executeToolCalls(
    [
      { id: 'a', name: 'calculate', input: { expression: '2+3*4' } },
      { id: 'b', name: 'code_execution', input: { language: 'javascript', code: jsCode } },
    ],
    'anthropic',
    gw
  );
  assert.deepEqual(rs.map((r) => [r.id, r.isError, r.id === 'a' ? r.content : 'x']), [['a', false, '14'], ['b', true, 'x']]);
  nothingRan('batch');
});

test("G81-4 an agent that DECLARES code_execution (the 'data' definition is given the declaration in-test; G8.2 removed it from the shipped one) is offered NO tool and runs no code", async () => {
  const tools = AgentRegistry.get('data').tools;
  tools.push('code_execution');
  try {
    const r = await runAgentTask('data', { agentId: 'data', missionId: null, taskNodeId: null, taskDescription: 'احسب 6 في 7.', upstreamOutputs: {}, gwCtx: gw });
    assert.equal(providerCalls, 1);
    assert.ok(!offeredTools || offeredTools.length === 0, 'no tool definitions were sent to the provider');
    assert.deepEqual(r.toolsUsed, []);
    nothingRan('agent offered');
  } finally {
    tools.splice(tools.indexOf('code_execution'), 1);
  }
});

test('G81-5 a provider that DEMANDS code_execution though never offered it: the loop gets an error tool_result, no code runs', async () => {
  mode = 'force_tool_use';
  const r = await runAgentTask('data', { agentId: 'data', missionId: null, taskNodeId: null, taskDescription: 'احسب.', upstreamOutputs: {}, gwCtx: gw });
  assert.equal(providerCalls, 2, 'round 1: the forced tool_use; round 2: the model sees the error tool_result and answers');
  assert.match(r.output, /رد نصي/);
  nothingRan('agent forced');
});

test('G81-6 a client-supplied ToolDef named code_execution (the /v2/tasks and /api/chat `tools` field) does not register anything', async () => {
  const before = getToolRegistry().list().length;
  mode = 'force_tool_use';
  const { runChatCompletion } = await import('../src/orchestrator/chatService.js');
  const { TaskObservability } = await import('../src/observability/recorder.js');
  const res = await runChatCompletion(
    {
      messages: [{ role: 'user', content: 'x' }],
      provider: 'anthropic',
      maxTokens: 100,
      taskId: 't-g81',
      tools: [{ name: 'code_execution', description: 'client-defined', input_schema: { type: 'object', properties: {} } }],
    },
    gw,
    new TaskObservability('t-g81', 'chat')
  );
  assert.equal(providerCalls, 2, 'the client-offered tool was demanded by the provider; the loop got an error result and carried on');
  assert.ok(res.content.some((b) => b.type === 'text'));
  assert.equal(getToolRegistry().list().length, before);
  assert.equal(getToolRegistry().get('code_execution'), undefined);
  nothingRan('client tool def');
});

test('G81-7 source guards: no src/ file imports the tool or registers anything outside bootstrap; only the tool file imports the Sandbox', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const importsTool: string[] = [];
  const importsSandbox: string[] = [];
  const registers: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      const code = strip(readFileSync(p, 'utf8'));
      if (/codeExecutionTool/.test(code) && !p.endsWith(join('builtin', 'codeExecutionTool.ts'))) importsTool.push(p);
      if (/sandbox\/sandbox(\.js)?['"]/.test(code) && !p.endsWith(join('builtin', 'codeExecutionTool.ts'))) importsSandbox.push(p);
      if (/[A-Za-z_)\]]\.register\(/.test(code) && !p.endsWith(join('tools', 'bootstrap.ts'))) registers.push(p);
    }
  };
  walk(root);
  assert.deepEqual(importsTool, [], 'something in src/ references codeExecutionTool — re-entry requires the owner conditions in tools/bootstrap.ts');
  assert.deepEqual(importsSandbox, [], 'something other than the tool file imports the Sandbox — a possible alias path');
  assert.deepEqual(registers, []);
  // bootstrap.ts itself must not register it either (comments stripped, so the explanatory comment does not count)
  assert.ok(!/codeExecutionTool|code_execution/.test(strip(readFileSync(join(root, 'tools', 'bootstrap.ts'), 'utf8'))));
});

test('G81-8 the implementation and G8 rules are intact: the tool file is still there, still classified legacy_exempt, and G8 still rejects an unclassified copy', () => {
  assert.equal(codeExecutionTool.def.name, 'code_execution');
  assert.equal(codeExecutionTool.effectClass?.kind, 'legacy_exempt');
  const unclassified = { ...codeExecutionTool, effectClass: undefined };
  assert.throws(() => getToolRegistry().register(unclassified), /\[VEL\/G8\]/);
  assert.equal(getToolRegistry().get('code_execution'), undefined);
});

test('G81-9 calculate and web_fetch are unchanged (definitions registered; calculate computes; web_fetch still refuses loopback via the SSRF guard)', async () => {
  const reg = getToolRegistry();
  assert.equal(reg.get('calculate')?.effectClass?.kind, 'pure');
  assert.equal(reg.get('web_fetch')?.effectClass?.kind, 'read_only');
  const c = await executeToolCall({ id: 'c', name: 'calculate', input: { expression: 'sqrt(16)+1' } }, 'anthropic', gw);
  assert.deepEqual([c.content, c.isError], ['5', false]);
  const w = await executeToolCall({ id: 'w', name: 'web_fetch', input: { url: 'http://127.0.0.1:9/' } }, 'anthropic', gw);
  assert.equal(w.isError, true);
});

// LAST on purpose (clears the registry): POSITIVE CONTROL — the markers and the counter are real. Only an EXPLICIT test-level registration makes the tool run.
test('G81-10 positive control: explicit registration (test-only) DOES run code and DOES create the marker — so the absences above are meaningful', async () => {
  getToolRegistry().register(codeExecutionTool);
  assert.deepEqual(getToolRegistry().listLegacyExemptions(), ['code_execution'], 'an explicit opt-in is visible as a legacy exemption');
  const r = await executeToolCall({ id: 'p', name: 'code_execution', input: { language: 'javascript', code: jsCode } }, 'anthropic', gw);
  assert.equal(r.isError, false, r.content);
  assert.equal(existsSync(markerJs), true);
  assert.equal(readFileSync(markerJs, 'utf8'), 'ran');
  assert.equal(runCodeCalls, 1);
  getToolRegistry().clear();
});

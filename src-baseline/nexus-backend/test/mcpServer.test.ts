import './helpers/setAuthTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { bootstrapTools } from '../src/tools/bootstrap.js';

// NEXUS MCP server (owner-authorized 2026-11-14): a minimal, READ-ONLY Model Context Protocol endpoint (JSON-RPC 2.0 over HTTP POST /mcp).
// Scope: initialize / ping / tools/list / tools/call only. Authenticated like every non-health route. Exposes ONLY tools whose effectClass is
// 'pure' (read_only tools need an explicit opt-in env, effectful/VEL and legacy_exempt tools are never exposed here).
let server: Server;
let url: string;
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer secret-key-abc' };

before(async () => {
  bootstrapTools();
  server = createNexusServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const rpc = (body: unknown, headers: Record<string, string> = AUTH) => fetch(`${url}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });

test('MCP: unauthenticated request is rejected (401) — the endpoint is not public', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'Content-Type': 'application/json' });
  assert.equal(res.status, 401);
});

test('MCP initialize returns protocolVersion, serverInfo and ONLY the tools capability', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(res.status, 200);
  const j = (await res.json()) as any;
  assert.equal(j.jsonrpc, '2.0');
  assert.equal(j.id, 1);
  assert.equal(typeof j.result.protocolVersion, 'string');
  assert.equal(j.result.serverInfo.name, 'nexus');
  assert.deepEqual(Object.keys(j.result.capabilities), ['tools']);
});

test('MCP notifications/initialized is accepted with 202 and no body', async () => {
  const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
  assert.equal((await res.text()).length, 0);
});

test('MCP tools/list exposes the pure tool "calculate" with its input schema and does NOT expose read_only web_fetch by default', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const j = (await res.json()) as any;
  const names = j.result.tools.map((t: any) => t.name);
  assert.ok(names.includes('calculate'), names.join(','));
  assert.ok(!names.includes('web_fetch'), 'read_only tools must be opt-in');
  const calc = j.result.tools.find((t: any) => t.name === 'calculate');
  assert.equal(calc.inputSchema.type, 'object');
  assert.deepEqual(calc.inputSchema.required, ['expression']);
});

test('MCP tools/call runs calculate through the real tool pipeline and returns the exact result', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'calculate', arguments: { expression: '2+3*4' } } });
  const j = (await res.json()) as any;
  assert.equal(j.result.isError, false);
  assert.match(j.result.content[0].text, /14/);
  assert.equal(j.result.content[0].type, 'text');
});

test('MCP tools/call with invalid arguments is a tool-level error (isError:true), not a protocol crash', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'calculate', arguments: {} } });
  const j = (await res.json()) as any;
  assert.equal(res.status, 200);
  assert.equal(j.result.isError, true);
});

test('MCP tools/call for a tool that is registered but NOT exposed (web_fetch) is refused with a JSON-RPC error and never executes', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'web_fetch', arguments: { url: 'http://127.0.0.1:1/' } } });
  const j = (await res.json()) as any;
  assert.equal(j.error.code, -32602);
  assert.equal(j.result, undefined);
});

test('MCP tools/call for an unknown tool is a JSON-RPC error (-32602)', async () => {
  const j = (await (await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } })).json()) as any;
  assert.equal(j.error.code, -32602);
});

test('MCP protocol errors: unknown method -32601, malformed request -32600, batch not supported -32600, invalid JSON -32700', async () => {
  const unknown = (await (await rpc({ jsonrpc: '2.0', id: 7, method: 'resources/list' })).json()) as any;
  assert.equal(unknown.error.code, -32601);
  const bad = (await (await rpc({ id: 8, method: 'ping' })).json()) as any; // no jsonrpc:"2.0"
  assert.equal(bad.error.code, -32600);
  const batch = (await (await rpc([{ jsonrpc: '2.0', id: 9, method: 'ping' }])).json()) as any;
  assert.equal(batch.error.code, -32600);
  const raw = await fetch(`${url}/mcp`, { method: 'POST', headers: AUTH, body: '{not json' });
  const parseErr = (await raw.json()) as any;
  assert.equal(parseErr.error.code, -32700);
});

test('MCP ping returns an empty result', async () => {
  const j = (await (await rpc({ jsonrpc: '2.0', id: 10, method: 'ping' })).json()) as any;
  assert.deepEqual(j.result, {});
});

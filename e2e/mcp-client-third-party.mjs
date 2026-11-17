// NEXUS MCP CLIENT (M1) <-> OFFICIAL third-party MCP SERVER (@modelcontextprotocol/sdk) interoperability check (ADR-007 A-M1.1).
// The SERVER is the real vendor SDK (McpServer + StreamableHTTPServerTransport, not written by us); the CLIENT is NEXUS's own McpClientManager.
// Install the SDK outside the repo: mkdir /tmp/mcp-sdk && cd /tmp/mcp-sdk && npm i @modelcontextprotocol/sdk zod
// Run (from repo root):  MCP_SDK_DIR=/tmp/mcp-sdk node --import tsx e2e/mcp-client-third-party.mjs   (tsx from src-baseline/nexus-backend/node_modules)
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_LOG_LEVEL = 'warn';
const SDK_DIR = process.env.MCP_SDK_DIR;
if (!SDK_DIR) { console.error('set MCP_SDK_DIR'); process.exit(2); }
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BACKEND = path.resolve(HERE, '../src-baseline/nexus-backend');
const req = createRequire(path.join(SDK_DIR, 'x.js'));
const imp = (p) => import(pathToFileURL(req.resolve(p)).href);
const sdkVersion = JSON.parse(readFileSync(path.join(SDK_DIR, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version;
const { McpServer } = await imp('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = await imp('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = await imp('zod');
const { McpClientManager } = await import(pathToFileURL(path.join(BACKEND, 'src/mcp/mcpClient.ts')).href);
const { getToolRegistry } = await import(pathToFileURL(path.join(BACKEND, 'src/tools/registry.ts')).href);
const { bootstrapTools } = await import(pathToFileURL(path.join(BACKEND, 'src/tools/bootstrap.ts')).href);
const { getRepos } = await import(pathToFileURL(path.join(BACKEND, 'src/persistence/repos.ts')).href);
bootstrapTools();

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 220) : ''}`); };

let hits = 0;
let mode = 'json'; // json | sse
function makeServer({ failTool = false } = {}) {
  const mcp = new McpServer({ name: 'sdk-third-party', version: '1.0.0' });
  mcp.registerTool('add', { description: 'Add two numbers.', inputSchema: { a: z.number(), b: z.number() }, annotations: { readOnlyHint: true } }, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
  mcp.registerTool('boom', { description: 'Always errors.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => { if (failTool) throw new Error('kaboom'); return { content: [{ type: 'text', text: 'x' }], isError: true }; });
  mcp.registerTool('delete_all', { description: 'Destructive.', inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: true } }, async () => ({ content: [{ type: 'text', text: 'deleted' }] }));
  mcp.registerTool('noann', { description: 'No annotations.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'n' }] }));
  return mcp;
}
const http = createServer(async (rq, rs) => {
  hits++;
  // stateless transport per request (SDK's supported "sessionIdGenerator: undefined" mode) — exercises the no-session-id path
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: mode === 'json' });
  const srv = makeServer();
  rs.on('close', () => { transport.close(); srv.close(); });
  await srv.connect(transport);
  let body = ''; for await (const c of rq) body += c;
  await transport.handleRequest(rq, rs, body ? JSON.parse(body) : undefined);
});
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${http.address().port}/mcp`;
const cfg = (name) => ({ name, url, enabled: true, allowPrivate: true, allowTools: ['add', 'boom', 'delete_all', 'noann'] });
const meta = { taskId: 't-e2e', caller: 'anthropic' };

try {
  for (const m of ['json', 'sse']) {
    mode = m;
    const mgr = new McpClientManager({ servers: [cfg(`sdk${m}`)], timeoutMs: 5000, maxBytes: 100000, maxTools: 16 });
    const st = (await mgr.connectAll())[0];
    check(`S1[${m}] connects to the official SDK server (protocol handshake + tools/list)`, st.connected, st.error);
    check(`S2[${m}] imports ONLY the read-only annotated tools; destructive + unannotated refused`, JSON.stringify([...st.tools].sort()) === JSON.stringify([`mcp__sdk${m}__add`, `mcp__sdk${m}__boom`].sort()) && st.refused.some((r) => r.tool === 'delete_all' && r.reason === 'effectful_annotation') && st.refused.some((r) => r.tool === 'noann' && r.reason === 'unclassified'), JSON.stringify({ tools: st.tools, refused: st.refused }));
    const add = getToolRegistry().get(`mcp__sdk${m}__add`);
    check(`S3[${m}] remote typed call returns the real computed value, labelled untrusted`, add && /\n3$/.test(await add.execute({ a: 1, b: 2 }, meta)) , '');
    const boom = getToolRegistry().get(`mcp__sdk${m}__boom`);
    let err = null; try { await boom.execute({}, meta); } catch (e) { err = e; }
    check(`S4[${m}] a tool-level isError from the SDK server surfaces as an error`, !!err, err?.message);
    let bad = null; try { await add.execute({ a: 'x', b: 2 }, meta); } catch (e) { bad = e; }
    check(`S5[${m}] invalid arguments are rejected by the SDK server and surface as an error (not as success)`, !!bad, bad?.message);
  }
  const pins = getRepos().mcpToolPins;
  check('S6 definitions were pinned on first sight (SHA-256 digests stored)', /^[0-9a-f]{64}$/.test(pins.get('sdkjson', 'add') ?? ''), '');
} catch (e) {
  check('E2E harness ran without an unexpected exception', false, e?.stack || e);
} finally {
  http.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nSDK @modelcontextprotocol/sdk ${sdkVersion}: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { getToolRegistry, type RegisteredTool } from '../../tools/registry.js';
import { executeToolCall } from '../../tools/pipeline.js';
import { auditSecurityEvent } from '../../security/audit.js';
import { normalizeError } from '../../core/errors.js';

/**
 * NEXUS MCP server — minimal, READ-ONLY Model Context Protocol endpoint (JSON-RPC 2.0 over HTTP POST /mcp). Owner-authorized 2026-11-14.
 *
 * Scope (deliberately small): initialize, ping, notifications/initialized, tools/list, tools/call. No resources, prompts, sampling, sessions,
 * SSE or batching. Authenticated by the gateway like every non-health route (this route is NOT skipAuth).
 *
 * Exposure rule (least privilege): only tools that run through the unchanged tool pipeline AND are classified effectClass.kind === 'pure' are
 * exposed. 'read_only' tools (e.g. web_fetch: server-side network egress) require the explicit opt-in NEXUS_MCP_EXPOSE_READ_ONLY=1.
 * Effectful (VEL) and legacy_exempt tools are NEVER exposed here — an MCP client gets no path around the VEL gate or the Warden.
 */
const PROTOCOL_VERSION = '2025-03-26';

type Json = Record<string, unknown>;
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function exposed(t: RegisteredTool | undefined): t is RegisteredTool {
  if (!t || !t.execute || t.effect) return false;
  const kind = t.effectClass?.kind;
  if (kind === 'pure') return true;
  return kind === 'read_only' && process.env.NEXUS_MCP_EXPOSE_READ_ONLY === '1';
}

export function registerMcpRoutes(router: Router) {
  router.post('/mcp', async (ctx: RouteContext) => {
    const send = (status: number, body?: unknown): void => {
      if (body === undefined) {
        ctx.res.writeHead(status);
        ctx.res.end();
        return;
      }
      ctx.res.writeHead(status, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify(body));
    };

    let msg: unknown;
    try {
      msg = await readJsonBody<unknown>(ctx.req);
    } catch (e) {
      const n = normalizeError(e);
      if (n.code === 'validation_error') return send(200, err(null, -32700, 'Parse error'));
      throw e;
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return send(200, err(null, -32600, 'Invalid Request: a single JSON-RPC object is required (batching is not supported)'));
    const m = msg as Json;
    if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return send(200, err(m.id, -32600, 'Invalid Request'));
    const id = m.id;
    const isNotification = id === undefined;
    const params = (typeof m.params === 'object' && m.params !== null ? m.params : {}) as Json;

    switch (m.method) {
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return send(202);
      case 'ping':
        return send(200, ok(id, {}));
      case 'initialize':
        return send(200, ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'nexus', version: '5.0.0' } }));
      case 'tools/list': {
        const reg = getToolRegistry();
        const tools = reg
          .list()
          .filter((d) => exposed(reg.get(d.name)))
          .map((d) => ({ name: d.name, description: d.description ?? '', inputSchema: d.input_schema ?? { type: 'object', properties: {} } }));
        return send(200, ok(id, { tools }));
      }
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : '';
        const args = (typeof params.arguments === 'object' && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;
        const tool = getToolRegistry().get(name);
        if (!exposed(tool)) {
          auditSecurityEvent('warn', 'MCP tools/call refused: tool not exposed', { tool: name, client: ctx.gw.clientKey });
          return send(200, err(id, -32602, `Unknown or non-exposed tool: ${name.slice(0, 80)}`));
        }
        const r = await executeToolCall({ id: String(id ?? 'mcp'), name, input: args }, 'mcp', ctx.gw);
        return send(200, ok(id, { content: [{ type: 'text', text: r.content }], isError: r.isError }));
      }
      default:
        if (isNotification) return send(202);
        return send(200, err(id, -32601, `Method not found: ${m.method.slice(0, 80)}`));
    }
  });
}

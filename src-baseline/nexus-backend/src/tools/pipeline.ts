import type { ProviderId } from '../config/providerRegistry.js';
import { getToolRegistry, validateAgainstSchema } from './registry.js';
import { PermissionModel, type GatewayContext } from '../capability/permissionModel.js';
import { Errors, normalizeError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { executeEffectfulToolCall } from './verifiedExecution.js';

export interface ToolCallRequest {
  /** The tool_use block id from the model's own response — never derived from free text. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallResult {
  id: string;
  content: string;
  isError: boolean;
  /** Present only for VEL (effectful) tools — see tools/verifiedExecution.ts. Additive: pre-VEL tools never set it. */
  receipt?: { id: string; status: string; verification: string | null; needsHuman: boolean };
}

export interface ToolCallOptions {
  /** The owning task id (ChatServiceRequest.taskId). Required for any VEL tool: an effectful action with no task scope is denied. */
  taskId?: string | null;
}

const MAX_RESULT_CHARS = 20_000;

/** Strips control characters and caps length — defense in depth so a misbehaving tool can't smuggle terminal-escape sequences or blow out context with an unbounded result. */
function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return stripped.length > MAX_RESULT_CHARS ? stripped.slice(0, MAX_RESULT_CHARS) + '…[مقتطع]' : stripped;
}

function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Errors.timeout(`انتهت مهلة تنفيذ الأداة "${toolName}".`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** 'mcp' = the call comes from an MCP client (routes/v2/mcp.ts), not from a model provider: the per-PROVIDER capability check does not apply (there is no provider), every other step is identical. */
export type ToolCaller = ProviderId | 'mcp';

export async function executeToolCall(req: ToolCallRequest, providerId: ToolCaller, ctx: GatewayContext, opts: ToolCallOptions = {}): Promise<ToolCallResult> {
  // 1. Registry lookup
  const registered = getToolRegistry().get(req.name);
  // NEXUS VEL: a tool that declares an external effect has no execute() and runs ONLY through the verified-execution gate (policy -> write-ahead receipt ->
  // dispatch -> independent read-back -> reconcile). Tools that don't declare `effect` take the unchanged path below.
  if (registered?.effect) {
    if (providerId === 'mcp') return { id: req.id, content: `الأداة "${req.name}" لا تُعرَّض عبر MCP.`, isError: true }; // defence in depth: effectful tools are never callable over MCP
    return executeEffectfulToolCall(req, providerId, ctx, registered as typeof registered & { effect: NonNullable<typeof registered.effect> }, opts);
  }
  if (!registered || !registered.execute) {
    return { id: req.id, content: `الأداة "${req.name}" غير مسجّلة أو لا تُنفَّذ من هذا الخادم.`, isError: true };
  }

  try {
    // 2. Capability check + 3. Permission check (auth/budget)
    if (providerId !== 'mcp') PermissionModel.assertToolAllowed(providerId, req.name, ctx);
    PermissionModel.assertBudgetAllowed();

    // 4. Validation
    const errors = validateAgainstSchema(registered.def.input_schema, req.input);
    if (errors.length) throw Errors.toolValidation(errors.join(' '), { errors });

    // 5. Execution + 6. Timeout
    const raw = await withTimeout(registered.execute(req.input), registered.timeoutMs, req.name);

    // 7. Sanitization
    const clean = sanitize(raw);

    logger.info('Tool executed', { tool: req.name, provider: providerId, resultChars: clean.length });
    // 8. Result
    return { id: req.id, content: clean, isError: false };
  } catch (e) {
    const err = normalizeError(e);
    logger.warn('Tool execution failed', { tool: req.name, provider: providerId, message: err.message });
    return { id: req.id, content: `فشل تنفيذ الأداة: ${err.message}`, isError: true };
  }
}

export async function executeToolCalls(reqs: ToolCallRequest[], providerId: ToolCaller, ctx: GatewayContext, opts: ToolCallOptions = {}): Promise<ToolCallResult[]> {
  return Promise.all(reqs.map((r) => executeToolCall(r, providerId, ctx, opts)));
}

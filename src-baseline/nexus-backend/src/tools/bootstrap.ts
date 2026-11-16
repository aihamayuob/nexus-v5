import { getToolRegistry } from './registry.js';
import { logger } from '../core/logger.js';
import { webFetchTool } from './builtin/webFetchTool.js';
import { calculateTool } from './builtin/calculateTool.js';

let bootstrapped = false;

export function bootstrapTools(): void {
  if (bootstrapped) return;
  const registry = getToolRegistry();
  registry.register(webFetchTool);
  registry.register(calculateTool);
  // G8.1 (owner decision, OPTION C): 'code_execution' is deliberately NOT registered here. Its implementation (tools/builtin/codeExecutionTool.ts,
  // sandbox/sandbox.ts) is kept for development/review only. sandbox.ts documents that there is NO filesystem or network isolation, so the tool must not
  // be reachable by default outside the VEL gate. Setting NEXUS_ENABLE_CODE_EXECUTION_TOOL does NOT re-register it (it only gates Sandbox.runCode itself);
  // while unregistered, any call for it fails in pipeline.ts ("غير مسجّلة") before any code runs, and agents that declare it silently resolve no tool.
  // RE-ENTRY CONDITIONS (all required): an isolated execution environment exists; the tool is bound to the VEL gate (`effect`, not a plain `execute`);
  // its security and recovery tests pass; the owner decides. Do NOT add a register() call or an import of codeExecutionTool anywhere in src/ without that —
  // test/codeExecutionNotRegistered.test.ts guards this. This change removes DEFAULT AVAILABILITY only; it adds no isolation.
  // VEL gap G8: make every non-VEL exemption visible in the boot log (it is a known, owner-accepted gap — not a claim of safety).
  for (const name of registry.listLegacyExemptions()) logger.warn('Tool registered as VEL legacy_exempt (can cause external effects; not VEL-gated)', { tool: name });
  // NOTE: 'create_file' and 'web_search' are intentionally NOT registered
  // here. create_file writes to the end user's own device/browser — there
  // is nothing meaningful for a stateless backend to execute; it stays a
  // client-side tool. web_search (type 'web_search_20250305') is executed
  // natively BY Anthropic itself when offered to that provider — it never
  // reaches this pipeline at all, so registering it here would be a no-op
  // at best and misleading at worst (implying we could deny/permission it,
  // when in reality Anthropic's own infrastructure runs it before we ever
  // see a tool_use block for it).
  bootstrapped = true;
}

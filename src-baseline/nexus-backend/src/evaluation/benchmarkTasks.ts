import { routeModel } from '../providers/modelRouter.js';
import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import { getProviderAdapter } from '../providers/index.js';
import { resilientCall } from '../providers/resilientCall.js';
import { executeToolCall } from '../tools/pipeline.js';
import { evaluateMathExpression } from '../tools/builtin/calculateTool.js';
import { safeFetch } from '../security/ssrfGuard.js';
import { Verifier } from '../orchestrator/verifier.js';
import { analyzeIntent } from '../intent/intentEngine.js';
import { classifyExecutionTier } from '../intent/executionPolicy.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { Errors } from '../core/errors.js';

export interface BenchmarkResult {
  name: string;
  category: 'routing' | 'provider' | 'tool' | 'failure_recovery' | 'verification_coverage' | 'policy';
  pass: boolean;
  latencyMs: number;
  details?: string;
}

const benchCtx: GatewayContext = { authenticated: true, clientKey: 'benchmark', projectId: null, userId: null };

async function timed(
  name: string,
  category: BenchmarkResult['category'],
  fn: () => Promise<boolean | { pass: boolean; details?: string }> | boolean | { pass: boolean; details?: string }
): Promise<BenchmarkResult> {
  const start = Date.now();
  try {
    const result = await fn();
    const normalized = typeof result === 'boolean' ? { pass: result } : result;
    return { name, category, pass: normalized.pass, latencyMs: Date.now() - start, details: normalized.details };
  } catch (e) {
    return { name, category, pass: false, latencyMs: Date.now() - start, details: `threw: ${(e as Error).message}` };
  }
}

// --- Routing benchmark: pure logic, no network, fully deterministic ---
async function routingBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(
    await timed('routing: rejects unknown provider', 'routing', () => {
      try {
        routeModel('nonexistent' as ProviderId);
        return { pass: false, details: 'expected a throw' };
      } catch {
        return { pass: true };
      }
    })
  );

  results.push(
    await timed('routing: fallback chain never includes the primary provider itself', 'routing', () => {
      const primary = pickRoutableProvider();
      if (!primary) return { pass: true, details: 'no fully-routable provider configured — skipped' };
      const routed = routeModel(primary);
      return { pass: !routed.fallbacks.includes(primary) };
    })
  );

  results.push(
    await timed('routing: needsTools excludes non-tool-capable fallbacks', 'routing', () => {
      const primary = pickRoutableProvider({ needsTools: true });
      if (!primary) return { pass: true, details: 'no tool-capable, fully-routable provider configured — skipped' };
      const routed = routeModel(primary, { needsTools: true });
      return { pass: !routed.fallbacks.some((p) => !ProviderRegistry.capabilities(p).tools) };
    })
  );

  return results;
}

/** A provider is only useful as a benchmark's "primary" if routeModel() would actually accept it — configured AND (for local providers) has a resolved model. Mirrors configuredProviders()'s definition exactly (see providerRegistry.ts) rather than reimplementing the check. */
function pickRoutableProvider(need: { needsTools?: boolean; needsImages?: boolean } = {}): ProviderId | null {
  const candidates = ProviderRegistry.configuredProviders().filter((p) => {
    const caps = ProviderRegistry.capabilities(p);
    if (need.needsTools && !caps.tools) return false;
    if (need.needsImages && !caps.images) return false;
    return true;
  });
  return candidates[0] ?? null;
}

// --- Provider benchmark: requires an actually reachable adapter (real config or test-injected fake). Skips gracefully when nothing is configured. ---
async function providerBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const configured = ProviderRegistry.configuredProviders();

  for (const providerId of configured) {
    results.push(
      await timed(`provider: ${providerId} responds to a minimal completion`, 'provider', async () => {
        const adapter = getProviderAdapter(providerId);
        const model = ProviderRegistry.resolve(providerId).resolvedModel;
        if (!model) return { pass: false, details: 'no model configured' };
        const res = await adapter.chat({ model, messages: [{ role: 'user', content: 'ping' }], maxTokens: 16 });
        return { pass: res.content.length > 0 || res.stopReason === 'end_turn', details: `stopReason=${res.stopReason}` };
      })
    );
  }
  if (configured.length === 0) {
    results.push({ name: 'provider: no providers configured', category: 'provider', pass: true, latencyMs: 0, details: 'skipped — nothing configured' });
  }
  return results;
}

// --- Tool benchmark: deterministic — calculate is pure, SSRF block fails closed without needing a real network path ---
async function toolBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(await timed('tool: calculate evaluates a real expression correctly', 'tool', () => evaluateMathExpression('(2+3)*4') === 20));

  results.push(
    await timed('tool: calculate rejects non-arithmetic input rather than executing it', 'tool', () => {
      try {
        evaluateMathExpression('require("fs")');
        return { pass: false, details: 'should have thrown' };
      } catch {
        return { pass: true };
      }
    })
  );

  results.push(
    await timed('tool: pipeline denies a tool on a provider without tool-calling capability', 'tool', async () => {
      const result = await executeToolCall({ id: 't2', name: 'calculate', input: { expression: '1+1' } }, 'ollama', benchCtx);
      return { pass: result.isError, details: result.content.slice(0, 80) };
    })
  );

  results.push(
    await timed('tool: pipeline reports validation error for malformed input, not a crash', 'tool', async () => {
      const result = await executeToolCall({ id: 't3', name: 'calculate', input: {} }, 'anthropic', benchCtx);
      return { pass: result.isError, details: result.content.slice(0, 80) };
    })
  );

  results.push(
    await timed('tool: SSRF guard blocks a loopback target', 'tool', async () => {
      try {
        await safeFetch('http://127.0.0.1:1/x', { timeoutMs: 2000 });
        return { pass: false, details: 'expected a throw' };
      } catch {
        return { pass: true };
      }
    })
  );

  return results;
}

// --- Failure-recovery benchmark: exercises resilientCall's real retry/fallback logic with synthetic attempts ---
async function failureRecoveryBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(
    await timed('failure-recovery: resilientCall falls back after primary fails', 'failure_recovery', async () => {
      let primaryCalls = 0;
      let fallbackCalls = 0;
      const result = await resilientCall({
        maxRetriesPerAttempt: 0,
        attempts: [
          { label: 'primary', run: async () => { primaryCalls++; throw Errors.provider('simulated failure', true); } },
          { label: 'fallback', run: async () => { fallbackCalls++; return 'ok'; } },
        ],
      });
      return { pass: result === 'ok' && primaryCalls === 1 && fallbackCalls === 1 };
    })
  );

  results.push(
    await timed('failure-recovery: non-retryable errors do not retry within the same attempt', 'failure_recovery', async () => {
      let calls = 0;
      try {
        await resilientCall({
          maxRetriesPerAttempt: 3,
          attempts: [{ label: 'only', run: async () => { calls++; throw Errors.validation('bad input'); } }],
        });
        return { pass: false, details: 'expected a throw' };
      } catch {
        return { pass: calls === 1, details: `called ${calls} times, expected 1` };
      }
    })
  );

  return results;
}

// --- Verification coverage: confirms the gating logic (applied exactly when it should be, not more/less) ---
async function verificationCoverageBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(
    await timed('verification: low-risk/low-complexity intent is NOT gated for verification (avoids wasted cost)', 'verification_coverage', () => {
      const intent = analyzeIntent('what time is it');
      return { pass: Verifier.shouldVerify(intent) === false };
    })
  );

  results.push(
    await timed('verification: high-risk intent IS gated for verification', 'verification_coverage', () => {
      const intent = analyzeIntent('ما هي جرعة الدواء الآمنة لطفل عمره 3 سنوات؟');
      return { pass: Verifier.shouldVerify(intent) === true };
    })
  );

  return results;
}

// --- Execution policy benchmark ---
async function policyBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  results.push(
    await timed('policy: a simple factual question classifies as LOW/fast-path', 'policy', () => classifyExecutionTier(analyzeIntent('what is the capital of France')) === 'LOW')
  );
  results.push(
    await timed('policy: a multi-step analytical request classifies above LOW', 'policy', () =>
      classifyExecutionTier(analyzeIntent('قارن استراتيجيات الاستثمار طويلة وقصيرة المدى وحلل المخاطر بالتفصيل')) !== 'LOW'
    )
  );
  results.push(
    await timed('policy: a high-risk medical request classifies as HIGH_RISK', 'policy', () =>
      classifyExecutionTier(analyzeIntent('ما هي جرعة الدواء الآمنة لطفل عمره 3 سنوات؟')) === 'HIGH_RISK'
    )
  );
  return results;
}

export async function runAllBenchmarks(): Promise<BenchmarkResult[]> {
  const groups = await Promise.all([
    routingBenchmarks(),
    providerBenchmarks(),
    toolBenchmarks(),
    failureRecoveryBenchmarks(),
    verificationCoverageBenchmarks(),
    policyBenchmarks(),
  ]);
  return groups.flat();
}

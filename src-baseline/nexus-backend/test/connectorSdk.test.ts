import './helpers/setAuthTestEnv.js';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getToolRegistry } from '../src/tools/registry.js';
import { bootstrapTools } from '../src/tools/bootstrap.js';
import { executeToolCall } from '../src/tools/pipeline.js';
import { validateManifest, registerConnector, registerConnectors, runConformance, type ConnectorManifest, type ConnectorImpl } from '../src/connectors/connectorSdk.js';
import { textStatsManifest, textStatsImpl, textStatsConformanceSamples } from '../src/connectors/reference/textStatsConnector.js';

/**
 * C1 — UNIVERSAL CONNECTOR SDK (ADR-007 §3, A-C1.1..A-C1.5). A connector author supplies a versioned manifest + an implementation; the SDK ENFORCES (not advises) the
 * effect declaration, schema shape, secret handling (by env-var NAME only) and the VEL requirement for effectful connectors. Third-party code isolation is NOT provided.
 */
const good = (over: Record<string, unknown> = {}): ConnectorManifest => ({ ...textStatsManifest, ...over }) as ConnectorManifest;
const names = () => getToolRegistry().list().map((d) => d.name).sort();
const ctx = { clientKey: 'k', authenticated: true } as never;
const effectSpec = () => ({
  connector: 'demo-ledger', operation: 'ledger.append', resource: () => 'ledger', summarize: () => 'append', locator: () => ({ id: 'x' }), successCondition: 'exactly one record with the id exists',
  idempotency: 'key_supported' as const, maxAttempts: 1, dispatchTimeoutMs: 1000, observeTimeoutMs: 1000, totalBudgetMs: 3000,
  dispatch: async () => ({ ok: true as const }), observe: async () => ({ readable: true as const, matches: 1, conflicts: 0 }),
});

before(() => bootstrapTools());
beforeEach(() => { for (const n of names()) if (n.startsWith('conn_') || n === 'text_stats') getToolRegistry().unregister(n); });

test('C1 (A-C1.1): the reference connector passes the conformance kit, registers, and runs through the REAL tool pipeline', async () => {
  const report = await runConformance(textStatsManifest, textStatsImpl, textStatsConformanceSamples);
  assert.equal(report.passed, true, JSON.stringify(report.checks.filter((c) => !c.ok)));
  assert.ok(report.checks.length >= 6, 'the kit actually runs several checks');
  registerConnector(textStatsManifest, textStatsImpl, { velEnabled: true });
  const t = getToolRegistry().get('text_stats')!;
  assert.equal(t.effectClass?.kind, 'pure');
  const r = await executeToolCall({ id: 'u', name: 'text_stats', input: { text: 'hello world foo' } }, 'mcp', ctx);
  assert.equal(r.isError, false, r.content);
  assert.match(r.content, /words:\s*3/);
  const bad = await executeToolCall({ id: 'u2', name: 'text_stats', input: {} }, 'mcp', ctx);
  assert.equal(bad.isError, true, 'schema-invalid input is rejected by the pipeline');
});

test('C1 (A-C1.2): deliberately bad manifests are refused with a clear error and NOTHING is registered', () => {
  const before = names();
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['missing effect', { effect: undefined }, /effect/],
    ['invalid effect value', { effect: 'legacy_exempt' }, /effect/],
    ['missing effectReason', { effectReason: 'short' }, /effectReason/],
    ['bad name', { name: 'Bad Name!' }, /name/],
    ['built-in name collision', { name: 'calculate' }, /calculate|موجودة|collision/i],
    ['schema violation: not an object', { inputSchema: { type: 'string' } }, /inputSchema/],
    ['schema violation: property without type', { inputSchema: { type: 'object', properties: { a: {} } } }, /inputSchema|type/],
    ['required names an unknown property', { inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['zzz'] } }, /required/],
    ['inline secret value in requiredSecrets', { requiredSecrets: ['sk-live-0123456789abcdef0123'] }, /secret|requiredSecrets/i],
    ['secret-looking value inside description', { description: 'uses key sk-ant-api03-0123456789abcdef0123456789' }, /secret|credential|سر/i],
    ['unknown manifest field (e.g. token)', { token: 'abc' }, /token|unknown|غير مسموح/i],
    ['bad version', { version: 'latest' }, /version/],
    ['timeout out of bounds', { timeoutMs: 99_999_999 }, /timeoutMs/],
    ['wrong manifestVersion', { manifestVersion: 2 }, /manifestVersion/],
  ];
  for (const [label, over, re] of cases) {
    const m = { ...textStatsManifest, ...over } as Record<string, unknown>;
    const v = validateManifest(m);
    assert.equal(v.ok, false, `${label}: must be invalid`);
    assert.match(v.errors.join(' | '), re, `${label}: error should be clear`);
    assert.throws(() => registerConnector(m as unknown as ConnectorManifest, textStatsImpl, { velEnabled: true }), /\[C1\]/, label);
  }
  assert.deepEqual(names(), before, 'a refused connector leaves the registry untouched');
});

test('C1 (A-C1.3): an effectful connector is refused without a VEL effect spec, with VEL disabled, or if it also carries a plain execute(); with VEL it registers as effect-only', () => {
  const eff = good({ name: 'conn_ledger', effect: 'effectful' });
  assert.throws(() => registerConnector(eff, { execute: async () => 'x' } as ConnectorImpl, { velEnabled: true }), /\[C1\].*VEL|effect/);
  assert.throws(() => registerConnector(eff, { effect: effectSpec() } as ConnectorImpl, { velEnabled: false }), /\[C1\].*VEL/);
  assert.throws(() => registerConnector(eff, { effect: effectSpec(), execute: async () => 'x' } as ConnectorImpl, { velEnabled: true }), /\[C1\]/);
  // and the reverse: a pure/read_only manifest must not smuggle an effect spec
  assert.throws(() => registerConnector(good({ name: 'conn_sneaky' }), { execute: async () => 'x', effect: effectSpec() } as ConnectorImpl, { velEnabled: true }), /\[C1\]/);
  assert.equal(getToolRegistry().get('conn_ledger'), undefined);
  registerConnector(eff, { effect: effectSpec() } as ConnectorImpl, { velEnabled: true });
  const t = getToolRegistry().get('conn_ledger')!;
  assert.ok(t.effect && !t.execute, 'effectful connector is reachable ONLY through the VEL gate');
});

test('C1: secrets are referenced by env-var NAME, must exist at registration, and a connector can read only the ones it declared', async () => {
  const m = good({ name: 'conn_secret', requiredSecrets: ['CONN_TEST_TOKEN'] });
  assert.throws(() => registerConnector(m, { execute: async () => 'x' }, { velEnabled: true }), /\[C1\].*CONN_TEST_TOKEN/);
  process.env.CONN_TEST_TOKEN = 'tok-conn-secret-123456';
  process.env.CONN_OTHER = 'other-secret';
  try {
    let seen = '', denied = '';
    registerConnector(m, { execute: async (_i, c) => { seen = c.secret('CONN_TEST_TOKEN'); try { c.secret('CONN_OTHER'); } catch (e) { denied = (e as Error).message; } return 'ok'; } }, { velEnabled: true });
    await executeToolCall({ id: 'u', name: 'conn_secret', input: { text: 'a' } }, 'mcp', ctx);
    assert.equal(seen, 'tok-conn-secret-123456');
    assert.match(denied, /CONN_OTHER/, 'undeclared secret read must throw');
  } finally { delete process.env.CONN_TEST_TOKEN; delete process.env.CONN_OTHER; }
});

test('C1: the conformance kit CATCHES non-conforming connectors (secret leak, oversize output, control characters, throw on valid input, timeout overrun)', async () => {
  process.env.CONN_LEAK = 'leaky-secret-value-98765';
  try {
    const base = good({ name: 'conn_bad', requiredSecrets: ['CONN_LEAK'], timeoutMs: 200 });
    const run = (impl: ConnectorImpl) => runConformance(base, impl, { valid: [{ text: 'a b' }], invalid: [{}] });
    assert.equal((await run({ execute: async (_i, c) => `result ${c.secret('CONN_LEAK')}` })).passed, false, 'leak');
    assert.equal((await run({ execute: async () => 'x'.repeat(30_000) })).passed, false, 'oversize');
    assert.equal((await run({ execute: async () => 'a\u0007b' })).passed, false, 'control chars');
    assert.equal((await run({ execute: async () => { throw new Error('boom'); } })).passed, false, 'throws on valid input');
    assert.equal((await run({ execute: () => new Promise((r) => setTimeout(() => r('late'), 600)) })).passed, false, 'timeout overrun');
    assert.equal((await run({ execute: async () => 'fine' })).passed, true, 'control: a conforming connector passes');
  } finally { delete process.env.CONN_LEAK; }
});

test('C1: registerConnectors (the boot path) fails loudly on the first invalid entry and a duplicate name is refused', () => {
  assert.throws(() => registerConnectors([{ manifest: good({ effect: undefined }), impl: textStatsImpl }], { velEnabled: true }), /\[C1\]/);
  registerConnector(textStatsManifest, textStatsImpl, { velEnabled: true });
  assert.throws(() => registerConnector(textStatsManifest, textStatsImpl, { velEnabled: true }), /\[C1\].*(مسجّلة|already|duplicate)/);
  assert.deepEqual(registerConnectors([], { velEnabled: true }), []);
});

test('C1: effectful with NO implementation at all is refused; the bootstrap path independently refuses a taken name; the boot path is all-or-nothing', async () => {
  assert.throws(() => registerConnector(good({ name: 'conn_empty', effect: 'effectful' }), {} as ConnectorImpl, { velEnabled: true }), /\[C1\].*VEL/);
  const { registerConnectorTool } = await import('../src/tools/bootstrap.js');
  assert.throws(() => registerConnectorTool({ def: { name: 'calculate', description: 'd' }, timeoutMs: 100, execute: async () => 'x', effectClass: { kind: 'pure', reason: 'pure reason text' } }), /\[C1\].*already|مسجّل/);
  assert.throws(() => registerConnectorTool({ def: { name: 'conn_lx', description: 'd' }, timeoutMs: 100, execute: async () => 'x', effectClass: { kind: 'legacy_exempt', reason: 'legacy reason text', compensatingControls: 'some compensating controls' } }), /\[C1\]/);
  assert.throws(() => registerConnectors([{ manifest: good({ name: 'conn_first' }), impl: textStatsImpl }, { manifest: good({ name: 'conn_second', effect: undefined }), impl: textStatsImpl }], { velEnabled: true }), /\[C1\]/);
  assert.equal(getToolRegistry().get('conn_first'), undefined, 'the valid first entry must be rolled back when a later entry is invalid');
});

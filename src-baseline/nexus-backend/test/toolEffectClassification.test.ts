import './helpers/setVelTestEnv.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { getToolRegistry, type RegisteredTool } from '../src/tools/registry.js';
import { bootstrapTools } from '../src/tools/bootstrap.js';
import { executeToolCall } from '../src/tools/pipeline.js';
import { webFetchTool } from '../src/tools/builtin/webFetchTool.js';
import { calculateTool } from '../src/tools/builtin/calculateTool.js';
import { codeExecutionTool } from '../src/tools/builtin/codeExecutionTool.js';
import { FakeLedger, makeLedgerTool } from './helpers/fakeLedgerConnector.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

/**
 * VEL gap G8 — registration-time classification gate. What these tests prove: ToolRegistry.register() enforces the three invariants and the stored
 * entry is immutable; the built-in tools carry a classification and the legacy-exemption set is exactly the pinned one; no other src/ file registers
 * tools. What they do NOT prove: that a classification is TRUE (it is an attestation), or that nothing calls a connector's own functions directly.
 */

const gw: GatewayContext = { authenticated: true, clientKey: 'key:g8', projectId: 'p1', userId: null };
const GOOD_REASON = 'سبب كافٍ وصريح للتصنيف.';
const noop = async () => 'ok';

function plainTool(name: string, extra: Partial<RegisteredTool> = {}): RegisteredTool {
  return { def: { name, description: 'TEST', input_schema: { type: 'object', properties: {} } }, timeoutMs: 1_000, ...extra };
}

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
  getToolRegistry().clear();
});

test('G8-1 an execute() tool with no classification is rejected and NOT registered', async () => {
  assert.throws(() => getToolRegistry().register(plainTool('t_unclassified', { execute: noop })), /\[VEL\/G8\].*effectClass/);
  assert.equal(getToolRegistry().get('t_unclassified'), undefined);
  const r = await executeToolCall({ id: 'x', name: 't_unclassified', input: {} }, 'anthropic', gw);
  assert.equal(r.isError, true);
});

test('G8-2 effect and execute together are rejected', () => {
  const t = { ...makeLedgerTool(new FakeLedger()), execute: noop };
  assert.throws(() => getToolRegistry().register(t), /effect وexecute/);
  assert.equal(getToolRegistry().get('ledger_append'), undefined);
});

test('G8-3 effect together with effectClass is rejected', () => {
  const t: RegisteredTool = { ...makeLedgerTool(new FakeLedger()), effectClass: { kind: 'pure', reason: GOOD_REASON } };
  assert.throws(() => getToolRegistry().register(t), /effect وeffectClass/);
});

test('G8-4 invalid classifications are rejected (table)', () => {
  const cases: Array<[string, unknown]> = [
    ['empty reason', { kind: 'pure', reason: '' }],
    ['whitespace reason', { kind: 'pure', reason: '            ' }],
    ['too-short reason', { kind: 'pure', reason: 'x' }],
    ['non-string reason', { kind: 'pure', reason: 12345678901234 }],
    ['unknown kind', { kind: 'safe', reason: GOOD_REASON }],
    ['missing kind', { reason: GOOD_REASON }],
    ['null', null],
    ['string instead of object', 'pure'],
    ['legacy_exempt without controls', { kind: 'legacy_exempt', reason: GOOD_REASON }],
    ['legacy_exempt with blank controls', { kind: 'legacy_exempt', reason: GOOD_REASON, compensatingControls: '   ' }],
  ];
  for (const [label, c] of cases) {
    assert.throws(() => getToolRegistry().register(plainTool('t_bad', { execute: noop, effectClass: c as never })), /\[VEL\/G8\]/, label);
    assert.equal(getToolRegistry().get('t_bad'), undefined, label);
  }
});

test('G8-5 valid classifications register and the tool still runs through the unchanged pipeline path', async () => {
  const reg = getToolRegistry();
  reg.register(plainTool('t_pure', { execute: async () => 'pure-result', effectClass: { kind: 'pure', reason: GOOD_REASON } }));
  reg.register(plainTool('t_ro', { execute: noop, effectClass: { kind: 'read_only', reason: GOOD_REASON } }));
  reg.register(plainTool('t_legacy', { execute: noop, effectClass: { kind: 'legacy_exempt', reason: GOOD_REASON, compensatingControls: 'ضوابط معوِّضة مسمّاة.' } }));
  const r = await executeToolCall({ id: 'x', name: 't_pure', input: {} }, 'anthropic', gw);
  assert.deepEqual({ content: r.content, isError: r.isError, receipt: r.receipt }, { content: 'pure-result', isError: false, receipt: undefined });
  assert.deepEqual(reg.listLegacyExemptions(), ['t_legacy']);
});

test('G8-6 a VEL (effect-only) tool needs no classification and a def-only tool is accepted unchanged', async () => {
  getToolRegistry().register(makeLedgerTool(new FakeLedger()));
  assert.ok(getToolRegistry().get('ledger_append')?.effect);
  getToolRegistry().register(plainTool('t_native'));
  const r = await executeToolCall({ id: 'x', name: 't_native', input: {} }, 'anthropic', gw);
  assert.equal(r.isError, true, 'a tool with neither execute nor effect is not executable by our pipeline');
});

test('G8-7 the stored entry is immutable (no gaining execute / losing effect / editing classification later)', () => {
  const reg = getToolRegistry();
  reg.register(makeLedgerTool(new FakeLedger()));
  const stored = reg.get('ledger_append') as RegisteredTool;
  assert.throws(() => { (stored as { execute?: unknown }).execute = noop; }, TypeError);
  assert.throws(() => { delete (stored as { effect?: unknown }).effect; }, TypeError);
  reg.register(plainTool('t_pure', { execute: noop, effectClass: { kind: 'pure', reason: GOOD_REASON } }));
  const p = reg.get('t_pure') as RegisteredTool;
  assert.throws(() => { (p.effectClass as { kind: string }).kind = 'legacy_exempt'; }, TypeError);
  // freezing a COPY must not freeze the caller's original object
  const original = plainTool('t_orig', { execute: noop, effectClass: { kind: 'pure', reason: GOOD_REASON } });
  reg.register(original);
  assert.equal(Object.isFrozen(original), false);
});

test('G8-8 built-in tools: each is classified, and the legacy-exemption set is exactly the pinned one', () => {
  for (const t of [webFetchTool, calculateTool, codeExecutionTool]) assert.ok(t.effectClass, `${t.def.name} must carry effectClass`);
  assert.equal(calculateTool.effectClass!.kind, 'pure');
  assert.equal(webFetchTool.effectClass!.kind, 'read_only');
  // code_execution's sandbox has no FS jail / network isolation (sandbox/sandbox.ts) => it must NOT be attested as pure/read_only.
  assert.equal(codeExecutionTool.effectClass!.kind, 'legacy_exempt');
  getToolRegistry().register(webFetchTool);
  getToolRegistry().register(calculateTool);
  getToolRegistry().register(codeExecutionTool);
  // Adding to this list is a deliberate, reviewable act: edit this pin AND record the owner decision.
  assert.deepEqual(getToolRegistry().listLegacyExemptions(), ['code_execution']);
});

test('G8-9 bootstrapTools() (the real boot path) completes with the classification gate active', () => {
  bootstrapTools();
  const reg = getToolRegistry();
  for (const n of ['web_fetch', 'calculate']) assert.ok(reg.get(n), `${n} registered`);
  // G8.1 (owner decision, OPTION C): code_execution is no longer registered by default, so the default boot path has NO legacy exemption left.
  assert.equal(reg.get('code_execution'), undefined);
  assert.deepEqual(reg.listLegacyExemptions(), []);
});

test('G8-10 no file in src/ other than tools/bootstrap.ts registers tools (bypass-site guard)', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && /\.register\(/.test(readFileSync(p, 'utf8')) && !p.endsWith(join('tools', 'bootstrap.ts'))) offenders.push(p);
    }
  };
  walk(root);
  // A hit in effectTypes.ts/registry.ts would only be a comment mentioning register(); those are filtered by requiring a call on an identifier below.
  const real = offenders.filter((p) => /[A-Za-z_)\]]\.register\(/.test(readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  assert.deepEqual(real, [], 'new tool-registration site: classify it and extend this guard deliberately');
});

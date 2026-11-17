import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  snapshotPersistableState,
  restorePersistableState,
  resetPersistableState,
} from './storage.mjs';

/* ==========================================================================
   Core slice 4 / candidate C1 — registry-parameter snapshot / restore / reset.

   These functions iterate a { get, set, default } registry that is passed in
   EXPLICITLY. The registry (PERSISTABLE_STATE) and the 16 variables it wraps
   still live in the classic script (ADR-003, unchanged), so every test below
   builds its own registry over a private state object — nothing here touches
   the monolith's variables.

   Three kinds of evidence:
     1. behavior tests against synthetic registries (incl. the fresh-default
        and mutation/aliasing contracts),
     2. a DIFFERENTIAL test against the ORIGINAL implementation, embedded
        verbatim from git HEAD 9c95fbd (the pre-extraction text), comparing
        results AND the exact sequence of get/set/default calls,
     3. a run against the REAL registry text, read from the monolith at test
        time (16 keys, fresh defaults) — read-only, nothing is moved.
   ========================================================================== */

// ---- the ORIGINAL implementation, verbatim from HEAD 9c95fbd (L4953-4966) ----
// It closes over a free identifier `PERSISTABLE_STATE`; we supply it as a
// parameter of the wrapper Function so the very same text can run here.
const ORIGINAL_SOURCE = `function snapshotPersistableState(){
  const snap = {};
  for(const key in PERSISTABLE_STATE) snap[key] = PERSISTABLE_STATE[key].get();
  return snap;
}
function restorePersistableState(decrypted){
  for(const key in PERSISTABLE_STATE){
    const entry = PERSISTABLE_STATE[key];
    entry.set(decrypted && decrypted[key] !== undefined ? decrypted[key] : entry.default());
  }
}
function resetPersistableState(){
  for(const key in PERSISTABLE_STATE) PERSISTABLE_STATE[key].set(PERSISTABLE_STATE[key].default());
}
`;
function makeOriginal(registry) {
  return new Function(
    'PERSISTABLE_STATE',
    ORIGINAL_SOURCE + '\nreturn { snapshotPersistableState, restorePersistableState, resetPersistableState };'
  )(registry);
}

// ---- synthetic registry builder: private state + an operation trace --------
// defs: { key: { init, def } }  (def = the default() factory)
function build(defs) {
  const state = {};
  const trace = [];
  const registry = {};
  for (const key of Object.keys(defs)) {
    state[key] = defs[key].init;
    registry[key] = {
      get: () => { trace.push('get:' + key); return state[key]; },
      set: (v) => { trace.push('set:' + key); state[key] = v; },
      default: () => { trace.push('default:' + key); return defs[key].def(); },
    };
  }
  return { registry, state, trace };
}
const DEFS = () => ({
  messages: { init: [{ role: 'user' }], def: () => [] },
  selectedAgentIds: { init: ['a', 'b'], def: () => ['general'] },
  activeGroupId: { init: 'g1', def: () => null },
  settingsLike: { init: { n: 5 }, def: () => ({ n: 0, nested: { x: [] } }) },
  briefingLastSeenAt: { init: '2020-01-01', def: () => null },
});

describe('snapshotPersistableState(registry)', () => {
  it('returns one entry per registry key, in registry order, with the get() values', () => {
    const { registry, state } = build(DEFS());
    const snap = snapshotPersistableState(registry);
    expect(Object.keys(snap)).toEqual(Object.keys(registry));
    for (const k of Object.keys(registry)) expect(snap[k]).toBe(state[k]);
  });
  it('calls get() exactly once per key and never set()/default()', () => {
    const { registry, trace } = build(DEFS());
    snapshotPersistableState(registry);
    expect(trace).toEqual(Object.keys(registry).map((k) => 'get:' + k));
  });
  it('returns a NEW top-level object on every call (mutating a snapshot never changes state)', () => {
    const { registry, state } = build(DEFS());
    const a = snapshotPersistableState(registry);
    const b = snapshotPersistableState(registry);
    expect(a).not.toBe(b);
    const before = JSON.stringify(state);
    delete a.messages;
    a.selectedAgentIds = ['mutated'];
    a.extra = 1;
    expect(JSON.stringify(state)).toBe(before);
    expect(Object.keys(snapshotPersistableState(registry))).toEqual(Object.keys(registry));
  });
  it('CHARACTERIZATION (existing behavior, preserved byte-for-byte, not a new guarantee): values are live references, the snapshot is shallow', () => {
    const { registry, state } = build(DEFS());
    const snap = snapshotPersistableState(registry);
    expect(snap.messages).toBe(state.messages);
    snap.messages.push({ role: 'assistant' });
    expect(state.messages).toHaveLength(2);
  });
  it('does not write to the registry or its entries (a deeply frozen registry works)', () => {
    const { registry } = build(DEFS());
    for (const k of Object.keys(registry)) Object.freeze(registry[k]);
    Object.freeze(registry);
    expect(() => snapshotPersistableState(registry)).not.toThrow();
  });
  it('an empty registry gives an empty snapshot', () => {
    expect(snapshotPersistableState({})).toEqual({});
  });
});

describe('restorePersistableState(registry, decrypted)', () => {
  it('restores every present key to the exact decrypted value (by reference)', () => {
    const { registry, state } = build(DEFS());
    const dec = { messages: [{ role: 'x' }], selectedAgentIds: ['z'], activeGroupId: 'g9', settingsLike: { n: 9 }, briefingLastSeenAt: '2030-01-01' };
    restorePersistableState(registry, dec);
    for (const k of Object.keys(dec)) expect(state[k]).toBe(dec[k]);
  });
  it('a MISSING key is restored to a FRESH default (not left at its current value)', () => {
    const { registry, state } = build(DEFS());
    restorePersistableState(registry, { messages: [{ role: 'only' }] });
    expect(state.messages).toEqual([{ role: 'only' }]);
    expect(state.selectedAgentIds).toEqual(['general']);
    expect(state.activeGroupId).toBeNull();
    expect(state.settingsLike).toEqual({ n: 0, nested: { x: [] } });
    expect(state.briefingLastSeenAt).toBeNull();
  });
  it('missing keys get a NEW, independent default object on every restore (no shared/mutable default)', () => {
    const { registry, state } = build(DEFS());
    restorePersistableState(registry, {});
    const first = { ids: state.selectedAgentIds, cfg: state.settingsLike, msgs: state.messages };
    restorePersistableState(registry, {});
    expect(state.selectedAgentIds).not.toBe(first.ids);
    expect(state.settingsLike).not.toBe(first.cfg);
    expect(state.settingsLike.nested).not.toBe(first.cfg.nested);
    expect(state.messages).not.toBe(first.msgs);
    // mutate the restored defaults -> neither the old nor the next default is affected
    state.selectedAgentIds.push('polluted');
    state.settingsLike.nested.x.push(1);
    state.messages.push('polluted');
    restorePersistableState(registry, {});
    expect(state.selectedAgentIds).toEqual(['general']);
    expect(state.settingsLike).toEqual({ n: 0, nested: { x: [] } });
    expect(state.messages).toEqual([]);
    expect(registry.selectedAgentIds.default()).toEqual(['general']);
  });
  it('two keys with structurally equal defaults still get distinct objects', () => {
    const { registry, state } = build({ a: { init: 1, def: () => [] }, b: { init: 1, def: () => [] } });
    restorePersistableState(registry, {});
    expect(state.a).toEqual([]);
    expect(state.b).toEqual([]);
    expect(state.a).not.toBe(state.b);
    state.a.push(1);
    expect(state.b).toEqual([]);
  });
  it('calls default() only for absent keys, set() exactly once per key, never get()', () => {
    const { registry, trace } = build(DEFS());
    restorePersistableState(registry, { messages: [], activeGroupId: 'g' });
    expect(trace.filter((t) => t.startsWith('get:'))).toEqual([]);
    expect(trace.filter((t) => t.startsWith('set:'))).toEqual(Object.keys(registry).map((k) => 'set:' + k));
    expect(trace.filter((t) => t.startsWith('default:'))).toEqual(
      ['selectedAgentIds', 'settingsLike', 'briefingLastSeenAt'].map((k) => 'default:' + k)
    );
  });
  it('only `undefined` triggers the default: null, 0, "", false and [] are real stored values and are kept', () => {
    const { registry, state } = build({
      a: { init: 'i', def: () => 'D' }, b: { init: 'i', def: () => 'D' }, c: { init: 'i', def: () => 'D' },
      d: { init: 'i', def: () => 'D' }, e: { init: 'i', def: () => 'D' }, f: { init: 'i', def: () => 'D' },
    });
    restorePersistableState(registry, { a: null, b: 0, c: '', d: false, e: [], f: undefined });
    expect(state.a).toBeNull();
    expect(state.b).toBe(0);
    expect(state.c).toBe('');
    expect(state.d).toBe(false);
    expect(state.e).toEqual([]);
    expect(state.f).toBe('D');
  });
  it.each([[null], [undefined], [0], [''], [false], ['a string'], [42]])(
    'decrypted=%j (null/undefined/non-object) => every key falls back to its default', (dec) => {
      const { registry, state } = build(DEFS());
      restorePersistableState(registry, dec);
      expect(state.messages).toEqual([]);
      expect(state.selectedAgentIds).toEqual(['general']);
      expect(state.activeGroupId).toBeNull();
      expect(state.briefingLastSeenAt).toBeNull();
    });
  it('keys in decrypted that are not in the registry are ignored (never added to state or registry)', () => {
    const { registry, state } = build(DEFS());
    restorePersistableState(registry, { messages: [], rogue: 'x' });
    expect('rogue' in state).toBe(false);
    expect('rogue' in registry).toBe(false);
  });
  it('does not mutate the decrypted input object (key set and top-level values unchanged)', () => {
    const { registry } = build(DEFS());
    const dec = { messages: [1], activeGroupId: 'g' };
    const keysBefore = Object.keys(dec).join(',');
    const valsBefore = JSON.stringify(dec);
    restorePersistableState(registry, dec);
    expect(Object.keys(dec).join(',')).toBe(keysBefore);
    expect(JSON.stringify(dec)).toBe(valsBefore);
    const frozen = Object.freeze({ messages: Object.freeze([1]) });
    expect(() => restorePersistableState(registry, frozen)).not.toThrow();
  });
  it('CHARACTERIZATION (existing behavior, preserved): restored values are assigned by reference, so state aliases the decrypted object\'s values', () => {
    const { registry, state } = build(DEFS());
    const dec = { messages: [{ role: 'x' }] };
    restorePersistableState(registry, dec);
    expect(state.messages).toBe(dec.messages);
  });
  it('does not write to the registry entries (a deeply frozen registry works)', () => {
    const { registry } = build(DEFS());
    for (const k of Object.keys(registry)) Object.freeze(registry[k]);
    Object.freeze(registry);
    expect(() => restorePersistableState(registry, { messages: [] })).not.toThrow();
  });
});

describe('resetPersistableState(registry)', () => {
  it('sets every key to its default()', () => {
    const { registry, state } = build(DEFS());
    resetPersistableState(registry);
    expect(state).toEqual({
      messages: [], selectedAgentIds: ['general'], activeGroupId: null,
      settingsLike: { n: 0, nested: { x: [] } }, briefingLastSeenAt: null,
    });
  });
  it('calls default() then set() once per key (in registry order) and never get()', () => {
    const { registry, trace } = build(DEFS());
    resetPersistableState(registry);
    const expected = [];
    for (const k of Object.keys(registry)) expected.push('default:' + k, 'set:' + k);
    expect(trace).toEqual(expected);
  });
  it('each reset installs NEW default objects (fresh every time, independent of earlier ones)', () => {
    const { registry, state } = build(DEFS());
    resetPersistableState(registry);
    const a = state.settingsLike;
    resetPersistableState(registry);
    expect(state.settingsLike).not.toBe(a);
    a.nested.x.push('polluted');
    state.messages.push('polluted');
    resetPersistableState(registry);
    expect(state.settingsLike.nested.x).toEqual([]);
    expect(state.messages).toEqual([]);
  });
  it('rebinds rather than clearing in place: a previously held array keeps its contents', () => {
    const { registry, state } = build(DEFS());
    const held = state.messages;
    resetPersistableState(registry);
    expect(state.messages).not.toBe(held);
    expect(held).toEqual([{ role: 'user' }]);
  });
  it('does not write to the registry entries (a deeply frozen registry works)', () => {
    const { registry } = build(DEFS());
    for (const k of Object.keys(registry)) Object.freeze(registry[k]);
    Object.freeze(registry);
    expect(() => resetPersistableState(registry)).not.toThrow();
  });
});

describe('round trips', () => {
  it('snapshot -> mutate state -> restore(snapshot) returns the original values', () => {
    const { registry, state } = build(DEFS());
    const original = JSON.stringify(state);
    const snap = JSON.parse(JSON.stringify(snapshotPersistableState(registry))); // as after encrypt/decrypt
    resetPersistableState(registry);
    expect(JSON.stringify(state)).not.toBe(original);
    restorePersistableState(registry, snap);
    expect(JSON.stringify(state)).toBe(original);
  });
  it('snapshot after reset equals the defaults (and JSON drops nothing for these shapes)', () => {
    const { registry } = build(DEFS());
    resetPersistableState(registry);
    expect(JSON.parse(JSON.stringify(snapshotPersistableState(registry)))).toEqual({
      messages: [], selectedAgentIds: ['general'], activeGroupId: null,
      settingsLike: { n: 0, nested: { x: [] } }, briefingLastSeenAt: null,
    });
  });
});

// ---- differential test against the ORIGINAL implementation -----------------
function prng(seed) { // small deterministic generator (mulberry32)
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomValue(rnd) {
  const pick = Math.floor(rnd() * 9);
  return [undefined, null, 0, '', false, [], 'str', { k: 1 }, [1, 2, 3]][pick];
}
describe('differential: extracted functions vs the ORIGINAL implementation (HEAD 9c95fbd text)', () => {
  it('200 random scenarios: identical resulting state AND identical get/set/default call sequence', () => {
    const rnd = prng(0xC0DE);
    for (let i = 0; i < 200; i++) {
      const a = build(DEFS());
      const b = build(DEFS());
      const orig = makeOriginal(a.registry);
      const dec = {};
      for (const k of [...Object.keys(a.registry), 'rogue']) {
        if (rnd() < 0.7) dec[k] = randomValue(rnd);
      }
      const decArg = rnd() < 0.1 ? [null, undefined, 0, '', 'x'][Math.floor(rnd() * 5)] : dec;
      const snapO = orig.snapshotPersistableState();
      const snapN = snapshotPersistableState(b.registry);
      expect(snapN).toEqual(snapO);
      orig.restorePersistableState(decArg);
      restorePersistableState(b.registry, decArg);
      expect(b.state).toEqual(a.state);
      if (rnd() < 0.5) { orig.resetPersistableState(); resetPersistableState(b.registry); expect(b.state).toEqual(a.state); }
      expect(b.trace).toEqual(a.trace);
    }
  });
  it('the embedded ORIGINAL is real code (sanity: it is not the extracted function)', () => {
    const { registry } = build(DEFS());
    const orig = makeOriginal(registry);
    expect(orig.snapshotPersistableState).not.toBe(snapshotPersistableState);
    expect(orig.snapshotPersistableState.length).toBe(0);
    expect(orig.restorePersistableState.length).toBe(1);
    expect(snapshotPersistableState.length).toBe(1);
    expect(restorePersistableState.length).toBe(2);
    expect(resetPersistableState.length).toBe(1);
  });
});

// ---- the REAL registry text, read (never moved) from the monolith -----------
const REAL_KEYS = [
  'messages', 'selectedAgentIds', 'knowledgeBase', 'activityLog', 'customAgents', 'longTermMemory', 'workflows',
  'agentOrder', 'usageLog', 'errorLog', 'activeGroupId', 'uploadedDocs', 'projects', 'decisionJournal',
  'topicMonitors', 'briefingLastSeenAt',
];
function loadRealRegistry() {
  // 2026-11-17: the monolith's inline <script> body now lives in app.js (CSP slice) — same text, new file.
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app.js'), 'utf8');
  const m = html.match(/const PERSISTABLE_STATE = \{[\s\S]*?\n\};/);
  if (!m) throw new Error('real PERSISTABLE_STATE block not found in the monolith');
  // The registry closes over 16 variables; declare them here so the REAL
  // registry text can run. Initial values are irrelevant (we only observe
  // defaults and the set/get plumbing).
  const decl = 'let ' + REAL_KEYS.map((k) => k + ' = "INIT"').join(', ') + ';';
  return new Function(decl + '\n' + m[0] + '\nreturn PERSISTABLE_STATE;')();
}
describe('against the REAL registry text (read-only from the monolith)', () => {
  it('has exactly the 16 expected keys', () => {
    const reg = loadRealRegistry();
    expect(Object.keys(reg).sort()).toEqual([...REAL_KEYS].sort());
  });
  it('every real default() returns a FRESH value on each call (no shared/mutable default)', () => {
    const reg = loadRealRegistry();
    for (const k of REAL_KEYS) {
      const d1 = reg[k].default();
      const d2 = reg[k].default();
      if (d1 !== null && typeof d1 === 'object') expect(d1, k).not.toBe(d2);
      expect(d1, k).toEqual(d2);
    }
  });
  it('restore with a decrypted blob that lacks keys => defaults for the missing ones, kept values for the present', () => {
    const reg = loadRealRegistry();
    restorePersistableState(reg, { messages: [{ role: 'user', content: 'kept' }], workflows: [{ id: 'w' }] });
    expect(reg.messages.get()).toEqual([{ role: 'user', content: 'kept' }]);
    expect(reg.workflows.get()).toEqual([{ id: 'w' }]);
    expect(reg.selectedAgentIds.get()).toEqual(['general']);
    expect(reg.activeGroupId.get()).toBeNull();
    expect(reg.briefingLastSeenAt.get()).toBeNull();
    for (const k of ['knowledgeBase', 'customAgents', 'agentOrder', 'usageLog', 'errorLog', 'uploadedDocs', 'projects', 'decisionJournal', 'topicMonitors', 'longTermMemory', 'activityLog']) {
      expect(reg[k].get(), k).toEqual([]);
    }
    // independence of the defaulted empties
    const kb = reg.knowledgeBase.get();
    kb.push('x');
    expect(reg.customAgents.get()).toEqual([]);
    expect(reg.agentOrder.get()).toEqual([]);
    expect(reg.knowledgeBase.default()).toEqual([]);
  });
  it('real snapshot -> reset -> restore(snapshot) round trip over all 16 keys', () => {
    const reg = loadRealRegistry();
    for (const k of REAL_KEYS) reg[k].set(k === 'activeGroupId' || k === 'briefingLastSeenAt' ? 'v-' + k : ['v-' + k]);
    const snap = snapshotPersistableState(reg);
    expect(Object.keys(snap)).toEqual(Object.keys(reg));
    const wire = JSON.parse(JSON.stringify(snap));
    resetPersistableState(reg);
    expect(reg.selectedAgentIds.get()).toEqual(['general']);
    expect(reg.activeGroupId.get()).toBeNull();
    restorePersistableState(reg, wire);
    for (const k of REAL_KEYS) expect(reg[k].get(), k).toEqual(wire[k]);
  });
});

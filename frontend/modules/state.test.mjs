import { describe, it, expect, vi, beforeEach } from 'vitest';

// Core slice 10 (CP-18 / ADR-005): modules/state.mjs owns `agentOrder`; installGlobalStateAccessors(target)
// exposes it as an accessor property. A fresh module instance per test (the binding is module-scope state).
let installGlobalStateAccessors;
beforeEach(async () => {
  vi.resetModules();
  ({ installGlobalStateAccessors } = await import('./state.mjs'));
});

describe('installGlobalStateAccessors — descriptor shape (AC-1)', () => {
  it('defines agentOrder as a configurable, non-enumerable accessor (get + set functions, no value)', () => {
    const t = {};
    installGlobalStateAccessors(t);
    const d = Object.getOwnPropertyDescriptor(t, 'agentOrder');
    expect(typeof d.get).toBe('function');
    expect(typeof d.set).toBe('function');
    expect(d.configurable).toBe(true);
    expect(d.enumerable).toBe(false);
    expect('value' in d).toBe(false);
  });

  it('defines ONLY agentOrder on the target (other names untouched)', () => {
    const t = { keep: 1 };
    installGlobalStateAccessors(t);
    expect(Object.getOwnPropertyNames(t).sort()).toEqual(['agentOrder', 'keep']);
    expect(Object.keys(t)).toEqual(['keep']); // non-enumerable: not in Object.keys
  });
});

describe('get/set semantics', () => {
  it('starts as an empty array', () => {
    const t = {};
    installGlobalStateAccessors(t);
    expect(t.agentOrder).toEqual([]);
  });

  it('set then get round-trips the same reference (rebind semantics)', () => {
    const t = {};
    installGlobalStateAccessors(t);
    const a = ['b', 'a'];
    t.agentOrder = a;
    expect(t.agentOrder).toBe(a);
    const b = ['c'];
    t.agentOrder = b;
    expect(t.agentOrder).toBe(b);
    expect(t.agentOrder).not.toBe(a);
  });

  it('in-place mutation of the returned array is visible on the next get (live reference)', () => {
    const t = {};
    installGlobalStateAccessors(t);
    t.agentOrder.push('x');
    expect(t.agentOrder).toEqual(['x']);
    expect(t.agentOrder).toBe(t.agentOrder);
  });

  it('get returns the same array across calls until it is rebound (not a fresh [] each time)', () => {
    const t = {};
    installGlobalStateAccessors(t);
    expect(t.agentOrder).toBe(t.agentOrder);
  });
});

describe('idempotence and ownership', () => {
  it('a second install keeps the value (the private binding is not reset)', () => {
    const t = {};
    installGlobalStateAccessors(t);
    t.agentOrder = ['k'];
    installGlobalStateAccessors(t);
    expect(t.agentOrder).toEqual(['k']);
  });

  it('two targets installed from the same module instance share one owned value', () => {
    const t1 = {}, t2 = {};
    installGlobalStateAccessors(t1);
    installGlobalStateAccessors(t2);
    t1.agentOrder = ['shared'];
    expect(t2.agentOrder).toEqual(['shared']);
  });

  it('a fresh module instance starts with a fresh independent []', async () => {
    const t1 = {};
    installGlobalStateAccessors(t1);
    t1.agentOrder = ['dirty'];
    vi.resetModules();
    const { installGlobalStateAccessors: inst2 } = await import('./state.mjs');
    const t2 = {};
    inst2(t2);
    expect(t2.agentOrder).toEqual([]);
    expect(t1.agentOrder).toEqual(['dirty']);
  });

  it('deleting the accessor removes the property (configurable:true) and does not clear the owned value', () => {
    const t = {};
    installGlobalStateAccessors(t);
    t.agentOrder = ['v'];
    expect(delete t.agentOrder).toBe(true);
    expect('agentOrder' in t).toBe(false);
    installGlobalStateAccessors(t);
    expect(t.agentOrder).toEqual(['v']);
  });
});

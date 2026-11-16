import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { localStore, ExecutionCheckpoint, ImageStore, MessageArchive } from './storage.mjs';

// IMPORTANT: window.storage only exists inside Claude's own artifact-
// preview environment — it is undefined in Aiham's actual deployed app.
// The branch that matters for production is the raw IndexedDB path, so
// these tests exercise that path (via fake-indexeddb, a standard,
// widely-used real-IndexedDB implementation for Node) by default, and
// separately verify the window.storage branch exists and is chosen
// correctly when present.
beforeEach(() => {
  delete window.storage;
});

describe('localStore (real IndexedDB path, via fake-indexeddb)', () => {
  it('set() then get() round-trips a value', async () => {
    await localStore.set('k1', 'hello');
    const res = await localStore.get('k1');
    expect(res.value).toBe('hello');
  });
  it('get() on a missing key rejects (matches the pre-extraction contract other code relies on via try/catch)', async () => {
    await expect(localStore.get('__never_set__')).rejects.toThrow();
  });
  it('delete() removes a key', async () => {
    await localStore.set('k2', 'x');
    await localStore.delete('k2');
    await expect(localStore.get('k2')).rejects.toThrow();
  });
  it('delete() on a missing key does not throw (non-critical by design)', async () => {
    await expect(localStore.delete('__never_set_either__')).resolves.not.toThrow();
  });
  it('listKeys(prefix) returns only matching keys', async () => {
    await localStore.set('nexus_img_a', '1');
    await localStore.set('nexus_img_b', '2');
    await localStore.set('other_key', '3');
    const keys = await localStore.listKeys('nexus_img_');
    expect(keys.sort()).toEqual(['nexus_img_a', 'nexus_img_b']);
  });
  it('set() overwrites an existing key', async () => {
    await localStore.set('k3', 'first');
    await localStore.set('k3', 'second');
    const res = await localStore.get('k3');
    expect(res.value).toBe('second');
  });
});

describe('localStore (window.storage path — the Claude-preview branch)', () => {
  beforeEach(() => {
    window.storage = {
      get: vi.fn(async (key) => ({ key, value: 'from-window-storage' })),
      set: vi.fn(async (key, value) => ({ key, value })),
      delete: vi.fn(async () => ({ deleted: true })),
      list: vi.fn(async (prefix) => ({ keys: ['a', 'b'], prefix })),
    };
  });
  it('get() delegates to window.storage.get when present', async () => {
    const res = await localStore.get('anykey');
    expect(res.value).toBe('from-window-storage');
    expect(window.storage.get).toHaveBeenCalledWith('anykey', false);
  });
  it('set() delegates to window.storage.set when present', async () => {
    await localStore.set('k', 'v');
    expect(window.storage.set).toHaveBeenCalledWith('k', 'v', false);
  });
  it('listKeys() delegates to window.storage.list when present', async () => {
    const keys = await localStore.listKeys('pfx_');
    expect(keys).toEqual(['a', 'b']);
    expect(window.storage.list).toHaveBeenCalledWith('pfx_', false);
  });
  it('delete() delegates to window.storage.delete when present', async () => {
    await localStore.delete('k');
    expect(window.storage.delete).toHaveBeenCalledWith('k', false);
  });
});

describe('ExecutionCheckpoint', () => {
  beforeEach(async () => { await ExecutionCheckpoint.clear(); });

  it('save() then load() round-trips the full record shape', async () => {
    await ExecutionCheckpoint.save('task1', 'planning', { partial: true }, { label: 'test task' });
    const loaded = await ExecutionCheckpoint.load();
    expect(loaded.taskId).toBe('task1');
    expect(loaded.phase).toBe('planning');
    expect(loaded.results).toEqual({ partial: true });
    expect(loaded.meta.label).toBe('test task');
    expect(typeof loaded.ts).toBe('number');
  });
  it('peek() returns the in-memory copy without a round-trip, matching the just-saved taskId', async () => {
    await ExecutionCheckpoint.save('task2', 'running', {}, {});
    expect(ExecutionCheckpoint.peek('task2')).not.toBeNull();
    expect(ExecutionCheckpoint.peek('other-task')).toBeNull();
  });
  it('clear() removes both the in-memory and persisted copy', async () => {
    await ExecutionCheckpoint.save('task3', 'x', {}, {});
    await ExecutionCheckpoint.clear();
    expect(ExecutionCheckpoint.peek('task3')).toBeNull();
    expect(await ExecutionCheckpoint.load()).toBeNull();
  });
  it('checkForResumable() shows a toast for a recent checkpoint', async () => {
    globalThis.showToast = vi.fn();
    await ExecutionCheckpoint.save('task4', 'phaseX', {}, { label: 'Recent Task' });
    await ExecutionCheckpoint.checkForResumable();
    expect(globalThis.showToast).toHaveBeenCalledTimes(1);
    expect(globalThis.showToast.mock.calls[0][0]).toContain('Recent Task');
  });
  it('checkForResumable() silently clears (no toast) a checkpoint older than 30 minutes', async () => {
    globalThis.showToast = vi.fn();
    await ExecutionCheckpoint.save('task5', 'phaseY', {}, {});
    // Simulate age by rewriting the persisted record directly.
    const stale = { taskId: 'task5', phase: 'phaseY', results: {}, meta: {}, ts: Date.now() - 31 * 60000 };
    await localStore.set('nexus_checkpoint', JSON.stringify(stale));
    ExecutionCheckpoint._mem = stale; // keep the in-memory mirror consistent with the persisted rewrite
    await ExecutionCheckpoint.checkForResumable();
    expect(globalThis.showToast).not.toHaveBeenCalled();
    expect(await ExecutionCheckpoint.load()).toBeNull();
  });
  it('checkForResumable() never throws even if showToast is missing (matches its own try/catch)', async () => {
    delete globalThis.showToast;
    await ExecutionCheckpoint.save('task6', 'z', {}, {});
    await expect(ExecutionCheckpoint.checkForResumable()).resolves.not.toThrow();
  });
});

describe('ImageStore', () => {
  beforeEach(async () => { await ImageStore.gcAll(); });

  it('save() then load() round-trips the exact base64 payload', async () => {
    const id = await ImageStore.save('aGVsbG8=');
    const loaded = await ImageStore.load(id);
    expect(loaded).toBe('aGVsbG8=');
  });
  it('save() returns null for empty input, does not create an entry', async () => {
    const id = await ImageStore.save('');
    expect(id).toBeNull();
  });
  it('getCached() returns the value synchronously right after save() (no round-trip needed for a same-session image)', async () => {
    const id = await ImageStore.save('cached-data');
    expect(ImageStore.getCached(id)).toBe('cached-data');
  });
  it('load() falls back to the store and populates the cache when not already cached', async () => {
    const id = await ImageStore.save('data-x');
    ImageStore._cache.delete(id); // simulate a fresh session where the cache is empty
    expect(ImageStore.getCached(id)).toBeNull();
    const loaded = await ImageStore.load(id);
    expect(loaded).toBe('data-x');
    expect(ImageStore.getCached(id)).toBe('data-x'); // now populated
  });
  it('gcAll() removes every stored image and clears the cache', async () => {
    const id1 = await ImageStore.save('img1');
    const id2 = await ImageStore.save('img2');
    await ImageStore.gcAll();
    expect(await ImageStore.load(id1)).toBeNull();
    expect(await ImageStore.load(id2)).toBeNull();
    expect(ImageStore.getCached(id1)).toBeNull();
  });
  it('load() on an unknown id returns null rather than throwing', async () => {
    await expect(ImageStore.load('img_never_existed')).resolves.toBeNull();
  });
});

describe('MessageArchive', () => {
  beforeEach(async () => { await MessageArchive.clear(); });

  it('appendBatch() then loadAll() round-trips messages', async () => {
    await MessageArchive.appendBatch([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
    const all = await MessageArchive.loadAll();
    expect(all).toHaveLength(2);
    expect(all[0].content).toBe('a');
  });
  it('appendBatch() called multiple times accumulates, never overwrites (this is what "archive" means as opposed to "prune")', async () => {
    await MessageArchive.appendBatch([{ content: 'first' }]);
    await MessageArchive.appendBatch([{ content: 'second' }]);
    const all = await MessageArchive.loadAll();
    expect(all.map((m) => m.content)).toEqual(['first', 'second']);
  });
  it('appendBatch() with an empty array is a no-op', async () => {
    await MessageArchive.appendBatch([]);
    expect(await MessageArchive.loadAll()).toEqual([]);
  });
  it('loadAll() returns an empty array when nothing has been archived yet', async () => {
    expect(await MessageArchive.loadAll()).toEqual([]);
  });
  it('clear() empties the archive', async () => {
    await MessageArchive.appendBatch([{ content: 'x' }]);
    await MessageArchive.clear();
    expect(await MessageArchive.loadAll()).toEqual([]);
  });
});

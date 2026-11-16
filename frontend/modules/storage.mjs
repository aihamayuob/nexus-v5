/* ==========================================================================
   modules/storage.mjs — Neural Nexus AI Agents

   Phase 2 (/nexus-modularize), extraction boundary #2: "storage".
   Behavior-preserving MOVE — every body below is byte-identical to its
   prior inline definition (diff-verified, see PHASE2-MODULARIZE.md).

   Contains the storage PRIMITIVES only: the raw key-value abstraction
   (localStore) and the three separately-keyed stores built on top of it
   (ExecutionCheckpoint, ImageStore, MessageArchive). PERSISTABLE_STATE
   itself is deliberately NOT here — it closes over ~16 mutable top-level
   variables scattered across the not-yet-extracted remainder of the app
   (messages, customAgents, workflows, knowledgeBase, ...); moving it here
   without also moving what it wraps would require passing those bindings
   across the module boundary by reference, which ES modules don't support
   the way one shared classic-script scope does. That extraction is
   deferred to a later boundary (see PHASE2-MODULARIZE.md's roadmap) once
   the state it wraps has a home. See ADR/003-phase2-storage-boundary.md.

   Depends on two globals that remain in the not-yet-extracted monolith —
   `showToast` (ExecutionCheckpoint.checkForResumable) and `autoInitApp`
   (mentioned only in a comment, not called from here) — both stay
   reachable via window exactly as escapeHtml/jsStr/etc. were designed to
   in boundary #1, since they're still plain function declarations in
   that classic script.
   ========================================================================== */

export const localStore = (function(){
  const DB_NAME = 'nexus_agents_db';
  const STORE_NAME = 'kv';
  let dbPromise = null;

  function openDB(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if(!window.indexedDB){ reject(new Error('IndexedDB غير مدعوم بهذا المتصفح')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  return {
    async get(key){
      if(window.storage){
        const res = await window.storage.get(key, false);
        if(!res) throw new Error('key not found');
        return res;
      }
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => {
          if(req.result === undefined){ reject(new Error('key not found')); return; }
          resolve({ key, value: req.result });
        };
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value){
      if(window.storage){
        const res = await window.storage.set(key, value, false);
        if(!res) throw new Error('storage.set returned null');
        return res;
      }
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve({ key, value });
        tx.onerror = () => reject(tx.error);
      });
    },
    async delete(key){
      if(window.storage){
        try{ await window.storage.delete?.(key, false); }catch(e){ /* not critical */ }
        return;
      }
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    // Added (Phase 1 /nexus-security, "image garbage collection"): needed
    // so ImageStore.gcAll() can find every per-image key it ever created
    // without maintaining a separate id registry. Same dual-backend
    // contract as get/set/delete above — window.storage already exposes
    // list() natively; the real-IndexedDB path uses getAllKeys().
    async listKeys(prefix){
      if(window.storage){
        const res = await window.storage.list(prefix, false);
        return res ? res.keys : [];
      }
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = () => resolve(req.result.filter(k => String(k).startsWith(prefix)));
        req.onerror = () => reject(req.error);
      });
    }
  };
})();

export const ExecutionCheckpoint = {
  _KEY: 'nexus_checkpoint',
  _mem: null, // in-memory mirror so peek() during the SAME session never depends on a round-trip
  async save(taskId, phase, resultsSoFar, meta={}){
    const record = { taskId, phase, results: resultsSoFar, meta, ts: Date.now() };
    this._mem = record;
    try{ await localStore.set(this._KEY, JSON.stringify(record)); }
    catch(e){ console.error('Checkpoint save failed (non-fatal):', e.message); }
  },
  peek(taskId){
    if(this._mem && (!taskId || this._mem.taskId === taskId)) return this._mem;
    return null;
  },
  async load(){
    try{ const res = await localStore.get(this._KEY); return JSON.parse(res.value); }
    catch(e){ return null; }
  },
  async clear(){
    this._mem = null;
    try{ await localStore.delete(this._KEY); }catch(e){ /* non-critical */ }
  },
  // Called once at startup (see autoInitApp below). Purely informational —
  // never auto-resumes silently, since a stale checkpoint from an
  // abandoned task shouldn't reappear as if nothing happened. A clearly
  // recent, incomplete checkpoint (under 30 min old) surfaces as a toast;
  // anything older is treated as stale and just cleared.
  async checkForResumable(){
    try{
      const cp = await this.load();
      if(!cp) return;
      const ageMin = (Date.now() - cp.ts) / 60000;
      if(ageMin > 30){ await this.clear(); return; }
      showToast('⏸️ توجد مهمة "'+ (cp.meta?.label||cp.taskId) +'" متوقفة عند مرحلة "'+cp.phase+'" — أرسل رسالتك التالية بشكل طبيعي لبدء مهمة جديدة (لن تُستأنف تلقائياً لتفادي الخلط).', 6000);
    }catch(e){ /* non-fatal — resumability is a convenience, never a startup blocker */ }
  },
};

// ---- ImageStore: attached-image blobs, kept OUT of the main encrypted
// PERSISTABLE_STATE blob (Phase 1 /nexus-security — "image separation in
// IndexedDB" + "image garbage collection"). Before this fix, sendMessage()
// embedded the full base64 payload of every attached image directly on
// the message object, so every image ever sent stayed inside the one
// blob that gets decrypted on every app load, forever, with no cap.
// Same separately-keyed-via-localStore pattern as ExecutionCheckpoint
// above, for the same reason: this is real user data (unlike a
// checkpoint) but it doesn't need to ride inside the same
// encrypt/decrypt-on-every-load contract as the rest of PERSISTABLE_STATE.
// Messages now carry only an `imageRef` id; renderMessages() resolves it
// through this store (with an in-memory cache so a just-sent image in the
// current session never needs a round-trip).
export const ImageStore = {
  _PREFIX: 'nexus_img_',
  _cache: new Map(), // imageRef -> base64, populated on save() and on first load()
  async save(base64){
    if(!base64) return null;
    const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    this._cache.set(id, base64);
    try{ await localStore.set(this._PREFIX + id, base64); }
    catch(e){ console.error('ImageStore.save failed (non-fatal):', e.message); }
    return id;
  },
  getCached(id){ return id ? this._cache.get(id) || null : null; },
  async load(id){
    if(!id) return null;
    if(this._cache.has(id)) return this._cache.get(id);
    try{
      const res = await localStore.get(this._PREFIX + id);
      this._cache.set(id, res.value);
      return res.value;
    }catch(e){ return null; }
  },
  // Called only from resetAllData() — a full wipe must not leave orphaned
  // image blobs behind (the cap/archive path deliberately keeps images
  // alive alongside their archived messages, so it never calls this).
  async gcAll(){
    this._cache.clear();
    try{
      const keys = await localStore.listKeys(this._PREFIX);
      await Promise.all(keys.map(k => localStore.delete(k)));
    }catch(e){ console.error('ImageStore.gcAll failed (non-fatal):', e.message); }
  },
};

// ---- MessageArchive: overflow past MESSAGE_CAP (Phase 1 /nexus-security
// — "message cap + archive"). Same separately-keyed-via-localStore
// pattern as ExecutionCheckpoint/ImageStore above — archived messages are
// real history (so, unlike a checkpoint, never silently discarded) but
// don't need to be part of the blob decrypted on every single app load.
// Not currently surfaced in any "load older messages" UI — out of scope
// for this security pass — but the data is preserved, never deleted,
// which is what "archive" means here as opposed to "prune".
export const MessageArchive = {
  _KEY: 'nexus_archived_messages',
  async appendBatch(oldMessages){
    if(!oldMessages || !oldMessages.length) return;
    let existing = [];
    try{ const res = await localStore.get(this._KEY); existing = JSON.parse(res.value); }
    catch(e){ /* no archive yet — that's fine */ }
    existing.push(...oldMessages);
    try{ await localStore.set(this._KEY, JSON.stringify(existing)); }
    catch(e){ console.error('MessageArchive.appendBatch failed (non-fatal):', e.message); }
  },
  async loadAll(){
    try{ const res = await localStore.get(this._KEY); return JSON.parse(res.value); }
    catch(e){ return []; }
  },
  async clear(){ try{ await localStore.delete(this._KEY); }catch(e){ /* non-critical */ } },
};

// ---- Persistable-state registry iteration (Phase 2 boundary "core", slice 4 / C1) -----------------
// The ONLY logic moved: the three functions that iterate a { get, set, default } registry. The registry
// itself (PERSISTABLE_STATE) and the 16 variables it wraps stay in the classic script — ADR-003 is
// unchanged, they cannot move without a state-ownership decision — and the registry is passed in
// EXPLICITLY, so nothing here names or reads a global. Bodies = the original text with `export` added,
// the free identifier PERSISTABLE_STATE replaced by the parameter `registry`, and that parameter added
// to each signature (proved mechanically: baseline/evidence/phase2-core-slice4-extract-script.mjs).
// Contract preserved from the original, NOT strengthened: snapshot is shallow (values are the live
// references); restore assigns decrypted values by reference; ONLY `undefined` triggers entry.default(),
// which is called per missing key so every restore/reset installs a fresh object.
export function snapshotPersistableState(registry){
  const snap = {};
  for(const key in registry) snap[key] = registry[key].get();
  return snap;
}
export function restorePersistableState(registry, decrypted){
  for(const key in registry){
    const entry = registry[key];
    entry.set(decrypted && decrypted[key] !== undefined ? decrypted[key] : entry.default());
  }
}
export function resetPersistableState(registry){
  for(const key in registry) registry[key].set(registry[key].default());
}

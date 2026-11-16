// Core slice 9 — behavior probe for the ownership PROTOTYPES of `agentOrder` (scratch copies only).
// It exercises the code paths that NO existing suite exercises for agentOrder: the read sites in
// getOrderedAgents(), the rebind in moveAgentOrder(), persist -> reload -> restore, and reset.
// It is run by phase2-core-slice9-ownership-prototypes.mjs against a scratch frontend dir
// (env S9_FRONTEND_DIR, required). It never touches the production tree.
//
// Check classes:  VALID = the probe can see the app at all;  BEHAVIOR = must hold for EVERY variant (control + prototypes);
//                 OBSERVED = recorded, not pass/fail (how the bare name behaves differs per mechanism — that is the finding).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FRONTEND_DIR = process.env.S9_FRONTEND_DIR;
if (!FRONTEND_DIR) { console.error('S9_FRONTEND_DIR is required'); process.exit(2); }
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const PORT = Number(process.env.S9_PORT || 8931);
const results = [];
const observed = {};
function log(cls, name, ok, detail) {
  results.push({ cls, name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${cls} ${name}${detail ? ' — ' + detail : ''}`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const urlPath = req.url === '/' ? HTML_FILE : decodeURIComponent(req.url.split('?')[0].slice(1));
    const filePath = path.join(FRONTEND_DIR, urlPath);
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch (e) { res.writeHead(404); res.end(String(e)); }
});
await new Promise((r) => server.listen(PORT, r));

const pageErrors = [];
let browser = null;
let page = null;
async function waitForInit() {
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  const inited = await waitForInit();
  log('VALID', 'page-load-and-init', inited && pageErrors.length === 0, `inited=${inited} pageErrors=${pageErrors.length}`);

  // initial: nothing explicit, order == all agents in natural order
  const init = await page.evaluate(() => {
    try {
      const all = getAllAgents().map((a) => a.id);
      const ord = getOrderedAgents().map((a) => a.id);
      return { ok: true, all, ord, regLen: PERSISTABLE_STATE.agentOrder.get().length, regIsArray: Array.isArray(PERSISTABLE_STATE.agentOrder.get()) };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  log('VALID', 'initial-order-readable', init.ok && init.all.length >= 3,
    init.ok ? `agents=${init.all.length}` : init.error);
  log('BEHAVIOR', 'initial-order-is-natural-and-registry-empty',
    init.ok && JSON.stringify(init.ord) === JSON.stringify(init.all) && init.regLen === 0 && init.regIsArray, init.ok ? `registryLen=${init.regLen}` : init.error);

  // OBSERVED: what does the bare name look like to classic code?
  observed.bare = await page.evaluate(() => {
    const out = {};
    try { out.typeofBare = typeof agentOrder; } catch (e) { out.typeofBare = 'THROWS:' + e.name; }
    try { out.readBare = Array.isArray(agentOrder) ? 'array(' + agentOrder.length + ')' : String(agentOrder); } catch (e) { out.readBare = 'THROWS:' + e.name; }
    out.inWindow = 'agentOrder' in window;
    const d = Object.getOwnPropertyDescriptor(window, 'agentOrder');
    out.windowDescriptor = d ? Object.keys(d).sort().join(',') : null;
    out.hasNexusState = typeof window.NexusState;
    return out;
  });
  console.log('[OBSERVED] bare-name view: ' + JSON.stringify(observed.bare));

  // BEHAVIOR: real UI function moveAgentOrder (read sites + the rebind site), swap first two agents
  const moved = await page.evaluate(async () => {
    try {
      const before = getOrderedAgents().map((a) => a.id);
      await moveAgentOrder(before[0], 1);
      const after = getOrderedAgents().map((a) => a.id);
      const reg = PERSISTABLE_STATE.agentOrder.get().slice();
      return { ok: true, before, after, reg, listHasRows: document.querySelectorAll('#reorderList .kb-item').length };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  const swapped = moved.ok && moved.after[0] === moved.before[1] && moved.after[1] === moved.before[0] &&
    JSON.stringify(moved.after.slice(2)) === JSON.stringify(moved.before.slice(2));
  log('BEHAVIOR', 'moveAgentOrder-swaps-first-two', swapped, moved.ok ? `first=${moved.before[0]}->${moved.after[1]}` : moved.error);
  log('BEHAVIOR', 'registry-sees-full-explicit-order',
    moved.ok && JSON.stringify(moved.reg) === JSON.stringify(moved.after), moved.ok ? `registryLen=${moved.reg.length}` : moved.error);

  // BEHAVIOR: persist -> reload -> restore through the real autoInitApp
  const expectedFirst = moved.ok ? moved.after[0] : null;
  await page.reload({ waitUntil: 'networkidle' });
  const inited2 = await waitForInit();
  let restored = false;
  try {
    await page.waitForFunction((id) => { try { return getOrderedAgents()[0].id === id; } catch { return false; } }, expectedFirst, { timeout: 15000 });
    restored = true;
  } catch { restored = false; }
  const after2 = await page.evaluate(() => { try { return getOrderedAgents().map((a) => a.id); } catch (e) { return ['ERR:' + e]; } });
  log('BEHAVIOR', 'order-survives-reload-via-autoInitApp', inited2 && restored && JSON.stringify(after2) === JSON.stringify(moved.after),
    `inited=${inited2} restored=${restored}`);

  // BEHAVIOR: reset installs the fresh default and the natural order returns
  const reset = await page.evaluate(() => {
    try {
      resetPersistableState();
      const all = getAllAgents().map((a) => a.id);
      const ord = getOrderedAgents().map((a) => a.id);
      return { ok: true, natural: JSON.stringify(all) === JSON.stringify(ord), regLen: PERSISTABLE_STATE.agentOrder.get().length };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  log('BEHAVIOR', 'reset-restores-default-and-natural-order', reset.ok && reset.natural && reset.regLen === 0, reset.ok ? `registryLen=${reset.regLen}` : reset.error);

  // OBSERVED: a stray BARE-NAME write from classic code (what an un-migrated call site would do)
  observed.bareWrite = await page.evaluate(() => {
    const out = {};
    try { agentOrder = ['stray-bare-write']; out.threw = false; } catch (e) { out.threw = e.name; }
    out.registrySees = JSON.stringify(PERSISTABLE_STATE.agentOrder.get());
    out.orderedFirst = (() => { try { return getOrderedAgents()[0].id; } catch (e) { return 'ERR'; } })();
    out.createdPlainGlobal = (() => { const d = Object.getOwnPropertyDescriptor(window, 'agentOrder'); return !!d && 'value' in d; })();
    return out;
  });
  console.log('[OBSERVED] stray bare-name write: ' + JSON.stringify(observed.bareWrite));

  log('VALID', 'no-page-errors', pageErrors.length === 0, `pageErrors=${JSON.stringify(pageErrors.slice(0, 3))}`);
} catch (e) {
  log('VALID', 'probe-crashed', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}

const pass = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).map((r) => r.name);
console.log(`\n=== SUMMARY ===\n${pass}/${results.length} checks passed`);
console.log('OBSERVED-JSON ' + JSON.stringify(observed));
if (failed.length) console.log('FAILED: ' + failed.join(','));
process.exit(pass === results.length ? 0 : 1);

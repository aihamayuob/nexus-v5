/* ==========================================================================
   e2e/phase2-core-slice8-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9 "core",
   TARGET SLICE 8: acceptance tests for the fix of the stuck `isSendingMessage` lock (CP-14).
   Criteria written first: baseline/evidence/phase2-core-slice8-acceptance-criteria.md

   Real HTML + real modules + real sendMessage / updateOnlineStatus / showToast / callClaude (no stubs of app
   logic). "Offline" = Chromium's network emulation (BrowserContext.setOffline). The page is served from
   https://nexus.test via context.route; every NON-origin request is aborted (nothing external is fetched), so an
   online send runs the real pipeline up to its failure ("Failed to fetch" -> error message -> finally).
   A test-side GATE can hold the first external request open to make the "send in flight" state deterministic.
   Faults before the old `try` are injected through the page (monkey-patch / DOM removal) and restored after each case.

   Check kinds (tag in the name, printed as [KIND])
     VALID  measurement validity / controls — must always be green, else verdict INVALID
     PRES   behavior that must be preserved — green PRE and POST
     PS     patch-specific — RED on the unfixed tree, GREEN after the fix
   Final line:  S8-VERDICT = ACCEPTED | REJECTED | INVALID  (+ per-kind counts). Exit 0 iff ACCEPTED.

   NEXUS_FRONTEND_DIR points the script at scratch copies (mutants / candidate fixes); NEXUS_S8_RESULTS overrides
   the results JSON (default baseline/evidence/phase2-core-slice8-results.json). Deterministic: no timings/timestamps.
   ========================================================================== */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_S8_RESULTS || path.resolve(HERE, '../baseline/evidence/phase2-core-slice8-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const ORIGIN = 'https://nexus.test';
const OFFLINE_TOAST_PREFIX = '🔌 لا يوجد اتصال بالإنترنت حالياً';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

const checks = [];
function rec(kind, name, ok, detail) {
  checks.push({ kind, name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`);
}
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const pres = (n, ok, d) => rec('PRES', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);
const pageErrors = [];
let browser = null;

/* ---------- scenario plumbing ---------- */
async function newScenario() {
  const ctx = await browser.newContext(); // fresh IndexedDB per scenario
  const ext = []; // every aborted NON-origin request
  const gate = { armed: false, held: 0, release: null, promise: null };
  gate.arm = () => { gate.armed = true; gate.held = 0; gate.promise = new Promise((r) => { gate.release = () => { gate.armed = false; r(); }; }); };
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) {
      ext.push(route.request().method() + ' ' + u.origin + u.pathname);
      if (gate.armed && gate.held === 0) { gate.held = 1; await gate.promise; } // hold ONLY the first request after arm()
      return route.abort();
    }
    const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
    try {
      const content = await readFile(path.join(FRONTEND_DIR, rel));
      await route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || 'application/octet-stream', body: content });
    } catch { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { ctx, page, ext, gate };
}
async function boot(page) {
  await page.goto(ORIGIN + '/', { waitUntil: 'load' });
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}
// bare-name reads of classic top-level `let`s from page.evaluate are allowed (slice 2 / 5 / 7 pattern)
const snap = (page) => page.evaluate(() => {
  try {
    const last = messages[messages.length - 1];
    return {
      onLine: navigator.onLine, flag: isSendingMessage, msgCount: messages.length,
      msgShape: messages.map((m) => `${m.role}/${m.type ?? '-'}`),
      userCount: messages.filter((m) => m.role === 'user').length,
      last: last ? { role: last.role, type: last.type ?? null, content: String(last.content).slice(0, 200) } : null,
      btnDisabled: document.getElementById('sendBtn').disabled, input: document.getElementById('msgInput').value,
      toasts: [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent),
      banner: document.getElementById('offlineBanner').style.display,
    };
  } catch (e) { return { error: String(e) }; }
});
async function goOffline(ctx, page) {
  await ctx.setOffline(true);
  try { await page.waitForFunction(() => navigator.onLine === false && document.getElementById('offlineBanner').style.display === 'block', null, { timeout: 5000 }); return true; } catch { return false; }
}
async function goOnline(ctx, page) {
  await ctx.setOffline(false);
  try { await page.waitForFunction(() => navigator.onLine === true && document.getElementById('offlineBanner').style.display === 'none' && document.getElementById('sendBtn').disabled === false, null, { timeout: 5000 }); return true; } catch { return false; }
}
async function toastsCleared(page) {
  try { await page.waitForFunction(() => document.querySelectorAll('#toastContainer .toast').length === 0, null, { timeout: 8000 }); return true; } catch { return false; }
}
// `force` skips Playwright's "enabled" wait so a disabled button (a stuck PRE state) cannot hang the script; a disabled button still fires no click.
async function send(page, via) {
  if (via === 'enter') { await page.focus('#msgInput'); await page.keyboard.press('Enter'); }
  else await page.click('#sendBtn', { force: true, timeout: 5000 });
}
async function sendAndObserve(page, ext, via) {
  const before = await snap(page); const extBefore = ext.length;
  await send(page, via);
  let appeared = true;
  try { await page.waitForFunction((n) => messages.length > n, before.msgCount, { timeout: 3000 }); } catch { appeared = false; }
  let cycleEnded = null;
  if (appeared) { try { await page.waitForFunction(() => isSendingMessage === false, null, { timeout: 30000 }); cycleEnded = true; } catch { cycleEnded = false; } }
  else await page.waitForTimeout(1000);
  const after = await snap(page);
  return { before, after, dMsgs: after.msgCount - before.msgCount, dExt: ext.length - extBefore, toasts: after.toasts, appeared, cycleEnded };
}
const okCycle = (r) => r.dMsgs === 2 && r.dExt >= 1 && r.cycleEnded === true && r.after.flag === false && r.after.btnDisabled === false && r.after.input === '';
const cycleDetail = (r) => `dMsgs=${r.dMsgs} dExt=${r.dExt} cycleEnded=${r.cycleEnded} flag=${r.after.flag} btnDisabled=${r.after.btnDisabled} input=${JSON.stringify(r.after.input)}`;
async function waitHeld(gate) { for (let i = 0; i < 100 && gate.held !== 1; i++) await new Promise((r) => setTimeout(r, 100)); return gate.held === 1; }
// run a scenario, turning a crash into a VALID failure instead of killing the script
async function scenario(name, fn) {
  try { return await fn(); } catch (e) { valid(`${name}-scenario-completed-without-crash`, false, String(e && e.message || e).slice(0, 200)); return null; }
}

let singleSendRequests = null; // measured in C0, used as the "one pipeline" reference
const out = {};

try {
  browser = await chromium.launch();
  const chromiumVersion = browser.version();
  console.log(`Chromium ${chromiumVersion}; FRONTEND_DIR=${FRONTEND_DIR}`);
  const sha = (f) => readFile(path.join(FRONTEND_DIR, f)).then((b) => createHash('sha256').update(b).digest('hex'));
  const fileHashes = { [HTML_FILE]: await sha(HTML_FILE), 'main.js': await sha('main.js') };

  // ================= AC-10 controls =================
  await scenario('C0', async () => {
    const { ctx, page, ext } = await newScenario();
    try {
      valid('C0-boot-online-lock-initially-false', (await boot(page)) && (await snap(page)).flag === false);
      await page.fill('#msgInput', 'S8-C0');
      const r = await sendAndObserve(page, ext, 'click');
      valid('C0-online-send-completes-cycle-and-releases-lock', okCycle(r) && r.after.msgShape.slice(-2).join(',') === 'user/-,assistant/error', cycleDetail(r));
      singleSendRequests = r.dExt;
    } finally { await ctx.close(); }
  });
  await scenario('C2', async () => {
    const { ctx, page, ext } = await newScenario();
    try {
      valid('C2-boot-online', await boot(page));
      valid('C2-offline-really-in-effect', await goOffline(ctx, page));
      valid('C2-reconnected-really-online', await goOnline(ctx, page));
      await page.fill('#msgInput', 'S8-C2');
      const r = await sendAndObserve(page, ext, 'click');
      valid('C2-offline-period-without-attempt-does-not-break-sending', okCycle(r), cycleDetail(r));
    } finally { await ctx.close(); }
  });

  // ================= AC-4′ / AC-5′ offline attempt -> reconnect -> follow-up (click and Enter) =================
  for (const via of ['click', 'enter']) {
    await scenario('A-' + via, async () => {
      const tag = 'AC4-5-' + via;
      const { ctx, page, ext } = await newScenario();
      try {
        valid(`${tag}-boot-online-lock-initially-false`, (await boot(page)) && (await snap(page)).flag === false);
        valid(`${tag}-offline-really-in-effect-banner-shown`, await goOffline(ctx, page));
        const text = `S8-${tag}-message`;
        await page.fill('#msgInput', text);
        const b = await snap(page); const eb = ext.length;
        await send(page, via); await page.waitForTimeout(400);
        const a = await snap(page);
        pres(`${tag}-offline-attempt-shows-the-offline-toast`, a.toasts.some((t) => t.startsWith(OFFLINE_TOAST_PREFIX)), JSON.stringify(a.toasts));
        pres(`${tag}-offline-attempt-sends-nothing-keeps-text-button-enabled`, a.msgCount === b.msgCount && ext.length === eb && a.input === text && a.btnDisabled === false, `dMsgs=${a.msgCount - b.msgCount} dExt=${ext.length - eb} input=${JSON.stringify(a.input)} btnDisabled=${a.btnDisabled}`);
        ps(`${tag}-lock-released-right-after-the-offline-attempt`, a.flag === false, `isSendingMessage=${a.flag}`);
        valid(`${tag}-reconnected-really-online`, await goOnline(ctx, page));
        valid(`${tag}-input-still-holds-the-text-after-reconnect`, (await snap(page)).input === text);
        valid(`${tag}-previous-toast-waited-out`, await toastsCleared(page));
        const f = await sendAndObserve(page, ext, via);
        ps(`${tag}-follow-up-after-reconnect-sends-same-text-same-entry-point`, okCycle(f), cycleDetail(f));
      } finally { await ctx.close(); }
    });
  }

  // ================= AC-5″ repeated offline attempts + AC-5‴ empty input offline =================
  await scenario('R', async () => {
    const { ctx, page, ext } = await newScenario();
    try {
      valid('AC5-repeat-boot-online', await boot(page));
      valid('AC5-repeat-offline-really-in-effect', await goOffline(ctx, page));
      await page.fill('#msgInput', '   '); // whitespace only -> `if(!text) return` before the lock
      const e0 = await snap(page); await send(page, 'click'); await page.waitForTimeout(300);
      const e1 = await snap(page);
      pres('AC5-empty-input-offline-attempt-does-nothing-lock-false-no-toast', e1.flag === false && e1.msgCount === e0.msgCount && e1.toasts.length === 0, `flag=${e1.flag} toasts=${JSON.stringify(e1.toasts)}`);
      const text = 'S8-repeat-message';
      await page.fill('#msgInput', text);
      const toastSeen = [], flags = [];
      for (let i = 0; i < 3; i++) {
        valid(`AC5-repeat-toasts-cleared-before-attempt-${i + 1}`, await toastsCleared(page));
        await send(page, i % 2 === 0 ? 'click' : 'enter'); await page.waitForTimeout(300);
        const s = await snap(page); toastSeen.push(s.toasts.some((t) => t.startsWith(OFFLINE_TOAST_PREFIX))); flags.push(s.flag);
      }
      ps('AC5-three-offline-attempts-each-show-the-toast', toastSeen.every(Boolean), JSON.stringify(toastSeen));
      ps('AC5-three-offline-attempts-keep-the-lock-false', flags.every((v) => v === false), JSON.stringify(flags));
      valid('AC5-repeat-reconnected-really-online', await goOnline(ctx, page));
      valid('AC5-repeat-toasts-waited-out', await toastsCleared(page));
      const f = await sendAndObserve(page, ext, 'click');
      ps('AC5-follow-up-after-repeated-offline-attempts-sends', okCycle(f), cycleDetail(f));
    } finally { await ctx.close(); }
  });

  // ================= AC-7′ the lock is still a real lock =================
  await scenario('L', async () => {
    const { ctx, page, ext, gate } = await newScenario();
    try {
      valid('AC7-boot-online', await boot(page));
      // (a) two synchronous calls, text refilled between them => one pipeline
      await page.fill('#msgInput', 'S8-a-ctrl');
      const ctrl = await sendAndObserve(page, ext, 'click'); // control: one send, same page
      valid('AC7a-control-single-send-cycle-ok', okCycle(ctrl), cycleDetail(ctrl));
      const b0 = await snap(page); const e0 = ext.length;
      await page.evaluate(async () => {
        const i = document.getElementById('msgInput');
        i.value = 'S8-a-dup'; const p1 = sendMessage();
        i.value = 'S8-a-dup'; const p2 = sendMessage(); // lock is held => must return at the guard
        await Promise.all([p1, p2]);
      });
      const a0 = await snap(page);
      pres('AC7a-two-synchronous-sends-start-one-pipeline', a0.userCount - b0.userCount === 1 && a0.msgCount - b0.msgCount === 2 && (ext.length - e0) === ctrl.dExt && a0.flag === false,
        `dUser=${a0.userCount - b0.userCount} dMsgs=${a0.msgCount - b0.msgCount} dExt=${ext.length - e0} (control ${ctrl.dExt})`);
      // (b) same with an attached image: the lock must be taken BEFORE the first await (ImageStore.save)
      const setImg = () => page.evaluate((t) => { pendingImageBase64 = 'QUJD'; document.getElementById('msgInput').value = t; }, 'S8-b-ctrl');
      await setImg();
      const ctrlI = await sendAndObserve(page, ext, 'click');
      valid('AC7b-control-single-image-send-cycle-ended', ctrlI.cycleEnded === true && ctrlI.after.flag === false && ctrlI.dMsgs >= 1, cycleDetail(ctrlI));
      const b1 = await snap(page); const e1 = ext.length;
      await page.evaluate(async () => {
        const i = document.getElementById('msgInput');
        pendingImageBase64 = 'QUJD'; i.value = 'S8-b-dup'; const p1 = sendMessage();
        pendingImageBase64 = 'QUJD'; i.value = 'S8-b-dup'; const p2 = sendMessage();
        await Promise.all([p1, p2]);
      });
      const a1 = await snap(page);
      pres('AC7b-two-synchronous-sends-with-image-start-one-pipeline', a1.userCount - b1.userCount === 1 && a1.msgCount - b1.msgCount === ctrlI.dMsgs && (ext.length - e1) === ctrlI.dExt && a1.flag === false,
        `dUser=${a1.userCount - b1.userCount} dMsgs=${a1.msgCount - b1.msgCount} dExt=${ext.length - e1} (control dMsgs=${ctrlI.dMsgs} dExt=${ctrlI.dExt})`);
      await page.evaluate(() => { pendingImageBase64 = null; });
      // (c) in-flight state held open by the gate
      gate.arm();
      await page.fill('#msgInput', 'S8-c-inflight');
      const bc = await snap(page);
      await send(page, 'click');
      valid('AC7c-first-request-reached-the-network-layer-and-is-held', await waitHeld(gate));
      const inflight = await snap(page); const eHeld = ext.length;
      pres('AC7c-in-flight-lock-true-and-button-disabled', inflight.flag === true && inflight.btnDisabled === true, `flag=${inflight.flag} btnDisabled=${inflight.btnDisabled}`);
      await page.fill('#msgInput', 'S8-c-second');
      await send(page, 'enter'); await send(page, 'click'); await page.waitForTimeout(500);
      const during = await snap(page);
      pres('AC7c-click-and-Enter-during-flight-are-no-ops', during.msgCount === inflight.msgCount && ext.length === eHeld && during.input === 'S8-c-second', `dMsgs=${during.msgCount - inflight.msgCount} dExt=${ext.length - eHeld}`);
      gate.release();
      try { await page.waitForFunction(() => isSendingMessage === false, null, { timeout: 30000 }); } catch {}
      const done = await snap(page);
      pres('AC7c-after-release-cycle-ends-lock-false-button-enabled', done.flag === false && done.btnDisabled === false && done.msgCount - bc.msgCount === 2, `flag=${done.flag} btnDisabled=${done.btnDisabled} dMsgs=${done.msgCount - bc.msgCount}`);
    } finally { await ctx.close(); }
  });

  // ================= AC-9 connection lost while a send is in flight =================
  await scenario('F', async () => {
    const { ctx, page, ext, gate } = await newScenario();
    try {
      valid('AC9-boot-online', await boot(page));
      gate.arm();
      await page.fill('#msgInput', 'S8-AC9-inflight');
      const b = await snap(page);
      await send(page, 'click');
      valid('AC9-request-held-in-flight', await waitHeld(gate));
      valid('AC9-offline-really-in-effect-mid-flight', await goOffline(ctx, page));
      gate.release();
      try { await page.waitForFunction(() => isSendingMessage === false, null, { timeout: 30000 }); } catch {}
      const a = await snap(page);
      pres('AC9-mid-flight-failure-gives-exactly-one-error-message-and-releases-lock-and-button', a.msgCount - b.msgCount === 2 && a.msgShape.slice(-2).join(',') === 'user/-,assistant/error' && a.flag === false && a.btnDisabled === false, `dMsgs=${a.msgCount - b.msgCount} shape=${JSON.stringify(a.msgShape.slice(-2))} flag=${a.flag} btnDisabled=${a.btnDisabled}`);
      valid('AC9-reconnected-really-online', await goOnline(ctx, page));
      await page.fill('#msgInput', 'S8-AC9-after');
      const f = await sendAndObserve(page, ext, 'click');
      pres('AC9-send-after-reconnect-works', okCycle(f), cycleDetail(f));
    } finally { await ctx.close(); }
  });

  // ================= AC-8 failures between the lock and the old `try` =================
  const FAULTS = [
    { tag: 'E1-ImageStore.save-rejects', expect: /INJECTED-E1/, text: 'S8-E1-text',
      inject: () => { window.__fired = 0; window.__orig = ImageStore.save; ImageStore.save = async () => { window.__fired++; throw new Error('INJECTED-E1-IMAGESTORE'); }; pendingImageBase64 = 'QUJD'; return true; },
      restore: () => { ImageStore.save = window.__orig; pendingImageBase64 = null; } },
    { tag: 'E2-resolveActiveMode-throws', expect: /INJECTED-E2/, text: 'S8-E2-text',
      inject: () => { window.__fired = 0; window.__orig = NexusOrchestrator.resolveActiveMode; NexusOrchestrator.resolveActiveMode = function () { window.__fired++; throw new Error('INJECTED-E2-RESOLVE'); }; return true; },
      restore: () => { NexusOrchestrator.resolveActiveMode = window.__orig; } },
    { tag: 'E3-startTask-throws', expect: /INJECTED-E3/, text: 'S8-E3-text',
      inject: () => { window.__fired = 0; window.__orig = NexusObservability.startTask; NexusObservability.startTask = function () { window.__fired++; throw new Error('INJECTED-E3-STARTTASK'); }; return true; },
      restore: () => { NexusObservability.startTask = window.__orig; } },
    { tag: 'E4-required-DOM-element-missing', expect: /null|checked/, text: 'S8-E4-text',
      inject: () => { window.__fired = 0; const el = document.getElementById('crossExamToggle'); if (!el) return false; window.__el = el; window.__par = el.parentNode; window.__next = el.nextSibling; el.remove(); return document.getElementById('crossExamToggle') === null; },
      restore: () => { window.__par.insertBefore(window.__el, window.__next); } },
  ];
  for (const fc of FAULTS) {
    await scenario(fc.tag, async () => {
      const { ctx, page, ext } = await newScenario();
      try {
        valid(`AC8-${fc.tag}-boot-online`, await boot(page));
        valid(`AC8-${fc.tag}-fault-armed`, await page.evaluate(fc.inject));
        await page.evaluate((t) => { document.getElementById('msgInput').value = t; }, fc.text);
        const res = await page.evaluate(() => sendMessage().then(() => ({ resolved: true }), (e) => ({ resolved: false, err: String((e && e.message) || e) })));
        const a = await snap(page);
        if (fc.tag.startsWith('E4')) valid(`AC8-${fc.tag}-fault-was-present-at-send-time`, res.resolved === true ? /null|checked/.test(a.last?.content || '') : /null|checked/.test(res.err || ''), `resolved=${res.resolved} err=${res.err} last=${a.last?.content}`);
        else valid(`AC8-${fc.tag}-fault-fired-exactly-once`, (await page.evaluate(() => window.__fired)) === 1);
        ps(`AC8-${fc.tag}-sendMessage-promise-resolves-failure-is-handled`, res.resolved === true, `resolved=${res.resolved} err=${res.err ?? ''}`);
        ps(`AC8-${fc.tag}-lock-released-and-button-enabled`, a.flag === false && a.btnDisabled === false, `flag=${a.flag} btnDisabled=${a.btnDisabled}`);
        ps(`AC8-${fc.tag}-error-message-shown-in-chat`, a.last && a.last.role === 'assistant' && a.last.type === 'error' && fc.expect.test(a.last.content), JSON.stringify(a.last));
        await page.evaluate(fc.restore);
        await page.fill('#msgInput', fc.text + '-next');
        const f = await sendAndObserve(page, ext, 'click');
        ps(`AC8-${fc.tag}-next-send-works-after-the-fault-is-removed`, okCycle(f), cycleDetail(f));
      } finally { await ctx.close(); }
    });
  }

  valid('no-uncaught-page-errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await browser.close();

  // ================= verdict =================
  const by = (k) => checks.filter((c) => c.kind === k);
  const cnt = (k) => `${by(k).filter((c) => c.ok).length}/${by(k).length}`;
  const invalid = by('VALID').some((c) => !c.ok);
  const rejected = !invalid && checks.some((c) => !c.ok);
  const verdict = invalid ? 'INVALID' : rejected ? 'REJECTED' : 'ACCEPTED';
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== SUMMARY ===\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed  (VALID ${cnt('VALID')}, PRES ${cnt('PRES')}, PS ${cnt('PS')})`);
  if (failed.length) console.log('FAILED: ' + failed.map((c) => `[${c.kind}] ${c.name}`).join('\n        '));
  console.log(`S8-VERDICT = ${verdict}  (chromium ${chromiumVersion}; frontend=${path.relative(HERE, FRONTEND_DIR) || '.'})`);
  await writeFile(RESULTS_FILE, JSON.stringify({ slice: 'core-8', subject: 'isSendingMessage lock release (CP-14 fix)', chromium: chromiumVersion, verdict, frontendSha256: fileHashes,
    counts: { VALID: cnt('VALID'), PRES: cnt('PRES'), PS: cnt('PS') }, failed: failed.map((c) => `[${c.kind}] ${c.name}`), checks }, null, 2) + '\n');
  console.log(`results -> ${RESULTS_FILE}`);
  process.exitCode = verdict === 'ACCEPTED' ? 0 : verdict === 'REJECTED' ? 1 : 3;
} catch (e) {
  console.log(`[FAIL] [VALID] script-crashed — ${e && e.stack ? e.stack : e}`);
  try { if (browser) await browser.close(); } catch {}
  console.log('\n=== SUMMARY ===\nscript crashed before completion\nS8-VERDICT = INVALID');
  process.exitCode = 2;
}

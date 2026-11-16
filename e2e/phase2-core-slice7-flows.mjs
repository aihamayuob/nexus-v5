/* ==========================================================================
   e2e/phase2-core-slice7-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9
   "core", TARGET SLICE 7 (EVIDENCE ONLY, no production change):
   runtime test, in real Chromium, of the static finding in CP-13 §8:

     "sendMessage() sets isSendingMessage = true and then returns early when
      !navigator.onLine, BEFORE the try/finally that resets it. A single send
      attempt while offline may leave later sends returning silently at the
      entry guard until reload, even after the connection is back."

   Real HTML + real modules + real sendMessage / updateOnlineStatus / showToast /
   callClaude (no stubs of app logic). "Offline" is Chromium's own network
   emulation (BrowserContext.setOffline). The page is served through
   context.route from https://nexus.test; every NON-origin request is aborted
   (nothing external is ever fetched), so an online send runs the real pipeline
   up to its failure ("Failed to fetch" -> error message -> finally).

   Acceptance criteria (written first): baseline/evidence/phase2-core-slice7-acceptance-criteria.md

   Check kinds
     [PASS]/[FAIL]  measurement-validity and control checks. Any FAIL => the verdict is INCONCLUSIVE and exit code != 0.
     [OBSERVED]     the outcome itself: REPORTED, never asserted (the script can report NOT-STUCK faithfully).
   Final line:  S7-VERDICT = STUCK | NOT-STUCK | INCONCLUSIVE  (+ validity count).

   FRONTEND_DIR defaults to ../frontend (self-locating); NEXUS_FRONTEND_DIR points the same script at scratch mutated
   copies (used ONLY by the slice 7 mutation script to prove the test can discriminate; production files are never edited).
   Results JSON: NEXUS_S7_RESULTS (default baseline/evidence/phase2-core-slice7-results.json). Deterministic: no timestamps/timings.
   ========================================================================== */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_S7_RESULTS || path.resolve(HERE, '../baseline/evidence/phase2-core-slice7-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const ORIGIN = 'https://nexus.test';
const OFFLINE_TOAST_PREFIX = '🔌 لا يوجد اتصال بالإنترنت حالياً';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

const checks = [];
const observed = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}
function observe(name, value, detail) {
  observed.push({ name, value, detail: detail ?? null });
  console.log(`[OBSERVED] ${name} = ${typeof value === 'string' ? value : JSON.stringify(value)}${detail ? ' — ' + detail : ''}`);
}

const pageErrors = [];
let browser = null;

/* A fresh BrowserContext per scenario (fresh IndexedDB, nothing shared). `ext` records every aborted NON-origin request. */
async function newScenario() {
  const ctx = await browser.newContext();
  const ext = [];
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) { ext.push(route.request().method() + ' ' + u.origin + u.pathname); return route.abort(); }
    const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
    try {
      const content = await readFile(path.join(FRONTEND_DIR, rel));
      await route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || 'application/octet-stream', body: content });
    } catch { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { ctx, page, ext };
}
async function bootOnline(page) {
  await page.goto(ORIGIN + '/', { waitUntil: 'load' });
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}
// Bare-name reads of classic top-level `let`s from page.evaluate are allowed (slice 2 / slice 5 pattern).
const snap = (page) => page.evaluate(() => {
  try {
    return {
      onLine: navigator.onLine,
      flag: isSendingMessage,
      msgCount: messages.length,
      msgShape: messages.map((m) => `${m.role}/${m.type ?? '-'}`),
      btnDisabled: document.getElementById('sendBtn').disabled,
      input: document.getElementById('msgInput').value,
      toasts: [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent),
      banner: document.getElementById('offlineBanner').style.display,
    };
  } catch (e) { return { error: String(e) }; }
});
async function goOffline(ctx, page) {
  await ctx.setOffline(true);
  try { await page.waitForFunction(() => navigator.onLine === false && document.getElementById('offlineBanner').style.display === 'block', null, { timeout: 5000 }); return true; }
  catch { return false; }
}
async function goOnline(ctx, page) {
  await ctx.setOffline(false);
  try { await page.waitForFunction(() => navigator.onLine === true && document.getElementById('offlineBanner').style.display === 'none' && document.getElementById('sendBtn').disabled === false, null, { timeout: 5000 }); return true; }
  catch { return false; }
}
async function toastsCleared(page) {
  try { await page.waitForFunction(() => document.querySelectorAll('#toastContainer .toast').length === 0, null, { timeout: 8000 }); return true; }
  catch { return false; }
}
async function send(page, via) {
  if (via === 'enter') { await page.focus('#msgInput'); await page.keyboard.press('Enter'); } // real handleKeydown path
  else await page.click('#sendBtn'); // real inline onclick path
}
/* Send and observe: waits (bounded) for a message to appear; if one did, waits for the cycle to finish (flag back to false). */
async function sendAndObserve(page, ext, via) {
  const before = await snap(page); const extBefore = ext.length;
  await send(page, via);
  let appeared = true;
  try { await page.waitForFunction((n) => messages.length > n, before.msgCount, { timeout: 3000 }); } catch { appeared = false; }
  let cycleEnded = null;
  if (appeared) { try { await page.waitForFunction(() => isSendingMessage === false, null, { timeout: 30000 }); cycleEnded = true; } catch { cycleEnded = false; } }
  else await page.waitForTimeout(1000); // nothing appeared: give any late effect a chance to show
  const after = await snap(page);
  return { before, after, dMsgs: after.msgCount - before.msgCount, dExt: ext.length - extBefore, newToasts: after.toasts, appeared, cycleEnded };
}

/* ---- AC-1 / AC-2 shared assertion: a normal online send completes the cycle ---- */
function assertOnlineCycleOk(tag, r, text) {
  check(`${tag}-online-send-added-user-and-error-message`, r.dMsgs === 2 && r.after.msgShape.slice(-2).join(',') === 'user/-,assistant/error', `dMsgs=${r.dMsgs} shape=${JSON.stringify(r.after.msgShape)}`);
  check(`${tag}-online-send-reached-network-layer-aborted-request`, r.dExt >= 1, `externalRequests=${r.dExt}`);
  check(`${tag}-online-send-cycle-ended-flag-false-btn-enabled-input-cleared`, r.cycleEnded === true && r.after.flag === false && r.after.btnDisabled === false && r.after.input === '', `cycleEnded=${r.cycleEnded} flag=${r.after.flag} btnDisabled=${r.after.btnDisabled} input=${JSON.stringify(r.after.input)}`);
}

/* ---- The scenario under test ---- */
async function offlineAttemptScenario({ tag, offlineVia, onlineVia, extras = null /* 'later-offline+reload' | 'intervention' */ }) {
  const { ctx, page, ext } = await newScenario();
  const out = { tag, offlineVia, onlineVia };
  try {
    const inited = await bootOnline(page);
    const s0 = await snap(page);
    check(`${tag}-boot-online-and-flag-initially-false`, inited && s0.onLine === true && s0.flag === false && s0.btnDisabled === false, `inited=${inited} onLine=${s0.onLine} flag=${s0.flag}`);

    check(`${tag}-offline-really-in-effect-banner-shown`, await goOffline(ctx, page), 'navigator.onLine===false and #offlineBanner shown');
    const text = `S7-${tag}-message`;
    await page.fill('#msgInput', text);
    const a1b = await snap(page); const extB = ext.length;
    await send(page, offlineVia);
    await page.waitForTimeout(400);
    const a1 = await snap(page);
    out.afterOffline = a1;
    check(`${tag}-AC4-offline-attempt-showed-the-offline-toast`, a1.toasts.some((t) => t.startsWith(OFFLINE_TOAST_PREFIX)), JSON.stringify(a1.toasts));
    check(`${tag}-AC4-offline-attempt-sent-nothing-and-kept-the-text`, a1.msgCount === a1b.msgCount && ext.length === extB && a1.input === text && a1.btnDisabled === false, `dMsgs=${a1.msgCount - a1b.msgCount} dExt=${ext.length - extB} input=${JSON.stringify(a1.input)} btnDisabled=${a1.btnDisabled}`);
    observe(`${tag}-flag-right-after-offline-attempt`, a1.flag, 'isSendingMessage (the CP-13 §8 inference says true)');

    check(`${tag}-reconnected-really-online-banner-hidden-btn-enabled`, await goOnline(ctx, page), 'navigator.onLine===true, banner hidden, sendBtn enabled');
    const s2 = await snap(page);
    check(`${tag}-after-reconnect-input-still-holds-the-text`, s2.input === text, JSON.stringify(s2.input));
    check(`${tag}-previous-toast-waited-out-so-a-new-toast-is-attributable`, await toastsCleared(page));

    const f = await sendAndObserve(page, ext, onlineVia);
    out.followUp = { dMsgs: f.dMsgs, dExt: f.dExt, newToasts: f.newToasts, flag: f.after.flag, input: f.after.input, btnDisabled: f.after.btnDisabled };
    observe(`${tag}-follow-up-after-reconnect`, out.followUp, `same text, same entry point (${onlineVia}); onLine=${f.after.onLine} banner=${f.after.banner}`);
    const sendsNothing = f.dMsgs === 0 && f.dExt === 0 && f.newToasts.length === 0;
    const sendsNormally = f.dMsgs >= 1 && f.dExt >= 1 && f.cycleEnded === true && f.after.flag === false;
    out.class = a1.flag === true && sendsNothing ? 'STUCK' : (a1.flag === false && sendsNormally ? 'NOT-STUCK' : 'MIXED');
    observe(`${tag}-run-classification`, out.class);

    if (extras === 'later-offline+reload' && out.class === 'STUCK') {
      // AC-9: a later OFFLINE attempt while stuck shows no toast at all (guard returns before the offline check)
      check(`${tag}-AC9-offline-again`, await goOffline(ctx, page));
      check(`${tag}-AC9-toasts-cleared-before-second-offline-attempt`, await toastsCleared(page));
      const l = await sendAndObserve(page, ext, 'click');
      observe(`${tag}-AC9-second-offline-attempt-while-stuck`, { dMsgs: l.dMsgs, dExt: l.dExt, toasts: l.newToasts }, 'inference: silent (no toast), because the entry guard returns first');
      check(`${tag}-AC9-back-online`, await goOnline(ctx, page));
      // AC-8: recovery by reload
      await page.reload({ waitUntil: 'load' });
      const reInited = await bootOnlineWait(page);
      const r0 = await snap(page);
      check(`${tag}-AC8-reload-valid-online-initialised`, reInited && r0.onLine === true, `inited=${reInited} onLine=${r0.onLine}`);
      observe(`${tag}-AC8-flag-after-reload`, r0.flag, 'isSendingMessage is not persisted; reload re-initialises the let');
      await page.fill('#msgInput', text + '-after-reload');
      const rr = await sendAndObserve(page, ext, 'click');
      observe(`${tag}-AC8-send-after-reload`, { dMsgs: rr.dMsgs, dExt: rr.dExt, flag: rr.after.flag }, 'a new user message + error message expected if recovered');
      out.reload = { flag: r0.flag, dMsgs: rr.dMsgs, dExt: rr.dExt };
    }
    if (extras === 'intervention' && out.class === 'STUCK') {
      // AC-7: causal intervention — reset ONLY the flag, repeat the very same send
      await page.evaluate(() => { isSendingMessage = false; });
      const iv = await sendAndObserve(page, ext, onlineVia);
      check(`${tag}-AC7-resetting-only-the-flag-makes-the-same-send-work`, iv.dMsgs === 2 && iv.dExt >= 1 && iv.cycleEnded === true && iv.after.flag === false, `dMsgs=${iv.dMsgs} dExt=${iv.dExt} flag=${iv.after.flag}`);
      out.intervention = { dMsgs: iv.dMsgs, dExt: iv.dExt, flag: iv.after.flag };
    }
  } finally { await ctx.close(); }
  return out;
}
async function bootOnlineWait(page) {
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}

try {
  browser = await chromium.launch();
  const chromiumVersion = browser.version();
  console.log(`Chromium ${chromiumVersion}; FRONTEND_DIR=${FRONTEND_DIR}`);
  const sha = (f) => readFile(path.join(FRONTEND_DIR, f)).then((b) => createHash('sha256').update(b).digest('hex'));
  const fileHashes = { [HTML_FILE]: await sha(HTML_FILE), 'main.js': await sha('main.js') };

  // ---------------- C0 (AC-1): control — a normal online send completes its cycle ----------------
  {
    const { ctx, page, ext } = await newScenario();
    try {
      const inited = await bootOnline(page);
      check('C0-boot-online', inited && (await snap(page)).onLine === true);
      await page.fill('#msgInput', 'S7-C0-message');
      assertOnlineCycleOk('C0', await sendAndObserve(page, ext, 'click'), 'S7-C0-message');
    } finally { await ctx.close(); }
  }
  // ---------------- C2 (AC-2): control — offline period WITHOUT a send attempt, then online ----------------
  {
    const { ctx, page, ext } = await newScenario();
    try {
      const inited = await bootOnline(page);
      check('C2-boot-online', inited);
      check('C2-offline-really-in-effect', await goOffline(ctx, page));
      check('C2-reconnected-really-online', await goOnline(ctx, page));
      await page.fill('#msgInput', 'S7-C2-message');
      assertOnlineCycleOk('C2', await sendAndObserve(page, ext, 'click'), 'S7-C2-message');
    } finally { await ctx.close(); }
  }

  // ---------------- Main scenario: offline attempt -> reconnect -> follow-up send ----------------
  const runs = [];
  runs.push(await offlineAttemptScenario({ tag: 'click1', offlineVia: 'click', onlineVia: 'click', extras: 'later-offline+reload' }));
  runs.push(await offlineAttemptScenario({ tag: 'click2', offlineVia: 'click', onlineVia: 'click', extras: 'intervention' }));
  runs.push(await offlineAttemptScenario({ tag: 'click3', offlineVia: 'click', onlineVia: 'click', extras: 'intervention' }));
  runs.push(await offlineAttemptScenario({ tag: 'enter1', offlineVia: 'enter', onlineVia: 'enter', extras: 'intervention' }));

  const classes = runs.map((r) => r.class);
  check('main-all-runs-classified-consistently', new Set(classes).size === 1 && classes[0] !== 'MIXED', JSON.stringify(classes));
  check('no-uncaught-page-errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await browser.close();

  // ---------------- verdict ----------------
  const failed = checks.filter((c) => !c.ok);
  const verdict = failed.length ? 'INCONCLUSIVE' : (new Set(classes).size === 1 ? (classes[0] === 'MIXED' ? 'INCONCLUSIVE' : classes[0]) : 'INCONCLUSIVE');
  console.log(`\n=== SUMMARY ===\n${checks.length - failed.length}/${checks.length} validity checks passed`);
  console.log(`S7-VERDICT = ${verdict}  (chromium ${chromiumVersion}; frontend=${path.relative(HERE, FRONTEND_DIR) || '.'})`);
  const out = {
    slice: 'core-7', subject: 'isSendingMessage after an offline send attempt (CP-13 §8)', chromium: chromiumVersion, verdict,
    frontendSha256: fileHashes,
    validity: { passed: checks.length - failed.length, total: checks.length, failed: failed.map((c) => c.name) },
    checks, observed,
  };
  await writeFile(RESULTS_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`results -> ${RESULTS_FILE}`);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.log(`[FAIL] script-crashed — ${e && e.stack ? e.stack : e}`);
  try { if (browser) await browser.close(); } catch {}
  console.log('\n=== SUMMARY ===\nscript crashed before completion\nS7-VERDICT = INCONCLUSIVE');
  process.exitCode = 2;
}

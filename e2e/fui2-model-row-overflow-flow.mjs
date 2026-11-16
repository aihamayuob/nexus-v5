/* ==========================================================================
   e2e/fui2-model-row-overflow-flow.mjs — F-UI-2: in ADVANCED mode with a LOCAL provider selected, the chat-model row (#chatModelRow: model select + local model
   name input + 🔒 sovereignty badge + active-modes indicator) must not push the page wider than the viewport, and the send button must stay visible, inside the
   viewport, big enough to tap, and not overlap the message box — in RTL (ar) and LTR (en), simple and advanced modes.
   Real Chromium loads the REAL frontend file (no backend is needed: the state under test is pure layout). Matrix: widths 320/360/375/390/412/430/480 +
   tablet 768 + laptop 1024 + desktop 1280, x lang ar|en, x mode simple|advanced, x model name short|long, x active-modes indicator off|on.
   Checks per cell (PS): no horizontal page overflow; every child of #chatModelRow inside the viewport (no clipping off either edge); send button visible, inside
   the viewport, >= 24x24 CSS px (WCAG 2.2 AA 2.5.8 minimum), not overlapped by another element at its centre, and not intersecting the message box.
   VALID: the local state is really active (badge + local input visible in advanced mode), and the harness can see an overflow (a deliberately overflowing probe element).
   Not covered (honest limits): other browsers/engines, real devices, text-zoom/font-scaling, landscape phones, keyboard-open viewport, the 3rd UI language (fr), screen readers.
   Final line: FUI2-VERDICT = ACCEPTED | REJECTED | INVALID. Exit 0 iff ACCEPTED. Set NEXUS_FUI2_SHOTS=<dir> to save screenshots of the worst cells.
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '../frontend');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const RESULTS_FILE = process.env.NEXUS_FUI2_RESULTS || path.join(os.tmpdir(), 'fui2-results.json');
const SHOTS = process.env.NEXUS_FUI2_SHOTS || '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 768, 1024, 1280];
const LANGS = ['ar', 'en'];
const MODES = ['simple', 'advanced'];
const NAMES = { short: 'llama3.1', long: 'qwen2.5-coder:32b-instruct-q4_K_M' };
const checks = [];
function rec(kind, name, ok, detail) { checks.push({ kind, name, ok: !!ok, detail: detail ?? null }); if (!ok || kind === 'VALID') console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`); }

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
  const abs = path.resolve(FRONTEND_DIR, rel);
  if (!abs.startsWith(FRONTEND_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(abs); res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${srv.address().port}`;

const browser = await chromium.launch();
if (SHOTS) await mkdir(SHOTS, { recursive: true });

/** Measure one cell inside an already-loaded page. Everything is measured in the page, in CSS px. */
const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const vis = (el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
  const out = { vw, docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth };
  const row = document.getElementById('chatModelRow');
  out.rowVisible = !!row && vis(row);
  out.rowChildren = [];
  if (row && out.rowVisible) {
    out.row = r(row); out.rowScrollW = row.scrollWidth; out.rowClientW = row.clientWidth;
    const walk = [...row.querySelectorAll('select, input, .sovereignty-badge, .active-mode-indicator, .model-pill-inline')];
    for (const el of walk) if (vis(el)) out.rowChildren.push({ id: el.id || el.className, ...r(el) });
  }
  const send = document.getElementById('sendBtn'); const msg = document.getElementById('msgInput');
  const comp = document.querySelector('.input-compound'); out.compound = comp ? r(comp) : null;
  out.send = send ? { visible: vis(send), ...r(send) } : null;
  out.msg = msg ? { visible: vis(msg), ...r(msg) } : null;
  if (send && out.send.visible) {
    const cx = out.send.l + out.send.w / 2, cy = out.send.t + out.send.h / 2;
    const top = document.elementFromPoint(Math.min(Math.max(cx, 0), vw - 1), Math.min(Math.max(cy, 0), innerHeight - 1));
    out.sendCentreHit = top ? (top === send || send.contains(top)) : false;
  }
  out.badgeShown = (() => { const b = document.getElementById('sovereigntyBadge'); return !!b && vis(b); })();
  out.localInputShown = (() => { const b = document.getElementById('localModelNameInput'); return !!b && vis(b); })();
  return out;
};

let cells = 0;
try {
  // VALID control: the harness really detects horizontal overflow.
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } }); const page = await ctx.newPage();
    await page.goto(origin + '/', { waitUntil: 'load' });
    const m = await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'width:900px;height:4px;position:absolute;top:0;inset-inline-start:0'; document.body.appendChild(d); return { docScrollW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }; });
    rec('VALID', 'V1 harness control: a deliberately 900px-wide probe element IS detected as horizontal overflow at 360px', m.docScrollW > m.vw, JSON.stringify(m));
    await ctx.close();
  }

  const worst = [];
  for (const lang of LANGS) for (const mode of MODES) for (const [nameKey, nameVal] of Object.entries(NAMES)) for (const indicator of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
    await ctx.addInitScript(({ lang, mode, nameVal }) => {
      try {
        localStorage.setItem('nexus_ui_lang', lang);
        localStorage.setItem('nexus_simple_mode', mode === 'simple' ? 'true' : 'false');
        localStorage.setItem('nexus_backend_url', 'http://127.0.0.1:9'); // local providers are only kept as the chat model when a backend URL is saved (renderChatModelSelect); the URL is never contacted here
        localStorage.setItem('nexus_chat_model', 'ollama'); // the LOCAL state (as chosen through the advanced-mode select)
        localStorage.setItem('nexus_local_model_name', nameVal);
      } catch (e) { /* ignore */ }
    }, { lang, mode, nameVal });
    const page = await ctx.newPage();
    await page.goto(origin + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
    await page.evaluate((indicator) => {
      renderChatModelSelect(); updateSovereigntyBadge(); updateLocalModelInputVisibility();
      for (const id of ['deepAnalysisToggle', 'toolsToggle', 'thoughtTreeToggle', 'multiModelToggle']) { const el = document.getElementById(id); if (el) { el.checked = indicator && id !== 'multiModelToggle' ? true : false; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      updateActiveModesCount();
    }, indicator);

    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w >= 768 ? 1000 : 800 });
      await page.waitForTimeout(60);
      const m = await page.evaluate(MEASURE);
      const cell = `${lang}/${mode}/name:${nameKey}/indicator:${indicator ? 'on' : 'off'}/w=${w}`;
      cells++;
      const problems = [];
      const overflow = Math.max(m.docScrollW, m.bodyScrollW) - m.vw;
      if (overflow > 1) problems.push(`page overflows horizontally by ${overflow}px (scrollWidth ${Math.max(m.docScrollW, m.bodyScrollW)} > viewport ${m.vw})`);
      if (mode === 'advanced') {
        if (!(m.rowVisible && m.badgeShown && m.localInputShown)) problems.push(`state not as expected (row=${m.rowVisible} badge=${m.badgeShown} localInput=${m.localInputShown})`);
        for (const c of m.rowChildren) if (c.l < -0.5 || c.r > m.vw + 0.5) problems.push(`row child "${c.id}" outside the viewport (${Math.round(c.l)}..${Math.round(c.r)} of ${m.vw})`);
        if (m.row && m.rowScrollW > m.rowClientW + 1) problems.push(`#chatModelRow content (${m.rowScrollW}px) wider than its box (${m.rowClientW}px)`);
      }
      if (m.compound && (m.compound.l < -0.5 || m.compound.r > m.vw + 0.5)) problems.push(`input dock (.input-compound) outside the viewport (${Math.round(m.compound.l)}..${Math.round(m.compound.r)} of ${m.vw})`);
      if (m.msg && m.msg.visible && (m.msg.l < -0.5 || m.msg.r > m.vw + 0.5)) problems.push(`message box outside the viewport (${Math.round(m.msg.l)}..${Math.round(m.msg.r)} of ${m.vw})`);
      const s = m.send;
      if (!s || !s.visible) problems.push('send button not visible');
      else {
        if (s.l < -0.5 || s.r > m.vw + 0.5) problems.push(`send button outside the viewport (${Math.round(s.l)}..${Math.round(s.r)} of ${m.vw})`);
        if (s.w < 24 || s.h < 24) problems.push(`send button smaller than 24x24 (${Math.round(s.w)}x${Math.round(s.h)})`);
        if (m.sendCentreHit === false) problems.push('send button centre is covered by another element');
        if (m.msg && m.msg.visible) {
          const inter = !(s.r <= m.msg.l || s.l >= m.msg.r || s.b <= m.msg.t || s.t >= m.msg.b);
          if (inter) problems.push('send button overlaps the message box');
        }
      }
      rec('PS', cell, problems.length === 0, problems.join('; ') || null);
      if (problems.length && SHOTS && worst.length < 6 && [320, 360, 375].includes(w)) {
        worst.push(cell);
        await page.screenshot({ path: path.join(SHOTS, cell.replace(/[/:]/g, '_') + '.png'), fullPage: false });
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close(); srv.close(); srv.closeAllConnections?.();
}

const vFail = checks.filter((c) => c.kind === 'VALID' && !c.ok); const pFail = checks.filter((c) => c.kind === 'PS' && !c.ok);
const verdict = vFail.length ? 'INVALID' : pFail.length ? 'REJECTED' : 'ACCEPTED';
const byW = {}; for (const c of pFail) { const w = /w=(\d+)/.exec(c.name)[1]; byW[w] = (byW[w] || 0) + 1; }
console.log(`SUMMARY cells=${cells} PS ${checks.filter((c) => c.kind === 'PS' && c.ok).length}/${checks.filter((c) => c.kind === 'PS').length}; failing cells by width: ${JSON.stringify(byW)}`);
console.log(`FUI2-VERDICT = ${verdict}`);
await writeFile(RESULTS_FILE, JSON.stringify({ verdict, cells, checks }, null, 2));
process.exit(verdict === 'ACCEPTED' ? 0 : 1);

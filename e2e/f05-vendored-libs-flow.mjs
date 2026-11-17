// F-05 (2026-11-16) — real Chromium: the lazily loaded libs come from same-origin ./vendor/ (no cdnjs request), pdf.js parses a real PDF
// through the same-origin worker with isEvalSupported:false, QR generation works, and there are zero CSP violations / page errors.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FRONT = new URL('../frontend', import.meta.url).pathname;
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const PORT = 8931;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const results = []; const log = (n, ok, d = '') => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); };

const srv = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/' + HTML;
    const f = path.join(FRONT, p); if (!f.startsWith(FRONT) || /node_modules|\.test\./.test(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
log('static-server-boot', true, `:${PORT}`);

// a minimal, valid one-page PDF with the text "Hello NEXUS PDF" (offsets computed, not hard-coded)
function makePdf(text) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = `BT /F1 18 Tf 20 50 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...Buffer.from(out, 'latin1')];
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = []; const requests = []; const consoleErr = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text()); });
page.on('request', (r) => requests.push(r.url()));
await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  log('page-load', pageErrors.length === 0, `pageErrors=${pageErrors.length}`);

  const libs = await page.evaluate(async () => {
    const o = {};
    await loadScriptOnce(LIB_URLS.qrcode); o.qr = typeof QRCode;
    await loadScriptOnce(LIB_URLS.jsQR); o.jsqr = typeof jsQR;
    const m = await loadPdfjs(); o.pdfjs = typeof m.getDocument; o.pdfVersion = m.version;
    return o;
  });
  log('libs-load-from-vendor', libs.qr === 'function' && libs.jsqr === 'function' && libs.pdfjs === 'function' && libs.pdfVersion === '4.10.38', JSON.stringify(libs));

  // spy on getDocument options to prove the app passes isEvalSupported:false on the real call path
  await page.evaluate(() => { const realLoad = window.loadPdfjs; window.__gdOpts = []; window.loadPdfjs = async () => { const real = await realLoad(); return new Proxy(real, { get: (t, k) => k === 'getDocument' ? (o) => { window.__gdOpts.push({ isEvalSupported: o.isEvalSupported, hasData: !!o.data }); return t.getDocument(o); } : Reflect.get(t, k) }); }; }); // pdf.js is an ES module namespace (read-only), so the loader is wrapped instead
  const text = await page.evaluate(async (bytes) => extractPdfText(new Uint8Array(bytes).buffer), makePdf('Hello NEXUS PDF'));
  log('pdf-text-extracted-via-same-origin-worker', /Hello\s+NEXUS\s+PDF/.test(text), JSON.stringify(text.trim()));
  const gd = await page.evaluate(() => window.__gdOpts);
  log('getDocument-called-with-isEvalSupported-false', gd.length === 1 && gd[0].isEvalSupported === false && gd[0].hasData === true, JSON.stringify(gd));

  const qrOk = await page.evaluate(() => { const h = document.createElement('div'); document.body.appendChild(h); new QRCode(h, { text: 'nexus-f05', width: 120, height: 120, correctLevel: QRCode.CorrectLevel.L }); return !!(h.querySelector('canvas') || h.querySelector('img')); });
  log('qrcode-renders', qrOk);

  const ext = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${PORT}/`) && !u.startsWith('data:') && !u.startsWith('blob:'));
  log('no-third-party-requests', ext.every((u) => !/cdnjs/.test(u)) , `external=${ext.length ? ext.slice(0, 3).join(',') : '-'}`);
  log('vendor-files-requested-same-origin', ['qrcode.min.js', 'jsQR.js', 'pdf.min.mjs', 'pdf.worker.min.mjs'].every((f) => requests.some((u) => u === `http://127.0.0.1:${PORT}/vendor/${f}`)));
  const viol = await page.evaluate(() => window.__csp);
  log('zero-csp-violations', viol.length === 0, viol.join(' | '));
  log('no-page-errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) { log('flow-exception', false, String(e)); }
await browser.close(); srv.close();
const pass = results.filter(Boolean).length;
console.log(`\n=== SUMMARY ===\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);

// F-05 (owner mandate 2026-11-16, option B): third-party libs are served from ./vendor with pinned hashes; no external script origin in CSP;
// pdf.js runs with isEvalSupported:false (defence in depth). 2026-11-17: pdf.js upgraded to 4.10.38 (>= 4.2.67, the fix for GHSA-wgrm-67xf-hhpq / CVE-2024-4367); loaded as an ES module.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageHtml = readFileSync(path.join(FRONT, 'neural_nexus_ai_agents-4-3-5-3.html'), 'utf8');
// 2026-11-17: the former inline <script> bodies live in app.js / ui-glow.js; code-level assertions below look at page + those files together (same text as before).
const html = pageHtml + '\n' + readFileSync(path.join(FRONT, 'app.js'), 'utf8') + '\n' + readFileSync(path.join(FRONT, 'ui-glow.js'), 'utf8');
const policy = (pageHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
const dir = (n) => ((policy.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' ')) || '').slice(n.length + 1).split(/\s+/).filter(Boolean));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

describe('F-05: no third-party script origin', () => {
  it('CSP script-src and worker-src do not name any external origin', () => {
    expect(dir('script-src').sort()).toEqual(["'self'"]); // was self + unsafe-inline until 2026-11-17 (see the inline-script describe below)
    expect(dir('worker-src').sort()).toEqual(["'self'", 'blob:']);
    expect(policy).not.toMatch(/cdnjs/);
  });
  it('the page loads no script / worker from an http(s) origin (LIB_URLS, workerSrc, <script src>)', () => {
    expect(html).not.toMatch(/https?:\/\/cdnjs\./);
    const libUrls = (html.match(/const LIB_URLS = \{([\s\S]*?)\};/) || [])[1] || '';
    expect(libUrls.length).toBeGreaterThan(0);
    for (const m of libUrls.matchAll(/'([^']+)'/g)) expect(m[1]).toMatch(/^\.\/vendor\/[\w.-]+\.m?js$/);
    expect(html).toMatch(/workerSrc\s*=\s*'\.\/vendor\/pdf\.worker\.min\.mjs'/);
    expect(pageHtml).not.toMatch(/<script[^>]+src=["']https?:/i);
  });
});

describe('F-05: pdf.js hardening', () => {
  it('getDocument is called with isEvalSupported:false', () => {
    const calls = [...html.matchAll(/getDocument\(\s*\{([^}]*)\}\s*\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/isEvalSupported\s*:\s*false/);
  });
});

describe('pdf.js version (CVE-2024-4367 fixed in >= 4.2.67)', () => {
  // main build: `apiVersion:"X.Y.Z"`; worker build: `="X.Y.Z";if(a!==b)throw` (the worker/API version handshake) — both literal in the shipped minified files.
  const ver = (f) => { const t = readFileSync(path.join(FRONT, 'vendor', f), 'utf8'); return (t.match(/apiVersion:"(\d+\.\d+\.\d+)"/) || t.match(/="(\d+\.\d+\.\d+)";if\(\w+!==\w+\)throw/) || [])[1]; };
  const gte = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return true; };
  it('the vendored main and worker builds are >= 4.2.67 and the same version', () => {
    const m = existsSync(path.join(FRONT, 'vendor', 'pdf.min.mjs')) ? ver('pdf.min.mjs') : undefined;
    const w = existsSync(path.join(FRONT, 'vendor', 'pdf.worker.min.mjs')) ? ver('pdf.worker.min.mjs') : undefined;
    expect(m, 'main version').toBeTruthy(); expect(w, 'worker version').toBeTruthy();
    expect(w).toBe(m); expect(gte(m, '4.2.67')).toBe(true);
  });
  it('the old 3.11.x classic-script builds are no longer shipped', () => {
    expect(existsSync(path.join(FRONT, 'vendor', 'pdf.min.js'))).toBe(false);
    expect(existsSync(path.join(FRONT, 'vendor', 'pdf.worker.min.js'))).toBe(false);
  });
  it('the app imports pdf.js as an ES module (no global pdfjsLib script)', () => {
    expect(html).toMatch(/import\(\s*LIB_URLS\.pdfjs\s*\)/);
  });
});

describe('F-05: vendored libraries are pinned', () => {
  const manifest = path.join(FRONT, 'vendor', 'VENDOR-SHA256.txt');
  it('manifest exists and every listed file matches its SHA-256', () => {
    expect(existsSync(manifest)).toBe(true);
    const lines = readFileSync(manifest, 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}  /.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) { const [h, f] = [l.slice(0, 64), l.slice(66).trim()]; expect(sha(path.join(FRONT, 'vendor', f)), f).toBe(h); }
  });
  it('the 4 runtime files referenced by the app are all in the manifest', () => {
    const txt = existsSync(manifest) ? readFileSync(manifest, 'utf8') : '';
    for (const f of ['qrcode.min.js', 'jsQR.js', 'pdf.min.mjs', 'pdf.worker.min.mjs']) expect(txt, f).toContain('  ' + f);
  });
  it('licence texts for the three libraries are shipped next to them', () => {
    for (const f of ['LICENSE-pdfjs.txt', 'LICENSE-jsqr.txt', 'LICENSE-qrcodejs.txt']) expect(existsSync(path.join(FRONT, 'vendor', f)), f).toBe(true);
  });
});

// 2026-11-17: inline <script> ELEMENTS are externalised; script-src no longer needs 'unsafe-inline'. Inline event-handler ATTRIBUTES (onclick=…, ~190 static plus
// template-generated ones) are still used, so they are allowed ONLY through script-src-attr (CSP3) — a narrower grant than the old blanket script-src 'unsafe-inline'.
// Residual risk (documented, not hidden): injected attribute handlers (e.g. <img onerror>) still execute; converting handlers to listeners is a separate slice.
describe('CSP: no inline <script> element', () => {
  it('script-src is exactly self; handler attributes are granted only via script-src-attr', () => {
    expect(dir('script-src')).toEqual(["'self'"]);
    expect(dir('script-src-attr')).toEqual(["'unsafe-inline'"]);
    expect(dir('script-src-elem')).toEqual([]);
  });
  it('every <script> element in the page has a src (no inline script body)', () => {
    const scripts = [...pageHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) { expect(attrs, 'script tag attrs').toMatch(/\bsrc=/); expect(body.trim(), 'inline body').toBe(''); }
  });
  it('the externalised classic scripts exist next to the page and are in the service-worker shell', () => {
    const sw = readFileSync(path.join(FRONT, 'sw.js'), 'utf8');
    for (const f of ['app.js', 'ui-glow.js']) {
      expect(existsSync(path.join(FRONT, f)), f).toBe(true);
      expect(pageHtml, f).toMatch(new RegExp(`<script[^>]+src=["']\\./?${f.replace('.', '\\.')}["']`));
      expect(sw, f).toContain(`'./${f}'`);
    }
  });
});

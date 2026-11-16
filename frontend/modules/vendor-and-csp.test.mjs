// F-05 (owner mandate 2026-11-16, option B): third-party libs are served from ./vendor with pinned hashes; no external script origin in CSP;
// pdf.js runs with isEvalSupported:false (mitigates GHSA-wgrm-67xf-hhpq / CVE-2024-4367 class for the pinned 3.11.174 build).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(FRONT, 'neural_nexus_ai_agents-4-3-5-3.html'), 'utf8');
const policy = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
const dir = (n) => ((policy.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' ')) || '').slice(n.length + 1).split(/\s+/).filter(Boolean));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

describe('F-05: no third-party script origin', () => {
  it('CSP script-src and worker-src do not name any external origin', () => {
    expect(dir('script-src').sort()).toEqual(["'self'", "'unsafe-inline'"]);
    expect(dir('worker-src').sort()).toEqual(["'self'", 'blob:']);
    expect(policy).not.toMatch(/cdnjs/);
  });
  it('the page loads no script / worker from an http(s) origin (LIB_URLS, workerSrc, <script src>)', () => {
    expect(html).not.toMatch(/https?:\/\/cdnjs\./);
    const libUrls = (html.match(/const LIB_URLS = \{([\s\S]*?)\};/) || [])[1] || '';
    expect(libUrls.length).toBeGreaterThan(0);
    for (const m of libUrls.matchAll(/'([^']+)'/g)) expect(m[1]).toMatch(/^\.\/vendor\/[\w.-]+\.js$/);
    expect(html).toMatch(/workerSrc\s*=\s*'\.\/vendor\/pdf\.worker\.min\.js'/);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
  });
});

describe('F-05: pdf.js hardening', () => {
  it('getDocument is called with isEvalSupported:false', () => {
    const calls = [...html.matchAll(/getDocument\(\s*\{([^}]*)\}\s*\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/isEvalSupported\s*:\s*false/);
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
    for (const f of ['qrcode.min.js', 'jsQR.js', 'pdf.min.js', 'pdf.worker.min.js']) expect(txt, f).toContain('  ' + f);
  });
  it('licence texts for the three libraries are shipped next to them', () => {
    for (const f of ['LICENSE-pdfjs.txt', 'LICENSE-jsqr.txt', 'LICENSE-qrcodejs.txt']) expect(existsSync(path.join(FRONT, 'vendor', f)), f).toBe(true);
  });
});

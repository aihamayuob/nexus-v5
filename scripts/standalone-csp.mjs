#!/usr/bin/env node
// NEXUS Standalone — keeps the page's Content-Security-Policy <meta> in sync with the sha256 hashes of its single inline <style>
// and single inline <script>. Zero dependencies.
//   node scripts/standalone-csp.mjs           # rewrite the CSP meta in standalone/NEXUS-Standalone.html
//   node scripts/standalone-csp.mjs --check   # exit 1 if the CSP does not match the current inline code (used by tests / verify)
// The policy has no 'unsafe-inline' and no 'unsafe-eval': only the exact inline blocks that ship in the file can run.
// connect-src is http:/https: because the user types the backend URL at run time; the backend's own CORS allow-list is the gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.find((a) => a.endsWith('.html')) || path.join(ROOT, 'standalone/NEXUS-Standalone.html');
const html = readFileSync(FILE, 'utf8');

const blocks = (tag) => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
const scripts = blocks('script');
const styles = blocks('style');
if (scripts.length !== 1 || styles.length !== 1) {
  console.error(`expected exactly 1 inline <script> and 1 <style>, found ${scripts.length}/${styles.length}`);
  process.exit(2);
}
if (/<script[^>]*\ssrc=/i.test(html) || /<link[^>]*rel=["']?stylesheet/i.test(html)) { console.error('external script/stylesheet is forbidden'); process.exit(2); }
if (/\sstyle\s*=/i.test(html) || /\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ''))) { console.error('inline style= / on*= attributes are forbidden by the CSP'); process.exit(2); }
const h = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const csp = [
  "default-src 'none'",
  `script-src ${h(scripts[0])}`,
  `style-src ${h(styles[0])}`,
  'connect-src http: https:',
  "img-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const re = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/;
const m = html.match(re);
if (!m) { console.error('CSP meta tag not found'); process.exit(2); }
if (process.argv.includes('--check')) {
  if (m[2] !== csp) { console.error('CSP is STALE — run: node scripts/standalone-csp.mjs'); process.exit(1); }
  console.log('CSP OK  ' + csp.split('; ').slice(0, 3).join('; ').replace(/sha256-[^']+/g, 'sha256-…'));
  process.exit(0);
}
writeFileSync(FILE, html.replace(re, `$1${csp}$3`));
console.log('CSP updated:\n  ' + csp.split('; ').join('\n  '));

#!/usr/bin/env node
// NEXUS — build ONE self-contained HTML file from the repo's latest frontend (frontend/): the HTML shell + app.js + ui-glow.js + main.js + modules/*.mjs +
// vendor/ (qrcode, jsQR, pdf.js + worker; SHA-256 verified against vendor/VENDOR-SHA256.txt before embedding). Zero dependencies, deterministic output.
// The repo sources stay the single source of truth; the output is a GENERATED artifact (default: frontend/dist/NEXUS-single-file.html, git-ignored).
//
// What is transformed (every replacement is asserted to match EXACTLY once, otherwise the build fails):
//   * <script type="module" src="main.js"> -> one inline module: the 5 modules are wrapped in strict-mode IIFEs (no cross-imports exist; export-only
//     syntax is asserted) and main.js's `import {..} from` lines become destructuring from them. Same defer timing, same window bridges.
//   * <script src=app.js> / <script src=ui-glow.js> -> inline classic scripts (bytes unchanged except the 5 listed vendor/SW replacements).
//   * LIB_URLS / pdf worker './vendor/*' -> lazy blob: URLs made from base64 data blocks (<script type="text/plain">, never executed).
//   * Service-worker registration is disabled (sw.js is not shipped in a single file; no offline shell cache).
//   * CSP meta: identical to the repo's EXCEPT script-src = the SHA-256 of each inline script + blob: (replaces 'self'). Disclosed weakening: blob: in
//     script-src (needed for the embedded libraries); script-src-attr 'unsafe-inline' and style 'unsafe-inline' are inherited from the repo file.
// Usage: node scripts/build-single-file.mjs [--out FILE] [--check]    (--check: rebuild in memory and exit 1 if FILE differs)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const args = process.argv.slice(2);
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const OUT = path.resolve(outArg || path.join(FE, 'dist/NEXUS-single-file.html'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => readFileSync(path.join(FE, p), 'utf8');
const fail = (m) => { console.error('BUILD FAILED: ' + m); process.exit(1); };

function replaceOnce(text, from, to, what) {
  const i = text.indexOf(from);
  if (i < 0) fail(`${what}: pattern not found`);
  if (text.indexOf(from, i + 1) >= 0) fail(`${what}: pattern found more than once`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

// ---- sources
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
let html = read(HTML);
const appJs = read('app.js'), glowJs = read('ui-glow.js'), mainJs = read('main.js');
const MODS = ['security', 'storage', 'utilities', 'settings', 'state'];
const modSrc = Object.fromEntries(MODS.map((m) => [m, read(`modules/${m}.mjs`)]));

for (const [n, t] of Object.entries({ 'app.js': appJs, 'ui-glow.js': glowJs, 'main.js': mainJs, ...modSrc })) {
  if (/<\/script/i.test(t) || /<!--/.test(t)) fail(`${n} contains "</script" or "<!--" (cannot be inlined safely)`);
  if (/^await\s/m.test(t) || /import\.meta/.test(t)) fail(`${n} uses top-level await / import.meta (cannot be wrapped)`);
}

// ---- vendor (verify pins first)
const pins = Object.fromEntries(read('vendor/VENDOR-SHA256.txt').trim().split('\n').map((l) => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
const VENDOR = ['qrcode.min.js', 'jsQR.js', 'pdf.min.mjs', 'pdf.worker.min.mjs'];
const vendorB64 = {};
for (const f of VENDOR) {
  const buf = readFileSync(path.join(FE, 'vendor', f));
  if (sha256(buf) !== pins[f]) fail(`vendor/${f} does not match vendor/VENDOR-SHA256.txt`);
  vendorB64[f] = buf.toString('base64');
}

// ---- modules -> IIFEs
function wrapModule(name, src) {
  const exported = [];
  const body = src.split('\n').map((line) => {
    const m = /^export\s+((?:async\s+)?function\*?\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { exported.push(m[2]); return line.replace(/^export\s+/, ''); }
    return line;
  });
  const joined = body.join('\n');
  if (/^\s*export\s/m.test(joined)) fail(`modules/${name}.mjs has an export form this builder does not handle`);
  if (/^\s*import\s/m.test(joined)) fail(`modules/${name}.mjs imports another module (not supported)`);
  return `const __nxmod_${name} = (function(){\n'use strict';\n${joined}\n;return { ${exported.join(', ')} };\n})();`;
}
const wrapped = MODS.map((m) => wrapModule(m, modSrc[m])).join('\n');
let main = mainJs;
for (const m of MODS) {
  const re = new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*['"]\\./modules/${m}\\.mjs['"];?\\s*$`, 'm');
  const mm = re.exec(main);
  if (!mm) fail(`main.js: import from modules/${m}.mjs not found`);
  main = main.replace(re, `const {${mm[1]}} = __nxmod_${m};`);
}
if (/^\s*import\s/m.test(main)) fail('main.js has an import this builder does not handle');
const moduleScript = `\n${wrapped}\n${main}\n`;

// ---- app.js: vendor + service worker
const PRELUDE = `/* NEXUS single-file build: embedded vendor libraries (base64 data blocks, SHA-256 verified at build time) exposed as lazy blob: URLs */
const __nxVendorUrls = {};
function __nxVendorUrl(file, mime){
  if(__nxVendorUrls[file]) return __nxVendorUrls[file];
  const el = document.getElementById('nx-vendor-' + file);
  if(!el) throw new Error('embedded vendor library missing: ' + file);
  const bin = atob(el.textContent.trim());
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return (__nxVendorUrls[file] = URL.createObjectURL(new Blob([bytes], { type: mime })));
}
`;
let app = appJs;
app = replaceOnce(app, "qrcode: './vendor/qrcode.min.js',", "get qrcode(){ return __nxVendorUrl('qrcode.min.js','text/javascript'); },", 'LIB_URLS.qrcode');
app = replaceOnce(app, "jsQR: './vendor/jsQR.js',", "get jsQR(){ return __nxVendorUrl('jsQR.js','text/javascript'); },", 'LIB_URLS.jsQR');
app = replaceOnce(app, "pdfjs: './vendor/pdf.min.mjs',", "get pdfjs(){ return __nxVendorUrl('pdf.min.mjs','text/javascript'); },", 'LIB_URLS.pdfjs');
app = replaceOnce(app, "pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';", "pdfjs.GlobalWorkerOptions.workerSrc = __nxVendorUrl('pdf.worker.min.mjs','text/javascript');", 'pdf worker');
app = replaceOnce(app, "if('serviceWorker' in navigator){\n    navigator.serviceWorker.register('sw.js')", "if(false /* single-file build: sw.js is not shipped */ && 'serviceWorker' in navigator){\n    navigator.serviceWorker.register('sw.js')", 'service worker');
const appScript = `\n${PRELUDE}${app}\n`;
const glowScript = `\n${glowJs}\n`;

// ---- HTML
const hash = (t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;
const hashes = [moduleScript, appScript, glowScript].map(hash);
const csp = `default-src 'self'; script-src ${hashes.join(' ')} blob:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http: https: ws: wss:; manifest-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'`;

const cspRe = /<!-- Release V1 · B4 — Content-Security-Policy \(meta\)[\s\S]*?-->\s*<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
if (!cspRe.test(html)) fail('CSP comment+meta block not found');
html = html.replace(cspRe, () => `<!-- NEXUS single-file build — Content-Security-Policy (meta). Same policy as the repo's frontend EXCEPT script-src: 'self' is replaced by the SHA-256 of each of the
     three inline scripts + blob: (needed for the embedded qrcode/jsQR/pdf.js libraries, created from base64 data blocks that were SHA-256-verified at build time).
     Inherited, disclosed weaknesses: script-src-attr 'unsafe-inline' (inline on*= handlers) and style-src 'unsafe-inline'. frame-ancestors/HSTS cannot be set from a meta tag.
     Opened from file:// the page loads but the browser blocks calls to the backend (origin "null" is not in the backend CORS allow-list): serve it over HTTP, e.g.
     "npm run nexus" then http://localhost:8080/dist/NEXUS-single-file.html -->
<meta http-equiv="Content-Security-Policy" content="${csp}">`);

const stamp = `<!-- GENERATED by scripts/build-single-file.mjs — do not edit. Sources (SHA-256): html ${sha256(read(HTML)).slice(0, 16)}… app.js ${sha256(appJs).slice(0, 16)}… main.js ${sha256(mainJs).slice(0, 16)}… ui-glow.js ${sha256(glowJs).slice(0, 16)}… modules ${MODS.map((m) => sha256(modSrc[m]).slice(0, 8)).join(',')} -->\n`;
html = replaceOnce(html, '<head>', '<head>\n' + stamp, 'head');

const vendorBlocks = VENDOR.map((f) => `<script type="text/plain" id="nx-vendor-${f}">${vendorB64[f]}</script>`).join('\n');
html = replaceOnce(html, '<script type="module" src="main.js"></script>', `${vendorBlocks}\n<script type="module">${moduleScript}</script>`, 'main.js tag');
html = replaceOnce(html, '<script src="./app.js"></script>', `<script>${appScript}</script>`, 'app.js tag');
html = replaceOnce(html, '<script src="./ui-glow.js"></script>', `<script>${glowScript}</script>`, 'ui-glow.js tag');
if (/<script[^>]*\ssrc=/i.test(html)) fail('an external <script src> remains');
if (/<link[^>]+rel=["']?stylesheet/i.test(html)) fail('an external stylesheet remains');

if (args.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== html) { console.error('CHECK FAILED: ' + OUT + ' is missing or stale — rebuild'); process.exit(1); }
  console.log('CHECK OK: ' + OUT + ' matches the sources (sha256 ' + sha256(html) + ')');
} else {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  console.log(`built ${OUT}\n  size ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MiB  sha256 ${sha256(html)}\n  inline scripts: 3 (CSP-hashed) + 4 vendor data blocks (not executed)`);
}

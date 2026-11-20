#!/usr/bin/env node
// NEXUS Standalone — safe local launcher (zero dependencies). Serves standalone/NEXUS-Standalone.html over HTTP on 127.0.0.1 and,
// unless --no-backend is given, starts the BUILT backend with a CORS allow-list that contains ONLY this page's origin.
// The backend's CORS/auth policy is never loosened: this script only passes the standard NEXUS_CORS_ORIGINS / NEXUS_GATEWAY_KEYS vars.
//
//   npm --prefix src-baseline/nexus-backend ci && npm --prefix src-baseline/nexus-backend run build   # once
//   node scripts/nexus-standalone.mjs                  # backend + page
//   node scripts/nexus-standalone.mjs --no-backend     # page only; then run your own backend with
//                                                      #   NEXUS_CORS_ORIGINS=http://127.0.0.1:8090 (the page origin)
// Env (optional): NEXUS_STANDALONE_PORT (8090), NEXUS_PORT (8787), NEXUS_GATEWAY_KEYS (random if empty), plus any NEXUS_* backend variable.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_DIR = path.join(ROOT, 'src-baseline/nexus-backend');
const PAGE = path.join(ROOT, 'standalone/NEXUS-Standalone.html');
const UI_PORT = Number(process.env.NEXUS_STANDALONE_PORT || 8090);
const API_PORT = Number(process.env.NEXUS_PORT || 8787);
const noBackend = process.argv.includes('--no-backend');
const ORIGIN = `http://127.0.0.1:${UI_PORT}`;

if (!existsSync(PAGE)) { console.error('standalone/NEXUS-Standalone.html not found'); process.exit(2); }
if (!noBackend && !existsSync(path.join(BACKEND_DIR, 'dist/index.js'))) {
  console.error('Backend is not built. Run:\n  npm --prefix src-baseline/nexus-backend ci && npm --prefix src-baseline/nexus-backend run build');
  process.exit(2);
}
const key = process.env.NEXUS_GATEWAY_KEYS || randomBytes(24).toString('base64url');

// The page is the ONLY thing served (no directory listing, no other files). Same-origin only; no CORS headers are added here.
const ui = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (p !== '/' && p !== '/NEXUS-Standalone.html') { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(PAGE));
  } catch { res.writeHead(500); res.end('error'); }
});

let be = null;
if (!noBackend) {
  be = spawn(process.execPath, ['--experimental-sqlite', '--enable-source-maps', 'dist/index.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, NODE_ENV: 'production', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(API_PORT), NEXUS_GATEWAY_KEYS: key,
      NEXUS_CORS_ORIGINS: process.env.NEXUS_CORS_ORIGINS || ORIGIN },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  be.on('exit', (c) => { console.error(`backend exited (${c})`); process.exit(c ?? 1); });
}
ui.listen(UI_PORT, '127.0.0.1', () => {
  console.log(`\nNEXUS Standalone is starting.\n  Open this:    ${ORIGIN}/NEXUS-Standalone.html${noBackend ? '' : `\n  API address:  http://127.0.0.1:${API_PORT}\n  Gateway key:  ${key}\n  (paste both into the page's Connect tab; the key is kept in page memory only)`}\n  Stop: Ctrl+C\n  Opening the .html via file:// will NOT reach the backend (browser CORS restriction) — only the DEMO/SIMULATED mode works there.\n`);
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { be?.kill('SIGTERM'); ui.close(); setTimeout(() => process.exit(0), 300); });

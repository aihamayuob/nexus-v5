#!/usr/bin/env node
// NEXUS — one-command local runner (zero dependencies). Starts the BUILT backend (dist/) and serves the frontend over HTTP
// (ES modules do not work from file://). Local/trusted-LAN use only: binds 127.0.0.1, generates a gateway key if none is given.
//
//   npm --prefix src-baseline/nexus-backend ci && npm --prefix src-baseline/nexus-backend run build   # once
//   node scripts/nexus-run.mjs                                                                            # then this
//
// Env (all optional): NEXUS_UI_PORT (8080), NEXUS_PORT (8787), NEXUS_GATEWAY_KEYS (generated if empty), NEXUS_DB_PATH (./data/nexus.db),
// plus any NEXUS_* provider variable from src-baseline/nexus-backend/.env.example (provider keys / Ollama / LM Studio URLs).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_DIR = path.join(ROOT, 'src-baseline/nexus-backend');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const UI_HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const UI_PORT = Number(process.env.NEXUS_UI_PORT || 8080);
const API_PORT = Number(process.env.NEXUS_PORT || 8787);

if (!existsSync(path.join(BACKEND_DIR, 'dist/index.js'))) {
  console.error('Backend is not built. Run:\n  npm --prefix src-baseline/nexus-backend ci && npm --prefix src-baseline/nexus-backend run build');
  process.exit(2);
}
const key = process.env.NEXUS_GATEWAY_KEYS || randomBytes(24).toString('base64url');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8' };

const ui = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '/NEXUS.html') p = '/' + UI_HTML; // alias: /NEXUS.html opens the app
    const file = path.resolve(FRONTEND_DIR, '.' + p);
    const rel = path.relative(FRONTEND_DIR, file);
    const ext = path.extname(file).toLowerCase();
    // serve only app files: inside frontend/, a known extension, never node_modules / tests / lockfiles
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules') || !MIME[ext] || /(^|\/)(vitest\.config|package(-lock)?)\./.test(rel) || /\.test\./.test(rel)) { res.writeHead(404); return res.end('not found'); }
    if (!(await stat(file)).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
});

const be = spawn(process.execPath, ['--experimental-sqlite', '--enable-source-maps', 'dist/index.js'], {
  cwd: BACKEND_DIR,
  env: { ...process.env, NODE_ENV: 'production', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(API_PORT), NEXUS_GATEWAY_KEYS: key,
    NEXUS_CORS_ORIGINS: process.env.NEXUS_CORS_ORIGINS || `http://localhost:${UI_PORT},http://127.0.0.1:${UI_PORT}` },
  stdio: ['ignore', 'inherit', 'inherit'],
});
be.on('exit', (c) => { console.error(`backend exited (${c})`); process.exit(c ?? 1); });
ui.listen(UI_PORT, '127.0.0.1', () => {
  console.log(`\nNEXUS is starting.\n  App (open this):  http://localhost:${UI_PORT}/NEXUS.html\n  Backend URL:      http://127.0.0.1:${API_PORT}\n  Gateway key:      ${key}\n  In the app: Settings ⚙️ → backend URL + key above (the key lives in page memory only).\n  Stop: Ctrl+C\n`);
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { be.kill('SIGTERM'); ui.close(); setTimeout(() => process.exit(0), 300); });

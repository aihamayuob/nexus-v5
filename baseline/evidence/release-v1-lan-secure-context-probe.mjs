// Probe (evidence for docs/DEPLOYMENT-LAN.md): what happens when the frontend is opened over plain HTTP from a NON-loopback address?
import { chromium } from '/tmp/claude-0/-home-claude/32993d6c-3079-5c91-b5d3-407731a6cd59/scratchpad/release/nexus-v5/e2e/node_modules/playwright/index.mjs';
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import path from 'node:path';
const DIR = process.env.NEXUS_FRONTEND_DIR || '/tmp/claude-0/-home-claude/32993d6c-3079-5c91-b5d3-407731a6cd59/scratchpad/release/nexus-v5/frontend';
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript' };
const srv = http.createServer(async (q, r) => { const u = new URL(q.url,'http://x'); const rel = u.pathname==='/'?'neural_nexus_ai_agents-4-3-5-3.html':u.pathname.slice(1);
  try { r.writeHead(200,{'content-type':MIME[path.extname(rel)]||'application/octet-stream'}); r.end(await readFile(path.join(DIR,rel))); } catch { r.writeHead(404); r.end(); } });
await new Promise(r => srv.listen(0,'0.0.0.0',r)); const port = srv.address().port;
const b = await chromium.launch();
for (const host of ['127.0.0.1', '192.0.2.2']) {
  const p = await (await b.newContext()).newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  await p.goto(`http://${host}:${port}/`, {waitUntil:'load'}); await p.waitForTimeout(3000);
  const o = await p.evaluate(() => ({ secure: window.isSecureContext, subtle: !!(crypto && crypto.subtle), sw: 'serviceWorker' in navigator, init: typeof encryptionKey !== 'undefined' && encryptionKey !== null }));
  console.log(host, JSON.stringify(o), 'pageerrors=', errs.length, errs[0]||'');
}
await b.close(); srv.close();

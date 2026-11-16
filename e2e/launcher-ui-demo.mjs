// NEXUS — demo/smoke through the ONE-COMMAND LAUNCHER (scripts/nexus-run.mjs): real browser -> /NEXUS.html -> real built backend -> SIMULATED local model.
// Proves the shipped runner serves a usable app on desktop and phone widths (Arabic/RTL), connects with the gateway key, and returns a model reply.
// Screenshots go to $NEXUS_SCENARIO_OUT/shots. The model is a fake Ollama-protocol server (SIMULATED); nothing leaves 127.0.0.1.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const OUT = process.env.NEXUS_SCENARIO_OUT || path.join(ROOT, 'scenario-out');
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok, d }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + String(d).slice(0, 220) : ''}`); };

let localHits = 0;
const fake = createServer(async (req, res) => {
  for await (const _ of req); // drain
  if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'fake-local:1b' }] })); }
  localHits++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'fake-local:1b', message: { role: 'assistant', content: 'مرحبًا! هذا رد محاكى من النموذج المحلي التجريبي.' }, done: true, prompt_eval_count: 3, eval_count: 9 }));
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const UI = 18400 + Math.floor(Math.random() * 400), API = UI + 500;
const db = path.join(mkdtempSync(path.join(tmpdir(), 'nexus-demo-')), 'n.db');
const run = spawn(process.execPath, [path.join(ROOT, 'scripts/nexus-run.mjs')], {
  env: { ...process.env, NEXUS_UI_PORT: String(UI), NEXUS_PORT: String(API), NEXUS_DB_PATH: db, NEXUS_LOG_LEVEL: 'warn', NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${fake.address().port}`, NEXUS_MODEL_OLLAMA: 'fake-local:1b' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; run.stdout.on('data', (d) => (out += d)); run.stderr.on('data', (d) => (out += d));
let key = null;
for (let i = 0; i < 60 && !key; i++) { await sleep(250); key = /Gateway key:\s+(\S+)/.exec(out)?.[1] || null; }
let up = false;
for (let i = 0; i < 40 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${API}/v2/health`).then((r) => r.ok).catch(() => false); }
check('launcher printed a gateway key and the backend came up', !!key && up, key ? 'key printed' : out.slice(0, 200));

const browser = await chromium.launch();
const errors = [];
async function session(name, viewport, locale) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${UI}/NEXUS.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 20000 });
  await page.evaluate(() => openSettingsPanel());
  await page.fill('#backendUrlInput', `http://127.0.0.1:${API}`);
  await page.fill('#gatewayKeyInput', key);
  await page.click('button[onclick="saveBackendUrl()"]');
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'shots', `${name}-settings-connected.png`) });
  await page.evaluate(() => { if (typeof closeSettingsPanel === 'function') closeSettingsPanel(); });
  // choose the local model through the real control path and send through the real UI
  await page.evaluate(() => { localStorage.setItem('nexus_local_model_name', 'fake-local:1b'); if (isSimpleMode()) toggleSimpleMode(); const sel = document.getElementById('chatModelSelect'); sel.value = 'ollama'; saveChatModelSetting(); });
  await page.fill('#msgInput', 'مرحبًا، هل تعمل المنصة؟');
  await page.click('#sendBtn');
  await page.waitForFunction(() => !isSendingMessage && !document.getElementById('sendBtn').disabled, null, { timeout: 60000 }).catch(() => {});
  await sleep(500);
  const last = await page.evaluate(() => (messages[messages.length - 1] || {}).content || '');
  await page.screenshot({ path: path.join(OUT, 'shots', `${name}-chat-reply.png`), fullPage: false });
  const dir = await page.evaluate(() => getComputedStyle(document.documentElement).direction + '/' + document.documentElement.lang);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await ctx.close();
  return { last, dir, overflow };
}
const desk = await session('desktop-1280', { width: 1280, height: 800 }, 'ar');
check('desktop: UI served via /NEXUS.html connected to the backend and returned the (simulated) local model reply', /رد محاكى/.test(desk.last), desk.last.slice(0, 100));
const mob = await session('phone-390', { width: 390, height: 844 }, 'ar');
check('phone 390px: same flow works', /رد محاكى/.test(mob.last), mob.last.slice(0, 100));
check('phone 390px: no horizontal page overflow', mob.overflow <= 1, `overflowPx=${mob.overflow}`);
check('Arabic/RTL document direction is applied', /rtl/.test(desk.dir) && /rtl/.test(mob.dir), `${desk.dir} ${mob.dir}`);
check('the model server received the requests (UI -> backend -> model path is real)', localHits >= 2, `localHits=${localHits}`);
check('no uncaught page errors', errors.length === 0, errors.join(' | '));
await browser.close(); run.kill('SIGTERM'); fake.close();
writeFileSync(path.join(OUT, 'launcher-ui-demo-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), simulated: 'ollama-protocol fake local model', results }, null, 2));
const fails = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${results.length - fails}/${results.length}; LAUNCHER-UI-DEMO-VERDICT = ${fails ? 'REJECTED' : 'ACCEPTED (simulated model)'}`);
process.exit(fails ? 1 : 0);

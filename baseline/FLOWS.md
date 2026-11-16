# FLOWS.md — NEXUS v5.0 Baseline Critical Flows (Phase 0)

Status: DONE (backend flows) / DONE (frontend flows tested) / PARTIAL
(full multi-provider chat success path — no live provider key in this
sandbox, disclosed, consistent with all prior sessions on this project)

Reproduction: `cd /home/claude/nexus-v5 && node e2e/baseline-flows.mjs`
(spawns the real compiled backend + a static file server for the real,
untouched HTML, drives a real headless Chromium via Playwright)
Raw run log: `baseline/evidence/e2e-run.log`

---

## Flow 1 — Backend boot

**Steps**: `node --experimental-sqlite --enable-source-maps dist/index.js`
with `NEXUS_PORT` set.
**Expected**: process logs `"Nexus backend listening"` and stays up.
**Observed**: PASS — `{"msg":"Nexus backend listening","host":"0.0.0.0","port":8799,"env":"development"}`
**Evidence**: `baseline/evidence/server-boot.log`, `server-boot2.log`

## Flow 2 — Health check (skipAuth route)

**Steps**: `curl http://127.0.0.1:8787/v2/health`
**Expected**: 200, no auth required.
**Observed**: PASS — `HTTP_200 {"ok":true,"version":2,"runningCount":0,"maxConcurrency":8}`

## Flow 3 — Gateway auth enforcement

**Steps**: `curl http://127.0.0.1:8788/v2/missions/fake-id` (no key), then
with `Authorization: Bearer wrongkey`, then with the real configured key.
**Expected**: 401 / 401 / past-auth response (404 "Mission not found" is
correct once auth passes, since the id is fake).
**Observed**: PASS, exactly as expected —
```
no key:      HTTP_401 {"code":"auth_error"}
wrong key:   HTTP_401 {"code":"auth_error"}
correct key: HTTP_404 {"message":"Mission غير موجودة.","code":"not_found"}
```

## Flow 4 — Rate limiting (burst)

**Steps**: 25 rapid sequential `GET /v2/health` requests from one client.
**Expected**: first `NEXUS_RATE_LIMIT_BURST` (default 20) succeed, then 429.
**Observed**: PASS — 20× `200`, then 5× `429`, exact boundary at request 21.

## Flow 5 — TypeScript build pipeline

**Steps**: `npm run typecheck`, `npm run build`, `npm test`, `npm audit`
**Observed**: all PASS —
- typecheck: exit 0, no errors (`baseline/evidence/` — see METRICS.md)
- build: exit 0, `dist/` produced with all 30 module dirs + `index.js`
- test: **406/406 passing**, 0 failed, 0 skipped (matches the number
  recorded at the end of the prior session — no regression)
- audit: **0 vulnerabilities**

## Flow 6 — Frontend page load (real browser, real file)

**Steps**: serve `frontend/neural_nexus_ai_agents-4-3-5-3.html` statically,
load in headless Chromium, read `document.title`.
**Observed**: PASS — title `"Neural Nexus AI Agents — منصة الوكلاء الحية"`.
Two benign console warnings observed and understood, not bugs:
- `sw.js` MIME type error — an artifact of our minimal static server
  (which serves everything as the same content type) not the app; the
  file references a real service worker that a real deployment's web
  server would serve correctly. **Not evaluated further — out of scope
  for Phase 0**, flagged for Phase 3/4 review if desired.
- Initial CORS rejection on `/api/chat` when frontend and backend were
  served from **different origins with `NEXUS_CORS_ORIGINS` unset** — this
  is the backend's CORS guard working *correctly*, not a bug. Confirmed
  by re-running with `NEXUS_CORS_ORIGINS` set to the frontend's origin,
  after which the request succeeded end-to-end (Flow 8).

## Flow 7 — Settings panel: configure backend URL + gateway key

**Steps**: call `openSettingsPanel()`, fill `#backendUrlInput` +
`#gatewayKeyInput`, call `saveBackendUrl()`, read back
`localStorage['nexus_backend_url']`.
**Observed**: PASS — modal opens (`display:flex`), value persisted exactly
as entered (`http://127.0.0.1:8799`).

## Flow 8 — Chat send, no provider configured (clean error path)

**Steps**: type a message into `#msgInput`, click `#sendBtn`, wait, read
`#chatArea` innerText.
**Expected** (per prior sessions' established behavior): a clean,
human-readable error — not a crash, not raw JS exception.
**Observed**: PASS — exact rendered text:
```
أنت
اختبار أساسي — Phase 0 baseline
خطأ
فشل الاتصال بـ API: 400 — {"error":{"message":"مزود \"anthropic\" يحتاج
مفتاح API مُعدّ على السيرفر.","code":"validation_error","retryable":false}}
```
Zero uncaught `pageerror` events during the whole session (Playwright
`page.on('pageerror')` listener, empty array at end of run).

## Flow 9 — NEXUS Ops Center modal (Advanced Mode)

**Steps**: force Advanced Mode (`document.body.classList.remove('simple-mode')`),
call the real opener function found in source (`openNexusOps()`), check
`#nexusOpsModal` computed `display`.
**Observed**: PASS — modal becomes visible (`display:flex`).

## Flow 10 — Workspace modal

**Steps**: call `openWorkspace('overview')`, check `#workspaceModal`.
**Observed**: PASS — modal becomes visible.

---

## Not exercised in Phase 0 (explicitly out of scope, disclosed — not a gap)

- Full success-path chat/mission/council/etc. with a real configured LLM
  provider — no provider API key available in this sandbox. Consistent
  with every prior session on this project; request/response contracts
  were already verified structurally in Flow 8 (clean, correct error
  shape when a provider is unconfigured).
- MQTT broker transport (raw TCP, no browser-reachable surface — prior
  sessions covered this over real TCP; not re-tested in Phase 0 since it
  requires a dedicated MQTT client harness, not a browser flow).
- The 20 individual `.modal-overlay` dialogs beyond Settings/Ops
  Center/Workspace (Schedules, Agent editor, Knowledge Base, Sandbox,
  Scenario, etc.) — each is a real, separate critical flow; enumerating
  and testing all 20 was judged out of Phase 0's baseline scope (inventory
  + representative sampling, not exhaustive regression) and is flagged as
  a candidate for a dedicated regression pass before/after Phase 2
  (modularization), where behavior-preservation risk is highest.

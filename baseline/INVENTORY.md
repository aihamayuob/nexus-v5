# INVENTORY.md — NEXUS v5.0 Baseline (Phase 0)

Status: DONE
Evidence root: `/home/claude/nexus-v5/baseline/evidence/`
Reproduction root: `/home/claude/nexus-v5/`

All commands below are reproducible from a clean checkout of this repo's
`v5.0-polish` branch. No application code was modified to produce this
document (see ADR/000-baseline.md for the explicit constraint).

---

## 1. Ground-truth sources (per protocol §3)

| Source | Path in repo | Verified |
|---|---|---|
| Frontend | `frontend/neural_nexus_ai_agents-4-3-5-3.html` | 12,036 lines, 928K — `wc -l frontend/*.html` |
| Backend | `src-baseline/nexus-backend/` (from `nexus-backend-resilience-verified.zip`) | 134 src `.ts` files, 58 test `.ts` files, 21,470 total LOC — `find src test -name '*.ts' | xargs wc -l` |
| Context doc | `FINAL-HTML-INTEGRATION-REPORT.md` | 238 lines, documentary only, not treated as evidence |

Per Aiham's explicit instruction, **4-3-5-3 is the official baseline** — no
diff against 4-3-5-2 was performed and none is claimed.

---

## 2. Project structure

### Frontend
Single self-contained HTML file (`frontend/neural_nexus_ai_agents-4-3-5-3.html`):
- 2 `<script>` blocks (style + logic), 408 top-level `function`/`async function`
  declarations, 20 `.modal-overlay` modals, all client-side state in
  `localStorage`/`IndexedDB` (no server-rendered templating).
- No build step — the file is served as-is.

### Backend (`src-baseline/nexus-backend/`)
Node.js 22+ / TypeScript, ESM (`"type": "module"`), zero runtime
`dependencies` (confirmed: `package.json` → `"dependencies": {}`). Only
`devDependencies` are `typescript` and `@types/node`.

Top-level `src/` modules (30 directories):
```
agents  capability  config  core  council  dreaming  evaluation  evolution
finetuning  gateway  intent  iot  knowledge  memory  metacognition
observability  orchestrator  persistence  providers  research  routes
sandbox  scheduler  security  streaming  swarm  tools  warden
index.ts
```

Persistence: SQLite via `node:sqlite` (experimental, `--experimental-sqlite`
flag required at runtime — confirmed in `package.json`'s `start` script).
15 migrations present (`src/persistence/migrations/001` through `015`),
26 repository classes under `src/persistence/repositories/`.

---

## 3. Frontend/backend boundary

- Frontend talks to backend exclusively over HTTP, base URL configurable at
  runtime via Settings panel (`#backendUrlInput`, saved to
  `localStorage['nexus_backend_url']`, function `saveBackendUrl()` at
  `frontend/...html:5786` area).
- Auth: optional Bearer token from `#gatewayKeyInput`, sent via
  `syncAuthHeaders()` (`frontend/...html:4621`).
- CORS: backend requires `NEXUS_CORS_ORIGINS` to be set when frontend origin
  differs from backend origin (confirmed empirically — see FLOWS.md §3).

---

## 4. Real API surface (extracted from source, not assumed)

Command: `grep -rhoE "router\.(get|post|patch|delete|put)\('[^']+'" src/routes/ | sort -u`
(full reproducible output saved at `baseline/evidence/api-routes.txt`)

**86 routes total** — 17 legacy (`/api/*`) + 69 v2 (`/v2/*`).
v2 breakdown by domain (from evidence file, `grep ' /v2/' ... | sed ... | sort | uniq -c`):

| Domain | Routes | Domain | Routes |
|---|---|---|---|
| knowledge-freshness | 7 | warden | 4 |
| iot | 7 | tasks | 4 |
| finetuning | 7 | metacognition | 4 |
| missions | 6 | dreaming | 4 |
| evolution | 6 | council | 4 |
| evaluation | 6 | approvals | 2 |
| swarm / route / research / providers / observability / models / feedback / budget | 1 each | | |

Only **2 routes skip auth** (`skipAuth: true`, confirmed via grep of
`src/gateway/router.ts` call sites): `GET /v2/health` and `POST /api/embed`
(the latter documented in-code as matching a frontend gap — no
`Authorization` header sent for embeddings).

---

## 5. Storage / persistence boundaries

- **Backend**: SQLite file at `NEXUS_DB_PATH` (default `./data/nexus.db`),
  15 migrations, 26 repositories — one per bounded-context table group.
- **Frontend**: `localStorage` (67 references) for settings/preferences/
  small state; `IndexedDB` (5 references) for larger persisted data
  (per prior-session history: message archive, image storage).

---

## 6. Security-relevant surface (inventory only — no fixes in Phase 0)

| Check | Count | Command |
|---|---|---|
| `eval(` | 1 match, **confirmed false positive** — line 2458 is a comment: `// Real recursive-descent parser — NOT eval().` | `grep -n 'eval(' frontend/*.html` |
| `document.write` | 0 | `grep -c 'document\.write' frontend/*.html` |
| `.innerHTML` | 153 | `grep -c '\.innerHTML' frontend/*.html` |
| `.textContent` | 82 | `grep -c '\.textContent' frontend/*.html` |
| `escapeHtml` (usage sites) | 116 | `grep -c 'escapeHtml' frontend/*.html` |
| `onclick=` (pre-existing, inventory only) | 168 | `grep -o 'onclick=' frontend/*.html \| wc -l` |
| `npm audit` (backend) | 0 vulnerabilities | `npm audit` — see `baseline/evidence/npm-audit.log` |

No ratio claim (e.g. "X of Y innerHTML sites use escapeHtml") is made here
— that requires per-call-site classification not yet performed, and doing
so is Phase 1 (`/nexus-security`) work, not Phase 0 inventory.

---

## 7. PWA / providers / integration points

- Service worker referenced (`sw.js`) — confirmed present as a network
  request from the page (`Service worker registration failed` in our E2E
  console log is an artifact of our static server not serving `sw.js` with
  a JS MIME type; **not evaluated further in Phase 0**, flagged as a
  baseline observation only, see FLOWS.md §3).
- Provider adapters (backend): Anthropic, OpenAI, DeepSeek, Gemini, Ollama,
  LM Studio — confirmed via `.env.example` keys
  (`NEXUS_ANTHROPIC_API_KEY`, `NEXUS_OPENAI_API_KEY`,
  `NEXUS_DEEPSEEK_API_KEY`, `NEXUS_GEMINI_API_KEY`,
  `NEXUS_OLLAMA_BASE_URL`, `NEXUS_LMSTUDIO_BASE_URL`). None configured in
  this sandbox (no keys available) — this is a pre-existing, disclosed
  environment limitation, not a defect.

## 8. Major UI/state/orchestration paths (frontend, structural only)

Confirmed via grep + live DOM inspection (E2E, see FLOWS.md):
- `#settingsModal` / `openSettingsPanel()` — backend URL + gateway key config
- `#nexusOpsModal` — Ops Center (Missions/Council/Swarm/Warden/Evaluation/
  Genome/Knowledge-Freshness/IoT/Fine-Tuning), gated behind Advanced Mode
- `#workspaceModal` — Projects/Decision Journal/Topic Monitoring/Briefing
- `#chatArea` + `#msgInput` + `#sendBtn` — main chat flow
- `body.simple-mode` toggle gates all `.advanced-only` elements
- 20 total `.modal-overlay` dialogs in the document

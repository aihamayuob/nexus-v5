# IP / License / Security register — delta 2026-11-14

Additive to `continuity/mandate-2026-11-13/02-DEPENDENCIES-LICENSES-IP-REPORT.md` (project docs). No license was added, changed or removed. This is an engineering register, **not legal advice**.

## Dependencies (measured on this tree)
| Area | Result |
|---|---|
| Backend runtime dependencies | **0** (`"dependencies": {}`; uses Node built-ins incl. `node:sqlite`) |
| Backend devDependencies (52 locked packages, all `dev`) | licenses: **MIT 31, Apache-2.0 21**; new direct dev dep this session: `tsx 4.23.12` (MIT; pulls `esbuild` MIT, `@esbuild/*` MIT, `get-tsconfig` MIT, `resolve-pkg-maps` MIT) — previously used but **undeclared** (B-6) |
| `npm audit` backend | 0 vulnerabilities (full and `--omit=dev`) |
| Frontend (dev tooling only; no runtime npm dependency shipped) | `npm audit`: 6 (3 moderate, 3 high): `vitest`, `@vitest/coverage-v8`, `@vitest/mocker`, `vite`/`launch-editor`, `undici`, `source-map-js` — all transitive dev-tooling advisories; **not** in the shipped HTML; fix = dev-tool upgrade, not applied (scope) |

## IP items still open (unchanged, owner decision needed)
- 6 base64-embedded images in the frontend with **unknown provenance** (cannot be cleared by engineering evidence).
- No `LICENSE`/`NOTICE` at repository root: the project license is an owner decision; nothing was invented.
- CDN scripts without SRI hashes (third-party code loaded at runtime; their licenses are listed in the 2026-11-13 report).
- Deposit-root file `neural_nexus_ai_agents-4-3-5-3.html` in `aihamayuob/nexus-v5` (`ef7d5aaa…`) is **not** the baseline frontend; provenance UNVERIFIED; untouched.

## Security register (this session)
| ID | Finding | Status |
|---|---|---|
| F-01 | `/api/embed` was `skipAuth` (public) | **FIXED + VERIFIED**: 3 backend tests (RED 502≠401 → GREEN), FUI1 E2E assertion F1b with mutation check (RED when frontend header removed, GREEN restored) |
| F-02 | MCP endpoint exposure | designed least-privilege: authenticated, `pure` tools only; effectful never; `read_only` opt-in env (ADR-006) |
| F-03 | Planning-phase orphan mission never terminal | **OPEN** (owner decision) |
| F-04 | Row keeps requested provider after fallback | **OPEN** |
| F-05 | CDN w/o SRI; CSP `unsafe-inline` + broad `connect-src` | **OPEN** |
| F-06 | No TLS; XFF trust | **OPEN** (LAN-only deployment documented) |
| F-07 | Secrets | the scenarios/launcher use generated or test-only keys; no real secret was used, stored or committed; `.env.example` contains placeholders only |

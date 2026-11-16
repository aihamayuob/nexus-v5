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

## Addendum 2026-11-15 (additive)
- Lockfile license counts re-measured, unchanged: backend 52 dev (MIT 31, Apache-2.0 21); frontend 126 dev (MIT 95, MPL-2.0 12, BSD-3 5, Apache-2.0 4, ISC 4, MIT-0 2, BSD-2 2, BlueOak-1.0.0 1, CC0 1). `npm audit`: backend 0; frontend 6 (dev only).
- No dependency was added to any manifest. `@modelcontextprotocol/sdk` 1.32.2 (MIT) was installed in a scratch directory only, for the interop test.
- **D-PT-1** (provider timeout not enforced → unbounded hang on a silent provider; availability/DoS-class reliability defect): **FIXED + VERIFIED** (see `docs/REAL-PROVIDER-VALIDATION-2026-11-15.md` §5). F-03…F-06 and all IP items above: unchanged, still open.
- Secrets: the harness reads real keys only from the environment, never prints them, asserts they do not appear in responses or backend logs; no real credential was used in this round (only a deliberately invalid key was sent to the real Anthropic endpoint).

## Addendum 2026-11-15 R3 (additive; earlier lines above remain as written)
- **F-03 FIXED + VERIFIED; F-04 FIXED + VERIFIED** (plus a related defect found on the way: the fallback provider was sent the primary's model name) — `docs/F03-F04-CLOSURE-2026-11-15.md`. F-05 and F-06 remain open (owner decisions).
- Frontend dev-tooling vulnerabilities (6) **closed**: `npm audit` frontend 0, backend 0 (details and the npm-10 crash workaround in the closure doc §5). Frontend lock now 133 packages, all dev (MIT 101, MPL-2.0 12, …, 0BSD 1). CycloneDX SBOM of 2026-11-13 is stale for the frontend.
- **Correction**: the "6 base64-embedded images" line above is an overcount. Only 2 assets are embedded (SVG favicon, PNG 192×192 icon); the other 4 matches are code prefixes. Authorship of both remains UNVERIFIED (owner decision); see closure doc §6.

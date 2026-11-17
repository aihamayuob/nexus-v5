# vendor/ — pinned third-party browser libraries (F-05, 2026-11-16)

Loaded lazily and **same-origin** by `loadScriptOnce(LIB_URLS.*)` (QR libs) and `import(LIB_URLS.pdfjs)` + `GlobalWorkerOptions.workerSrc` (pdf.js) in the app page. Replaces the former cdnjs loads (no SRI, third-party origin in CSP).
Integrity of this folder: `VENDOR-SHA256.txt` (checked by `frontend/modules/vendor-and-csp.test.mjs` on every Vitest run).

| File | Library | Version | Obtained from | Licence (upstream) |
|---|---|---|---|---|
| `qrcode.min.js` | qrcodejs (davidshimjs) | 1.0.0 | npm `qrcodejs@1.0.0` (`qrcode.min.js`) | MIT — text in `LICENSE-qrcodejs.txt` |
| `jsQR.js` | jsQR (cozmo) | 1.4.0 | npm `jsqr@1.4.0` (`dist/jsQR.js`) | Apache-2.0 — `LICENSE-jsqr.txt` |
| `pdf.min.mjs`, `pdf.worker.min.mjs` | pdf.js (Mozilla) | 4.10.38 (ES modules; was 3.11.174 until 2026-11-17) | npm `pdfjs-dist@4.10.38` (`build/`) | Apache-2.0 — `LICENSE-pdfjs.txt` |

npm registry integrity (sha512 of the tarballs at the time of vendoring, 2026-11-16):
- `pdfjs-dist@4.10.38` sha512-/Y3fcFrXEAsMjJXeL9J8+ZG9U01LbuWaYypvDW2ycW1jL269L3js3DVBjDJ0Up9Np1uqDXsDrRihHANhZOlwdQ== (vendored 2026-11-17)
- (superseded) `pdfjs-dist@3.11.174` sha512-TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA==
- `jsqr@1.4.0` sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==
- `qrcodejs@1.0.0` sha512-67rj3mMBhSBepaD57qENnltO+r8rSYlqM7HGThks/BiyDAkc86sLvkKqjkqPS5v13f7tvnt6dbEf3qt7zq+BCg==

## Disclosures (UNVERIFIED items — not hidden)
- **Byte-identity with the previous cdnjs copies is UNVERIFIED**: cdnjs was not reachable from the build environment, so the vendored bytes could not be diffed against what users previously received. They are the same upstream releases.
- The `qrcodejs@1.0.0` npm `package.json` declares its licence URL as `github.com/angular/material/...` (a packaging error); the shipped `LICENSE` file is the MIT text © 2012 davidshimjs. Licence = MIT per the shipped file; the metadata inconsistency is recorded, not "fixed".
- pdf.js was upgraded (2026-11-17) from 3.11.174 to **4.10.38**, which is >= 4.2.67 (the first release fixing GHSA-wgrm-67xf-hhpq / CVE-2024-4367). `isEvalSupported:false` is kept as defence in depth and the CSP has no `unsafe-eval`. The ES-module build is loaded with `import()`; its worker is `pdf.worker.min.mjs`. **Not vendored (disclosed)**: `cmaps/` and `standard_fonts/` — PDFs that need CJK CMaps or non-embedded standard fonts may extract less text. Absence of other pdf.js vulnerabilities is not claimed.
- `unsafe-inline` for scripts/styles remains in the CSP (≈168 inline handlers) — deferred, not claimed fixed.
- Not precached by the service worker; offline use depends on the browser HTTP cache.

## Updating a library
Replace the file from the new pinned npm tarball, update `VENDOR-SHA256.txt` (`sha256sum <files> > VENDOR-SHA256.txt`), this table, the SBOM, and re-run `npx vitest run` + `node e2e/f05-vendored-libs-flow.mjs`.

// Core slice 4 / C1 — proves the NEW unit tests describe PRE-EXISTING behavior.
// Generates a temporary copy of persistable-state.test.mjs in which the three
// imported functions are replaced by thin adapters over the ORIGINAL
// implementation (the verbatim HEAD text embedded in that test file), runs
// Vitest on it, and ALWAYS deletes the temporary file.
// Usage (from repo root): node baseline/evidence/phase2-core-slice4-unit-vs-original.mjs
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'frontend');
const SRC = path.join(FE, 'modules', 'persistable-state.test.mjs');
const TMP = path.join(FE, 'modules', 'zz-tmp-vs-original.test.mjs');
const src = fs.readFileSync(SRC, 'utf8');
const IMPORT = /import \{\s*snapshotPersistableState,\s*restorePersistableState,\s*resetPersistableState,\s*\} from '\.\/storage\.mjs';/;
if (!IMPORT.test(src)) throw new Error('import block not found');
const ADAPT = `const snapshotPersistableState = (r) => makeOriginal(r).snapshotPersistableState();
const restorePersistableState = (r, d) => makeOriginal(r).restorePersistableState(d);
const resetPersistableState = (r) => makeOriginal(r).resetPersistableState();`;
fs.writeFileSync(TMP, src.replace(IMPORT, ADAPT));
let code = 1;
try {
  const r = spawnSync('npx', ['vitest', 'run', 'modules/zz-tmp-vs-original.test.mjs'], { cwd: FE, encoding: 'utf8' });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  code = r.status;
} finally { fs.rmSync(TMP, { force: true }); }
console.log('temporary file removed:', !fs.existsSync(TMP), '| vitest exit code:', code);
process.exit(code);

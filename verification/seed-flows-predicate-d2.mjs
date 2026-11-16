// D-2 evidence (2026-11-16): false-failure rate and mutant detection of the NEW plainHidden predicate (Arabic value + 32-byte sentinel on DECODED bytes) vs the ORIGINAL one.
import { webcrypto as c } from 'node:crypto';
const obj = { اسم: 'نكسس', n: 42, nested: { a: [1, 2, { b: null }], t: true }, emoji: '🔒', s: "q'\"<>&", sentinel: 'Zq7!Kd9#Rw3$Vb8%Ys2&Hn5*Pc4^Lm6~' };
const b64 = (u8) => Buffer.from(u8).toString('base64');
const enc = new TextEncoder();
const hasIn = (bytes, needle) => { const n = enc.encode(needle); outer: for (let i = 0; i + n.length <= bytes.length; i++) { for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer; return true; } return false; };
const oldPred = (data) => !Buffer.from(data, 'base64').toString('binary').includes('نكسس') && !data.includes('42');
const newPred = (data) => { const bytes = new Uint8Array(Buffer.from(data, 'base64')); return !hasIn(bytes, 'نكسس') && !hasIn(bytes, obj.sentinel); };
const key = await c.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const N = 20000; let oldFail = 0, newFail = 0;
for (let i = 0; i < N; i++) {
  const iv = c.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const data = b64(ct);
  if (!oldPred(data)) oldFail++; if (!newPred(data)) newFail++;
}
console.log(`real AES-GCM x${N}: old-predicate false failures=${oldFail} (${(100*oldFail/N).toFixed(2)}%), new-predicate false failures=${newFail}`);
const plain = enc.encode(JSON.stringify(obj));
const mutants = {
  'M1 base64(plaintext)': b64(plain),
  'M2 plaintext + fake tag': b64(new Uint8Array([...plain, ...c.getRandomValues(new Uint8Array(16))])),
  'M5 random bytes + sentinel leaked in clear': b64(new Uint8Array([...c.getRandomValues(new Uint8Array(100)), ...enc.encode(obj.sentinel)])),
  'M3 byte-reversed plaintext (known undetectable)': b64(plain.slice().reverse()),
  'M4 single-byte XOR (known undetectable)': b64(plain.map((x) => x ^ 0x5a)),
};
for (const [k, d] of Object.entries(mutants)) console.log(`${k.padEnd(48)} old detects=${!oldPred(d)}  new detects=${!newPred(d)}`);

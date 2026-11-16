// Evidence for CP-14 §E-1: quantifies the false-failure rate of e2e/phase2-core-seed-flows.mjs check `ciphertext-hides-plaintext`
// (`!payload.data.includes("42")` on random base64). Run: node baseline/evidence/phase2-core-slice7-seedflow-flaky-probe.mjs
// Quantify P(base64 ciphertext of the test's own object contains "42") using the REAL encryptState.
const { encryptState } = await import(new URL('../../frontend/modules/security.mjs', import.meta.url).href);
const obj = { اسم: 'نكسس', n: 42, nested: { a: [1, 2, { b: null }], t: true }, emoji: '🔒', s: "q'\"<>&" };
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
let hit = 0, hitArabic = 0, N = 20000, len = 0;
for (let i = 0; i < N; i++) {
  const p = await encryptState(obj, key);
  len = p.data.length;
  if (p.data.includes('42')) hit++;
  if (atob(p.data).includes('نكسس')) hitArabic++;
}
console.log(JSON.stringify({ N, dataBase64Length: len, includes42: hit, rate: hit / N, theoretical: 1 - Math.pow(1 - 1/4096, len - 1), includesArabicPlain: hitArabic }));

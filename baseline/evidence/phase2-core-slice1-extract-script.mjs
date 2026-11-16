// One-shot, behavior-preserving MOVE of encryptState/decryptState.
// Cuts the exact original text from the monolith (verified against git HEAD),
// appends it to security.mjs with `export`, and leaves a pointer comment.
import fs from 'node:fs'; import { execSync } from 'node:child_process';
const HTML='neural_nexus_ai_agents-4-3-5-3.html', MOD='modules/security.mjs';
const head = execSync(`git show HEAD:frontend/${HTML}`,{encoding:'utf8'});
let html = fs.readFileSync(HTML,'utf8');
if(html!==head) throw new Error('monolith differs from HEAD before extraction — abort');
const ORIGINAL =
`async function encryptState(obj, key){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(JSON.stringify(obj)));
  return { iv:bufToB64(iv), data:bufToB64(cipher) };
}
async function decryptState(payload, key){
  const iv = b64ToBuf(payload.iv);
  const data = b64ToBuf(payload.data);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, data);
  return JSON.parse(new TextDecoder().decode(plain));
}
`;
if(html.split(ORIGINAL).length!==2) throw new Error('original block not found exactly once');
const POINTER =
`/* MOVED (Phase 2 /nexus-modularize, boundary "core", first slice):
   encryptState() and decryptState() now live in modules/security.mjs.
   See main.js. */
`;
html = html.replace(ORIGINAL, POINTER);
fs.writeFileSync(HTML, html);
// security.mjs: insert right after b64ToBuf (the primitives they depend on)
let mod = fs.readFileSync(MOD,'utf8');
const ANCHOR = `export function b64ToBuf(b64){ return Uint8Array.from(atob(b64), c=>c.charCodeAt(0)); }\n`;
if(mod.split(ANCHOR).length!==2) throw new Error('anchor not found exactly once');
const EXPORTED = ORIGINAL.replace('async function encryptState','export async function encryptState').replace('async function decryptState','export async function decryptState');
const BLOCK = `\n// ---- State encryption envelope (Phase 2 boundary "core", slice 1) -------\n// Moved byte-for-byte from the monolith (only \`export\` added). Pure\n// primitives: the AES-GCM key is always passed in by the caller; nothing\n// here reads or writes application state. Depend only on bufToB64/b64ToBuf\n// above and the standard globals crypto/TextEncoder/TextDecoder/JSON.\n// NOTE: a fresh random 96-bit IV is generated per call; decryptState throws\n// on a wrong key, tampered IV/ciphertext, or malformed payload (callers —\n// autoInitApp — rely on that to start fresh instead of loading garbage).\n`;
mod = mod.replace(ANCHOR, ANCHOR + BLOCK + EXPORTED);
fs.writeFileSync(MOD, mod);
// byte-diff proof: module body (minus 'export ') === original block
const body = fs.readFileSync(MOD,'utf8');
const ok = body.includes(EXPORTED) && EXPORTED.replace(/export /g,'')===ORIGINAL;
console.log('byte-identical-after-export-strip:', ok);

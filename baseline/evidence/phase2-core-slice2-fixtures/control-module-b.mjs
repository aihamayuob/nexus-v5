// Control: a second ES module reading module A's top-level names by bare name.
// Module scope is private, so every read is expected to be a ReferenceError.
// Purpose: show the probe CAN distinguish "shared global scope" from "private scope".
const out = { aRanFirst: JSON.stringify(globalThis.__aRan) };
const rec = (k, f) => { try { out[k] = { threw: false, value: f() }; } catch (e) { out[k] = { threw: true, errorName: e && e.name, errorMessage: e && e.message }; } };
rec('read_A_LET',   () => A_LET);
rec('read_A_CONST', () => A_CONST);
rec('read_A_VAR',   () => A_VAR);
console.log('PROBE_RESULT:' + JSON.stringify(out));

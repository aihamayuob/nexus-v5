// ES module probe. Every access below is a BARE-NAME access executed in module
// code (never via page.evaluate, which runs in classic global scope).
const out = {};
const rec = (key, fn) => {
  try { out[key] = { threw: false, value: fn() }; }
  catch (e) { out[key] = { threw: true, errorName: e && e.name, errorMessage: e && e.message }; }
};
const winInfo = (n) => {
  const d = Object.getOwnPropertyDescriptor(window, n);
  return { inWindow: n in window, hasOwn: Object.prototype.hasOwnProperty.call(window, n),
           typeofWindowProp: typeof window[n],
           descriptor: d ? { configurable: d.configurable, enumerable: d.enumerable, writable: d.writable } : null };
};

// Module-private declarations (for the reverse-isolation probe).
let MOD_LET = 'mod-let';
var MOD_VAR = 'mod-var';

out.context = {
  importMetaUrlType: typeof import.meta.url,
  topLevelThis: String(this),
  strictMode: (function () { return this === undefined; })(),
};
out.order = { atModuleStart: window.__order.slice() };
window.__order.push('module-start');

// ---- READ by bare name ----
rec('read_let',   () => CL_LET);
rec('read_const', () => CL_CONST);
rec('read_var',   () => CL_VAR);
rec('read_arr',   () => JSON.stringify(CL_ARR));
rec('read_obj_k', () => CL_OBJ.k);
rec('typeof_let',   () => typeof CL_LET);
rec('typeof_const', () => typeof CL_CONST);
rec('typeof_var',   () => typeof CL_VAR);

// ---- window.<name> presence ----
out.window = { CL_LET: winInfo('CL_LET'), CL_CONST: winInfo('CL_CONST'), CL_VAR: winInfo('CL_VAR'),
               CL_ARR: winInfo('CL_ARR'), CL_OBJ: winInfo('CL_OBJ'), classicView: winInfo('classicView'),
               MOD_LET: winInfo('MOD_LET'), MOD_VAR: winInfo('MOD_VAR') };

// ---- WRITE by bare name (then observe from three vantage points) ----
rec('write_let', () => { CL_LET = 'let-written-by-module'; return CL_LET; });
out.write_let_seen = { fromModule: (() => CL_LET)(), fromClassic: classicView().CL_LET, viaWindow: window.CL_LET };

rec('write_var', () => { CL_VAR = 'var-written-by-module'; return CL_VAR; });
out.write_var_seen = { fromModule: (() => CL_VAR)(), fromClassic: classicView().CL_VAR, viaWindow: window.CL_VAR };

rec('write_const', () => { CL_CONST = 'const-written-by-module'; return CL_CONST; });
out.write_const_seen = { fromModule: (() => CL_CONST)(), fromClassic: classicView().CL_CONST };

rec('write_arr_reassign', () => { CL_ARR = [9]; return JSON.stringify(CL_ARR); });
out.write_arr_seen = { fromClassic: classicView().CL_ARR };

rec('write_const_object_property', () => { CL_OBJ.k = 'obj-mutated-by-module'; return CL_OBJ.k; });
out.write_obj_seen = { fromClassic: classicView().CL_OBJ_k };

// ---- reverse direction: classic writes, module reads (live binding, not a copy) ----
classicSetLet('let-written-by-classic-after');
rec('read_let_after_classic_write', () => CL_LET);

// ---- NEGATIVE CONTROLS: undeclared names must fail ----
rec('control_undeclared_read',  () => UNDECLARED_NAME_A);
rec('control_undeclared_typeof', () => typeof UNDECLARED_NAME_A);
rec('control_undeclared_write', () => { UNDECLARED_NAME_B = 1; return 'no-error'; });
out.control_undeclared_write_after = { inWindow: 'UNDECLARED_NAME_B' in window };

// ---- reverse isolation: does the classic script see module-scope names? ----
out.reverse_isolation = { classicSeesMOD_LET: classicTypeofModLet(), classicSeesMOD_VAR: classicTypeofModVar() };

window.__order.push('module-end');
out.order.atModuleEnd = window.__order.slice();
console.log('PROBE_RESULT:' + JSON.stringify(out));

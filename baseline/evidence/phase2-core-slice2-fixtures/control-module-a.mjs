// Declares top-level bindings in MODULE scope (not a classic script).
let   A_LET   = 'a-let';
const A_CONST = 'a-const';
var   A_VAR   = 'a-var';
globalThis.__aRan = [typeof A_LET, typeof A_CONST, typeof A_VAR];

/* ==========================================================================
   modules/state.mjs — Neural Nexus AI Agents

   Phase 2 (/nexus-modularize), core boundary #5, slice 10 (CP-18, ADR-005):
   PILOT of the "global accessor" ownership mechanism (CP-17 option B) for
   exactly ONE persisted state variable: `agentOrder`.

   This module OWNS the value (a private module-scope binding). The classic
   script keeps reading and writing the bare name `agentOrder` unchanged —
   `installGlobalStateAccessors(window)` defines `window.agentOrder` as an
   accessor property over that private binding, and a bare identifier in the
   classic (sloppy-mode) script resolves to that global property. The classic
   `let agentOrder` declaration was removed from the monolith, so there is no
   second binding that could shadow it.

   Scope is deliberately ONE variable: the other 15 PERSISTABLE_STATE
   variables (incl. `messages`, `selectedAgentIds`) are NOT migrated by this
   slice. `PERSISTABLE_STATE` itself is unchanged (its `agentOrder` entry still
   does `get:()=>agentOrder`, `set:v=>agentOrder=v`, which now go through the
   accessor).

   Must be installed by main.js after the window bridges and BEFORE the first
   startup call (applyTheme) — see main.js. Idempotent: installing again
   re-defines the same accessor over the same private binding (value kept).
   ========================================================================== */

let agentOrder = []; // array of agent ids in user-preferred display order

export function installGlobalStateAccessors(target) {
  Object.defineProperty(target, 'agentOrder', {
    configurable: true,
    enumerable: false,
    get() { return agentOrder; },
    set(v) { agentOrder = v; },
  });
}

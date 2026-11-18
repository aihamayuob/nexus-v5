#!/usr/bin/env bash
# NEXUS — full verification on THIS tree (clean install -> typecheck -> build -> backend tests -> frontend tests -> all E2E -> scenarios -> UI demo).
# Writes raw logs to $NEXUS_VERIFY_OUT (default ./verify-out). Exit code != 0 if anything fails. Models are SIMULATED (fake servers) — see docs/OPERATIONAL-BUILD.md.
# Requires: Node >= 22.5, Playwright (+ Chromium) resolvable from e2e/ (see docs/OPERATIONAL-BUILD.md), tsx comes from backend devDependencies.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${NEXUS_VERIFY_OUT:-$ROOT/verify-out}"; mkdir -p "$OUT"; export NEXUS_SCENARIO_OUT="$OUT/scenario"; rc=0
# D-9: snapshot/restore baseline/evidence WITHOUT git (works in a tree with no .git); restore also runs on interruption.
# shellcheck source=lib-evidence-guard.sh
source "$ROOT/scripts/lib-evidence-guard.sh"
evidence_snapshot "$ROOT"
trap 'evidence_restore "$ROOT" "$OUT/baseline-evidence-drift.txt"' EXIT
step() { local n="$1"; shift; echo "== $n"; "$@" >"$OUT/$n.raw.log" 2>&1; local c=$?; echo "   exit=$c"; [ $c -ne 0 ] && rc=1; return 0; }
cd "$ROOT/src-baseline/nexus-backend"
step 01-backend-npm-ci npm ci --no-audit --no-fund
step 02-backend-typecheck npx tsc -p tsconfig.json --noEmit
step 03-backend-build npm run build
step 04-backend-tests bash -c 'npx tsx --test test/**/*.test.ts'
cd "$ROOT/frontend"
step 05-frontend-npm-ci npm ci --no-audit --no-fund
step 06-frontend-vitest npx vitest run
cd "$ROOT/e2e"
for f in *.mjs; do n="${f%.mjs}"; case "$n" in operational-scenarios|launcher-ui-demo|real-provider-validation|mcp-third-party-interop|mcp-client-third-party|a2a-third-party-peer) continue;; esac; step "07-e2e-$n" timeout 280 node "$f"; done
# real-provider harness: always runs; BLOCKED items (no keys / no network route) are reported, not failed. Real keys are read from the environment only.
step 07b-real-provider-validation env NEXUS_RPV_OUT="$OUT/real-provider" timeout 400 node real-provider-validation.mjs
# third-party MCP client interop: needs the official SDK installed outside the repo (MCP_SDK_DIR); skipped (not failed) otherwise
if [ -n "${MCP_SDK_DIR:-}" ]; then step 07c-mcp-third-party-interop env NEXUS_MCP_OUT="$OUT/mcp-interop" timeout 200 node mcp-third-party-interop.mjs; else echo "== 07c-mcp-third-party-interop"; echo "   SKIPPED (set MCP_SDK_DIR)"; fi
# M1: NEXUS as MCP CLIENT against the official SDK *server* (MCP_SDK_DIR); A1: official @a2a-js/sdk *client* against the BUILT NEXUS A2A server + SIGKILL/restart (A2A_SDK_DIR). Skipped (not failed) when the SDK is not installed outside the repo.
if [ -n "${MCP_SDK_DIR:-}" ]; then step 07d-mcp-client-third-party env MCP_SDK_DIR="$MCP_SDK_DIR" bash -c 'cd "$0" && node --import ./src-baseline/nexus-backend/node_modules/tsx/dist/loader.mjs e2e/mcp-client-third-party.mjs' "$ROOT"; else echo "== 07d-mcp-client-third-party"; echo "   SKIPPED (set MCP_SDK_DIR)"; fi
if [ -n "${A2A_SDK_DIR:-}" ]; then step 07e-a2a-third-party-peer env A2A_SDK_DIR="$A2A_SDK_DIR" timeout 200 node a2a-third-party-peer.mjs; else echo "== 07e-a2a-third-party-peer"; echo "   SKIPPED (set A2A_SDK_DIR)"; fi
step 08-operational-scenarios timeout 280 node operational-scenarios.mjs
step 09-launcher-ui-demo timeout 200 node launcher-ui-demo.mjs
# the legacy E2E scripts regenerate files under baseline/evidence — restored from the pre-run snapshot (EXIT trap above; D-9). Drift report: $OUT/baseline-evidence-drift.txt
evidence_restore "$ROOT" "$OUT/baseline-evidence-drift.txt"
echo "OVERALL exit=$rc"; exit $rc

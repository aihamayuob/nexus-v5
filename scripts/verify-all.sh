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
for f in *.mjs; do n="${f%.mjs}"; case "$n" in operational-scenarios|launcher-ui-demo) continue;; esac; step "07-e2e-$n" timeout 280 node "$f"; done
step 08-operational-scenarios timeout 280 node operational-scenarios.mjs
step 09-launcher-ui-demo timeout 200 node launcher-ui-demo.mjs
# the legacy E2E scripts regenerate files under baseline/evidence — restored from the pre-run snapshot (EXIT trap above; D-9). Drift report: $OUT/baseline-evidence-drift.txt
evidence_restore "$ROOT" "$OUT/baseline-evidence-drift.txt"
echo "OVERALL exit=$rc"; exit $rc

#!/usr/bin/env bash
# CP-19 regression runner: runs ONLY against the isolated full copy (path-patched scripts); results JSONs redirected to scratch.
REPO=/tmp/claude-0/-home-claude/ab9ed084-7608-5722-8dc1-06ac77002352/scratchpad/CP19/iso/nexus-v5
SCR=/tmp/claude-0/-home-claude/ab9ed084-7608-5722-8dc1-06ac77002352/scratchpad
L=$SCR/CP19/logs/REG; mkdir -p "$L"
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
SUMMARY="$L/SUMMARY.txt"; : > "$SUMMARY"
run() { local name="$1" cwd="$2"; shift 2; local start=$(date +%s); ( cd "$cwd" && timeout 900 "$@" ) > "$L/$name.log" 2>&1; local rc=$?; echo "$name exit=$rc secs=$(( $(date +%s) - start )) cmd=[$*] :: $(tail -n 3 "$L/$name.log" | tr '\n' ' ' | cut -c1-240)" >> "$SUMMARY"; }
run vitest "$REPO/frontend" npx vitest run
run baseline-flows "$REPO/e2e" node baseline-flows.mjs
run phase1-security-flows "$REPO/e2e" node phase1-security-flows.mjs
run phase2-core-seed-flows "$REPO/e2e" node phase2-core-seed-flows.mjs
run phase2-core-slice4-flows "$REPO/e2e" node phase2-core-slice4-flows.mjs
NEXUS_S5_RESULTS="$L/slice5-results.json" run slice5 "$REPO/e2e" node phase2-core-slice5-flows.mjs
NEXUS_S6_RESULTS="$L/slice6-results.json" run slice6 "$REPO/e2e" node phase2-core-slice6-flows.mjs
NEXUS_S7_RESULTS="$L/slice7-results.json" run slice7 "$REPO/e2e" node phase2-core-slice7-flows.mjs
NEXUS_S8_RESULTS="$L/slice8-results.json" run slice8 "$REPO/e2e" node phase2-core-slice8-flows.mjs
NEXUS_S10_RESULTS="$L/slice10-results.json" run slice10 "$REPO/e2e" node phase2-core-slice10-flows.mjs
NEXUS_EI_UI_RESULTS="$L/ei-ui-results.json" run ei-ui "$REPO/e2e" node phase2-evidence-integrity-flows.mjs
NEXUS_S11_RESULTS="$L/slice11-results.json" run slice11 "$REPO/e2e" node phase2-core-slice11-context-characterization-flows.mjs
echo "DONE $(date -u +%H:%M:%S)" >> "$SUMMARY"

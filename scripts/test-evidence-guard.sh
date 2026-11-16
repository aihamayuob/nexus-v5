#!/usr/bin/env bash
# D-9 test: baseline/evidence must be restored byte-for-byte after a run WITHOUT .git (modified, added and deleted files).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/baseline/evidence/sub"; echo a > "$T/baseline/evidence/a.txt"; echo b > "$T/baseline/evidence/b.txt"; echo s > "$T/baseline/evidence/sub/s.txt"
before="$(cd "$T/baseline/evidence" && find . -type f -print0 | sort -z | xargs -0 sha256sum)"
# shellcheck source=lib-evidence-guard.sh
source "$HERE/lib-evidence-guard.sh" || { echo "FAIL: cannot source lib-evidence-guard.sh"; exit 2; }
evidence_snapshot "$T"
echo CHANGED > "$T/baseline/evidence/a.txt"; rm "$T/baseline/evidence/b.txt"; echo NEW > "$T/baseline/evidence/c.txt"; echo NEW > "$T/baseline/evidence/sub/n.txt"
evidence_restore "$T" "$T/drift.txt"
after="$(cd "$T/baseline/evidence" && find . -type f -print0 | sort -z | xargs -0 sha256sum)"
[ "$before" = "$after" ] || { echo "FAIL: evidence not restored byte-for-byte"; diff <(echo "$before") <(echo "$after"); exit 1; }
grep -q "a.txt" "$T/drift.txt" && grep -q "c.txt" "$T/drift.txt" && grep -q "b.txt" "$T/drift.txt" || { echo "FAIL: drift report incomplete"; cat "$T/drift.txt"; exit 1; }
# no baseline/evidence at all must not crash the helpers
T2="$(mktemp -d)"; evidence_snapshot "$T2" && evidence_restore "$T2" "$T2/d.txt" || { echo "FAIL: absent evidence dir crashed"; rm -rf "$T2"; exit 1; }; rm -rf "$T2"
echo "PASS: evidence restored byte-for-byte without .git (modified+added+deleted+nested), drift reported"

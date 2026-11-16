#!/usr/bin/env bash
# D-9 (2026-11-16): restore baseline/evidence after verify-all WITHOUT depending on git (the previous `git checkout -- baseline/evidence`
# silently did nothing — exit 128 — in a tree without .git, leaving legacy-E2E rewrites in the evidence folder).
# evidence_snapshot ROOT            -> copies ROOT/baseline/evidence into a private snapshot dir (path kept in $EVIDENCE_SNAP)
# evidence_restore  ROOT [DRIFT]    -> writes a drift report (files modified/added/removed during the run) to DRIFT, then restores byte-for-byte
EVIDENCE_SNAP=""
evidence_snapshot() {
  local root="$1"; EVIDENCE_SNAP="$(mktemp -d)"
  [ -d "$root/baseline/evidence" ] && cp -a "$root/baseline/evidence/." "$EVIDENCE_SNAP/" 2>/dev/null
  [ -d "$root/baseline/evidence" ] && : > "$EVIDENCE_SNAP/.present-marker-$$" || true
  return 0
}
evidence_restore() {
  local root="$1" drift="${2:-/dev/null}"; local dst="$root/baseline/evidence"
  [ -n "$EVIDENCE_SNAP" ] && [ -d "$EVIDENCE_SNAP" ] || return 0
  if [ -e "$EVIDENCE_SNAP/.present-marker-$$" ]; then
    rm -f "$EVIDENCE_SNAP/.present-marker-$$"
    { diff -rq "$EVIDENCE_SNAP" "$dst" 2>&1 | sed "s#$EVIDENCE_SNAP#<snapshot>#g" ; } > "$drift" 2>&1 || true
    rm -rf "$dst" && mkdir -p "$dst" && cp -a "$EVIDENCE_SNAP/." "$dst/"
  else
    : > "$drift" 2>/dev/null || true   # evidence dir did not exist before the run: nothing to restore
  fi
  rm -rf "$EVIDENCE_SNAP"; EVIDENCE_SNAP=""
  return 0
}

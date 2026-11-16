#!/bin/bash
# Read-only state snapshot of the real working copy. usage: snapshot-state.sh <outdir>
set -u
export GIT_OPTIONAL_LOCKS=0
R=/home/claude/nexus-v5
O="$1"; mkdir -p "$O"
cd "$R"
tree_hash() { # <dir>
  find "$1" -path '*/node_modules' -prune -o -path "$R/src-baseline/nexus-backend/dist" -prune -o -path "$R/src-baseline/nexus-backend/data" -prune -o -type f -print0 \
    | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
}
{
  echo "taken_at=$(date -u +%FT%TZ)"
  echo "== production files"
  sha256sum frontend/neural_nexus_ai_agents-4-3-5-3.html frontend/main.js frontend/modules/state.mjs frontend/modules/state.test.mjs
  echo "== tree hashes (excl node_modules/dist/data)"
  echo "frontend=$(tree_hash $R/frontend)"
  echo "src-baseline=$(tree_hash $R/src-baseline)"
  echo "ADR=$(tree_hash $R/ADR)"
  echo "e2e(excl node_modules)=$(tree_hash $R/e2e)"
  echo "== git"
  echo "branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "== refs"; git for-each-ref
  echo "== count-objects"; git count-objects -v
  echo "== stash"; git stash list | wc -l
  echo "== .git/index sha256"; sha256sum .git/index
  echo "== .git/HEAD + config sha256"; sha256sum .git/HEAD .git/config
  echo "== status counts"; git status --porcelain | awk '{print substr($0,1,2)}' | sort | uniq -c
} > "$O/summary.txt"
git status --porcelain | sort > "$O/status-porcelain.txt"
sha256sum $(git ls-files -m) 2>/dev/null > "$O/modified-files.sha256"
# every non-ignored file in the working tree (tracked + untracked) with its hash
git ls-files -co --exclude-standard -z | sort -z | xargs -0 sha256sum > "$O/all-files.sha256"
wc -l "$O/status-porcelain.txt" "$O/all-files.sha256" | head -3

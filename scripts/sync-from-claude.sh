#!/usr/bin/env bash
set -euo pipefail

BRANCH=${1:-claude/backend-fix}
LOG_PREFIX="[sync-from-claude]"

log() { echo "$LOG_PREFIX $*"; }
fail() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

log "target branch: $BRANCH"
log "current HEAD before sync: $(git rev-parse --short HEAD 2>/dev/null || echo unknown) on $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

if ! git remote get-url github >/dev/null 2>&1; then
  fail "remote 'github' not configured. Run: git remote -v"
fi

DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$DIRTY" != "0" ]; then
  log "WARNING: working tree has $DIRTY uncommitted changes:"
  git status --short
  fail "refusing to checkout — commit or stash first to avoid losing work"
fi

log "fetching $BRANCH from github..."
if ! git fetch github "$BRANCH" 2>&1; then
  fail "git fetch failed. Branch may not exist on remote, or auth issue."
fi

log "checking out $BRANCH..."
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout "$BRANCH"
  git reset --hard "github/$BRANCH"
else
  git checkout -b "$BRANCH" "github/$BRANCH"
fi

log "now on: $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"
log "last 3 commits:"
git log --oneline -3

log "installing deps with pnpm..."
if ! pnpm install 2>&1; then
  fail "pnpm install failed — see output above"
fi

log "done. Restart workflows + click Deploy in Replit to republish."

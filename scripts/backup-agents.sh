#!/usr/bin/env bash
# scripts/backup-agents.sh — snapshot agent state (all agent groups) into a
# separate private git repo, then commit and push.
#
# What gets backed up (scales to any number of agent groups automatically,
# since groups/* and the central DB already hold every agent group):
#   - data/v2.db          (central DB: agent groups, wirings, users, roles, tasks)
#   - groups/*/            minus regenerable/scratch content and secrets
#
# What is deliberately excluded (never leaves this machine):
#   - .env, *.keys.json, data/photon-auth.json — live credentials
#   - node_modules/, .pnpm-store/, tmp*/, .claude-fragments/ — regenerated on spawn
#   - CLAUDE.local.md, .claude-shared.md — composer-regenerated, not source state
#   - data/v2-sessions/ — ephemeral per-session inbound/outbound DBs
#
# Configure via env vars (e.g. in a systemd service's Environment= lines):
#   NANOCLAW_DIR         path to this checkout (default: script's parent dir)
#   NANOCLAW_BACKUP_DIR  path to the backup repo working copy (required)
set -euo pipefail

NANOCLAW_DIR="${NANOCLAW_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${NANOCLAW_BACKUP_DIR:?set NANOCLAW_BACKUP_DIR to the backup repo working copy}"

if [ ! -d "$BACKUP_DIR/.git" ]; then
  echo "error: $BACKUP_DIR is not a git repo. Clone your private backup repo there first." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR/data" "$BACKUP_DIR/groups"

echo "[backup] snapshotting central DB..."
pnpm --dir "$NANOCLAW_DIR" exec tsx scripts/backup-snapshot.ts \
  "$NANOCLAW_DIR/data/v2.db" "$BACKUP_DIR/data/v2.db"

echo "[backup] syncing groups/ (excluding scratch, secrets, node_modules)..."
rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude '.pnpm-store/' \
  --exclude 'tmp/' \
  --exclude 'tmp-*/' \
  --exclude '.claude-fragments/' \
  --exclude 'CLAUDE.local.md' \
  --exclude '.claude-shared.md' \
  --exclude '*.keys.json' \
  --exclude '.env' \
  --exclude '.env.*' \
  "$NANOCLAW_DIR/groups/" "$BACKUP_DIR/groups/"

cd "$BACKUP_DIR"
git add -A
if git diff --cached --quiet; then
  echo "[backup] no changes since last snapshot"
  exit 0
fi

git commit -q -m "backup: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q
echo "[backup] committed and pushed"

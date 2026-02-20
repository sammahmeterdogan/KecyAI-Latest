#!/usr/bin/env bash
# sync-upstream-lerobot.sh
# Syncs local LeRobot clone into runtime/upstream/lerobot/
# Usage: ./scripts/sync-upstream-lerobot.sh [/path/to/lerobot-main]
set -euo pipefail

SOURCE="${1:-$HOME/Desktop/lerobot-main}"

# ── Validate source ──
if [ ! -d "$SOURCE/.git" ]; then
    echo "ERROR: Source path '$SOURCE' does not contain a git repo. Aborting." >&2
    exit 1
fi

# ── Resolve paths ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$REPO_ROOT/runtime/upstream/lerobot"

echo "Source : $SOURCE"
echo "Dest   : $DEST"

# ── Get upstream commit ──
COMMIT=$(git -C "$SOURCE" rev-parse --short HEAD)
FULL_COMMIT=$(git -C "$SOURCE" rev-parse HEAD)
BRANCH=$(git -C "$SOURCE" rev-parse --abbrev-ref HEAD)
DATE=$(date +%Y-%m-%d)
echo "Commit : $COMMIT ($BRANCH)"

# ── Sync files ──
rm -rf "$DEST"
rsync -a \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='.mypy_cache' \
    --exclude='.ruff_cache' \
    --exclude='.venv' \
    --exclude='node_modules' \
    --exclude='*.pyc' \
    "$SOURCE/" "$DEST/"

# ── Update UPSTREAM.md ──
UPSTREAM_DOC="$REPO_ROOT/docs/architecture/upstream_dependencies.md"
if [ -f "$UPSTREAM_DOC" ]; then
    sed -i.bak "s/\(\*\*Pinned Commit\*\* | \`\)[^\`]*/\1$FULL_COMMIT/" "$UPSTREAM_DOC"
    sed -i.bak "s/\(\*\*Branch\*\* | \`\)[^\`]*/\1$BRANCH/" "$UPSTREAM_DOC"
    sed -i.bak "s/\(\*\*Sync Date\*\* | \)[0-9-]*/\1$DATE/" "$UPSTREAM_DOC"
    rm -f "$UPSTREAM_DOC.bak"
    echo "Updated UPSTREAM.md with $FULL_COMMIT"
fi

echo ""
echo "Done. Vendored LeRobot @ $COMMIT ($DATE)"

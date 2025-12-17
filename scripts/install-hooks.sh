#!/bin/sh
# Install tracked hooks into this repo's .git/hooks directory.
# Run from the extension root: ./scripts/install-hooks.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_SRC="$REPO_ROOT/scripts/hooks"
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || echo .git)
HOOKS_DST="$GIT_DIR/hooks"

echo "Installing hooks from $HOOKS_SRC to $HOOKS_DST"
mkdir -p "$HOOKS_DST"
cp -v "$HOOKS_SRC"/* "$HOOKS_DST"/ || { echo "No hooks copied"; }
chmod +x "$HOOKS_DST"/* || true

echo "Hooks installed. If you use a non-standard hooks path, copy files manually to your hooks directory."

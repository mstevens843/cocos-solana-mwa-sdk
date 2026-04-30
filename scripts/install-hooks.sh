#!/usr/bin/env bash
#
# install-hooks.sh — symlinks repo-tracked git hooks into .git/hooks/.
# Run once per clone: `bash scripts/install-hooks.sh`.
#
# Why a manual symlink instead of husky/lint-staged: this is a Cocos Creator
# project without a node build pipeline. Adding husky pulls in node_modules
# for one shell hook. Plain symlinks keep the repo tooling-light. The
# tradeoff: each clone must run this script. CI should also run the lint
# (scripts/check-graphics-safety.sh) as backup if a teammate forgets.

set -e

ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$ROOT/.git/hooks"

if [[ ! -d "$HOOKS_DIR" ]]; then
    echo "[install-hooks] ERROR: $HOOKS_DIR does not exist (is this a git checkout?)" >&2
    exit 1
fi

# Ensure script bodies are executable.
chmod +x "$ROOT/scripts/git-pre-commit.sh" "$ROOT/scripts/check-graphics-safety.sh" 2>/dev/null || true

# Symlink with a relative path so the symlink remains valid if the repo is moved.
ln -sf "../../scripts/git-pre-commit.sh" "$HOOKS_DIR/pre-commit"

echo "[install-hooks] installed: pre-commit -> scripts/git-pre-commit.sh"
echo "[install-hooks] verify with: ls -l $HOOKS_DIR/pre-commit"

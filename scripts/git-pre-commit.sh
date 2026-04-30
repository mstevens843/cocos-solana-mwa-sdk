#!/usr/bin/env bash
#
# git-pre-commit.sh — repo pre-commit hook body. Symlinked from
# .git/hooks/pre-commit by scripts/install-hooks.sh.
#
# Currently only runs the Cocos Graphics safety lint, which flags any
# `addComponent(Graphics)` site that is not wrapped through the safeGraphics
# queue or a director.once(EVENT_AFTER_DRAW) callback. Unsafe sites SIGSEGV
# the engine at offset 0x28 in js_cc_UIModelProxy_activeSubModels (libcocos.so)
# probabilistically on Android boot. See safeGraphics.ts and the
# project_cocos_uimodelproxy_bug.md memory for the full saga.

set -e

ROOT="$(git rev-parse --show-toplevel)"
"$ROOT/scripts/check-graphics-safety.sh"

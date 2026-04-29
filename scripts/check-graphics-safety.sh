#!/usr/bin/env bash
#
# check-graphics-safety.sh — flag unsafe addComponent(Graphics) call sites.
#
# Background: Cocos 3.8 native SIGSEGVs (fault addr 0x28 in
# js_cc_UIModelProxy_activeSubModels) when addComponent(Graphics) lands
# during onLoad/start/update phases. Fix is to wrap in director.once(
# Director.EVENT_AFTER_DRAW, ...), use safeAddGraphics(), or queue via
# enqueuePostDraw() from assets/token-duel/scripts/safeGraphics.ts. The
# queue caps Graphics-per-AFTER_DRAW at PER_TICK_BUDGET to stay below
# the engine's empirical ~20 ceiling.
#
# This script greps every addComponent(Graphics) call in assets/ and reports
# any site that ISN'T:
#   - Inside the safeGraphics utility itself
#   - Annotated with `// safe: <reason>` on the same line
#   - Within ~200 lines of a director.once(EVENT_AFTER_DRAW),
#     safeAddGraphics(, or enqueuePostDraw( wrapper
#
# Run as a pre-commit hook or in CI. Exit 0 on clean, 1 on any unsafe site.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_DIR="${1:-$ROOT/assets}"

if [[ ! -d "$SCAN_DIR" ]]; then
    echo "[check-graphics-safety] ERROR: scan dir not found: $SCAN_DIR" >&2
    exit 2
fi

# Find every addComponent(Graphics) site.
matches=$(grep -rn -E "\.addComponent\s*\(\s*Graphics\s*\)" "$SCAN_DIR" \
    --include="*.ts" --include="*.js" 2>/dev/null || true)

if [[ -z "$matches" ]]; then
    echo "[check-graphics-safety] OK: no addComponent(Graphics) sites found."
    exit 0
fi

unsafe_count=0
unsafe_lines=()

while IFS= read -r line; do
    # Format: file:lineno:code
    file="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    code="${rest#*:}"

    # Skip the utility file itself.
    case "$file" in
        */safeGraphics.ts|*/safeGraphics.js) continue ;;
    esac

    # Skip lines explicitly annotated as safe.
    if echo "$code" | grep -qE "//\s*safe:"; then
        continue
    fi

    # Look back up to 200 lines for the enclosing wrapper. 200 covers even
    # long function bodies; the wrapper is typically near the function head
    # (installSoftGlow / addParticleDrift / etc).
    start=$((lineno - 200))
    [[ $start -lt 1 ]] && start=1
    if sed -n "${start},${lineno}p" "$file" 2>/dev/null \
        | grep -qE "EVENT_AFTER_DRAW|safeAddGraphics\s*\(|enqueuePostDraw\s*\("; then
        continue
    fi

    unsafe_count=$((unsafe_count + 1))
    unsafe_lines+=("$file:$lineno: $code")
done <<< "$matches"

if [[ $unsafe_count -eq 0 ]]; then
    total=$(echo "$matches" | wc -l | tr -d ' ')
    echo "[check-graphics-safety] OK: all $total addComponent(Graphics) sites are safe."
    exit 0
fi

echo "[check-graphics-safety] FAIL: $unsafe_count unsafe addComponent(Graphics) site(s):"
echo ""
for entry in "${unsafe_lines[@]}"; do
    echo "  $entry"
done
echo ""
echo "Each site above can SIGSEGV the engine (libcocos.so, fault addr 0x28,"
echo "js_cc_UIModelProxy_activeSubModels) when the next DRAW walks the"
echo "half-attached render entity."
echo ""
echo "Fixes:"
echo "  1) Use safeAddGraphics(node, (g) => { ... }) from"
echo "     assets/token-duel/scripts/safeGraphics.ts (auto-budgeted)"
echo "  2) Wrap the surrounding work in enqueuePostDraw(() => { ... })"
echo "     from safeGraphics.ts (auto-budgeted)"
echo "  3) Or wrap manually in director.once(Director.EVENT_AFTER_DRAW, ...)"
echo "     (NOT auto-budgeted — only safe for one-off post-boot adds)"
echo "  4) Or annotate with '// safe: <reason>' if you're certain it's safe"
echo "     (e.g., always called post-boot)."
exit 1

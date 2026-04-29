#!/usr/bin/env bash
# Extracts PNG frame sequences from the 4 Seedance mascot mp4s into
# assets/demo/resources/mascot/frames/ for Cocos sprite-sheet animation.
#
# Output naming: <state>_NNN.png — Cocos resources.loadDir picks them up,
# AppUI groups by state prefix and feeds MascotController.setSpriteSheet.
#
# Idempotent: -y forces overwrite, mkdir -p safe if dst exists.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=assets/demo/resources/mascot/mascot_frames
DST=assets/demo/resources/mascot/frames
mkdir -p "$DST"

extract() {
    local state="$1"
    local fps="$2"
    local src="${3:-$state.mp4}"
    echo "→ $state @ ${fps}fps (src=$src)"
    ffmpeg -y -loglevel error -i "$SRC/$src" \
        -vf "fps=$fps,scale=384:384:flags=lanczos,colorkey=color=0xFFFFFF:similarity=0.03:blend=0.30" \
        "$DST/${state}_%03d.png"
}

extract idle 12 idle_5s.mp4
extract think 12
extract celebrate 24
extract lose 24

echo "Done. $(find "$DST" -name '*.png' | wc -l | tr -d ' ') frames in $DST"

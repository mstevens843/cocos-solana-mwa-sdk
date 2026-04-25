# Token Duel — Mascot Animations (Remotion)

Deterministic code-driven animations of the Token Duel mascot. Four states —
**idle / celebrate / think / lose** — each rendered frame-perfect from pure
React + CSS transforms via [Remotion](https://remotion.dev).

No AI video generation. No per-generation cost. Pixel-identical re-renders.

## Setup (one-time)

```bash
cd ~/Desktop/cocos-solana-mwa/mascot-animations
npm install
```

## Live preview

Launches Remotion Studio in your browser — scrub through animations, iterate
on motion curves, tweak sparkle counts live.

```bash
npm run dev
```

## Render mp4 clips

```bash
npm run render:idle       # → out/idle.mp4
npm run render:celebrate  # → out/celebrate.mp4
npm run render:think      # → out/think.mp4
npm run render:lose       # → out/lose.mp4
npm run render:all        # all 4 in sequence
```

## Render individual PNG frames (for Cocos sprite sheets)

This is the path that feeds into the in-game mascot. PNG preserves alpha
(transparent background); JPEG bakes white. Use `render:frames:*` for Cocos.

```bash
npm run render:frames:idle       # → out/idle-frames/frame-001.png ... frame-120.png
npm run render:frames:celebrate  # → out/celebrate-frames/frame-001.png ... frame-060.png
npm run render:frames:think      # → out/think-frames/frame-001.png ... frame-090.png
npm run render:frames:lose       # → out/lose-frames/frame-001.png ... frame-060.png
npm run render:frames:all        # all 4 state folders
```

Total frames: 120 + 60 + 90 + 60 = **330 frames** across the 4 states.

## Wiring frames into Cocos (after rendering)

1. Copy rendered frames into the game's resource folder:
   ```bash
   mkdir -p ../assets/demo/resources/mascot/frames
   cp out/idle-frames/*.png ../assets/demo/resources/mascot/frames/
   # rename prefix per state so Cocos can group them — example:
   for f in ../assets/demo/resources/mascot/frames/frame-*.png; do
       mv "$f" "${f/frame-/idle_}"
   done
   # repeat for celebrate / think / lose
   ```
   (Or I (Claude) can script this as `scripts/install-mascot-frames.sh` once
   you've run a first render and I can see actual file names.)

2. Focus Cocos Creator to auto-generate `.meta` UUIDs for each PNG.

3. Ping Claude and I'll extend `MascotController.setSpriteSheet` to accept
   a `Record<MascotState, SpriteFrame[]>` and cycle frames per state.

## Why this over AI video gen

| Pain with Seedance/Kling | How Remotion solves it |
|---|---|
| Zoom/framing drifts between clips | Fixed 512×512 composition, mascot pinned to center |
| Mirror/swap (hands jump sides) | Image file literally can't flip without code |
| Mascot morphs into slightly different character per frame | Same `staticFile('mascot-ref.png')` every frame |
| $0.25+ per re-roll | Free. Render as many times as you want. |
| 1-2 min per clip | ~5 sec per clip on M-series Mac |
| Inconsistency across 4 states | All 4 states use the EXACT same source image |

## Composition details

All 512×512 @ 30fps. Durations chosen to match MascotController playback:

| State | Frames | Duration | Loopable? |
|---|---|---|---|
| idle | 120 | 4.0s | ✅ (sine wave closes perfectly) |
| celebrate | 60 | 2.0s | ❌ (plays once, returns to idle) |
| think | 90 | 3.0s | ✅ (sine wave closes) |
| lose | 60 | 2.0s | ❌ (plays once, settles) |

## Files

```
mascot-animations/
  package.json
  remotion.config.ts
  tsconfig.json
  public/
    mascot-ref.png          (copied from ../assets/demo/resources/mascot/)
  src/
    index.ts                entry point
    index.css               tailwind base
    Root.tsx                4 Composition registrations
    Sparkles.tsx            shared particle system (ambient sparkles + gold burst)
    MascotIdle.tsx          sine bob + ambient teal sparkles
    MascotCelebrate.tsx     crouch → jump+spin → gold burst at apex → return
    MascotThink.tsx         head tilt ±6° + thought-bubble "?" above
    MascotLose.tsx          shoulders slump + desaturate + smoke puff
  out/                      render output (gitignore this)
```

## Next polish ideas (later)

1. **Layered mascot** — split mascot-ref.png into separate PNGs for body / arm /
   wand, tween each independently for richer motion (arm raising, wand spinning
   relative to body).
2. **Pose variants** — generate 4 static mascot PNGs per state (happy / focused
   / sad / surprised) via GPT Image 2, crossfade between them here.
3. **Background** — composition background is transparent. Add a subtle
   radial gradient if used outside the Cocos dark-navy UI context.

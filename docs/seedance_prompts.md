# Seedance Mascot Prompts

Replacement prompts for regenerating mascot animation frames. Current frames bake the editor's transparency checkerboard into the RGB channel as opaque pixels, which renders as a visible grid behind the mascot in-app. These prompts forbid that pattern explicitly and require a true alpha channel.

Drop the regenerated PNGs into:

- `assets/demo/resources/mascot/frames/idle_001.png` … `idle_NNN.png`
- `assets/demo/resources/mascot/frames/think_001.png` … `think_049.png`

Then clear `library/` and `temp/` and reopen Cocos so the import pipeline picks up the new frames.

---

## Prompt 1 — `idle_*` (landing page)

```
Looping idle animation of a cute pixel-style mascot character: a gold
Solana/SPL token with a smiling face, small arms, and round teal-blue
feet. Standing pose, three-quarter view, looking forward. Gentle idle
breathing (±2px vertical bob) and slow rim-glow pulse, soft cyan to
magenta, radiating outward from the body and fading smoothly to full
transparency at the canvas edge.

Frame specs:
- 384x384 PNG per frame, RGBA, 8-bit per channel
- Filename pattern: idle_001.png, idle_002.png, ...
- Loop seamlessly (last frame back to first frame)
- 12 fps target playback

ABSOLUTE TRANSPARENCY REQUIREMENTS, DO NOT VIOLATE:
- The background must be a TRUE ALPHA CHANNEL (alpha = 0 everywhere
  outside the mascot and its glow).
- DO NOT draw a checkerboard pattern in the image. The checker pattern
  is editor UI shown OVER transparency, it is not a thing you render
  into the PNG. Output pixels must not contain alternating gray/white
  squares of any kind.
- DO NOT add a white, gray, black, or colored background fill.
- DO NOT add a matte, frame, border, or vignette.
- DO NOT premultiply against any background color.
- All pixels outside the mascot/glow must have RGB = (0, 0, 0) and
  alpha = 0. The glow must fade to alpha = 0, not to a solid color.

Composition: subject centered, ~60% of canvas height, generous
transparent padding so the glow falls off into alpha without clipping.
```

---

## Prompt 2 — `think_*` (race panel gameplay)

```
49-frame looping animation of the same gold Solana/SPL token mascot
character in a "thinking" pose: head tilted slightly, one small hand
near chin, eyes scanning side to side. Subtle bob (±3px vertical) and
slow rim-glow pulse, cyan to magenta, over the loop. The pose holds,
this is a thoughtful idle, not an action animation. Match the visual
style of the idle sequence exactly (same mascot, same palette, same
glow treatment).

Frame specs:
- 49 frames, 384x384 each, PNG RGBA, 8-bit per channel
- Filename pattern: think_001.png ... think_049.png
- Loop seamlessly (frame 49 back to frame 1)
- 12 fps target playback (~4 second loop)

ABSOLUTE TRANSPARENCY REQUIREMENTS, DO NOT VIOLATE:
- The background must be a TRUE ALPHA CHANNEL (alpha = 0 everywhere
  outside the mascot and its glow).
- DO NOT draw a checkerboard pattern in the image. The checker pattern
  is editor UI shown OVER transparency, it is not a thing you render
  into the PNG. Output pixels must not contain alternating gray/white
  squares of any kind.
- DO NOT add a white, gray, black, or colored background fill.
- DO NOT add a matte, frame, border, or vignette.
- DO NOT premultiply against any background color.
- All pixels outside the mascot/glow must have RGB = (0, 0, 0) and
  alpha = 0. The glow must fade to alpha = 0, not to a solid color.

Composition: subject centered, ~60% of canvas height, generous
transparent padding so the glow falls off into alpha without clipping.
```

---

## Verifying the regenerated frames

Before importing into Cocos, sanity-check one frame:

```bash
python3 -c "from PIL import Image; im=Image.open('think_001.png').convert('RGBA'); print(im.getpixel((0,0)))"
```

Expected output: `(0, 0, 0, 0)` (or any RGB with alpha = 0). If you see `(255, 255, 255, 255)` or any opaque pixel at the corner, the prompt was ignored and the frame still has a baked background. Re-prompt with stronger emphasis on the alpha rules.

Preview.app on Mac does not show alpha. Use Pixelmator, Photoshop, or `open -a Preview` against a dark background image as a backdrop test instead.

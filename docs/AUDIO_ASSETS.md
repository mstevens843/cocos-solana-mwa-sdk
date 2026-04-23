# Audio Assets — Part 11 Bundle C

Token Duel ships 5 MP3 sound effects that need to be sourced (or recorded)
and placed at `assets/resources/audio/` so the `Sound.ts` subsystem can
lazy-load them via Cocos's `resources.load(AudioClip)` API.

## Files required

| File | Duration | Trigger | Vibe |
|---|---|---|---|
| `tap.mp3` | ~50ms | UI button press | soft tactile click (pop, not beep) |
| `stack.mp3` | ~200ms | block lands on tower | wooden thunk / block settle |
| `miss.mp3` | ~800ms | block falls off-screen, game-over | falling whoosh → soft thud |
| `victory.mp3` | ~1.5s | 1st place PostMatch | short upbeat fanfare (no vocals) |
| `level_up.mp3` | ~800ms | XP level gained | magical chime / ascending tone |

## Loudness + format

- **Format:** MP3 (Cocos 3.8 OGG decoder is flaky on some Android versions)
- **Bitrate:** 128 kbps VBR minimum, 192 kbps VBR recommended
- **Sample rate:** 44.1 kHz
- **Channels:** Mono for SFX (tap / stack / miss / level_up) — Stereo only for `victory.mp3`
- **Loudness:** -14 LUFS integrated (Spotify / YouTube standard). Normalize with ffmpeg:
  ```bash
  ffmpeg -i in.wav -af loudnorm=I=-14:LRA=11:TP=-1.0 -c:a libmp3lame -b:a 192k out.mp3
  ```
- **Trim silence:** leading silence ≤ 20ms (keeps interaction feel instant)

## Sourcing

Preferred (licensed for commercial use):

1. **[freesound.org](https://freesound.org)** — filter by "Creative Commons 0" (CC0) license; no attribution required. Search terms: "button click", "wood block", "game over", "fanfare", "level up chime".
2. **[zapsplat.com](https://zapsplat.com)** — free tier with attribution in the app's Settings → Credits page. Higher quality than freesound on average.
3. **Logic Pro / Ableton stock** — if you own either, the stock library is licensed for redistribution in your own products.
4. **Bfxr / ChipTone** — chiptune generators. Free, fun for retro arcade vibe. Good fit for `tap` and `level_up`.

**Do not use:** music-streaming rips, game rips (Nintendo / Sega SFX), or
unattributed YouTube extracts — Colosseum judging + app-store submission
both require clean licensing.

## Directory layout

```
assets/
└── resources/
    └── audio/
        ├── tap.mp3
        ├── stack.mp3
        ├── miss.mp3
        ├── victory.mp3
        └── level_up.mp3
```

The `resources/` subdirectory is **mandatory** — Cocos's `resources.load`
API only resolves paths within that bundle. A sibling path like
`assets/token-duel/audio/` will not load.

## Verification

After dropping the files in place:

```bash
cd /Users/devlegacy/Desktop/cocos-solana-mwa
# In Cocos Creator: reimport the `resources` bundle via
# Project → Bundle → Rebuild All (or click the bundle in Assets).
# Then check the meta files exist at:
ls assets/resources/audio/
#   tap.mp3  tap.mp3.meta  stack.mp3  stack.mp3.meta  ...

# APK rebuild:
rm -rf library/ temp/ build/android/proj/build/
# Rebuild in Cocos Creator, then adb install -r.
# Test on device — taps should click, wins should fanfare.
```

On startup, the client logs confirm load success:

```
[Sound] load | OK tap.mp3 duration=0.05s
[Sound] load | OK stack.mp3 duration=0.20s
[Sound] load | OK miss.mp3 duration=0.82s
[Sound] load | OK victory.mp3 duration=1.48s
[Sound] load | OK level_up.mp3 duration=0.79s
```

If any file is missing, you'll see `[Sound] load | MISSING <name>.mp3` and
that specific SFX will silently no-op. The game still plays.

## Credits

If any sourced sound requires attribution (non-CC0 Freesound, Zapsplat free
tier, etc.), add the credit line to a new `CREDITS.md` at repo root so the
Colosseum submission + future app-store listing have a clean paper trail.

## Ready-to-download pack (CC0)

The following five freesound.org entries are Creative-Commons-Zero (no
attribution required) and pre-vetted for loudness + length ≤ 1.5s. Each
link goes to the asset page; download the MP3 preview via the page's
"Download" button (a free freesound account is required for the download
action).

| Slot | Freesound ID + title | URL |
|---|---|---|
| `tap.mp3`       | 256116 "button-pressed-37.wav" (CC0) | https://freesound.org/people/kwahmah_02/sounds/256116/ |
| `stack.mp3`     | 352103 "woodenThudJoint_shortRattle.wav" (CC0) | https://freesound.org/people/joedeshon/sounds/352103/ |
| `miss.mp3`      | 277403 "fall-down-short.wav" (CC0) | https://freesound.org/people/Breviceps/sounds/277403/ |
| `victory.mp3`   | 270545 "fanfare-trumpets.wav" (CC0) | https://freesound.org/people/bone666138/sounds/270545/ |
| `level_up.mp3`  | 320775 "chime-short-ascending.wav" (CC0) | https://freesound.org/people/rhodesmas/sounds/320775/ |

If a link 404s (freesound occasionally reshuffles IDs), search the title
on the same site — CC0 assets rarely disappear, and the same search term
will surface the next-best substitute.

### Bulk download + normalize

After manually downloading the 5 raw files into a temporary directory
(freesound requires an interactive click-through to accept the CC0
terms — no direct-link CLI is available), run this ffmpeg loop to
normalize loudness + trim any leading silence and drop the results into
the Cocos resources path:

```bash
cd /Users/devlegacy/Desktop/cocos-solana-mwa
mkdir -p assets/resources/audio
cd ~/Downloads/token-duel-sfx-raw   # wherever you saved the 5 source files
# Expected files (rename the downloads to match, one slot each):
#   raw_tap.wav raw_stack.wav raw_miss.wav raw_victory.wav raw_level_up.wav

for slot in tap stack miss victory level_up; do
    ffmpeg -y -i "raw_${slot}.wav" \
        -af "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-40dB,loudnorm=I=-14:LRA=11:TP=-1.0" \
        -c:a libmp3lame -b:a 192k \
        "/Users/devlegacy/Desktop/cocos-solana-mwa/assets/resources/audio/${slot}.mp3"
done

# Verify the 5 files landed with sensible sizes (~8-40 KB each):
ls -lah /Users/devlegacy/Desktop/cocos-solana-mwa/assets/resources/audio/
```

If you'd rather skip the manual download step entirely, Bfxr's browser
generator (https://www.bfxr.net) can produce all five in ~10 minutes of
knob-twisting. Export at 44.1 kHz / 16-bit WAV and pipe through the
loudnorm command above.

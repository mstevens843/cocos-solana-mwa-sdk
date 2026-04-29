#!/usr/bin/env python3
"""
Strip the white background + tinted halo from Seedance-generated mascot
frame PNGs, leaving only the mascot silhouette with full transparency
elsewhere.

Algorithm (four-pass):

  Pass 1 — Corner flood-fill, thresh=40.
    Catches the off-white background and the bright outer ring of the halo.
    Stops at the saturated mascot edge (yellow body / colored details).

  Pass 2 — BFS halo dilation.
    Starting from currently-transparent pixels (post pass-1), BFS-expand
    to 4-neighbor opaque pixels meeting BOTH:
      V > 0.85  (luminance — bright)
      S < 0.30  (saturation — desaturated/near-gray)
    The BFS eats through the halo from the outside in, stopping when it
    hits a saturated mascot pixel. Internal whites (e.g. eye highlights
    inside dark sunglasses frames) are preserved because they are not
    connected to the outside transparency mask.

  Pass 3 — Largest-component keep.
    Keeps only the biggest connected opaque component on alpha. Removes
    floating speckles disconnected from the mascot body.

  Pass 4 — Radial edge taper.
    Multiplies alpha by a smooth quadratic falloff in the outermost
    EDGE_FADE_PX of the canvas, forcing alpha to 0 at the border. This
    eliminates the rectangular bounding-box artifact that otherwise shows
    up when a colored halo (think/lose) or full-canvas white wash (idle)
    survives passes 1-3 and runs into the canvas edge. Idempotent on
    already-clean pixels — alpha=0 stays alpha=0.

Usage:
    python3 scripts/strip-mascot-bg.py

After running:
    rm -rf library/ temp/
    # Re-open Cocos Creator so it re-imports the now-RGBA PNGs.
"""
from collections import deque
from pathlib import Path
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("ERROR: Pillow not installed. Install with: pip3 install Pillow", file=sys.stderr)
    sys.exit(1)

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy not installed. Install with: pip3 install numpy", file=sys.stderr)
    sys.exit(1)


FRAMES_DIR = Path(__file__).resolve().parent.parent / "assets" / "demo" / "resources" / "mascot" / "frames"
FLOOD_THRESH = 40         # Pass 1 RGB tolerance for corner flood-fill
HALO_V_MIN = 0.85         # Pass 2: minimum luminance (V in HSV) to qualify as halo
HALO_S_MAX = 0.30         # Pass 2: maximum saturation to qualify as halo
EDGE_FADE_PX = 28         # Pass 4: pixels within this distance of the canvas
                          # edge are smoothly faded toward alpha=0. Eliminates
                          # the rectangular bounding-box artifact when source
                          # halo / wash runs to the canvas border.
TRANSPARENT = (0, 0, 0, 0)


def is_near_white(rgb, threshold=200):
    return rgb[0] >= threshold and rgb[1] >= threshold and rgb[2] >= threshold


def strip_one(path: Path):
    """Return (status, transparent_pct)."""
    try:
        img = Image.open(path).convert("RGBA")
    except Exception as e:
        return (f"error_open:{e}", 0.0)

    w, h = img.size
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]

    # Sanity: at least one corner must be near-white. Otherwise this frame
    # doesn't match the Seedance white-bg pattern and we skip rather than
    # risk eating the silhouette.
    near_white_corners = sum(1 for c in corners if is_near_white(img.getpixel(c)))
    if near_white_corners == 0:
        return ("skipped_no_white_corner", 0.0)

    # Pass 1 — corner flood-fill.
    for cx, cy in corners:
        seed = img.getpixel((cx, cy))
        if not is_near_white(seed):
            continue
        ImageDraw.floodfill(img, (cx, cy), TRANSPARENT, thresh=FLOOD_THRESH)

    # Pass 2 — BFS halo dilation.
    arr = np.array(img)  # (h, w, 4) uint8
    alpha = arr[:, :, 3]
    rgb = arr[:, :, :3].astype(np.int16)
    rmax = rgb.max(axis=2)
    rmin = rgb.min(axis=2)
    V = rmax.astype(np.float32) / 255.0
    # Saturation: (max - min) / max if max > 0 else 0
    safe_max = np.maximum(rmax, 1).astype(np.float32)
    S = (rmax - rmin).astype(np.float32) / safe_max
    halo_mask = (V > HALO_V_MIN) & (S < HALO_S_MAX) & (alpha > 0)

    transparent = alpha == 0

    # Build initial frontier: opaque halo pixels adjacent to a transparent pixel.
    q = deque()
    # 4-neighbor shifts
    # Pad transparent mask to handle borders without explicit bounds checks
    t_pad = np.zeros((h + 2, w + 2), dtype=bool)
    t_pad[1:-1, 1:-1] = transparent
    adj_to_trans = (
        t_pad[0:h, 1:w + 1] |        # up
        t_pad[2:h + 2, 1:w + 1] |    # down
        t_pad[1:h + 1, 0:w] |        # left
        t_pad[1:h + 1, 2:w + 2]      # right
    )
    frontier = halo_mask & adj_to_trans
    fy, fx = np.where(frontier)
    for y, x in zip(fy.tolist(), fx.tolist()):
        q.append((x, y))

    # BFS — pop, mark transparent, push halo neighbors that are still opaque.
    while q:
        x, y = q.popleft()
        if arr[y, x, 3] == 0:
            continue
        if not halo_mask[y, x]:
            continue
        arr[y, x, 0] = 0
        arr[y, x, 1] = 0
        arr[y, x, 2] = 0
        arr[y, x, 3] = 0
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and arr[ny, nx, 3] > 0 and halo_mask[ny, nx]:
                q.append((nx, ny))

    # Pass 3 — keep only the largest connected component on the alpha mask.
    # Removes orphan opaque islands: sparkles, aura wisps, glow halos
    # disconnected from the mascot body. 4-connectivity on alpha so internal
    # whites within the mascot stay (they're enclosed by the body's alpha).
    opaque = arr[:, :, 3] > 0
    label_map = np.zeros((h, w), dtype=np.int32)
    next_label = 0
    label_sizes: list[int] = []
    for sy in range(h):
        for sx in range(w):
            if not opaque[sy, sx] or label_map[sy, sx] != 0:
                continue
            next_label += 1
            size = 0
            stack = [(sx, sy)]
            while stack:
                cx, cy = stack.pop()
                if cx < 0 or cx >= w or cy < 0 or cy >= h:
                    continue
                if not opaque[cy, cx] or label_map[cy, cx] != 0:
                    continue
                label_map[cy, cx] = next_label
                size += 1
                stack.append((cx + 1, cy))
                stack.append((cx - 1, cy))
                stack.append((cx, cy + 1))
                stack.append((cx, cy - 1))
            label_sizes.append(size)

    if label_sizes:
        largest_label = 1 + label_sizes.index(max(label_sizes))
        # Set alpha=0 for any opaque pixel not in the largest component.
        kill_mask = opaque & (label_map != largest_label)
        if kill_mask.any():
            arr[kill_mask, 0] = 0
            arr[kill_mask, 1] = 0
            arr[kill_mask, 2] = 0
            arr[kill_mask, 3] = 0

    # Pass 4 — Radial edge taper.
    # Multiply alpha by a smooth quadratic falloff in the outermost
    # EDGE_FADE_PX of the canvas. Distance is to nearest edge (Chebyshev
    # against the rectangle), so the taper hugs the rectangle uniformly.
    # smoothstep: t*t*(3 - 2*t). Idempotent: alpha=0 stays 0.
    if EDGE_FADE_PX > 0:
        ys = np.arange(h).reshape(h, 1)
        xs = np.arange(w).reshape(1, w)
        d_left   = xs
        d_right  = (w - 1) - xs
        d_top    = ys
        d_bottom = (h - 1) - ys
        d = np.minimum(np.minimum(d_left, d_right), np.minimum(d_top, d_bottom))
        t = np.clip(d.astype(np.float32) / float(EDGE_FADE_PX), 0.0, 1.0)
        falloff = t * t * (3.0 - 2.0 * t)  # smoothstep
        new_alpha = (arr[:, :, 3].astype(np.float32) * falloff).round().astype(np.uint8)
        arr[:, :, 3] = new_alpha

    # Save
    Image.fromarray(arr, "RGBA").save(path, "PNG")
    transparent_pct = 100.0 * (arr[:, :, 3] == 0).sum() / (w * h)
    return ("ok", transparent_pct)


def main():
    if not FRAMES_DIR.is_dir():
        print(f"ERROR: frames dir not found: {FRAMES_DIR}", file=sys.stderr)
        sys.exit(1)

    pngs = sorted(FRAMES_DIR.glob("*.png"))
    if not pngs:
        print(f"ERROR: no PNGs in {FRAMES_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"Processing {len(pngs)} frames in {FRAMES_DIR}")
    counts = {"ok": 0, "skipped_no_white_corner": 0}
    transparent_pcts = []
    for i, path in enumerate(pngs, 1):
        status, pct = strip_one(path)
        counts[status] = counts.get(status, 0) + 1
        if status == "ok":
            transparent_pcts.append(pct)
        if status != "ok" or i % 25 == 0 or i == len(pngs):
            print(f"  [{i}/{len(pngs)}] {path.name} -> {status} (transparent: {pct:.1f}%)")

    print("\nDone.")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    if transparent_pcts:
        avg = sum(transparent_pcts) / len(transparent_pcts)
        print(f"  avg transparent%: {avg:.1f}% (was ~41.7% with the old single-pass algo)")
    print("\nNext steps:")
    print("  1. rm -rf library/ temp/")
    print("  2. Re-open Cocos Creator (it will re-import the now-RGBA PNGs)")
    print("  3. Build + install + run")


if __name__ == "__main__":
    main()

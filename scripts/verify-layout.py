#!/usr/bin/env python3
"""
verify-layout.py — overlap detector for the generated Cocos scene.

Reads `assets/demo/scenes/Main.scene` (JSON) and walks the Canvas's
top-level panels. For each panel, computes the axis-aligned bounding box
of every direct-child node that has a UITransform, then checks every
unique pair for unintended overlap.

Anchor convention: Cocos defaults to anchor (0.5, 0.5). bbox computed as
    bbox = (lpos.x - w/2, lpos.y - h/2, w, h)

Usage:
    python3 scripts/verify-layout.py

Exit codes:
    0 — all panels clean (no unintended overlaps)
    1 — at least one unintended overlap detected
    2 — script error (scene file missing, etc.)

The script is intentionally lightweight (stdlib only) so it runs in any
shell without `pip install`. It does NOT require an APK build.

To suppress an intentional overlap, add the pair to `allowedOverlaps` in
the panel's entry of `assets/token-duel/scripts/LayoutSpec.cjs`. The
verifier reads that list and skips matching pairs.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENE_PATH = ROOT / "assets" / "demo" / "scenes" / "Main.scene"
LAYOUT_SPEC_PATH = ROOT / "assets" / "token-duel" / "scripts" / "LayoutSpec.cjs"


def load_scene() -> list:
    if not SCENE_PATH.is_file():
        print(f"ERROR: scene file not found: {SCENE_PATH}", file=sys.stderr)
        sys.exit(2)
    with SCENE_PATH.open() as f:
        return json.load(f)


def parse_allowed_overlaps() -> dict[str, list[tuple[str, str]]]:
    """
    Coarse parse of LayoutSpec.cjs to extract `allowedOverlaps` per panel.
    We don't run the JS file — we parse the literal arrays. Matches the
    pattern: `<PanelName>: { ... allowedOverlaps: [ [a, b], ... ], ... }`.
    """
    if not LAYOUT_SPEC_PATH.is_file():
        return {}
    text = LAYOUT_SPEC_PATH.read_text()
    out: dict[str, list[tuple[str, str]]] = {}
    # Match top-level panel entries: name followed by { ... } block.
    panel_re = re.compile(r'(\w+):\s*\{', re.MULTILINE)
    for m in panel_re.finditer(text):
        panel = m.group(1)
        # Find the matching closing brace using a depth counter.
        depth = 1
        i = m.end()
        while i < len(text) and depth > 0:
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            i += 1
        block = text[m.end():i]
        # Find allowedOverlaps: scan for the keyword, then read the matching
        # bracketed array using a depth counter (the array contains nested
        # `[...]` pairs, so a non-greedy regex captures only the first one).
        kw = re.search(r'allowedOverlaps\s*:\s*\[', block)
        if not kw:
            continue
        bdepth = 1
        bi = kw.end()
        while bi < len(block) and bdepth > 0:
            if block[bi] == '[':
                bdepth += 1
            elif block[bi] == ']':
                bdepth -= 1
            bi += 1
        ao_block = block[kw.end():bi - 1]
        pairs = re.findall(
            r"\[\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\]",
            ao_block,
        )
        if pairs:
            out[panel] = [(a, b) for a, b in pairs]
    return out


def find_node(nodes: list, name: str) -> int | None:
    for i, n in enumerate(nodes):
        if n.get("__type__") == "cc.Node" and n.get("_name") == name:
            return i
    return None


def get_ui_transform(nodes: list, node_idx: int) -> dict | None:
    n = nodes[node_idx]
    for c in n.get("_components", []):
        if isinstance(c, dict):
            cid = c.get("__id__")
            if cid is not None and cid < len(nodes):
                comp = nodes[cid]
                if comp.get("__type__") == "cc.UITransform":
                    return comp
    return None


def bbox_of(nodes: list, node_idx: int) -> tuple[float, float, float, float] | None:
    """Return (x, y, w, h) bbox in panel-local coords, or None if no UITransform."""
    n = nodes[node_idx]
    if n.get("__type__") != "cc.Node":
        return None
    if not n.get("_active", True):
        return None
    ut = get_ui_transform(nodes, node_idx)
    if ut is None:
        return None
    cs = ut.get("_contentSize", {})
    w = cs.get("width", 0)
    h = cs.get("height", 0)
    if w == 0 or h == 0:
        return None
    lpos = n.get("_lpos", {})
    cx = lpos.get("x", 0)
    cy = lpos.get("y", 0)
    return (cx - w / 2, cy - h / 2, w, h)


def boxes_overlap(b1: tuple[float, float, float, float], b2: tuple[float, float, float, float]) -> bool:
    x1, y1, w1, h1 = b1
    x2, y2, w2, h2 = b2
    return (x1 < x2 + w2) and (x2 < x1 + w1) and (y1 < y2 + h2) and (y2 < y1 + h1)


# 2026-04-29 — Dashboard zone scaffold (mirrors DashboardLayoutSpec in
# LayoutSpec.cjs / .ts). Portfolio + Leaderboard share a strict 5-zone
# vertical layout. Each zone is (topY, bottomY) in panel-local Y.
def _build_dashboard_zones(include_mode_switch: bool) -> dict[str, tuple[float, float]]:
    TOP = 760
    H = {"header": 80, "title": 104, "modeSwitch": 60, "subtab": 60}
    header_top = TOP
    header_bot = header_top - H["header"]
    title_top = header_bot
    title_bot = title_top - H["title"]
    if include_mode_switch:
        ms_top = title_bot
        ms_bot = ms_top - H["modeSwitch"]
        sub_top = ms_bot
    else:
        ms_top = ms_bot = None
        sub_top = title_bot
    sub_bot = sub_top - H["subtab"]
    content_top = sub_bot
    content_bot = -480
    out = {
        "header":  (header_top, header_bot),
        "title":   (title_top, title_bot),
        "subtab":  (sub_top, sub_bot),
        "content": (content_top, content_bot),
    }
    if include_mode_switch:
        out["modeSwitch"] = (ms_top, ms_bot)
    return out


# Map element node names → claimed zone for the panels that opt into the
# zone-containment check. Names not listed are skipped (e.g., legacy hidden
# stubs, status footer below CONTENT, sticky-bottom YOU card).
_PORTFOLIO_ZONE_MAP = {
    "BackLinkLabel":                 "header",
    "BackButton":                    "header",
    "HubTabStrip":                   "header",
    "PortfolioTitleLabel":           "title",
    "PortfolioSubtitleLabel":        "title",
    "PortfolioPubkeyLabel":          "title",
    "PortfolioModeLabel":            "modeSwitch",
    "PFModePill":                    "modeSwitch",
    "PFTopLevelPill":                "subtab",
    "PortfolioStatsTab":             "subtab",
    "PortfolioHistoryTab":           "subtab",
    "PortfolioTrophiesTab":          "subtab",
    "PortfolioPaperTab":             "modeSwitch",
    "PortfolioRealTab":              "modeSwitch",
    "PFStatCard_pnl":                "content",
    "PFStatCard_wins":               "content",
    "PFStatCard_losses":             "content",
    "PFStatCard_winrate":            "content",
    "PFStatCard_games":              "content",
    "PFStatCard_xp":                 "content",
    "PortfolioGroupHeaderPerformance": "content",
    "PortfolioGroupHeaderActivity":  "content",
}
_LEADERBOARD_ZONE_MAP = {
    "BackLinkLabel":                 "header",
    "BackButton":                    "header",
    "HubTabStrip":                   "header",
    "LeaderboardTitleLabel":         "title",
    "LeaderboardSubtitleLabel":      "title",
    "LBModePill":                    "subtab",
    "ModeTabsContainer":             "subtab",
    "LBTab_1v1":                     "subtab",
    "LBTab_trio":                    "subtab",
    "LBTab_4p":                      "subtab",
    "LBTab_8p":                      "subtab",
    "LBTab_season":                  "subtab",
    "TopPlayerCard":                 "content",
}
_DASHBOARD_PANELS = {
    "PortfolioPanel":   (_PORTFOLIO_ZONE_MAP,   _build_dashboard_zones(True)),
    "LeaderboardPanel": (_LEADERBOARD_ZONE_MAP, _build_dashboard_zones(False)),
}


def verify_dashboard_zones(nodes: list, panel_idx: int, panel_name: str) -> int:
    """Assert each known element on Portfolio/Leaderboard sits inside its
    claimed zone. Returns count of containment failures."""
    if panel_name not in _DASHBOARD_PANELS:
        return 0
    zone_map, zones = _DASHBOARD_PANELS[panel_name]
    failures = 0
    for c in nodes[panel_idx].get("_children", []):
        if not isinstance(c, dict):
            continue
        cid = c.get("__id__")
        if cid is None or cid >= len(nodes):
            continue
        cn = nodes[cid]
        if cn.get("__type__") != "cc.Node":
            continue
        nm = cn.get("_name", "")
        if nm not in zone_map:
            continue
        bb = bbox_of(nodes, cid)
        if bb is None:
            continue
        zone_key = zone_map[nm]
        if zone_key not in zones:
            continue
        top_y, bot_y = zones[zone_key]
        bx, by, bw, bh = bb
        el_top = by + bh
        el_bot = by
        # 4-px tolerance for sub-pixel rendering of pill glow / shadows.
        TOL = 4.0
        if el_top > top_y + TOL or el_bot < bot_y - TOL:
            failures += 1
            print(f"  ZONE-BREACH {panel_name}.{nm} (zone={zone_key})")
            print(f"    element y span [{el_bot:.0f}, {el_top:.0f}]   "
                  f"zone y span [{bot_y:.0f}, {top_y:.0f}]")
    return failures


def verify_panel(nodes: list, panel_idx: int, panel_name: str, allowed: list[tuple[str, str]]) -> int:
    """Return number of unintended overlaps in this panel."""
    n = nodes[panel_idx]
    children = []  # list of (idx, name, bbox)
    for c in n.get("_children", []):
        if isinstance(c, dict):
            cid = c.get("__id__")
            if cid is None or cid >= len(nodes):
                continue
            cn = nodes[cid]
            if cn.get("__type__") != "cc.Node":
                continue
            bb = bbox_of(nodes, cid)
            if bb is None:
                continue
            children.append((cid, cn.get("_name", "?"), bb))

    # Two match modes for allowedOverlaps:
    #   1. Exact: pair stored as ('NodeA', 'NodeB') matches sibling names verbatim.
    #   2. Template: pair stored as ('NodeBase', 'OtherBase') matches sibling
    #      names after stripping a trailing _N suffix (e.g., 'Toast_0' → 'Toast').
    #      Useful for template panels (NotificationToastSlot_0/_1/_2) that share
    #      the same intentional internal-overlap pattern.
    allow_exact = set(frozenset(p) for p in allowed)
    allow_template = set(
        frozenset((re.sub(r'_\d+$', '', a), re.sub(r'_\d+$', '', b))) for a, b in allowed
    )
    overlaps = 0
    for i in range(len(children)):
        for j in range(i + 1, len(children)):
            _, na, ba = children[i]
            _, nb, bb_ = children[j]
            if not boxes_overlap(ba, bb_):
                continue
            # Phase 13 (B3): glow-halo sprites (BtnGlow_*) are intentional
            # decorative bleeds — they sit larger than their host button
            # and are meant to overlap neighbors. Skip any pair involving one.
            if na.startswith('BtnGlow_') or nb.startswith('BtnGlow_'):
                continue
            # Phase 18 — ripple sprites (Ripple_*) are pre-created click
            # overlays that scale 0.4× → 2.5× on tap. Initial size = button
            # size, sharing y=0 with TopHighlight/BottomShadow/Label. The
            # overlap is by design (ripple overlays the button face).
            if na.startswith('Ripple_') or nb.startswith('Ripple_'):
                continue
            # Phase 21 (F) — BackgroundGlow_* sprites are stacked halos
            # (outer/mid/inner per color) that overlap by design to fake a
            # radial gradient. 9 sprites × cross-overlaps = many pairs;
            # skip rule is cleaner than enumerating allowedOverlaps.
            if na.startswith('BackgroundGlow_') or nb.startswith('BackgroundGlow_'):
                continue
            # Polish 2026-04-26 — FeedColumnHeaders.HeaderBg is a chrome strip
            # sprite sized to the full group; it sits behind the 7 ColHeader_*
            # labels by design so the column row reads as part of the list.
            if na == 'HeaderBg' or nb == 'HeaderBg':
                continue
            # 2026-04-26 redesign — card backgrounds are sized to fully cover
            # their child labels by design (multi-row stat cards). Skip any
            # pair involving one of these wrapper sprites.
            CARD_BG_NAMES = {
                'MatchSetupCard', 'SquadPanel', 'PlayerStatusPill',
                'TokenDuelLevelChip', 'BalanceChip', 'PillDivider',
                'ScoreBadgeBg', 'CardEdgeAccent',
                # 2026-04-27 — full-canvas outcome tint behind PostMatchPanel
                # content (graphics rect, alpha-tweened by AppUI).
                'OutcomeBgTint',
            }
            if na in CARD_BG_NAMES or nb in CARD_BG_NAMES:
                continue
            if frozenset((na, nb)) in allow_exact:
                continue
            na_base = re.sub(r'_\d+$', '', na)
            nb_base = re.sub(r'_\d+$', '', nb)
            if frozenset((na_base, nb_base)) in allow_template:
                continue
            overlaps += 1
            print(f"  OVERLAP {panel_name}.{na} <-> {panel_name}.{nb}")
            print(f"    {na}: bbox=({ba[0]:.0f}, {ba[1]:.0f}, {ba[2]:.0f}, {ba[3]:.0f})")
            print(f"    {nb}: bbox=({bb_[0]:.0f}, {bb_[1]:.0f}, {bb_[2]:.0f}, {bb_[3]:.0f})")
    return overlaps


def main() -> int:
    nodes = load_scene()
    allowed_per_panel = parse_allowed_overlaps()

    canvas_idx = find_node(nodes, "Canvas")
    if canvas_idx is None:
        print("ERROR: no Canvas node in scene", file=sys.stderr)
        return 2

    # Collect every node that should be checked as a "panel" (multi-element
    # container). Top-level: direct children of Canvas (excluding Camera /
    # Background / MWAManager). Nested: any descendant with >=3 children that
    # have UITransforms (filters out button internals which only have
    # Highlight + Label = 2 children).
    skip_names = {"Camera", "Background", "MWAManager"}

    def n_ui_children(idx: int) -> int:
        n = nodes[idx]
        count = 0
        for c in n.get("_children", []):
            if isinstance(c, dict):
                cid = c.get("__id__")
                if cid is None or cid >= len(nodes):
                    continue
                cn = nodes[cid]
                if cn.get("__type__") != "cc.Node":
                    continue
                if get_ui_transform(nodes, cid) is None:
                    continue
                count += 1
        return count

    panels: list[tuple[int, str]] = []
    visited: set[int] = set()

    def collect(idx: int, depth: int = 0):
        if idx in visited or idx >= len(nodes) or depth > 25:
            return
        n = nodes[idx]
        if n.get("__type__") != "cc.Node":
            return
        visited.add(idx)
        name = n.get("_name", "?")
        if name in skip_names:
            return
        # Top-level Canvas children always count as panels (even if only 1
        # child, e.g., overlays). Nested nodes: require >=3 UITransform
        # children to be considered a "panel".
        if depth == 0 or n_ui_children(idx) >= 3:
            panels.append((idx, name))
        for c in n.get("_children", []):
            if isinstance(c, dict):
                cid = c.get("__id__")
                if cid is not None and cid < len(nodes):
                    collect(cid, depth + 1)

    for c in nodes[canvas_idx].get("_children", []):
        if isinstance(c, dict):
            cid = c.get("__id__")
            if cid is not None and cid < len(nodes):
                collect(cid, 0)

    total_overlaps = 0
    print(f"Verifying {len(panels)} panels (top-level + nested) in {SCENE_PATH.relative_to(ROOT)}")
    # Global pairs (LayoutSpec `_GLOBAL_.allowedOverlaps`) apply to every
    # panel — used for structural pairs that recur app-wide (e.g., button
    # bevel siblings TopHighlight/BottomShadow/Label).
    global_allowed = allowed_per_panel.get('_GLOBAL_', [])
    for panel_idx, panel_name in panels:
        # Look up allowedOverlaps under both the exact panel name and the
        # template name (panel with trailing _N stripped). Template-named
        # entries let one LayoutSpec block cover all instances of a repeated
        # template (e.g., NotificationToastSlot_0/_1/_2).
        allowed = list(allowed_per_panel.get(panel_name, []))
        template_name = re.sub(r'_\d+$', '', panel_name)
        if template_name != panel_name:
            allowed.extend(allowed_per_panel.get(template_name, []))
        # Global pairs apply to every panel.
        allowed.extend(global_allowed)
        n_children = len(nodes[panel_idx].get("_children", []))
        before = total_overlaps
        total_overlaps += verify_panel(nodes, panel_idx, panel_name, allowed)
        # 2026-04-29 — Dashboard zone-containment check for Portfolio + Leaderboard.
        total_overlaps += verify_dashboard_zones(nodes, panel_idx, panel_name)
        added = total_overlaps - before
        marker = "OK" if added == 0 else f"{added} OVERLAPS"
        print(f"  {panel_name:30s} {n_children:3d} children   {marker}")

    print()
    if total_overlaps == 0:
        print("PASS — no unintended overlaps detected.")
        return 0
    print(f"FAIL — {total_overlaps} unintended overlap(s) / zone breaches detected.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env node
/**
 * Single Scene Generator — Landing + Home panels in one scene.
 * No scene transitions. Panels show/hide based on connection state.
 */
const fs = require('fs');
const path = require('path');

// UX overhaul: shared theme constants (see assets/token-duel/scripts/Theme.cjs).
// Mirror file lives at assets/token-duel/scripts/Theme.ts for runtime use.
const Theme = require('./assets/token-duel/scripts/Theme.cjs');
const { Palette: P, ButtonVariants: BV, ButtonTierSpec: BTS, rgba } = Theme;
// rgb-tuple helpers — pull from a Theme variant.
const VAR = (name) => BV[name]?.normal ?? BV.primary.normal;

// 2026-04-29 (Prompt 1) — global button hierarchy. Resolves a tier name to
// its locked structural spec (height, fontSize, glow). Returns null when no
// tier is requested so legacy positional args remain authoritative.
const tierSpec = (opts) => (opts && opts.tier && BTS[opts.tier]) ? BTS[opts.tier] : null;

// ─── LAYOUT POLICY ────────────────────────────────────────────────────
// Every UI element's (x, y, w, h) MUST come from
// `assets/token-duel/scripts/LayoutSpec.cjs`. NO literal coordinates inline.
// New elements: add to LayoutSpec FIRST, then reference here as
// `LAYOUT.<panel>.elements.<name>.{x,y,w,h}`. After editing LayoutSpec, run
//   npm run scenes && python3 scripts/verify-layout.py
// to detect unintended overlaps WITHOUT rebuilding the APK.
// ──────────────────────────────────────────────────────────────────────
const LAYOUT = require('./assets/token-duel/scripts/LayoutSpec.cjs');

// Phase 26 — Android safe-area top inset. Modern Android phones
// (19.5:9+) have a status bar / camera notch that cuts into the top
// of the widget-extended viewport. Panels with elements at y >= 580
// would otherwise render behind the status bar / camera. Each
// affected panel's root _lpos.y is shifted down by SAFE_AREA_TOP so
// its top-zone elements land below the unsafe top region.
// Internal panel layouts are unchanged (sibling positions preserved).
// 2026-04-26: 60 → 110 — at 60 the Pixel-style camera punch-hole still
// covered the top mascot row on TokenDuelPanel. 110 clears notch + status
// bar comfortably on a 19.5:9 viewport.
const SAFE_AREA_TOP = 110;

// 2026-04-27: RacePanel canvas is 720×1800 (oversized) and its top row sits
// at y=720, so even with TokenDuelPanel's inherited −110 the timer ring still
// landed in the camera punch-hole on tall (19.5:9+) viewports. Pushing the
// whole RacePanel down by an extra 90 keeps internal proportions intact
// (top row, player cards, duel bar, opponent strip, mascot all shift as one
// unit) and gives the ring real clearance below the device toolbar.
// 2026-04-29: superseded by lobbyMount() below — kept for reference only.
const RACE_SAFE_AREA_EXTRA = 90;

// 2026-04-29 v3: UNIFORM TOP-OF-PAGE alignment, calibrated to Home's
// resting position. v1 and v2 both had correct math, but PanelTransitions
// .swapPanel was clobbering panel _lpos to (0, 0, 0) on every swap. With
// that fixed (panel rest position now preserved across tweens), we anchor
// every panel so its topmost solid child has the same panel-local top-edge
// Y as Home's reference (the WalletPill row at y=640, h=60, top edge 670).
//
// Formula: mount.y = HOME_TOP_LOCAL_Y - panelTopEdgeLocalY
// Result: with Home at lpos.y=0 (its post-swap resting position), every
// other panel's lpos.y is offset so child world-Y of the topmost solid
// element matches Home's. Home stays put; everything else aligns to it.
//
// To shift the whole app up or down, edit HOME_TOP_LOCAL_Y. NEVER
// hand-tune individual panel mount offsets.
const HOME_TOP_LOCAL_Y = 670;

// Element types that count as "visible content" for top-edge math.
// Excludes 'sprite' and 'graphics' (decorative bgs, glows, halos, scrims)
// and 'group' (wrappers — children carry the real bbox).
const SOLID_TYPES = new Set([
    'label', 'btnPrimary', 'btnSuccess', 'btnDanger',
    'btnGhost', 'btnWarn', 'badge', 'chip', 'tab', 'editbox',
    'mascot', 'image', 'scrollview', 'slider'
]);

const computePanelTopEdge = (panelKey) => {
    const panel = LAYOUT[panelKey];
    const els = (panel && panel.elements) || {};
    const tpls = (panel && panel.templates) || {};
    let maxTopEdge = -Infinity;
    let source = null;       // element name that drove the top edge
    let sourceY = null, sourceH = null, sourceType = null;
    for (const k in els) {
        const el = els[k];
        if (!el || !SOLID_TYPES.has(el.type)) continue;
        if (typeof el.y !== 'number' || typeof el.h !== 'number') continue;
        const topEdge = el.y + el.h / 2;
        if (topEdge > maxTopEdge) {
            maxTopEdge = topEdge;
            source = k; sourceY = el.y; sourceH = el.h; sourceType = el.type;
        }
    }
    // Templates (e.g. TokenDuelPanel.topRowActionBtn at y=685) drop instances
    // as direct children of the panel, so they need to participate in top-edge
    // math. Templates use `y` (single y) or `baseY` (start of stack) and `h`.
    // A template instance is "visible content" if its slot is button-like.
    for (const k in tpls) {
        const t = tpls[k];
        if (!t || typeof t.h !== 'number') continue;
        // Skip templates that are clearly internals of a card/scrollview
        // (these never sit at the panel root). Heuristic: only treat templates
        // as top-row candidates if their name contains 'topRow', 'header',
        // 'Banner', or any template positioned at panel-local Y >= 600 (above
        // the lobby content band).
        const ty = (typeof t.y === 'number') ? t.y : (typeof t.baseY === 'number' ? t.baseY : null);
        if (typeof ty !== 'number') continue;
        if (ty < 600) continue;
        const topEdge = ty + t.h / 2;
        if (topEdge > maxTopEdge) {
            maxTopEdge = topEdge;
            source = `template:${k}`; sourceY = ty; sourceH = t.h; sourceType = 'template';
        }
    }
    // Override for panels whose topmost solid content is BUILT AT RUNTIME
    // (e.g. Portfolio/Leaderboard HubTabStrip from AppUI._buildHubTabs).
    if (panel && typeof panel.RUNTIME_TOP_EDGE === 'number' && panel.RUNTIME_TOP_EDGE > maxTopEdge) {
        maxTopEdge = panel.RUNTIME_TOP_EDGE;
        source = '<RUNTIME_TOP_EDGE>'; sourceY = null; sourceH = null; sourceType = 'runtime';
    }
    return { topEdge: maxTopEdge, source, sourceY, sourceH, sourceType };
};

const lobbyMount = (panelKey) => {
    const { topEdge, source, sourceY, sourceH, sourceType } = computePanelTopEdge(panelKey);
    const mountY = HOME_TOP_LOCAL_Y - topEdge;
    const srcDesc = sourceY != null
        ? `${source}(y=${sourceY},h=${sourceH},type=${sourceType})`
        : `${source}(type=${sourceType})`;
    console.log(`[LayoutDiag][build] ${panelKey} topEdge=${topEdge} source=${srcDesc} mount.y=${mountY}`);
    return v3(0, mountY, 0);
};

// 2026-04-29 — UNIFORM spacing diagnostic. One-pass audit at startup
// over every panel's elements; flags any CARD or CTA width that isn't a
// token (CONTENT_W=680, etc.) and any neighbor y-gap between top-level
// CARDS / CTAs / scrollviews that isn't a token (or a sum of tokens).
// Labels, dividers, status footers, halos, and chrome bits are exempt
// — the column rule is about the structural rhythm (cards + CTAs),
// not every text element.
//
// ALLOWED_WIDTHS: column widths (CONTENT_W=680, BODY_W=600, CHIP_W=200,
// CANVAS_W=720). 0 covers collapsed/auto-sized.
// ALLOWED_GAPS: SPACE_8/12/16/24/32 + composable sums.
const ALLOWED_WIDTHS = new Set([0, 200, 600, 680, 720]);
const ALLOWED_GAPS = new Set([0, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 60, 64, 72, 80]);
// Audit only types that anchor the structural column rhythm. CARDS
// (groups) and scrollviews must align with the column. Buttons split
// the column in many legitimate ways (icon chrome, tab pairs, "host /
// bot" 50/50 splits) so we don't audit btn widths here. Full-width
// CTAs that drift from CONTENT_W are best caught visually.
const COLUMN_TYPES = new Set(['group', 'scrollview']);
// Popover / modal / dropdown sub-elements don't sit in the main column
// — they're contextual surfaces sized to their trigger or content.
const SUB_SURFACE_RE = /Popover|Modal|Dropdown|Sheet|Drawer|Tooltip|TrophyTree/;
// Max edge-gap that counts as "drift" — anything larger is intentional
// vertical fill between a top section and a bottom CTA, not card-to-card
// drift.
const MAX_AUDITABLE_GAP = 200;

function logSpacingDrift(panelKey, name, spec) {
    if (!spec || typeof spec.w !== 'number') return false;
    if (!COLUMN_TYPES.has(spec.type)) return false;
    if (SUB_SURFACE_RE.test(name)) return false;
    if (ALLOWED_WIDTHS.has(spec.w)) return false;
    console.log(`[LayoutDiag][space] ${panelKey} ${name} (${spec.type}) w=${spec.w} (not a UNIFORM_LAYOUT width)`);
    return true;
}

// Edge-gap audit: distance from previous card's bottom edge to next
// card's top edge (not center-to-center, which is meaningless when
// the two cards have different heights).
function logGapDrift(panelKey, prev, cur) {
    if (SUB_SURFACE_RE.test(prev.name) || SUB_SURFACE_RE.test(cur.name)) return false;
    const prevBottom = prev.spec.y - prev.spec.h / 2;
    const curTop     = cur.spec.y  + cur.spec.h  / 2;
    const gap = Math.abs(prevBottom - curTop);
    if (gap === 0) return false;
    if (gap > MAX_AUDITABLE_GAP) return false;
    if (ALLOWED_GAPS.has(gap)) return false;
    console.log(`[LayoutDiag][space] ${panelKey} gap ${prev.name}→${cur.name} = ${gap} (not a UNIFORM_SPACE token or sum)`);
    return true;
}

function auditLayoutSpacing() {
    // Skip overlays / drawer panels with their own narrower column.
    const NON_COLUMN = /^(BackgroundFX|JoinMatchConfirmOverlay|LiveStandingsOverlay|LiveStandingsRow|NotificationToastOverlay|NotificationToastSlot|NotificationPanel|CountdownOverlay|SigningOverlay|LoadingOverlay|LevelUpOverlay)$/;
    let issues = 0;
    for (const panelKey of Object.keys(LAYOUT)) {
        if (panelKey.startsWith('_')) continue;             // _GLOBAL_, etc.
        if (NON_COLUMN.test(panelKey)) continue;
        const panel = LAYOUT[panelKey];
        if (!panel || typeof panel !== 'object') continue;
        const els = panel.elements;
        if (!els || typeof els !== 'object') continue;

        // Width audit — cards / CTAs / scrollviews only.
        for (const name of Object.keys(els)) {
            if (logSpacingDrift(panelKey, name, els[name])) issues++;
        }

        // Gap audit — only top-level CENTER-anchored cards / CTAs / scrollviews.
        // Title/subtitle/status labels and chrome bits are exempt.
        const stack = Object.keys(els)
            .map((n) => ({ name: n, spec: els[n] }))
            .filter(({ spec }) =>
                spec &&
                typeof spec.x === 'number' && spec.x === 0 &&
                typeof spec.y === 'number' &&
                typeof spec.h === 'number' &&
                COLUMN_TYPES.has(spec.type))
            .sort((a, b) => b.spec.y - a.spec.y);
        for (let i = 1; i < stack.length; i++) {
            const prev = stack[i - 1];
            const cur  = stack[i];
            if (logGapDrift(panelKey, prev, cur)) issues++;
        }
    }
    if (issues === 0) {
        console.log(`[LayoutDiag][space] OK — every audited card/CTA width and column gap is a UNIFORM token (or token sum).`);
    } else {
        console.log(`[LayoutDiag][space] ${issues} drift warning(s) above. Snap to UNIFORM_LAYOUT / UNIFORM_SPACE tokens.`);
    }
}
auditLayoutSpacing();

const UUIDS = {
    MWAManager: '409dciqDmlP9rvNGXKC80Rx',
    DemoAppConfig: '97371AjclpDVa7mBnZTheRu',
    AppUI: 'cb798kSOOFKbbKjUoIU/iq3',
};

let idC = 0;
const gid = () => { idC++; let s='',n=idC+Date.now()%99999; for(let i=0;i<21;i++){s+='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[n%62];n=Math.floor(n/62)+i*7+idC;} return s; };
const uuid = () => { let u='',h='0123456789abcdef'; for(let i=0;i<32;i++){u+=h[Math.floor(Math.random()*16)];if(i===7||i===11||i===15||i===19)u+='-';} return u; };
const v3 = (x=0,y=0,z=0) => ({__type__:'cc.Vec3',x,y,z});
const qt = () => ({__type__:'cc.Quat',x:0,y:0,z:0,w:1});
const sz = (w,h) => ({__type__:'cc.Size',width:w,height:h});
const v2 = (x,y) => ({__type__:'cc.Vec2',x,y});
const cl = (r,g,b,a=255) => ({__type__:'cc.Color',r,g,b,a});
const rf = (id) => ({__id__:id});

class SB {
    constructor(){this.e=[];}
    add(o){const i=this.e.length;this.e.push(o);return i;}
    node(name,parent,children,comps,pos=v3()){return this.add({__type__:'cc.Node',_name:name,_objFlags:0,__editorExtras__:{},_parent:parent!==null?rf(parent):null,_children:children.map(rf),_active:true,_components:comps.map(rf),_prefab:null,_lpos:pos,_lrot:qt(),_lscale:v3(1,1,1),_mobility:0,_layer:33554432,_euler:v3(),_id:gid()});}
    ut(n,w,h){return this.add({__type__:'cc.UITransform',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_contentSize:sz(w,h),_anchorPoint:v2(0.5,0.5),_id:gid()});}
    lbl(n,t,fs=30,r=255,g=255,b=255){return this.add({__type__:'cc.Label',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_string:t,_horizontalAlign:1,_verticalAlign:1,_actualFontSize:fs,_fontSize:fs,_fontFamily:'Arial',_lineHeight:fs+10,_overflow:0,_enableWrapText:true,_font:{__uuid__:'e35e48c9-4afd-4ca0-98ac-860f2e2c8f85'},_isSystemFontUsed:false,_spacingX:0,_isItalic:false,_isBold:false,_isUnderline:false,_underlineHeight:2,_cacheMode:0,_color:cl(r,g,b),_isBatchable:false,_id:gid()});}
    btn(n,r=60,g=120,b=200){return this.add({__type__:'cc.Button',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_interactable:true,_transition:2,_normalColor:cl(r,g,b),_hoverColor:cl(Math.min(255,r+20),Math.min(255,g+20),Math.min(255,b+20)),_pressedColor:cl(Math.max(0,r-20),Math.max(0,g-20),Math.max(0,b-20)),_disabledColor:cl(100,100,100,180),_duration:0.1,_zoomScale:1.05,_target:rf(n),_id:gid()});}
    spr(n,r=60,g=120,b=200,sf='20835ba4-6145-4fbc-a58a-051ce700aa3e@f9941',type=1){return this.add({__type__:'cc.Sprite',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_customMaterial:null,_srcBlendFactor:2,_dstBlendFactor:4,_color:cl(r,g,b),_type:type,_fillType:0,_sizeMode:0,_fillCenter:v2(0,0),_fillStart:0,_fillRange:0,_isTrimmedMode:true,_useGrayscale:false,_atlas:null,_spriteFrame:{__uuid__:sf},_id:gid()});}
    // Session 5: orthoHeight = half of the design-resolution height. 720×1280
    // portrait → half-height 640. Previous 360 was baked in for a 720 viewport
    // which clipped any UI above y=360 and left massive black margins.
    cam(n){return this.add({__type__:'cc.Camera',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_projection:0,_priority:0,_fov:45,_fovAxis:0,_orthoHeight:640,_near:0,_far:2000,_color:cl(0,0,0),_depth:1,_stencil:0,_clearFlags:7,_rect:{__type__:'cc.Rect',x:0,y:0,width:1,height:1},_aperture:19,_shutter:7,_iso:0,_screenScale:1,_visibility:1108344832,_targetTexture:null,_postProcess:null,_usePostProcess:false,_cameraType:-1,_trackingType:0,_id:gid()});}
    canvas(n,cam){return this.add({__type__:'cc.Canvas',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_cameraComponent:rf(cam),_alignCanvasWithScreen:true,_id:gid()});}
    widget(n){return this.add({__type__:'cc.Widget',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_alignFlags:45,_target:null,_left:0,_right:0,_top:0,_bottom:0,_horizontalCenter:0,_verticalCenter:0,_isAbsLeft:true,_isAbsRight:true,_isAbsTop:true,_isAbsBottom:true,_isAbsHorizontalCenter:true,_isAbsVerticalCenter:true,_originalWidth:0,_originalHeight:0,_alignMode:2,_lockFlags:0,_id:gid()});}
    custom(n,uuid){return this.add({__type__:uuid,_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_id:gid()});}
    globals(){const g=this.e.length;this.add({__type__:'cc.SceneGlobals',ambient:rf(g+1),shadows:rf(g+2),_skybox:rf(g+3),fog:rf(g+4),octree:rf(g+5),skin:rf(g+6),lightProbeInfo:rf(g+7),postSettings:rf(g+8),bakedWithStationaryMainLight:false,bakedWithHighpLightmap:false});this.add({__type__:'cc.AmbientInfo',_skyColorHDR:{__type__:'cc.Vec4',x:0,y:0,z:0,w:0.52},_skyColor:{__type__:'cc.Vec4',x:0,y:0,z:0,w:0.52},_skyIllumHDR:20000,_skyIllum:20000,_groundAlbedoHDR:{__type__:'cc.Vec4',x:0,y:0,z:0,w:0},_groundAlbedo:{__type__:'cc.Vec4',x:0,y:0,z:0,w:0},_skyColorLDR:{__type__:'cc.Vec4',x:0.2,y:0.5,z:0.8,w:1},_skyIllumLDR:20000,_groundAlbedoLDR:{__type__:'cc.Vec4',x:0.2,y:0.2,z:0.2,w:1}});this.add({__type__:'cc.ShadowsInfo',_enabled:false,_type:0,_normal:v3(0,1,0),_distance:0,_planeBias:1,_shadowColor:cl(76,76,76),_maxReceived:4,_size:v2(512,512)});this.add({__type__:'cc.SkyboxInfo',_envLightingType:0,_envmapHDR:null,_envmap:null,_envmapLDR:null,_diffuseMapHDR:null,_diffuseMapLDR:null,_enabled:false,_useHDR:true,_editableMaterial:null,_reflectionHDR:null,_reflectionLDR:null,_rotationAngle:0});this.add({__type__:'cc.FogInfo',_type:0,_fogColor:cl(200,200,200),_enabled:false,_fogDensity:0.3,_fogStart:0.5,_fogEnd:300,_fogAtten:5,_fogTop:1.5,_fogRange:1.2,_accurate:false});this.add({__type__:'cc.OctreeInfo',_enabled:false,_minPos:v3(-1024,-1024,-1024),_maxPos:v3(1024,1024,1024),_depth:8});this.add({__type__:'cc.SkinInfo',_enabled:false,_blurRadius:0.01,_sssIntensity:3});this.add({__type__:'cc.LightProbeInfo',_giScale:1,_giSamples:1024,_bounces:2,_reduceRinging:0,_showProbe:true,_showWireframe:true,_showConvex:false,_data:null,_lightProbeSphereVolume:1});this.add({__type__:'cc.PostSettingsInfo',_toneMappingType:0});return g;}
    toJSON(){return JSON.stringify(this.e,null,2);}
}

function mkLabel(sb, name, parent, text, fs, y, w=800, h=50, r=255, g=255, b=255) {
    const n = sb.e.length, u=n+1, l=n+2;
    sb.node(name, parent, [], [u,l], v3(0,y,0));
    sb.ut(n,w,h); sb.lbl(n,text,fs,r,g,b);
    return n;
}

/**
 * UX Phase 2c: tweak a Label's style (bold / letter-spacing / color / font-size)
 * after it's been created. Finds the cc.Label component on the node itself or
 * its first child (handles both mkLabel and mkBtn patterns).
 */
function style(sb, nodeIdx, opts = {}) {
    if (nodeIdx == null || !sb.e[nodeIdx]) return;
    let labelIdx = null;
    // Check components on the node itself first (mkLabel pattern).
    const cs = sb.e[nodeIdx]._components ?? [];
    for (const c of cs) {
        if (sb.e[c.__id__]?.__type__ === 'cc.Label') { labelIdx = c.__id__; break; }
    }
    // Otherwise search every child (mkBtn pattern — the label may not be child[0]
    // now that buttons have a Highlight sibling inserted before the Label).
    if (labelIdx === null) {
        const children = sb.e[nodeIdx]._children ?? [];
        for (const childRef of children) {
            const child = sb.e[childRef.__id__];
            if (!child) continue;
            if (child._name && child._name !== 'Label') continue; // prefer the 'Label' child
            const ccs = child._components ?? [];
            for (const c of ccs) {
                if (sb.e[c.__id__]?.__type__ === 'cc.Label') { labelIdx = c.__id__; break; }
            }
            if (labelIdx !== null) break;
        }
    }
    if (labelIdx === null) return;
    const l = sb.e[labelIdx];
    // UX Phase 2c: bold=true swaps the font to Sora-Bold instead of setting
    // _isBold (which would synthetic-bold Inter on top of a font that isn't
    // designed for it — muddier rendering). Sora-Bold is already bold by weight.
    if (opts.bold === true) {
        l._font = { __uuid__: 'b93c2245-b7ae-4e03-b74e-9f3dd1015941' };
        l._isBold = false;
    } else if (opts.bold === false) {
        l._font = { __uuid__: 'e35e48c9-4afd-4ca0-98ac-860f2e2c8f85' };
        l._isBold = false;
    }
    if (opts.spacing !== undefined) l._spacingX = opts.spacing;
    if (opts.color) l._color = opts.color;
    if (opts.fontSize !== undefined) {
        l._actualFontSize = opts.fontSize;
        l._fontSize = opts.fontSize;
        l._lineHeight = opts.fontSize + 10;
    }
    // Stage 5N — switch to system monospace (Menlo on iOS / monospace on Android)
    // so number columns don't dance during roll-tweens. No bundled JetBrains.
    if (opts.mono === true) {
        l._fontFamily = 'Menlo';
        l._isSystemFontUsed = true;
        l._font = null;
    }
}

// UX Phase 2c palette shortcuts for typography pass.
const GOLD = () => cl(255, 210, 74, 255);    // Palette.rank.gold
const TEXT_HI = () => cl(255, 255, 255, 255); // Palette.text.hi (2026-04-30 white)
// Phase 15 (B5): mid + lo tier helpers for the 3-tier text hierarchy.
const TEXT_MID = () => cl(184, 184, 184, 255); // Palette.text.mid — secondary
const TEXT_LO  = () => cl(140, 140, 140, 255); // Palette.text.lo  — tertiary / muted

// Phase 13 (B3): every button gets a 2-strip bevel — top highlight + bottom
// shadow. The brand-color base + brighter top + slight bottom-shadow reads
// as a subtle convex surface (light-from-above). Children order
// [TopHighlight, BottomShadow, Label] keeps Label on top.
/**
 * 2026-04-29 — uniform "← Back" header builder, mirrors MIP. Creates:
 *   - "BackLinkLabel" (visible 18pt off-white left-aligned label "← Back")
 *   - "BackButton"   (invisible 140x36 hit area, alpha-0 cc.Button)
 * Both at panel-local (UNIFORM_HEADER.BACK_LINK.x, UNIFORM_HEADER.BACK_Y) by
 * default; pass `y` to override (e.g. PostMatch sits its back at y=622 to
 * clear the 60pt h=80 title).
 *
 * Returns { linkN, btnN } so callers can wire click handlers / opacity tweens.
 */
// 2026-04-29 — log-only helper for panels that build back buttons via the
// older mkLabel('BackLinkLabel'...) + sb.node('BackButton'...) pattern
// (Settings, MIP, Leaderboard, Portfolio, TokenDuel, TokenDetail, DailyChallenge).
// Mirrors the [LayoutDiag][back] log produced by mkBackHeader.
function logBackParity(panelKey, y) {
    const top = computePanelTopEdge(panelKey);
    // For static sources we know the center y directly (top.sourceY).
    // For RUNTIME_TOP_EDGE (HubTabStrip h=56) the source's center is
    // topEdge - 28; tolerate any element h up to 60 by using a 32-px window.
    const topY = (top.sourceY != null) ? top.sourceY : (top.topEdge - 28);
    const tolerance = (top.sourceY != null) ? 6 : 32;
    const onPar = Math.abs(y - topY) <= tolerance;
    const flag = onPar ? 'true ' : 'FALSE';
    console.log(`[LayoutDiag][back] ${panelKey} back.y=${y} topY=${topY} (${top.source}) onPar=${flag}`);
}

function mkBackHeader(sb, parent, opts = {}) {
    const HDR = LAYOUT.UNIFORM_HEADER || {
        BACK_Y: 580,
        BACK_LINK: { x: -280, w: 110, h: 28 },
        BACK_BTN:  { x: -280, w: 140, h: 36 },
    };
    const y = opts.y ?? HDR.BACK_Y;
    // 1) visible label.
    const linkN = mkLabel(sb, 'BackLinkLabel', parent, '← Back', 18,
        y, HDR.BACK_LINK.w, HDR.BACK_LINK.h,
        200, 210, 230);
    sb.e[linkN]._lpos = v3(HDR.BACK_LINK.x, y, 0);
    // Left-align the label so "← Back" sits flush against its left edge,
    // matching the MIP reference screenshot.
    const linkLabelIdx = sb.e[linkN]._components[1].__id__;
    sb.e[linkLabelIdx]._horizontalAlign = 0;
    // 2) invisible hit area (alpha-0 transitions, no background).
    const btnN = sb.e.length;
    sb.node('BackButton', parent, [], [], v3(HDR.BACK_BTN.x, y, 0));
    const btnUT = sb.ut(btnN, HDR.BACK_BTN.w, HDR.BACK_BTN.h);
    const btnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(btnN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.04, _target: rf(btnN), _id: gid(),
    });
    sb.e[btnN]._components = [rf(btnUT), rf(btnBtn)];
    // 2026-04-29 — back-vs-top diagnostic. Compares back.y against the panel's
    // auto-detected topmost solid element y. onPar=true means back sits at the
    // same row as the highest element (matching the MIP reference). onPar=false
    // means back is BELOW something else and needs an override.
    if (opts && opts.panelKey) {
        logBackParity(opts.panelKey, y);
    }
    return { linkN, btnN };
}

// 2026-04-29 (Prompt 1) — body sprite for buttons. Uses the 9-slice rounded
// asset (radius 16) when UUID_CARD_BG_R16 is populated; falls back to the
// flat white square otherwise. Both branches keep the same call shape so
// callers don't need to know which mode is active.
function btnBodySpr(sb, n, r, g, b) {
    const useRounded = !!UUID_CARD_BG_R16;
    return sb.spr(n, r, g, b, useRounded ? UUID_CARD_BG_R16 : UUID_WHITE_SPRITE, 1);
}

// 2026-04-29 (round-button-chrome) — bevel / ripple / halo sprite helper.
// Mirrors btnBodySpr but writes a custom alpha into the resulting Sprite's
// _color so callers don't need a separate `sb.e[idx]._color = cl(...)` step.
// Critical: routes through the same 9-slice rounded asset as the body so the
// chrome corners clip to the same outline. Without this, TopHighlight (white)
// and BottomShadow (black) bleed through the body's transparent rounded
// corners as L-shapes, and on small icon buttons combine into a `+` artifact.
function btnChromeSpr(sb, n, r, g, b, a) {
    const useRounded = !!UUID_CARD_BG_R16;
    const idx = sb.spr(n, r, g, b, useRounded ? UUID_CARD_BG_R16 : UUID_WHITE_SPRITE, 1);
    sb.e[idx]._color = cl(r, g, b, a);
    return idx;
}

// 2026-04-29 (Prompt 1) — body sprite for cards. One canonical surface:
// Palette.bg.card (RGB 30/36/56) at 230 alpha, 9-slice rounded asset for
// radius 16. Replaces ad-hoc `sb.spr(cardN, r, g, b)` + manual `_color =
// cl(...)` pairs. Caller still owns parent node, UITransform, and
// downstream wiring. Pass `alpha` only when a card intentionally needs a
// different translucency (rare).
function cardBodySpr(sb, n, alpha) {
    // 2026-04-30 black-glass overhaul: navy (30,36,56) → obsidian (10,13,20).
    // Mirrors Theme.cjs Palette.bg.card change. One edit, every card flips.
    const useRounded = !!UUID_CARD_BG_R16;
    const a = (alpha != null) ? alpha : 235;  // Card.bgAlpha
    const sprIdx = sb.spr(n, 26, 8, 32,
        useRounded ? UUID_CARD_BG_R16 : UUID_WHITE_SPRITE,
        useRounded ? 1 : 0);
    sb.e[sprIdx]._color = cl(26, 8, 32, a);
    return sprIdx;
}

// Bevel chrome (TopHighlight + BottomShadow) was designed for tall hero
// buttons (h >= ~80). On short buttons (h ~ 32-60) the BottomShadow strip
// is only 5-10 px tall, far smaller than the 9-slice border (16 px) of
// card_bg_r16, so the corner pieces overlap and render as visible dark
// notches at the button corners. Threshold below: skip the chrome on
// short buttons; their flat rounded body (already through btnBodySpr +
// card_bg_r16) reads cleanly without depth chrome.
const BTN_CHROME_MIN_H = 80;

function mkBtn(sb, name, parent, text, y, w=500, h=75, br=60, bg=120, bb=200, opts) {
    // 2026-04-29 (Prompt 1) — when a tier is supplied via opts, ButtonTierSpec
    // dictates label fontSize and (for hero variants) glow strength. Height +
    // width stay LayoutSpec-driven so call sites keep their existing
    // calibrated dimensions. Tier heights (136 / 104 / 48) are aligned with
    // current LayoutSpec values within the spec ranges; treat them as
    // documentation rather than overrides.
    const ts = tierSpec(opts);
    const useChrome = h >= BTN_CHROME_MIN_H;
    const bn=sb.e.length;
    const fontSize = ts ? ts.fontSize : Math.max(26, Math.round(h*0.34));
    if (useChrome) {
        const tHN=bn+1, bSN=bn+2, ln=bn+3, bu=bn+4, sp=bn+5, bt=bn+6;
        const tHUt=bn+7, tHSp=bn+8, bSUt=bn+9, bSSp=bn+10, lUt=bn+11, ll=bn+12;
        sb.node(name, parent, [tHN, bSN, ln], [bu, sp, bt], v3(0, y, 0));
        sb.node('TopHighlight', bn, [], [tHUt, tHSp], v3(0, h * 0.30, 0));
        sb.node('BottomShadow', bn, [], [bSUt, bSSp], v3(0, -h * 0.42, 0));
        sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
        sb.ut(bn, w, h); btnBodySpr(sb, bn, br, bg, bb); sb.btn(bn, br, bg, bb);
        sb.ut(tHN, w - 4, h * 0.40); btnChromeSpr(sb, tHN, 255, 255, 255, 52);
        sb.ut(bSN, w - 4, h * 0.16); btnChromeSpr(sb, bSN, 0, 0, 0, 46);
        sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
        sb.e[ll]._overflow = 2;
    } else {
        const ln=bn+1, bu=bn+2, sp=bn+3, bt=bn+4, lUt=bn+5, ll=bn+6;
        sb.node(name, parent, [ln], [bu, sp, bt], v3(0, y, 0));
        sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
        sb.ut(bn, w, h); btnBodySpr(sb, bn, br, bg, bb); sb.btn(bn, br, bg, bb);
        sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
        sb.e[ll]._overflow = 2;
    }
    return bn;
}

function mkBtnXY(sb, name, parent, text, x, y, w=500, h=75, br=60, bg=120, bb=200, opts) {
    // 2026-04-29 (Prompt 1) — see mkBtn for tier rationale.
    const ts = tierSpec(opts);
    const useChrome = h >= BTN_CHROME_MIN_H;
    const bn=sb.e.length;
    const fontSize = ts ? ts.fontSize : Math.max(22, Math.round(h*0.34));
    if (useChrome) {
        const tHN=bn+1, bSN=bn+2, ln=bn+3, bu=bn+4, sp=bn+5, bt=bn+6;
        const tHUt=bn+7, tHSp=bn+8, bSUt=bn+9, bSSp=bn+10, lUt=bn+11, ll=bn+12;
        sb.node(name, parent, [tHN, bSN, ln], [bu, sp, bt], v3(x, y, 0));
        sb.node('TopHighlight', bn, [], [tHUt, tHSp], v3(0, h * 0.30, 0));
        sb.node('BottomShadow', bn, [], [bSUt, bSSp], v3(0, -h * 0.42, 0));
        sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
        sb.ut(bn, w, h); btnBodySpr(sb, bn, br, bg, bb); sb.btn(bn, br, bg, bb);
        sb.ut(tHN, w - 4, h * 0.40); btnChromeSpr(sb, tHN, 255, 255, 255, 52);
        sb.ut(bSN, w - 4, h * 0.16); btnChromeSpr(sb, bSN, 0, 0, 0, 46);
        sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
        sb.e[ll]._overflow = 2;
    } else {
        const ln=bn+1, bu=bn+2, sp=bn+3, bt=bn+4, lUt=bn+5, ll=bn+6;
        sb.node(name, parent, [ln], [bu, sp, bt], v3(x, y, 0));
        sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
        sb.ut(bn, w, h); btnBodySpr(sb, bn, br, bg, bb); sb.btn(bn, br, bg, bb);
        sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
        sb.e[ll]._overflow = 2;
    }
    return bn;
}

// Phase 13 (B3): hero CTA — adds a brand-color glow halo behind the button.
// The halo is a sibling rendered FIRST (before the button) so it appears
// behind. Default 12-px bleed on every side, alpha 80, tinted the button's
// own brand color. V2: callers can pass `opts.glowAlpha` and `opts.glowPad`
// to tier the glow intensity per CTA hierarchy (Start > Find > Bot).
// 2026-04-29 (Prompt 1): when `opts.tier` is supplied, ButtonTierSpec[tier]
// supplies the label fontSize and locks glowAlpha + glowPad to the tier
// hierarchy (primary 110/16, secondary 70/12, tertiary 0/0). Height + width
// stay caller-controlled to preserve LayoutSpec-tuned dimensions.
// Returns { glow, btn, ripple }.
function mkBtnHero(sb, name, parent, text, x, y, w, h, br, bg, bb, opts) {
    const ts = tierSpec(opts);
    const glowAlpha = ts ? ts.glowAlpha
        : (opts && typeof opts.glowAlpha === 'number') ? opts.glowAlpha : 80;
    const glowPad   = ts ? ts.glowPad
        : (opts && typeof opts.glowPad   === 'number') ? opts.glowPad   : 12;
    if (glowAlpha <= 0) {
        // Tertiary tier (no halo) — just delegate straight to mkBtnXY and
        // skip building the BtnGlow_/Ripple_ siblings.
        const btnN = mkBtnXY(sb, name, parent, text, x, y, w, h, br, bg, bb, opts);
        return { glow: -1, btn: btnN, ripple: -1 };
    }
    // Halo sibling — w+pad*2, h+pad*2, brand-color at the chosen alpha.
    const glowN = sb.e.length;
    sb.node(`BtnGlow_${name}`, parent, [], [], v3(x, y, 0));
    const glowUT = sb.ut(glowN, w + glowPad * 2, h + glowPad * 2);
    // 2026-04-29 (round-button-chrome) — halo uses the same 9-slice rounded
    // asset as the body so its outer corners are rounded too. Without this,
    // the bloom is a hard square behind a rounded button.
    const glowSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(glowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(br, bg, bb, glowAlpha),
        _spriteFrame: { __uuid__: UUID_CARD_BG_R16 || UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[glowN]._components = [rf(glowUT), rf(glowSpr)];
    // Actual button — pass opts so tier-derived height + rounded body sprite
    // propagate down to the inner factory.
    const btnN = mkBtnXY(sb, name, parent, text, x, y, w, h, br, bg, bb, opts);
    // Phase 18 — ripple-on-click child sprite. AppUI's ButtonFX.addRipple
    // activates + tweens scale/opacity on CLICK. Initially _active=false +
    // alpha 0 so it's invisible until tapped. Sized = button size; sits
    // centered (0,0) inside the button.
    // 2026-04-29 (round-button-chrome) — ripple uses the rounded asset so
    // it expands as a rounded shape that matches the button outline.
    const rippleN = sb.e.length;
    sb.node(`Ripple_${name}`, btnN, [], [], v3(0, 0, 0));
    const rippleUT = sb.ut(rippleN, w, h);
    const rippleSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(rippleN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 0),
        _spriteFrame: { __uuid__: UUID_CARD_BG_R16 || UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[rippleN]._components = [rf(rippleUT), rf(rippleSpr)];
    sb.e[rippleN]._active = false;
    // Add ripple to the button's _children. mkBtnXY sets children to
    // [TopHighlight, BottomShadow, Label]; insert ripple FIRST so it renders
    // beneath labels (face-of-button overlay).
    const existingChildren = sb.e[btnN]._children ?? [];
    sb.e[btnN]._children = [rf(rippleN), ...existingChildren];
    return { glow: glowN, btn: btnN, ripple: rippleN };
}

// Premium two-line CTA — title + subtitle stacked INSIDE the button rect.
// Same TopHighlight/BottomShadow bevel and ripple/glow halo as mkBtnHero.
// `opts.ghost` swaps the body color for the dark surface and renders the
// title in (br,bg,bb) as an accent — used for secondary actions (Reconnect)
// that shouldn't compete visually with the primary CTA. Ghost variants get
// no glow halo. Returns { glow, btn, ripple } — glow=-1 when ghost.
function mkBtnHeroLayered(sb, name, parent, title, subtitle, x, y, w, h, br, bg, bb, opts = {}) {
    // 2026-04-29 (Prompt 1) — when a tier is supplied, ButtonTierSpec[tier]
    // dictates title fontSize and halo strength. Subtitle stays a proportional
    // ratio so two-line layout doesn't squash. Height + width stay caller-
    // controlled (LayoutSpec-driven) to preserve calibrated dimensions.
    // 2026-04-29 (demo-ready) — opts.titleFs / opts.subFs let a single call
    // site (currently the Landing ConnectButton + ReconnectButton) override
    // the tier font size without cascading to every other primary/secondary
    // button. Preferred over editing ButtonTierSpec.
    const ts = tierSpec(opts);
    const ghost = opts.ghost === true;
    const haloAlpha = ts ? ts.glowAlpha : (opts.haloAlpha ?? 80);
    const hasGradient = opts.gradient === true;
    const bodyR = ghost ? 21 : br, bodyG = ghost ? 25 : bg, bodyB = ghost ? 41 : bb;
    const titleR = ghost ? br : 255, titleG = ghost ? bg : 255, titleB = ghost ? bb : 255;
    const subAlpha = 220;
    const titleFs = opts.titleFs ?? (ts ? ts.fontSize : Math.max(24, Math.round(h * 0.28)));
    const subFs   = opts.subFs   ?? (ts ? Math.max(14, Math.round(titleFs * 0.55))
                                        : Math.max(14, Math.round(h * 0.16)));

    // Glow halo sibling — added BEFORE button body so it renders behind.
    // Skipped for ghost (secondary surface) and for any tier whose glowAlpha
    // resolves to <=0 (tertiary).
    let glowN = -1;
    if (!ghost && haloAlpha > 0) {
        const glowPad = ts ? ts.glowPad : 12;
        glowN = sb.e.length;
        sb.node(`BtnGlow_${name}`, parent, [], [], v3(x, y, 0));
        const glowUT  = sb.ut(glowN, w + glowPad * 2, h + glowPad * 2);
        // 2026-04-29 (round-button-chrome) — halo uses the rounded asset so
        // its outer corners match the button outline.
        const glowSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(glowN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(br, bg, bb, haloAlpha),
            _spriteFrame: { __uuid__: UUID_CARD_BG_R16 || UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[glowN]._components = [rf(glowUT), rf(glowSpr)];
    }

    // Body + bevel + (optional MidGloss) + 2 labels. Index pre-compute is
    // conditional because adding MidGloss bumps every later slot by 2 (one
    // node + one UT + one Sprite).
    const bn = sb.e.length;
    const tHN = bn + 1;
    const bSN = bn + 2;
    const mgN = hasGradient ? bn + 3 : -1;
    const tlN = bn + (hasGradient ? 4 : 3);
    const slN = bn + (hasGradient ? 5 : 4);
    let next = slN + 1;
    const bu = next++, sp = next++, bt = next++;
    const tHUt = next++, tHSp = next++;
    const bSUt = next++, bSSp = next++;
    const mgUt = hasGradient ? next++ : -1;
    const mgSp = hasGradient ? next++ : -1;
    const tlUt = next++, tlLbl = next++;
    const slUt = next++, slLbl = next++;

    const childrenList = hasGradient
        ? [tHN, bSN, mgN, tlN, slN]
        : [tHN, bSN, tlN, slN];
    sb.node(name, parent, childrenList, [bu, sp, bt], v3(x, y, 0));
    sb.node('TopHighlight', bn, [], [tHUt, tHSp], v3(0,  h * 0.30, 0));
    sb.node('BottomShadow', bn, [], [bSUt, bSSp], v3(0, -h * 0.42, 0));
    if (hasGradient) sb.node('MidGloss', bn, [], [mgUt, mgSp], v3(0, h * 0.05, 0));
    sb.node('TitleLabel',    bn, [], [tlUt, tlLbl], v3(0,  h * 0.14, 0));
    sb.node('SubtitleLabel', bn, [], [slUt, slLbl], v3(0, -h * 0.20, 0));

    sb.ut(bn, w, h); btnBodySpr(sb, bn, bodyR, bodyG, bodyB); sb.btn(bn, bodyR, bodyG, bodyB);
    // 2026-04-29 (round-button-chrome) — bevel sprites clip to rounded body.
    sb.ut(tHN, w - 4, h * 0.40); btnChromeSpr(sb, tHN, 255, 255, 255, ghost ? 24 : 52);
    sb.ut(bSN, w - 4, h * 0.16); btnChromeSpr(sb, bSN, 0, 0, 0, ghost ? 22 : 46);
    if (hasGradient) {
        sb.ut(mgN, w - 4, h * 0.30); sb.spr(mgN, 255, 255, 255);
        sb.e[mgSp]._color = cl(255, 255, 255, 28); // 11% white sheen across mid-line
    }

    // Title — bold display font.
    sb.ut(tlN, w, h * 0.48);
    sb.lbl(tlN, title, titleFs, titleR, titleG, titleB);
    sb.e[tlLbl]._font = { __uuid__: UUID_FONT_SORA };
    sb.e[tlLbl]._isBold = false;
    sb.e[tlLbl]._overflow = 2;
    sb.e[tlLbl]._lineHeight = titleFs + 4;

    // Subtitle — body font, muted.
    const subR = ghost ? 168 : 244, subG = ghost ? 174 : 245, subB = ghost ? 201 : 249;
    sb.ut(slN, w - 24, h * 0.32);
    sb.lbl(slN, subtitle, subFs, subR, subG, subB);
    sb.e[slLbl]._color = cl(subR, subG, subB, subAlpha);
    sb.e[slLbl]._overflow = 2;
    sb.e[slLbl]._lineHeight = subFs + 2;

    // Ripple-on-click child — invisible until ButtonFX.addRipple activates.
    // 2026-04-29 (round-button-chrome) — ripple uses the rounded asset so
    // it expands as a rounded shape that matches the button outline.
    const rippleN = sb.e.length;
    sb.node(`Ripple_${name}`, bn, [], [], v3(0, 0, 0));
    const rippleUT = sb.ut(rippleN, w, h);
    const rippleSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(rippleN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 0),
        _spriteFrame: { __uuid__: UUID_CARD_BG_R16 || UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[rippleN]._components = [rf(rippleUT), rf(rippleSpr)];
    sb.e[rippleN]._active = false;
    // Prepend ripple so it renders BENEATH labels.
    const existing = sb.e[bn]._children ?? [];
    sb.e[bn]._children = [rf(rippleN), ...existing];

    // 2026-04-28 polish — periodic shimmer-sweep child for hero CTAs with
    // gradient sheen. Narrow vertical white-alpha band parked off-screen
    // (active=false) until ButtonFX.addShimmerSweep tweens it across the
    // button face every few seconds. Appended LAST in _children so it
    // renders ON TOP of the labels during a sweep.
    if (hasGradient) {
        const shimmerN = sb.e.length;
        sb.node(`Shimmer_${name}`, bn, [], [], v3(0, 0, 0));
        const shimmerUT = sb.ut(shimmerN, 90, h);
        const shimmerSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(shimmerN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(255, 255, 255, 80),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[shimmerN]._components = [rf(shimmerUT), rf(shimmerSpr)];
        sb.e[shimmerN]._active = false;
        sb.e[bn]._children = [...sb.e[bn]._children, rf(shimmerN)];
    }
    return { glow: glowN, btn: bn, ripple: rippleN };
}

// Subtle status pill — semi-translucent dark surface + center label. Used
// for the Landing footer "Disconnected" indicator. AppUI flips text + color
// at runtime via _setConnectionPill.
function mkPill(sb, name, parent, text, x, y, w, h, opts = {}) {
    const bgR = opts.bgR ?? 30,  bgG = opts.bgG ?? 36,  bgB = opts.bgB ?? 56;
    const txR = opts.txR ?? 168, txG = opts.txG ?? 174, txB = opts.txB ?? 201;
    const bgAlpha = opts.bgAlpha ?? 200;
    const fs = Math.max(14, Math.round(h * 0.45));
    const pn = sb.e.length;
    const lblN = pn + 1;
    sb.node(name, parent, [lblN], [pn+2, pn+3], v3(x, y, 0));
    sb.node('Label', pn, [], [pn+4, pn+5], v3(0, 0, 0));
    sb.ut(pn, w, h);
    sb.spr(pn, bgR, bgG, bgB);
    sb.e[pn+3]._color = cl(bgR, bgG, bgB, bgAlpha);
    sb.ut(lblN, w, h);
    sb.lbl(lblN, text, fs, txR, txG, txB);
    return pn;
}

// Phase 14 (B4): premium card edge accent. 4-px brand-color strip at the
// very top of a card. Caller appends the returned index to the card's
// _children array (so it renders on top of the body sprite, behind
// labels in the y-band — but bbox doesn't overlap any header label since
// edge sits at y=h/2-2 outside the label y-range).
function mkCardEdge(sb, cardN, w, h, r, g, b, alpha=255) {
    const eN = sb.e.length;
    sb.node('CardEdgeAccent', cardN, [], [], v3(0, h / 2 - 2, 0));
    // 32-px horizontal inset clears the 16-px rounded-corner zone of card_bg_r16
    // so the edge stripe stays inside the curve. With a 4-px inset the stripe
    // pokes past the rounded corners and reads as a "kink" / dark notch.
    const eUT = sb.ut(eN, Math.max(8, w - 32), 4);
    const eSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(eN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(r, g, b, alpha),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[eN]._components = [rf(eUT), rf(eSpr)];
    return eN;
}

// 2026-04-29 (Prompt 1) — unified card chrome.
//
// Builds one card surface: container Node + body Sprite (9-slice rounded
// when UUID_CARD_BG_R16 is populated, square otherwise) + optional colored
// top-edge accent + optional sibling elevation glow.
//
// Replaces the ad-hoc sb.node + sb.spr + cl(...) + mkCardEdge sequence
// duplicated 22+ times in this file. Caller wires children/components on
// the returned cardN exactly as before.
//
// opts:
//   tier:      'base' | 'elevated' | 'interactive'   (default 'base')
//   edge:      [r, g, b] tuple from Palette.cardEdge.* (or null/undefined for no edge)
//   edgeAlpha: 0..255 (default 255). Mirrors mkCardEdge alpha arg.
//   bodyAlpha: 0..255 (default 230 = Card.bgAlpha)
//   name:      Node name (default 'Card')
//
// Returns: { cardN, bodySpr, edgeN, glowN } where edgeN/glowN may be null.
function mkCard(sb, parent, x, y, w, h, opts) {
    opts = opts || {};
    const tier      = opts.tier || 'base';
    const edge      = opts.edge || null;
    const edgeAlpha = (opts.edgeAlpha != null) ? opts.edgeAlpha : 255;
    const bodyAlpha = (opts.bodyAlpha != null) ? opts.bodyAlpha : 230;
    const name      = opts.name || 'Card';

    // Optional elevation glow — sibling to the card body so the glow extends
    // beyond the card bounds. Mirrors the existing homeRecentCardElevation
    // pattern. Tier 'base' returns null; no glow node is created.
    let glowN = null;
    if (tier === 'elevated' || tier === 'interactive') {
        const isInteractive = (tier === 'interactive');
        const glowSpread = isInteractive ? 16 : 12;
        const glowAlpha  = isInteractive ? 110 : 60;
        glowN = mkCardGlow(sb, parent, x, y,
            w + glowSpread * 2, h + glowSpread * 2, glowAlpha);
    }

    const cardN = sb.e.length;
    sb.node(name, parent, [], [], v3(x, y, 0));
    const cardUT = sb.ut(cardN, w, h);

    // 9-slice rounded body when asset is present, square fallback otherwise.
    // _type: 1 (SLICED) reads the SpriteFrame's 9-slice insets — the import
    // settings on card_bg_r16.png must have border = 16 on all sides for the
    // corners to render correctly at any (w, h).
    const useRounded = !!UUID_CARD_BG_R16;
    const bodySpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(cardN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(26, 8, 32, bodyAlpha),  // 2026-04-30 black-glass: Palette.bg.card now #0A0D14
        _spriteFrame: { __uuid__: useRounded ? UUID_CARD_BG_R16 : UUID_WHITE_SPRITE },
        _type: useRounded ? 1 : 0,           // 1=SLICED, 0=SIMPLE
        _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[cardN]._components = [rf(cardUT), rf(bodySpr)];

    // Optional colored top-edge accent — preserves per-card semantic colors
    // (Violet/Teal/Gold/Slate/Blue/Rose) by routing through the existing
    // mkCardEdge helper. Caller may still call mkCardEdge directly if they
    // want a non-default placement.
    let edgeN = null;
    if (edge) {
        edgeN = mkCardEdge(sb, cardN, w, h, edge[0], edge[1], edge[2], edgeAlpha);
        sb.e[cardN]._children = [rf(edgeN)];
    }

    return { cardN: cardN, bodySpr: bodySpr, edgeN: edgeN, glowN: glowN };
}

// 2026-04-29 (Prompt 1) — companion glow Sprite for elevated/interactive
// cards. Sits at the same (x, y) as the card but is a sibling under
// `parent` so it can extend beyond the card's bounds. Caller appends the
// returned index to parent's _children BEFORE the card itself so the glow
// renders behind the body sprite.
function mkCardGlow(sb, parent, x, y, w, h, alpha) {
    const gN = sb.e.length;
    sb.node('CardGlow', parent, [], [], v3(x, y, 0));
    const gUT = sb.ut(gN, w, h);
    const gSprIdx = sb.spr(gN, 153, 69, 255);  // violet halo by default
    sb.e[gSprIdx]._color = cl(153, 69, 255, alpha);
    sb.e[gN]._components = [rf(gUT), rf(gSprIdx)];
    return gN;
}

// 2026-04-26: lobby-status chip group — small Key (uppercase tiny, lo-tier)
// stacked above Val (bigger, hi-tier bold). Used by Home MatchStatus +
// ChallengeSeason cards. Container is transparent (cc.UITransform only) so
// taps fall through to the parent card's cc.Button. `prefix` namespaces the
// child node names ('HomeMatch' / 'HomeChal') so AppUI can bind them.
function mkChipGroup(sb, prefix, baseName, parent, x, y, w, h, keyText, valText, keyFs, valFs) {
    const cN = sb.e.length;
    sb.node(`${prefix}Chip_${baseName}`, parent, [], [], v3(x, y, 0));
    const cUT = sb.ut(cN, w, h);
    sb.e[cN]._components = [rf(cUT)];
    const keyN = mkLabel(sb, `${prefix}ChipKey_${baseName}`, cN, keyText, keyFs,
        12, w - 4, 14, 140, 140, 140);
    style(sb, keyN, { spacing: 1 });
    const valN = mkLabel(sb, `${prefix}ChipVal_${baseName}`, cN, valText, valFs,
        -10, w - 4, 22, 255, 255, 255);
    style(sb, valN, { bold: true });
    sb.e[cN]._children = [rf(keyN), rf(valN)];
    return { container: cN, keyLbl: keyN, valLbl: valN };
}

// Schemas below match Cocos 3.8.8's default prefabs at
// /Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/editor/assets/default_prefab/ui/
// Change with care — the engine reads these fields at scene parse time.

// Well-known Cocos-bundled UUIDs (stable across Cocos 3.x).
const UUID_WHITE_SPRITE   = '20835ba4-6145-4fbc-a58a-051ce700aa3e@f9941';
const UUID_EDITBOX_BG     = 'bd1bcaba-bd7d-4a71-b143-997c882383e4@f9941';
const UUID_SLIDER_RAIL    = '28765e2f-040a-4c65-8e8c-f9d0bb79d863@f9941';
const UUID_SLIDER_HANDLE  = 'f12a23c4-b924-4322-a260-3d982428f1e8@f9941';
const UUID_BUILTIN_SPRITE_MAT = 'fda095cb-831d-4601-ad94-846013963de8';

// 2026-04-29 (Prompt 1) — single 9-slice rounded card SpriteFrame. Asset
// lives at assets/demo/resources/ui/card_bg_r16.png with corner insets of
// 16 px on all sides. UUID is minted by Cocos editor on first import; paste
// it here and clear library/temp before the next scene-gen run. Until the
// asset is imported, mkCard() falls back to UUID_WHITE_SPRITE (square
// corners) so existing call sites can be migrated without visual regression.
const UUID_CARD_BG_R16 = 'e276a2d2-2f93-461d-acd4-e118f0679590@f9941';

// UX Phase 2c: custom fonts bundled at assets/demo/resources/fonts/.
// Inter-Regular = body/default, Sora-Bold = display (applied via style({bold:true})).
// UUIDs are minted by Cocos editor on first import.
const UUID_FONT_INTER = 'e35e48c9-4afd-4ca0-98ac-860f2e2c8f85';
const UUID_FONT_SORA  = 'b93c2245-b7ae-4e03-b74e-9f3dd1015941';

/**
 * EditBox — Cocos 3.8 cc.EditBox mirrors the default prefab layout:
 *   Parent Node: [UITransform, Sprite (background), EditBox]
 *     TEXT_LABEL child: [UITransform, Label]  — shown while typing
 *     PLACEHOLDER_LABEL child: [UITransform, Label]  — shown while empty
 * Returns the parent node index (handler wiring uses `node.getComponent(EditBox)`).
 */
function mkEditBox(sb, name, parent, placeholder, x, y, w=600, h=60, fs=26) {
    const ebN = sb.e.length;
    sb.node(name, parent, [], [], v3(x, y, 0));
    // 2026-04-26: left/right text inset bumped 10→20 so placeholder/text doesn't
    // touch the EditBox left edge (was visibly mashed against the bg sprite).
    const PAD_X = 20;
    const textN = sb.e.length;
    sb.node('TEXT_LABEL', ebN, [], [], v3(-w/2 + PAD_X, h/2 - 4, 0));
    const phN = sb.e.length;
    sb.node('PLACEHOLDER_LABEL', ebN, [], [], v3(-w/2 + PAD_X, h/2 - 4, 0));

    // Text label comps (hidden until user types).
    const tut = sb.ut(textN, w - PAD_X * 2, h);
    // Override anchor point to (0,1) per the prefab to match EditBox internals.
    sb.e[tut]._anchorPoint = v2(0, 1);
    const tlbl = sb.add({
        __type__: 'cc.Label', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(textN), _enabled: true, __prefab: null,
        _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 255),
        _useOriginalSize: true,
        _string: '',
        _horizontalAlign: 0, _verticalAlign: 1,
        _actualFontSize: fs, _fontSize: fs, _fontFamily: 'Arial',
        _lineHeight: h, _overflow: 1, _enableWrapText: false,
        _font: null, _isSystemFontUsed: true,
        _isItalic: false, _isBold: false, _isUnderline: false,
        _cacheMode: 0, _id: gid(),
    });
    sb.e[textN]._components = [rf(tut), rf(tlbl)];
    sb.e[textN]._active = false;

    const pUT = sb.ut(phN, w - PAD_X * 2, h);
    sb.e[pUT]._anchorPoint = v2(0, 1);
    const plbl = sb.add({
        __type__: 'cc.Label', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(phN), _enabled: true, __prefab: null,
        _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(187, 187, 187, 255),
        _useOriginalSize: true,
        _string: placeholder,
        _horizontalAlign: 0, _verticalAlign: 1,
        _actualFontSize: fs, _fontSize: fs, _fontFamily: 'Arial',
        _lineHeight: h, _overflow: 1, _enableWrapText: false,
        _font: null, _isSystemFontUsed: true,
        _isItalic: false, _isBold: false, _isUnderline: false,
        _cacheMode: 0, _id: gid(),
    });
    sb.e[phN]._components = [rf(pUT), rf(plbl)];

    // Parent comps: UITransform + Sprite (bg) + EditBox.
    const pt = sb.ut(ebN, w, h);
    const psp = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(ebN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(40, 40, 60, 255), _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _spriteFrame: { __uuid__: UUID_EDITBOX_BG }, _id: gid(),
    });
    const eb = sb.add({
        __type__: 'cc.EditBox', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(ebN), _enabled: true, __prefab: null,
        editingDidBegan: [], textChanged: [], editingDidEnded: [], editingReturn: [],
        _returnType: 0, _useOriginalSize: true,
        _string: '',
        _tabIndex: 0,
        _backgroundImage: { __uuid__: UUID_EDITBOX_BG },
        _inputFlag: 5, _inputMode: 6,
        _fontSize: fs, _lineHeight: h,
        _maxLength: 44, // long enough for a base58 mint
        _fontColor: cl(255, 255, 255, 255),
        _placeholder: placeholder,
        _placeholderFontSize: fs,
        _placeholderFontColor: cl(187, 187, 187, 255),
        _stayOnTop: false,
        _id: gid(),
    });

    sb.e[ebN]._components = [rf(pt), rf(psp), rf(eb)];
    sb.e[ebN]._children = [rf(textN), rf(phN)];
    return ebN;
}

/**
 * Slider — Cocos 3.8 cc.Slider.
 * Parent Node: [UITransform, Sprite (rail), Slider]
 *   Handle child: [UITransform, Sprite (handle), Button]
 * Slider._handle points at the Handle's Sprite component.
 */
function mkSlider(sb, name, parent, x, y, w=500, h=20, progress=0.1) {
    const sN = sb.e.length;
    sb.node(name, parent, [], [], v3(x, y, 0));
    const hN = sb.e.length;
    // Handle sits at progress along the rail. We initialize at -w/2 (far left);
    // Slider component re-positions on load/progress-change.
    sb.node('Handle', sN, [], [], v3(-w/2 + progress * w, 0, 0));

    // Handle comps
    const hUT = sb.ut(hN, Math.max(32, h * 2), Math.max(32, h * 2));
    const hSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(hN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 255),
        _spriteFrame: { __uuid__: UUID_SLIDER_HANDLE },
        _type: 0, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const hBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(hN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(214, 214, 214, 255),
        _hoverColor: cl(211, 211, 211, 255),
        _pressedColor: cl(255, 255, 255, 255),
        _disabledColor: cl(124, 124, 124, 255),
        _duration: 0.1, _zoomScale: 1.1,
        _target: rf(hN), _id: gid(),
    });
    sb.e[hN]._components = [rf(hUT), rf(hSpr), rf(hBtn)];

    // Parent comps
    const pUT = sb.ut(sN, w, h);
    const pSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(sN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(90, 90, 110, 255),
        _spriteFrame: { __uuid__: UUID_SLIDER_RAIL },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const slider = sb.add({
        __type__: 'cc.Slider', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(sN), _enabled: true, __prefab: null,
        _handle: rf(hSpr),
        _direction: 0,
        _progress: progress,
        _slideEvents: [],
        _id: gid(),
    });
    sb.e[sN]._components = [rf(pUT), rf(pSpr), rf(slider)];
    sb.e[sN]._children = [rf(hN)];
    return sN;
}

/**
 * ScrollView — vertical-only, with content Node. No built-in scrollbar for
 * simplicity. Mask clips content to the visible window.
 * Parent Node: [UITransform, Sprite (backdrop), ScrollView]
 *   'view' child: [UITransform, Mask]  (required — Mask clips the content)
 *     'content' child: [UITransform]    (rows get appended here)
 *
 * Returns { root, content }. Caller populates `content` children + resizes
 * content UITransform to rowCount × rowHeight.
 */
function mkScrollView(sb, name, parent, x, y, w, h, bgAlpha = 255) {
    const svN = sb.e.length;
    sb.node(name, parent, [], [], v3(x, y, 0));
    const viewN = sb.e.length;
    sb.node('view', svN, [], [], v3(0, 0, 0));
    const contentN = sb.e.length;
    // Content anchor is top-center per Cocos prefab — content starts at top,
    // children cascade downward.
    sb.node('content', viewN, [], [], v3(0, h/2, 0));

    // view comps: UITransform + Mask
    const vUT = sb.ut(viewN, w, h);
    const vMask = sb.add({
        __type__: 'cc.Mask', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(viewN), _enabled: true, __prefab: null,
        _materials: [],
        _visFlags: 0,
        _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 255),
        _type: 0, _inverted: false, _segments: 64, _id: gid(),
    });
    sb.e[viewN]._components = [rf(vUT), rf(vMask)];
    sb.e[viewN]._children = [rf(contentN)];

    // content comps: UITransform only; anchor (0.5, 1) so child rows can be
    // positioned downward from top.
    const cUT = sb.ut(contentN, w, h); // initial size = view; caller resizes
    sb.e[cUT]._anchorPoint = v2(0.5, 1);
    sb.e[contentN]._components = [rf(cUT)];

    // Parent comps: UITransform + Sprite (backdrop) + ScrollView
    const pUT = sb.ut(svN, w, h);
    const pSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(svN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(25, 25, 40, bgAlpha),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const sv = sb.add({
        __type__: 'cc.ScrollView', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(svN), _enabled: true, __prefab: null,
        bounceDuration: 0.23,
        brake: 0.75,
        elastic: true,
        inertia: true,
        horizontal: false,
        vertical: true,
        cancelInnerEvents: true,
        scrollEvents: [],
        _content: rf(contentN),
        _horizontalScrollBar: null,
        _verticalScrollBar: null,
        _id: gid(),
    });
    sb.e[svN]._components = [rf(pUT), rf(pSpr), rf(sv)];
    sb.e[svN]._children = [rf(viewN)];
    return { root: svN, content: contentN, contentUT: cUT };
}

function generate() {
    const sb = new SB(); idC=100;

    // 0: SceneAsset
    sb.add({__type__:'cc.SceneAsset',_name:'Main',_objFlags:0,__editorExtras__:{},_native:'',scene:rf(1)});

    // 1: Scene
    sb.add({__type__:'cc.Scene',_name:'Main',_objFlags:0,__editorExtras__:{},_parent:null,_children:[rf(2)],_active:true,_components:[],_prefab:null,_lpos:v3(),_lrot:qt(),_lscale:v3(1,1,1),_mobility:0,_layer:1073741824,_euler:v3(),autoReleaseAssets:false,_globals:null,_id:uuid()});

    // 2: Canvas — portrait 720x1280
    const canvas = sb.add({__type__:'cc.Node',_name:'Canvas',_objFlags:0,__editorExtras__:{},_parent:rf(1),_children:[],_active:true,_components:[],_prefab:null,_lpos:v3(360,640,0),_lrot:qt(),_lscale:v3(1,1,1),_mobility:0,_layer:33554432,_euler:v3(),_id:gid()});

    // Camera
    const camN = sb.e.length, camC = camN+1;
    sb.node('Camera', canvas, [], [camC], v3(0,0,1000));
    sb.e[camN]._layer = 1073741824;
    sb.cam(camN);
    // Patch orthoHeight for portrait
    sb.e[camC]._orthoHeight = 640;

    // Canvas components — portrait 720x1280
    const cUT = sb.ut(canvas, 720, 1280);
    const cCV = sb.canvas(canvas, camC);
    const cWG = sb.widget(canvas);

    // Dark background — Unity: (0.05, 0.05, 0.12).
    // Session 6: added cc.Widget so the sprite stretches to the actual visible
    // viewport, not the 720×1280 design bounds. On taller-than-9:16 phones
    // (most modern Androids) the design height is less than the device height
    // under FIXED_WIDTH policy — the Widget extends this sprite beyond the
    // design bounds to cover those letterbox bands with dark-navy instead of
    // black. Cocos's widget() helper aligns all 4 edges with zero margins.
    const bgN = sb.e.length;
    sb.node('Background', canvas, [], [bgN+1, bgN+2, bgN+3], v3(0,0,0));
    sb.ut(bgN, 720, 1280);
    // Pure black plate. Phase 12 (B1+B2) layers the violet/teal glow +
    // 64-star ambient field on top of this in BackgroundFX (next block).
    sb.spr(bgN, 0, 0, 0, '57520716-48c8-4a19-8acf-41c9f8777fb0@f9941', 0);
    sb.widget(bgN);

    // ═══════════════════════════════════════════════════════════════
    // Phase 12 (B1+B2) — neon-trading background polish.
    // 3 layered brand-color halo sprites + 64-star ambient field.
    // Sits between the black Background plate and panel content.
    // ═══════════════════════════════════════════════════════════════
    const BFX = LAYOUT.BackgroundFX.elements;
    const STAR = LAYOUT.BackgroundFX.templates.star;
    const fxN = sb.e.length;
    sb.node('BackgroundFX', canvas, [], [], v3(0, 0, 0));
    sb.ut(fxN, LAYOUT.BackgroundFX.canvas.w, LAYOUT.BackgroundFX.canvas.h);

    // Inline helper: make a halo sprite (white sprite tinted brand color, low alpha).
    function mkGlow(name, def, color) {
        const n = sb.e.length;
        sb.node(name, fxN, [], [], v3(def.x, def.y, 0));
        const ut = sb.ut(n, def.w, def.h);
        const spr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(n), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: color,
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[n]._components = [rf(ut), rf(spr)];
        return n;
    }
    // Phase 21 (F): each halo is now 3 stacked sprites (outer/mid/inner)
    // for a soft radial-falloff illusion. Sums to brightest core, fades to
    // edge of outer ring. Eye reads the stack as a smooth gradient.
    const FX_HALOS = [
        // Solana violet — top-left, 3 layered sprites
        { name: 'BackgroundGlow_TopLeft_Outer',  spec: 'glowTopLeft_Outer',  r: 153, g: 69,  b: 255, a: 18 },
        { name: 'BackgroundGlow_TopLeft_Mid',    spec: 'glowTopLeft_Mid',    r: 153, g: 69,  b: 255, a: 35 },
        { name: 'BackgroundGlow_TopLeft_Inner',  spec: 'glowTopLeft_Inner',  r: 153, g: 69,  b: 255, a: 60 },
        // Solana teal — bot-right, 3 layered sprites
        { name: 'BackgroundGlow_BotRight_Outer', spec: 'glowBotRight_Outer', r: 20,  g: 241, b: 149, a: 15 },
        { name: 'BackgroundGlow_BotRight_Mid',   spec: 'glowBotRight_Mid',   r: 20,  g: 241, b: 149, a: 28 },
        { name: 'BackgroundGlow_BotRight_Inner', spec: 'glowBotRight_Inner', r: 20,  g: 241, b: 149, a: 50 },
        // Amber — center, 3 layered sprites
        { name: 'BackgroundGlow_Center_Outer',   spec: 'glowCenter_Outer',   r: 255, g: 180, b: 84,  a: 8 },
        { name: 'BackgroundGlow_Center_Mid',     spec: 'glowCenter_Mid',     r: 255, g: 180, b: 84,  a: 14 },
        { name: 'BackgroundGlow_Center_Inner',   spec: 'glowCenter_Inner',   r: 255, g: 180, b: 84,  a: 22 },
    ];
    const haloIndices = FX_HALOS.map(({ name, spec, r, g, b, a }) =>
        mkGlow(name, BFX[spec], cl(r, g, b, a))
    );

    // Starfield — 64 deterministic-seeded dots across 3 alpha tiers.
    // Seed is fixed so every build produces identical positions; verifier
    // doesn't need to chase RNG and visual smoke tests reproduce.
    const starN = sb.e.length;
    sb.node('Starfield', fxN, [], [], v3(BFX.starfield.x, BFX.starfield.y, 0));
    sb.ut(starN, BFX.starfield.w, BFX.starfield.h);
    const starIndices = [];
    let lcg = STAR.seed;
    const rand = () => { lcg = (lcg * 1103515245 + 12345) & 0x7FFFFFFF; return lcg / 0x7FFFFFFF; };
    let starIdx = 0;
    for (const tier of STAR.tiers) {
        for (let i = 0; i < tier.count; i++) {
            const sx = STAR.xRange[0] + rand() * (STAR.xRange[1] - STAR.xRange[0]);
            const sy = STAR.yRange[0] + rand() * (STAR.yRange[1] - STAR.yRange[0]);
            const alpha = tier.alphaMin + Math.floor(rand() * (tier.alphaMax - tier.alphaMin + 1));
            const sN = sb.e.length;
            sb.node(`Star_${starIdx}`, starN, [], [], v3(Math.round(sx), Math.round(sy), 0));
            const sUT = sb.ut(sN, tier.size, tier.size);
            const sSpr = sb.add({
                __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(sN), _enabled: true, __prefab: null,
                _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
                _color: cl(255, 255, 255, alpha),
                _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
                _type: 1, _fillType: 0, _sizeMode: 0,
                _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
                _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
                _id: gid(),
            });
            sb.e[sN]._components = [rf(sUT), rf(sSpr)];
            starIndices.push(sN);
            starIdx++;
        }
    }
    sb.e[starN]._children = starIndices.map(rf);
    sb.e[fxN]._children = [...haloIndices.map(rf), rf(starN)];

    // MWAManager node
    const mwaN = sb.e.length;
    sb.node('MWAManager', canvas, [], [mwaN+1, mwaN+2, mwaN+3], v3(0,0,0));
    sb.ut(mwaN, 0, 0);
    sb.custom(mwaN, UUIDS.MWAManager);
    sb.custom(mwaN, UUIDS.DemoAppConfig);

    // ═══════════════════════════════════════════════════════════════
    // LANDING PANEL — v2 premium onboarding.
    //   Hero band (title → subtitle → mascot → tagline → support — tight)
    //   CTA Card (semi-translucent dark surface w/ violet edge accent)
    //     Connect Wallet [PRIMARY, gradient + halo + chevron]
    //     Trust line (Secure · Non-custodial · You control your wallet)
    //     Reconnect    [SECONDARY ghost, conditional]
    //     Play as Guest [TERTIARY, dim halo]
    //   Footer ConnectionStatusPill
    // ═══════════════════════════════════════════════════════════════
    const lpN = sb.e.length;
    sb.node('LandingPanel', canvas, [], [lpN+1], v3(0,0,0));
    sb.ut(lpN, LAYOUT.Landing.canvas.w, LAYOUT.Landing.canvas.h);

    // ALL positions sourced from LayoutSpec.Landing.elements.* — no literals.
    const LE = LAYOUT.Landing.elements;

    // ── Hero band ───────────────────────────────────────────────────
    // 2026-04-27 UX upgrade — gold halo behind title. White-square sprite
    // tinted with Palette.glow.gold; LandingFX.addGlowPulse breathes opacity
    // at runtime for shimmer.
    const titleGlow = sb.e.length;
    sb.node('TitleGlow', lpN, [], [], v3(LE.titleGlow.x, LE.titleGlow.y, 0));
    const titleGlowUT  = sb.ut(titleGlow, LE.titleGlow.w, LE.titleGlow.h);
    const titleGlowSpr = sb.spr(titleGlow, 255, 210, 74);
    sb.e[titleGlowSpr]._color = cl(255, 210, 74, 64);
    sb.e[titleGlow]._components = [rf(titleGlowUT), rf(titleGlowSpr)];

    // 2026-04-29 dominance pass — title 64 → 68pt for slightly more presence
    // (still solid gold + halo; user explicitly liked the simple yellow look).
    const title = mkLabel(sb, 'TitleLabel', lpN, 'Token Duel',
        68, LE.title.y, LE.title.w, LE.title.h);
    // 2026-04-29 demo-ready pass — letter-spacing 2 → 3 for premium / "decided"
    // feel; preserves gold + halo identity.
    style(sb, title, { bold: true, color: GOLD(), spacing: 3 });

    // 2026-04-29 demo-ready pass — subtitle 22 → 18pt + Palette.text.mid color
    // (184, 184, 184). Reads as supporting microcopy under the gold title
    // instead of a competing line.
    const sub = mkLabel(sb, 'SubtitleLabel', lpN, 'Outperform. Or get outperformed.',
        18, LE.subtitle.y, LE.subtitle.w, LE.subtitle.h, 184, 184, 184);

    // 2026-04-27 UX upgrade — violet radial bloom behind mascot.
    // 2026-04-29 demo-ready pass: scene Sprite color alpha 80 → 0. The
    // hard-edged Sprite never paints, so the visible "purple square" behind
    // the mascot is gone permanently. AppUI._polishLandingPanel calls
    // LandingFX.installSoftGlow, which attaches a Graphics-drawn radial to
    // the same node — that's what the user sees, faded in via addGlowPulse.
    const mascotGlow = sb.e.length;
    sb.node('MascotGlow', lpN, [], [], v3(LE.mascotGlow.x, LE.mascotGlow.y, 0));
    const mascotGlowUT  = sb.ut(mascotGlow, LE.mascotGlow.w, LE.mascotGlow.h);
    const mascotGlowSpr = sb.spr(mascotGlow, 153, 69, 255);
    sb.e[mascotGlowSpr]._color = cl(153, 69, 255, 0);
    sb.e[mascotGlow]._components = [rf(mascotGlowUT), rf(mascotGlowSpr)];

    // 2026-04-27 UX upgrade — flat dark ellipse below mascot for grounding.
    // 2026-04-29 demo-ready pass: scene Sprite color alpha 130 → 0 so the
    // black bar never paints. installSoftEllipse renders a soft Graphics
    // pedestal on the same node — reads as ground, not a sliced bar.
    const mascotShadow = sb.e.length;
    sb.node('MascotShadow', lpN, [], [], v3(LE.mascotShadow.x, LE.mascotShadow.y, 0));
    const mascotShadowUT  = sb.ut(mascotShadow, LE.mascotShadow.w, LE.mascotShadow.h);
    const mascotShadowSpr = sb.spr(mascotShadow, 0, 0, 0);
    sb.e[mascotShadowSpr]._color = cl(0, 0, 0, 0);
    sb.e[mascotShadow]._components = [rf(mascotShadowUT), rf(mascotShadowSpr)];

    // Mascot container — Empty Node; AppUI.start() adds MascotController
    // at runtime and phase3 swaps in Seedance frames.
    const landingMascotN = sb.e.length;
    sb.node('LandingMascotContainer', lpN, [], [], v3(LE.mascot.x, LE.mascot.y, 0));
    const landingMascotUT = sb.ut(landingMascotN, LE.mascot.w, LE.mascot.h);
    sb.e[landingMascotN]._components = [rf(landingMascotUT)];

    // 2026-04-28 polish — TaglineLabel + SupportLine dropped. Hero band now
    // reads as one dominant idea (title + subtitle) with the mascot as the
    // centerpiece between hero copy and CTA card.

    // ── CTA card backdrop (v2) ──────────────────────────────────────
    // Semi-translucent dark surface that visually groups the action stack.
    // Top edge accent in Solana violet signals "sign-in zone". Rendered
    // FIRST in panel _children so all action elements layer on top.
    const cardBgN = sb.e.length;
    sb.node('CTACardBg', lpN, [], [], v3(LE.ctaCardBg.x, LE.ctaCardBg.y, 0));
    const cardBgUT  = sb.ut(cardBgN, LE.ctaCardBg.w, LE.ctaCardBg.h);
    // Card body — translucent (130) so the gradient bleeds through behind the action stack.
    const cardBgSpr = cardBodySpr(sb, cardBgN, 130);
    sb.e[cardBgN]._components = [rf(cardBgUT), rf(cardBgSpr)];
    const cardEdgeN = mkCardEdge(sb, cardBgN, LE.ctaCardBg.w, LE.ctaCardBg.h, 153, 69, 255, 140);
    sb.e[cardBgN]._children = [rf(cardEdgeN)];

    // ── Action stack ────────────────────────────────────────────────
    // PRIMARY — Enter the Duel (gold, matches the title color above).
    // 2026-04-28 hackathon UX — copy upgrade "Play Token Duel" → "Enter the
    // Duel" (game-first command verb). Subtitle "Stake SOL · Win SOL" stays.
    // 2026-04-29 demo-ready — titleFs override 28 + subFs override 16. Tier
    // stays 'primary' (preserves halo, idle-pulse, press-pop, shimmer, strong-
    // press), but the per-call font sizes scale down proportional to the new
    // 108 button height without touching ButtonTierSpec.primary (which is
    // shared with FindMatch / StartMatch on Home).
    const { glow: connectGlow, btn: connectBtn } = mkBtnHeroLayered(sb,
        'ConnectButton', lpN,
        'Enter the Duel', 'Stake SOL · Win SOL',
        LE.connectBtn.x, LE.connectBtn.y, LE.connectBtn.w, LE.connectBtn.h,
        255, 210, 74,
        { tier: 'primary', gradient: true, titleFs: 28, subFs: 16 });

    // Right-aligned chevron — directional cue. Child of ConnectButton.
    const chevronN = sb.e.length;
    sb.node('ConnectChevron', connectBtn, [], [chevronN+1, chevronN+2],
        v3(LE.connectChevron.x, 0, 0));
    sb.ut(chevronN, LE.connectChevron.w, LE.connectChevron.h);
    // 2026-04-29 demo-ready pass — chevron 42 → 36 (proportional to smaller
    // 108-height button); alpha stays 255.
    sb.lbl(chevronN, '›', 36, 255, 255, 255);
    sb.e[chevronN+2]._color = cl(255, 255, 255, 255);
    style(sb, chevronN, { bold: true });
    sb.e[connectBtn]._children = [...(sb.e[connectBtn]._children ?? []), rf(chevronN)];

    // Trust line — directly under Connect, inside card. Small + muted.
    // 2026-04-27 UX upgrade — green-tinted (150, 220, 180) for subtle
    // reassurance accent (was neutral text.mid 168/174/201).
    // 2026-04-28 hackathon UX — font 14 → 12 to reduce visual weight (now
    // shares space with new LiveSignal label below).
    // 2026-04-29 demo-ready pass — copy restored to full
    // "🔒 Secure · Non-custodial · You control your wallet". With trust line
    // moved 18 px lower (24 px clearance below the smaller CTA), the longer
    // copy fits without competing with the button. Font stays 11pt microcopy.
    const trustLine = mkLabel(sb, 'TrustLineLabel', lpN,
        '🔒  Secure · Non-custodial · You control your wallet',
        11, LE.trustLine.y, LE.trustLine.w, LE.trustLine.h, 150, 220, 180);

    // 2026-04-28 hackathon UX — "live system" sub-CTA cue between trust line
    // and Guest button. Teal-tinted (20, 241, 149 ≈ Theme.accent.teal). Static —
    // no RPC dependency on first paint. Goal: instant signal that this is a
    // live, populated game.
    // 2026-04-28 polish — emoji replaced with a live Sprite dot whose alpha
    // pulses at runtime via LandingFX.addGlowPulse for "alive" cue.
    // 2026-04-29 dominance pass — font 12 → 11 to match shortened trust line.
    const liveSignal = mkLabel(sb, 'LiveSignalLabel', lpN,
        'Live now · Join in seconds',
        11, LE.liveSignalLabel.y, LE.liveSignalLabel.w, LE.liveSignalLabel.h, 20, 241, 149);

    // Sibling green dot (8×8, teal #14F195) parked left of the label text.
    // The label is horizontally centered; "Live now · Join in seconds" at
    // 12pt is roughly 220px wide, so the leading dot sits at x=-118 to read
    // as a leading bullet.
    const liveDotN = sb.e.length;
    sb.node('LiveSignalDot', lpN, [], [],
        v3(-118, LE.liveSignalLabel.y + 1, 0));
    const liveDotUT  = sb.ut(liveDotN, 8, 8);
    const liveDotSpr = sb.spr(liveDotN, 20, 241, 149);
    sb.e[liveDotSpr]._color = cl(20, 241, 149, 230);
    sb.e[liveDotN]._components = [rf(liveDotUT), rf(liveDotSpr)];

    // SECONDARY — Reconnect (ghost-teal, conditional via AppUI).
    // 2026-04-29 demo-ready — width restored to UNIFORM (was narrowed to 560
    // in the dominance pass, which broke the consistent-button-widths rule
    // and made it look glitchy). Title font dropped to 18pt so it stays
    // visibly tertiary; AppUI raises opacity 110 → 180 so it no longer reads
    // as "broken/disabled".
    const { btn: reconnBtn } = mkBtnHeroLayered(sb,
        'ReconnectButton', lpN,
        '⟳  Reconnect', 'Continue with saved wallet',
        LE.reconnBtn.x, LE.reconnBtn.y, LE.reconnBtn.w, LE.reconnBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { tier: 'secondary', ghost: true, titleFs: 18, subFs: 12 });
    sb.e[reconnBtn]._active = false;

    // SECONDARY — Play as Guest (teal, two-line layered, defers visually
    // to Connect via tier-locked glow strength).
    // 2026-04-29 demo-ready — titleFs override 22 (was 24 from tier),
    // subFs 13 (was 13 from tier). Smaller height (88→80) keeps it visibly
    // shorter than Connect; AppUI drops body opacity 210 → 180 + halo 70 →
    // 40 so it reads as clearly secondary.
    const { glow: guestGlow, btn: guestBtn } = mkBtnHeroLayered(sb,
        'PlayAsGuestButton', lpN,
        '👤  Play as Guest', 'Practice with bots · no wallet needed',
        LE.playAsGuestBtn.x, LE.playAsGuestBtn.y, LE.playAsGuestBtn.w, LE.playAsGuestBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { tier: 'secondary', titleFs: 22, subFs: 13 });

    // ── Footer ──────────────────────────────────────────────────────
    // 2026-04-29 demo-ready — bgAlpha 90 (faint Palette.bg.card capsule) so
    // the chip reads as part of the layout, not a floating label.
    const statusPill = mkPill(sb, 'ConnectionStatusPill', lpN, '● Disconnected',
        LE.connectionStatusPill.x, LE.connectionStatusPill.y,
        LE.connectionStatusPill.w, LE.connectionStatusPill.h,
        { bgAlpha: 90 });

    // Patch LandingPanel children — render order matters.
    // Title halo + mascot glow/shadow render as decorative anchors below
    // content + CTA stack.
    sb.e[lpN]._children = [
        // Title halo, then title + subtitle on top of it
        rf(titleGlow),
        rf(title), rf(sub),
        // Mascot glow + shadow render BEHIND the mascot container
        rf(mascotGlow), rf(mascotShadow),
        rf(landingMascotN),
        rf(cardBgN),                         // ← card backdrop FIRST
        rf(connectGlow), rf(connectBtn),
        rf(trustLine),
        rf(liveSignal), rf(liveDotN),        // 2026-04-28 polish — pulsing dot + label
        rf(reconnBtn),
        rf(guestGlow), rf(guestBtn),
        rf(statusPill),
    ];

    // ═══════════════════════════════════════════════════════════════
    // HOME PANEL — 2026-04-26 lobby restructure.
    //   HUD HEADER (bell · WalletPill · settings)
    //   LEVEL/XP CARD (Lv N · X/Y XP · teal progress bar, full-width)
    //   MATCH STATUS CARD (HomeMatchTicker — RECENT MATCHES + 5 chips)
    //   CHALLENGE/SEASON CARD (DailyStreakStrip — flame + 5 chips)
    //   "CHOOSE MATCH TYPE" section title
    //   3 action buttons (subtitles + chevrons INSIDE button rect)
    //   TRAINING/MASCOT CARD (mascot + free-bot copy + reparented status)
    //
    // Disconnect / Delete / SignOutGuest REMOVED from Home — SettingsPanel
    // is now the single account-control surface (DisconnectSettingsButton,
    // DeleteAccountSettingsButton, ReconnectSettingsButton).
    // ═══════════════════════════════════════════════════════════════
    const hpN = sb.e.length;
    sb.node('HomePanel', canvas, [], [hpN+1], lobbyMount('Home'));
    sb.ut(hpN, LAYOUT.Home.canvas.w, LAYOUT.Home.canvas.h);

    const HE = LAYOUT.Home.elements;

    // ── BACKGROUND SCRIM (V2) ─────────────────────────────────────────
    // Full-panel dim overlay behind all content; reduces starfield contrast
    // so the lobby content reads cleanly. Renders FIRST in panel children.
    const scrimN = sb.e.length;
    sb.node('HomeContentScrim', hpN, [], [], v3(HE.homeContentScrim.x, HE.homeContentScrim.y, 0));
    const scrimUT = sb.ut(scrimN, HE.homeContentScrim.w, HE.homeContentScrim.h);
    const scrimSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(scrimN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.primary.r, P.bg.primary.g, P.bg.primary.b, 110),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[scrimN]._components = [rf(scrimUT), rf(scrimSpr)];

    // ── HUD HEADER: WalletPill (V2 — bigger, centered, glowing) ──────
    // Premium tappable pill: violet glow halo behind, status dot left,
    // pubkey + "Seed Vault" stacked center.
    const walletPillGlowN = sb.e.length;
    sb.node('WalletPillGlow', hpN, [], [], v3(HE.walletPillGlow.x, HE.walletPillGlow.y, 0));
    const walletPillGlowUT = sb.ut(walletPillGlowN, HE.walletPillGlow.w, HE.walletPillGlow.h);
    const walletPillGlowSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(walletPillGlowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(153, 69, 255, 50),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[walletPillGlowN]._components = [rf(walletPillGlowUT), rf(walletPillGlowSpr)];

    const walletPillN = sb.e.length;
    sb.node('WalletPill', hpN, [], [], v3(HE.walletPill.x, HE.walletPill.y, 0));
    const walletPillUT = sb.ut(walletPillN, HE.walletPill.w, HE.walletPill.h);
    const walletPillSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(walletPillN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.card.r, P.bg.card.g, P.bg.card.b, 240),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[walletPillN]._components = [rf(walletPillUT), rf(walletPillSpr)];

    // PubkeyLabel — child of pill. Cyan (Unity convention).
    const pubkey = mkLabel(sb, 'PubkeyLabel', walletPillN, 'Not connected', 18,
        HE.pubkeyLabel.y, HE.pubkeyLabel.w, HE.pubkeyLabel.h, 128, 204, 255);
    sb.e[pubkey]._lpos = v3(HE.pubkeyLabel.x, HE.pubkeyLabel.y, 0);
    style(sb, pubkey, { bold: true });

    // WalletNameLabel — child of pill. 2026-04-27 — moved to right side
    // of pill, font 11→13 for visibility.
    const walletNameN = mkLabel(sb, 'WalletNameLabel', walletPillN, '', 13,
        HE.walletNameLabel.y, HE.walletNameLabel.w, HE.walletNameLabel.h, 184, 184, 184);
    sb.e[walletNameN]._lpos = v3(HE.walletNameLabel.x, HE.walletNameLabel.y, 0);

    // Status dot — green "live" indicator inside pill, left edge.
    const secureDotN = sb.e.length;
    sb.node('WalletPillSecureDot', walletPillN, [], [], v3(HE.walletPillSecureDot.x, HE.walletPillSecureDot.y, 0));
    const secureDotUT = sb.ut(secureDotN, HE.walletPillSecureDot.w, HE.walletPillSecureDot.h);
    const secureDotSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(secureDotN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[secureDotN]._components = [rf(secureDotUT), rf(secureDotSpr)];

    sb.e[walletPillN]._children = [rf(pubkey), rf(walletNameN), rf(secureDotN)];

    // Stage 4K — streak flame (kept; sits in chrome zone above the visible
    // top bar). Toggled by AppUI._updateStreakFlame based on UserStats.currentStreak.
    const streakFlameN = sb.e.length;
    sb.node('StreakFlameContainer', hpN, [], [streakFlameN + 1], v3(280, 748, 0));
    sb.ut(streakFlameN, 100, 36);
    sb.e[streakFlameN]._active = false;
    const streakIconN = sb.e.length;
    sb.node('StreakFlameIcon', streakFlameN, [], [streakIconN + 1, streakIconN + 2], v3(-28, 0, 0));
    sb.ut(streakIconN, 28, 28);
    sb.lbl(streakIconN, '', 22, 255, 160, 70);
    const streakCountN = sb.e.length;
    sb.node('StreakCountLabel', streakFlameN, [], [streakCountN + 1, streakCountN + 2], v3(22, 0, 0));
    sb.ut(streakCountN, 60, 30);
    const streakCountL = sb.lbl(streakCountN, '0×', 20, 255, 160, 70);
    sb.e[streakCountL]._isBold = true;
    style(sb, streakCountN, { mono: true });
    sb.e[streakFlameN]._children = [rf(streakIconN), rf(streakCountN)];

    // ── LEVEL/XP CARD (V2 — real progression module) ─────────────────
    // Full-width 680×80 card. "Lv N" gold-bold 22pt anchor-left, "X / Y XP"
    // hi-tier 13pt anchor-right, gold progress bar 640×14 with rounded ends
    // (animated fill at runtime). No colored edge strip.
    const homeLevelChipN = sb.e.length;
    sb.node('HomeLevelChip', hpN, [], [], v3(HE.homeLevelChip.x, HE.homeLevelChip.y, 0));
    const homeLevelChipUT = sb.ut(homeLevelChipN, HE.homeLevelChip.w, HE.homeLevelChip.h);
    const homeLevelChipSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(homeLevelChipN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.surface.r, P.bg.surface.g, P.bg.surface.b, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[homeLevelChipN]._components = [rf(homeLevelChipUT), rf(homeLevelChipSpr)];

    const homeLevelChipLbl = mkLabel(sb, 'HomeLevelChipLabel', homeLevelChipN, 'Lv 1', 22,
        18, 280, 28, 255, 210, 74);
    sb.e[homeLevelChipLbl]._lpos = v3(-310, 18, 0);
    style(sb, homeLevelChipLbl, { bold: true });
    {
        const lblComp = sb.e[sb.e[homeLevelChipLbl]._components[1].__id__];
        lblComp._horizontalAlign = 0;
    }

    const homeXpProgressLbl = mkLabel(sb, 'HomeXpProgressLabel', homeLevelChipN, '0 / 1750 XP', 13,
        HE.homeXpProgressLabel.y, HE.homeXpProgressLabel.w, HE.homeXpProgressLabel.h, 255, 255, 255);
    sb.e[homeXpProgressLbl]._lpos = v3(HE.homeXpProgressLabel.x, HE.homeXpProgressLabel.y, 0);
    style(sb, homeXpProgressLbl, { bold: true });
    {
        const lblComp = sb.e[sb.e[homeXpProgressLbl]._components[1].__id__];
        lblComp._horizontalAlign = 2; // right
    }

    // Progress bar track — wider, taller, dark.
    const homeXpBarTrackN = sb.e.length;
    sb.node('HomeXpBarTrack', homeLevelChipN, [], [], v3(HE.homeXpBarTrack.x, HE.homeXpBarTrack.y, 0));
    const homeXpBarTrackUT = sb.ut(homeXpBarTrackN, HE.homeXpBarTrack.w, HE.homeXpBarTrack.h);
    const homeXpBarTrackSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(homeXpBarTrackN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.primary.r, P.bg.primary.g, P.bg.primary.b, 230),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[homeXpBarTrackN]._components = [rf(homeXpBarTrackUT), rf(homeXpBarTrackSpr)];

    // Progress bar fill — left-anchored, gold accent, width tweens at runtime.
    const homeXpBarFillN = sb.e.length;
    sb.node('HomeXpBarFill', homeXpBarTrackN, [], [], v3(HE.homeXpBarFill.x, HE.homeXpBarFill.y, 0));
    const homeXpBarFillUT = sb.ut(homeXpBarFillN, HE.homeXpBarFill.w, HE.homeXpBarFill.h);
    sb.e[homeXpBarFillUT]._anchorPoint = v2(0, 0.5);
    const homeXpBarFillSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(homeXpBarFillN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 210, 74, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[homeXpBarFillN]._components = [rf(homeXpBarFillUT), rf(homeXpBarFillSpr)];
    sb.e[homeXpBarTrackN]._children = [rf(homeXpBarFillN)];

    sb.e[homeLevelChipN]._children = [rf(homeLevelChipLbl), rf(homeXpProgressLbl), rf(homeXpBarTrackN)];
    sb.e[homeLevelChipN]._active = false; // hidden until UserStats loads

    // ── V3 — HEADER UNDERLINE (subtle violet line under header band) ──
    const homeHeaderUnderlineN = sb.e.length;
    sb.node('HomeHeaderUnderline', hpN, [], [], v3(HE.homeHeaderUnderline.x, HE.homeHeaderUnderline.y, 0));
    const homeHeaderUnderlineUT = sb.ut(homeHeaderUnderlineN, HE.homeHeaderUnderline.w, HE.homeHeaderUnderline.h);
    const homeHeaderUnderlineSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(homeHeaderUnderlineN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: (() => { const c = rgba(P.accent.violetDim); return cl(c.r, c.g, c.b, 80); })(),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[homeHeaderUnderlineN]._components = [rf(homeHeaderUnderlineUT), rf(homeHeaderUnderlineSpr)];

    // ── V3 — RECENT-CARD ELEVATION (soft drop-shadow behind unified card) ──
    const homeRecentCardElevationN = sb.e.length;
    sb.node('HomeRecentCardElevation', hpN, [], [], v3(HE.homeMatchTicker.x, HE.homeMatchTicker.y + HE.homeRecentCardElevation.y, 0));
    const homeRecentCardElevationUT = sb.ut(homeRecentCardElevationN, HE.homeRecentCardElevation.w, HE.homeRecentCardElevation.h);
    const homeRecentCardElevationSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(homeRecentCardElevationN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 120),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[homeRecentCardElevationN]._components = [rf(homeRecentCardElevationUT), rf(homeRecentCardElevationSpr)];

    // ── LAST RESULT CARD (V5 — 2026-04-28 home UX polish) ──
    // 680×108 surface card repurposed from network-feed "RECENT MATCH" to
    // the user's own most-recent settled match. Reads from Stats.loadLastMatch().
    // Layout: "LAST MATCH" tag (top-left) · "WON"/"LOST" big bold left-center ·
    // "+0.10 SOL" big bold right · meta line "1v1 · 0.10 stake · 12m ago".
    // Outcome + delta colored teal (win) or rose (loss); HomeLastResultGlow
    // sibling tints the same color and pulses subtly.
    // Stays a cc.Button so taps route to Portfolio history (was Spectator).
    const matchTickerN = sb.e.length;
    sb.node('HomeMatchTicker', hpN, [], [], v3(HE.homeMatchTicker.x, HE.homeMatchTicker.y, 0));
    const matchTickerUT = sb.ut(matchTickerN, HE.homeMatchTicker.w, HE.homeMatchTicker.h);
    const matchTickerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(matchTickerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.surface.r, P.bg.surface.g, P.bg.surface.b, 230),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const matchTickerBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(matchTickerN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255,255,255,0), _hoverColor: cl(255,255,255,0),
        _pressedColor: cl(255,255,255,0), _disabledColor: cl(100,100,100,0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(matchTickerN), _id: gid(),
    });
    sb.e[matchTickerN]._components = [rf(matchTickerUT), rf(matchTickerSpr), rf(matchTickerBtn)];
    sb.e[matchTickerN]._active = false;

    // V5 — outcome-tinted halo sibling (sits behind card; alpha 0 by
    // default). Tinted teal/rose at runtime by AppUI._setLastResult.
    const lastResultGlowN = sb.e.length;
    sb.node('HomeLastResultGlow', hpN, [], [], v3(HE.homeLastResultGlow.x, HE.homeLastResultGlow.y, 0));
    const lastResultGlowUT = sb.ut(lastResultGlowN, HE.homeLastResultGlow.w, HE.homeLastResultGlow.h);
    const lastResultGlowSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(lastResultGlowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 0),  // alpha 0 default; tinted at runtime
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[lastResultGlowN]._components = [rf(lastResultGlowUT), rf(lastResultGlowSpr)];
    sb.e[lastResultGlowN]._active = false;

    // V5 — "LAST MATCH" 11pt muted tag (top-left of card).
    const lastResultLabel = mkLabel(sb, 'HomeLastResultLabel', matchTickerN, 'LAST MATCH', 11,
        HE.homeLastResultLabel.y, HE.homeLastResultLabel.w, HE.homeLastResultLabel.h, 140, 140, 140);
    sb.e[lastResultLabel]._lpos = v3(HE.homeLastResultLabel.x, HE.homeLastResultLabel.y, 0);
    {
        const lblComp = sb.e[sb.e[lastResultLabel]._components[1].__id__];
        lblComp._horizontalAlign = 0; // left
    }
    style(sb, lastResultLabel, { spacing: 2 });

    // V5 — outcome label "WON" / "LOST" / "—". Color tinted at runtime.
    const lastResultOutcome = mkLabel(sb, 'HomeLastResultOutcome', matchTickerN, '—', 22,
        HE.homeLastResultOutcome.y, HE.homeLastResultOutcome.w, HE.homeLastResultOutcome.h, 184, 184, 184);
    sb.e[lastResultOutcome]._lpos = v3(HE.homeLastResultOutcome.x, HE.homeLastResultOutcome.y, 0);
    style(sb, lastResultOutcome, { bold: true });
    {
        const lblComp = sb.e[sb.e[lastResultOutcome]._components[1].__id__];
        lblComp._horizontalAlign = 0; // left
    }

    // V5 — delta SOL "+0.10 SOL" / "-0.05 SOL". Right-aligned, same color as outcome.
    const lastResultDelta = mkLabel(sb, 'HomeLastResultDelta', matchTickerN, '—', 22,
        HE.homeLastResultDelta.y, HE.homeLastResultDelta.w, HE.homeLastResultDelta.h, 184, 184, 184);
    sb.e[lastResultDelta]._lpos = v3(HE.homeLastResultDelta.x, HE.homeLastResultDelta.y, 0);
    style(sb, lastResultDelta, { bold: true });
    {
        const lblComp = sb.e[sb.e[lastResultDelta]._components[1].__id__];
        lblComp._horizontalAlign = 2; // right
    }

    // V5 — meta line "1v1 · 0.10 stake · 12m ago" 12pt muted (bottom row).
    const lastResultMeta = mkLabel(sb, 'HomeLastResultMeta', matchTickerN, 'No recent matches', 12,
        HE.homeLastResultMeta.y, HE.homeLastResultMeta.w, HE.homeLastResultMeta.h, 184, 184, 184);
    sb.e[lastResultMeta]._lpos = v3(HE.homeLastResultMeta.x, HE.homeLastResultMeta.y, 0);

    sb.e[matchTickerN]._children = [
        rf(lastResultLabel),
        rf(lastResultOutcome),
        rf(lastResultDelta),
        rf(lastResultMeta),
    ];

    // Tournament alternate — same slot as ticker, mutually exclusive.
    // Keeps single-line label for v1; 5-chip parity is deferred polish.
    const homeTournamentBadge = mkBtnXY(sb, 'HomeTournamentBadge', hpN, 'Tournament in —',
        HE.homeTournamentBadge.x, HE.homeTournamentBadge.y, HE.homeTournamentBadge.w, HE.homeTournamentBadge.h,
        140, 80, 180);
    sb.e[homeTournamentBadge]._active = false;

    // V3 — DailyStreakStrip + HomeChooseMatchLabel ("CHOOSE MATCH TYPE")
    // dropped. Daily chips reparented above; richer CTA subtitles carry the
    // section affordance.

    // ── PRIMARY CTA TRIO ──────────────────────────────────────────────
    // Subtitle + chevron are CHILDREN of the button rect (scale on press
    // along with the button). FindMatch carries a live count badge sibling.
    function attachCTAExtras(btnN, subtitleName, subtitleText, chevronName, subtitleSpec, chevronSpec) {
        const subN = mkLabel(sb, subtitleName, btnN, subtitleText, 14,
            subtitleSpec.y, subtitleSpec.w, subtitleSpec.h, 255, 255, 255);
        sb.e[subN]._lpos = v3(subtitleSpec.x, subtitleSpec.y, 0);
        const chevN = mkLabel(sb, chevronName, btnN, '›', 28,
            chevronSpec.y, chevronSpec.w, chevronSpec.h, 255, 255, 255);
        sb.e[chevN]._lpos = v3(chevronSpec.x, chevronSpec.y, 0);
        style(sb, chevN, { bold: true });
        const existing = sb.e[btnN]._children ?? [];
        sb.e[btnN]._children = [...existing, rf(subN), rf(chevN)];
        return { sub: subN, chev: chevN };
    }

    // V4 — CTA hierarchy ("Play Now" hub):
    //   Find  (HERO):      alpha 110, pad 16 — instant play, biggest glow
    //   Start (secondary): alpha 70,  pad 12 — purple host action
    //   MIP   (neutral):   ghost charcoal, no glow — contextual status
    //   Bot   (training):  alpha 60,  pad 10 — gold full-width, two-line subtitle

    // Find Match — V4 HERO (instant play). PRIMARY tier — biggest glow, idle pulse,
    // ripple, and the only tier that gets the shimmer sweep.
    const { glow: findMatchGlow, btn: findMatch } = mkBtnHero(sb,
        'FindMatchButton', hpN, 'Find Match',
        HE.findMatchBtn.x, HE.findMatchBtn.y, HE.findMatchBtn.w, HE.findMatchBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { tier: 'primary' });
    style(sb, findMatch, { bold: true });
    attachCTAExtras(findMatch, 'FindMatchSubtitle', 'Join an open match instantly',
        'FindMatchChevron', HE.findMatchSubtitle, HE.findMatchChevron);

    // FindMatch live count badge — sibling, sits on right edge of button.
    const findMatchBadgeN = sb.e.length;
    sb.node('FindMatchButtonCountBadge', hpN, [], [], v3(HE.findMatchCountBadge.x, HE.findMatchCountBadge.y, 0));
    const findMatchBadgeUT = sb.ut(findMatchBadgeN, HE.findMatchCountBadge.w, HE.findMatchCountBadge.h);
    const findMatchBadgeSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(findMatchBadgeN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 240),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // V5 — bumped 14pt → 16pt bold so the count carries more weight on the hero badge (88×32).
    const findMatchBadgeLbl = mkLabel(sb, 'FindMatchButtonCountLabel', findMatchBadgeN, '0', 16, 0, 70, 32, 10, 4, 16);
    sb.e[sb.e[findMatchBadgeLbl]._components[1].__id__]._isBold = true;
    sb.e[findMatchBadgeN]._components = [rf(findMatchBadgeUT), rf(findMatchBadgeSpr)];
    sb.e[findMatchBadgeN]._children = [rf(findMatchBadgeLbl)];
    sb.e[findMatchBadgeN]._active = false;

    // V5 NEW — Shimmer_FindMatchButton sweep band (90×h white/alpha 80) parked
    // off-screen until ButtonFX.addShimmerSweep tweens it across the hero CTA
    // every ~4.5s. Renders ON TOP of labels during a sweep so the sheen reads
    // through the text. mkBtnHero (the helper used by Find/Start/MIP/Bot)
    // doesn't create this child by default — only mkBtnHeroLayered does — so
    // we add it inline for the hero card only.
    const findMatchShimmerN = sb.e.length;
    sb.node('Shimmer_FindMatchButton', findMatch, [], [], v3(0, 0, 0));
    const findMatchShimmerUT = sb.ut(findMatchShimmerN, 90, HE.findMatchBtn.h);
    const findMatchShimmerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(findMatchShimmerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 80),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[findMatchShimmerN]._components = [rf(findMatchShimmerUT), rf(findMatchShimmerSpr)];
    sb.e[findMatchShimmerN]._active = false;
    sb.e[findMatch]._children = [...(sb.e[findMatch]._children ?? []), rf(findMatchShimmerN)];

    // V4 NEW — FindMatch activity dot (small teal pulsing dot, upper-left).
    const findMatchDotN = sb.e.length;
    sb.node('FindMatchActivityDot', hpN, [], [], v3(HE.findMatchActivityDot.x, HE.findMatchActivityDot.y, 0));
    const findMatchDotUT = sb.ut(findMatchDotN, HE.findMatchActivityDot.w, HE.findMatchActivityDot.h);
    const findMatchDotSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(findMatchDotN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[findMatchDotN]._components = [rf(findMatchDotUT), rf(findMatchDotSpr)];
    sb.e[findMatchDotN]._active = false;

    // V4 — Start Match SECONDARY purple (sits below FindMatch primary).
    const { glow: startMatchGlow, btn: startMatch } = mkBtnHero(sb,
        'StartMatchButton', hpN, 'Start Match',
        HE.startMatchBtn.x, HE.startMatchBtn.y, HE.startMatchBtn.w, HE.startMatchBtn.h,
        VAR('primary').r, VAR('primary').g, VAR('primary').b,
        { tier: 'secondary' });
    style(sb, startMatch, { bold: true });
    attachCTAExtras(startMatch, 'StartMatchSubtitle', 'Create a match · Invite or wait',
        'StartMatchChevron', HE.startMatchSubtitle, HE.startMatchChevron);

    // V5 — drop-shadow sibling for Start Match (alpha 60). Sits 6px below the
    // card to create depth layering; renders behind the glow so it doesn't
    // mute the violet halo.
    const startMatchShadowN = sb.e.length;
    sb.node('StartMatchShadow', hpN, [], [], v3(HE.startMatchBtn.x, HE.startMatchBtn.y - 6, 0));
    const startMatchShadowUT = sb.ut(startMatchShadowN, HE.startMatchBtn.w, HE.startMatchBtn.h + 6);
    const startMatchShadowSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(startMatchShadowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 60),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[startMatchShadowN]._components = [rf(startMatchShadowUT), rf(startMatchShadowSpr)];

    // V4 — Matches In Progress SECONDARY ghost (no halo via ghost flag).
    const mipColor = P.bg.card; // dark slate #1E2438 — true neutral, distinct from teal/violet/gold.
    const { glow: mipGlow, btn: mipBtn } = mkBtnHero(sb,
        'MatchesInProgressButton', hpN, 'Matches In Progress',
        HE.matchesInProgressBtn.x, HE.matchesInProgressBtn.y, HE.matchesInProgressBtn.w, HE.matchesInProgressBtn.h,
        mipColor.r, mipColor.g, mipColor.b,
        { tier: 'secondary', ghost: true });
    style(sb, mipBtn, { bold: true });
    attachCTAExtras(mipBtn, 'MatchesInProgressSubtitle', 'Resume your active games',
        'MatchesInProgressChevron', HE.matchesInProgressSubtitle, HE.matchesInProgressChevron);

    // V5 — drop-shadow sibling for MIP (alpha 50). MIP has no glow halo; the
    // shadow alone provides its depth layering so the ghost card doesn't read
    // flat against the panel.
    const mipShadowN = sb.e.length;
    sb.node('MatchesInProgressShadow', hpN, [], [], v3(HE.matchesInProgressBtn.x, HE.matchesInProgressBtn.y - 6, 0));
    const mipShadowUT = sb.ut(mipShadowN, HE.matchesInProgressBtn.w, HE.matchesInProgressBtn.h + 6);
    const mipShadowSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mipShadowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 50),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mipShadowN]._components = [rf(mipShadowUT), rf(mipShadowSpr)];

    // MIP live count badge — sibling, sits on right edge of button (mirror FindMatch pattern).
    const mipBadgeN = sb.e.length;
    sb.node('MatchesInProgressCountBadge', hpN, [], [], v3(HE.matchesInProgressCountBadge.x, HE.matchesInProgressCountBadge.y, 0));
    const mipBadgeUT = sb.ut(mipBadgeN, HE.matchesInProgressCountBadge.w, HE.matchesInProgressCountBadge.h);
    const mipBadgeSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mipBadgeN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 240),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const mipBadgeLbl = mkLabel(sb, 'MatchesInProgressCountLabel', mipBadgeN, '0', 14, 0, 60, 28, 10, 4, 16);
    sb.e[sb.e[mipBadgeLbl]._components[1].__id__]._isBold = true;
    sb.e[mipBadgeN]._components = [rf(mipBadgeUT), rf(mipBadgeSpr)];
    sb.e[mipBadgeN]._children = [rf(mipBadgeLbl)];
    sb.e[mipBadgeN]._active = false;

    // V4 NEW — MIP activity dot (small teal pulsing dot, left edge).
    const mipDotN = sb.e.length;
    sb.node('MatchesInProgressActivityDot', hpN, [], [], v3(HE.matchesInProgressActivityDot.x, HE.matchesInProgressActivityDot.y, 0));
    const mipDotUT = sb.ut(mipDotN, HE.matchesInProgressActivityDot.w, HE.matchesInProgressActivityDot.h);
    const mipDotSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mipDotN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mipDotN]._components = [rf(mipDotUT), rf(mipDotSpr)];
    sb.e[mipDotN]._active = false;

    // V4 — Bot Match grows full-width (w 600→680, h 72→88) and absorbs Training
    // copy on a second subtitle line ("Train before real matches" + "N free
    // matches left"). Stays gold/amberDim so the training affordance reads.
    const botColor = rgba(P.accent.amberDim);
    const { glow: botMatchGlow, btn: botMatch } = mkBtnHero(sb,
        'BotMatchButton', hpN, 'Bot Match',
        HE.botMatchBtn.x, HE.botMatchBtn.y, HE.botMatchBtn.w, HE.botMatchBtn.h,
        botColor.r, botColor.g, botColor.b,
        { tier: 'secondary' });

    // V5 — drop-shadow sibling for Bot Match (alpha 40). Lowest of the three
    // staggered shadows — the training affordance reads as the visual base of
    // the action stack.
    const botMatchShadowN = sb.e.length;
    sb.node('BotMatchShadow', hpN, [], [], v3(HE.botMatchBtn.x, HE.botMatchBtn.y - 6, 0));
    const botMatchShadowUT = sb.ut(botMatchShadowN, HE.botMatchBtn.w, HE.botMatchBtn.h + 6);
    const botMatchShadowSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(botMatchShadowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 40),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[botMatchShadowN]._components = [rf(botMatchShadowUT), rf(botMatchShadowSpr)];
    style(sb, botMatch, { bold: true });
    attachCTAExtras(botMatch, 'BotMatchSubtitle', 'Train before real matches',
        'BotMatchChevron', HE.botMatchSubtitle, HE.botMatchChevron);
    // V4 NEW — second subtitle line carries the free-match counter (was on
    // the now-deleted Training card). AppUI._setBotMatchTrainingLine writes here.
    const botMatchSubLine2N = mkLabel(sb, 'BotMatchSubtitleLine2', botMatch, '— free matches left', 13,
        HE.botMatchSubtitleLine2.y, HE.botMatchSubtitleLine2.w, HE.botMatchSubtitleLine2.h, 184, 184, 184);
    sb.e[botMatchSubLine2N]._lpos = v3(HE.botMatchSubtitleLine2.x, HE.botMatchSubtitleLine2.y, 0);
    {
        const existing = sb.e[botMatch]._children ?? [];
        sb.e[botMatch]._children = [...existing, rf(botMatchSubLine2N)];
    }

    // ── V4 — TRAINING / MASCOT CARD REMOVED ───────────────────────────
    // HomeTrainingCard and its 6 children deleted. Bot Match card now
    // carries the "Train before real matches" + "N free matches left"
    // copy on its two-line subtitle. MascotContainer kept off-flow as
    // a panel-root child so AppUI.MascotController.attach() doesn't 404
    // when Home is active (mascot only renders inside PostMatchPanel
    // now). HomeStatusLabel reparented to panel root for AppUI._homeStatus.
    const mascotN = sb.e.length;
    sb.node('MascotContainer', hpN, [], [], v3(HE.mascot.x, HE.mascot.y, 0));
    const mascotUT = sb.ut(mascotN, HE.mascot.w, HE.mascot.h);
    sb.e[mascotN]._components = [rf(mascotUT)];
    sb.e[mascotN]._active = false;

    const homeStatus = mkLabel(sb, 'HomeStatusLabel', hpN, '', 11,
        HE.homeStatus.y, HE.homeStatus.w, HE.homeStatus.h, 140, 140, 140);
    sb.e[homeStatus]._lpos = v3(HE.homeStatus.x, HE.homeStatus.y, 0);
    {
        const lblComp = sb.e[sb.e[homeStatus]._components[1].__id__];
        lblComp._horizontalAlign = 1; // center
    }

    // ── HUD CHROME ICONS ──────────────────────────────────────────────
    // Right cluster (Portfolio · Leaderboard · Settings) lives left-of-Settings;
    // promoted from TokenDuelGame so global nav is always one tap from Home.
    const homeSettingsBtn = mkBtnXY(sb, 'OpenSettingsButton', hpN, '',
        HE.openSettingsBtn.x, HE.openSettingsBtn.y, HE.openSettingsBtn.w, HE.openSettingsBtn.h,
        56, 64, 90);
    const homeLeaderboardBtn = mkBtnXY(sb, 'OpenLeaderboardButton', hpN, '',
        HE.openLeaderboardBtn.x, HE.openLeaderboardBtn.y, HE.openLeaderboardBtn.w, HE.openLeaderboardBtn.h,
        56, 64, 90);
    // Phase N4: Disconnect button (replaces former Portfolio shortcut on Home).
    const homeDisconnectBtn = mkBtnXY(sb, 'DisconnectButton', hpN, '',
        HE.disconnectBtn.x, HE.disconnectBtn.y, HE.disconnectBtn.w, HE.disconnectBtn.h,
        56, 64, 90);
    const homeNotifBell = mkBtnXY(sb, 'NotificationBellButton', hpN, '',
        HE.notificationBell.x, HE.notificationBell.y, HE.notificationBell.w, HE.notificationBell.h,
        56, 64, 90);

    // Notification bell badge — overlay on top-right of bell.
    const homeNotifBadgeN = sb.e.length;
    sb.node('NotificationBellBadge', hpN, [], [], v3(HE.notificationBadge.x, HE.notificationBadge.y, 0));
    const homeNotifBadgeUT = sb.ut(homeNotifBadgeN, HE.notificationBadge.w, HE.notificationBadge.h);
    const homeNotifBadgeSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(homeNotifBadgeN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(236, 88, 122, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const homeNotifBadgeLbl = mkLabel(sb, 'NotificationBadgeLabel', homeNotifBadgeN, '0', 12, 0, 24, 24, 255, 255, 255);
    sb.e[sb.e[homeNotifBadgeLbl]._components[1].__id__]._isBold = true;
    sb.e[homeNotifBadgeN]._components = [rf(homeNotifBadgeUT), rf(homeNotifBadgeSpr)];
    sb.e[homeNotifBadgeN]._children = [rf(homeNotifBadgeLbl)];
    sb.e[homeNotifBadgeN]._active = false;

    // ── HomePanel children patch (V4 render order: back → front) ──────
    // V4: scrim FIRST (behind everything), wallet glow BEFORE pill, header
    // underline behind content, recent-card elevation BEFORE ticker so it
    // sits as a soft shadow behind the card. CTA quartet renders Find first
    // (HERO), then Start (secondary), MIP (neutral), Bot (training). Each
    // glow renders BEHIND its button. New activity dots sit alongside the
    // count badges. Training card REMOVED — mascot pinned off-flow.
    sb.e[hpN]._children = [
        rf(scrimN),
        rf(homeHeaderUnderlineN),
        rf(walletPillGlowN), rf(walletPillN),
        rf(homeLevelChipN),
        rf(homeRecentCardElevationN),
        rf(lastResultGlowN),  // V5 — outcome halo renders BEHIND the card (after elevation)
        rf(matchTickerN), rf(homeTournamentBadge),
        // CTA quartet (V4 hierarchy: Find=hero > Start=secondary > MIP=neutral > Bot=training).
        // V5 — drop-shadow siblings rendered FIRST per card, so the card sits
        // visually elevated. Hero (FindMatch) skips the shadow — its larger
        // glow halo already provides the depth.
        rf(findMatchGlow), rf(findMatch), rf(findMatchBadgeN), rf(findMatchDotN),
        rf(startMatchShadowN), rf(startMatchGlow), rf(startMatch),
        // MIP is ghost: mipGlow === -1, skip it so we don't push a bogus ref.
        rf(mipShadowN), ...(mipGlow >= 0 ? [rf(mipGlow)] : []), rf(mipBtn), rf(mipBadgeN), rf(mipDotN),
        rf(botMatchShadowN), rf(botMatchGlow), rf(botMatch),
        rf(mascotN), rf(homeStatus),
        rf(homeDisconnectBtn), rf(homeLeaderboardBtn), rf(homeSettingsBtn),
        rf(homeNotifBell), rf(homeNotifBadgeN),
        rf(streakFlameN),
    ];

    // ═══════════════════════════════════════════════════════════════
    // TOKEN DUEL PANEL — Session 2 rebuild:
    //   • Balance chip (top-right) — live SOL balance.
    //   • 3 feed tabs (Trending / Gainers / New) — tap to switch Birdeye feed.
    //   • 8 feed rows (non-scrolling for v1; ScrollView is Phase IV polish).
    //     Each row has a SymbolLabel, DeltaLabel, sprite backdrop, and Button
    //     that taps to add the token to the squad.
    //   • 3 squad slot buttons (tap to clear a slot).
    //   • 3 stake chips (0.001 / 0.01 / 0.1 SOL) — replaces the v1 fixed stake.
    //   • StakeCommitButton — renamed from SignStakeButton. Uses the new
    //     `signAndSendTransaction` path (one wallet prompt, no Broadcast).
    //   • Holding labels kept as hidden legacy nodes — AppUI rebinds them if
    //     the scene regen ships a version that removes them.
    // ═══════════════════════════════════════════════════════════════
    const tdN = sb.e.length;
    sb.node('TokenDuelPanel', canvas, [], [tdN+1], lobbyMount('TokenDuelPanel'));
    sb.ut(tdN, 720, 1280);
    sb.spr(tdN, 10, 14, 22); // Phase 25: dark-slate backdrop hides BackgroundFX halos behind data

    // ─────────────────────────────────────────────────────────────────
    // Session 12: designer-heavy UX pass — solpulse-parity sleekness.
    //   • TOP CHROME (y=+640..+400): back link · title · balance, search,
    //     dropdown / star / LIVE row, filter chips, column headers.
    //   • FEED ZONE (y=+395..-260): scrollview, 660px tall (was 400).
    //   • BOTTOM CLUSTER (y=-260..-640): squad, stake slider+chips, commit.
    // Palette:
    //   panel bg  (10, 14, 22)  — near-black, warm undertone
    //   chrome bg (36, 16, 48)  — search, dropdown, chips idle
    //   accent    (48,198,155)  — LIVE, active chips, positive
    //   gold      (218,165,32)  — price, title
    //   muted     (140,145,165) — name subtitles
    //   dim       (100,110,130) — column headers
    // ─────────────────────────────────────────────────────────────────

    // Back link — tiny top-left, replaces the big y=-380 slab.
    // betting-duel round-4 polish: FIXED_WIDTH viewport spread for
    // TokenDuelPanel. Device reports visible_h=1602 but content was packed
    // into 1280. Y range widened from [-625,+618] → [-740,+720] so the top
    // chrome and bottom status stretch edge-to-edge on device, killing the
    // "shadow frame" bands the user kept seeing.
    // TokenDuelPanel chrome positions sourced from LAYOUT.TokenDuelPanel.
    const TDE = LAYOUT.TokenDuelPanel.elements;
    const TDT = LAYOUT.TokenDuelPanel.templates;

    logBackParity('TokenDuelPanel', TDE.backLink.y);
    const tdBackLink = mkLabel(sb, 'BackLinkLabel', tdN, '← Back', 18,
        TDE.backLink.y, TDE.backLink.w, TDE.backLink.h, 200, 210, 230);
    sb.e[tdBackLink]._lpos = v3(TDE.backLink.x, TDE.backLink.y, 0);
    const tdBackLinkL = sb.e[tdBackLink]._components[1].__id__;
    sb.e[tdBackLinkL]._horizontalAlign = 0;
    const tdBackBtn = sb.e.length;
    sb.node('BackButton', tdN, [], [], v3(TDE.backBtn.x, TDE.backBtn.y, 0));
    const tdBackBtnUT = sb.ut(tdBackBtn, TDE.backBtn.w, TDE.backBtn.h);
    const tdBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(tdBackBtn), _id: gid(),
    });
    sb.e[tdBackBtn]._components = [rf(tdBackBtnUT), rf(tdBackBtnBtn)];

    // 2026-04-26 — black background bar that spans the full canvas width
    // behind the "Token Duel" title. Anchors the header band visually.
    // Rendered BEFORE the title in the panel children list so the title text
    // sits on top.
    // 2026-04-29 token-picker rebuild — h 56→64 to fit the larger 48h title with 8px breathing room.
    const tdTitleBg = sb.e.length;
    sb.node('TitleBgSprite', tdN, [], [], v3(0, TDE.title.y, 0));
    const tdTitleBgUT = sb.ut(tdTitleBg, 720, 64);
    const tdTitleBgSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdTitleBg), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdTitleBg]._components = [rf(tdTitleBgUT), rf(tdTitleBgSpr)];

    // 2026-04-29 token-picker rebuild — font 30→34 so the title reads as the
    // page-owning headline and isn't visually swallowed by the match setup card
    // beneath it.
    // 2026-04-30 — single gold "Token Duel" label (matches Leaderboard title
    // pattern). Prior split into TitleLabel + TitleAccentLabel left the accent
    // unparented (no children-array entry) so "Duel" never rendered anyway.
    const tdTitle = mkLabel(sb, 'TitleLabel', tdN, 'Token Duel', 34,
        TDE.title.y, TDE.title.w, TDE.title.h, 255, 210, 74); // Palette.rank.gold
    sb.e[tdTitle]._lpos = v3(0, TDE.title.y, 0);
    sb.e[sb.e[tdTitle]._components[1].__id__]._horizontalAlign = 1; // CENTER
    style(sb, tdTitle, { bold: true });

    // ── 2026-05-02 token-picker UX — DRAFT YOUR SQUAD eyebrow ──────────
    // Replaces HeaderUnderline as the visual band-separator below the title.
    // 14pt, dim slate (UNIFORM_TEXT.DIM_COLOR), bold, +2 letter spacing.
    const tdSubtitle = mkLabel(sb, 'TokenDuelSubtitle', tdN, 'DRAFT YOUR SQUAD',
        TDE.subtitle.x, TDE.subtitle.y, TDE.subtitle.w, TDE.subtitle.h, 168, 174, 201);
    sb.e[tdSubtitle]._lpos = v3(TDE.subtitle.x, TDE.subtitle.y, 0);
    sb.e[sb.e[tdSubtitle]._components[1].__id__]._fontSize = 14;
    sb.e[sb.e[tdSubtitle]._components[1].__id__]._horizontalAlign = 1; // CENTER
    sb.e[sb.e[tdSubtitle]._components[1].__id__]._isBold = true;
    sb.e[sb.e[tdSubtitle]._components[1].__id__]._spacingX = 2;

    // ── HeaderUnderline kept off-canvas (superseded by subtitle eyebrow) ──
    const tdHeaderUnderline = sb.e.length;
    sb.node('HeaderUnderline', tdN, [], [],
        v3(TDE.headerUnderline.x, TDE.headerUnderline.y, 0));
    const tdHUUT = sb.ut(tdHeaderUnderline,
        TDE.headerUnderline.w, TDE.headerUnderline.h);
    const tdHUSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdHeaderUnderline), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(153, 69, 255, 0),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdHeaderUnderline]._components = [rf(tdHUUT), rf(tdHUSpr)];
    sb.e[tdHeaderUnderline]._active = false;

    // ── 2026-04-26 v2 — Two SEPARATE rounded pills (Lv + SOL) ──────────
    // Replaces the combined PlayerStatusPill. Each pill is its own rounded
    // sprite with a single label inside, so long XP / SOL strings cannot
    // overflow into each other. The legacy node names TokenDuelLevelChip /
    // TokenDuelLevelChipLabel / BalanceChip / BalanceChipLabel are preserved
    // so AppUI's existing getChildByName lookups (set in start()) still work.

    // LevelPill — left of solPill, holds "Lv N · curr/max XP" (gold).
    const tdLevelChipN = sb.e.length;
    sb.node('LevelPill', tdN, [], [], v3(TDE.levelPill.x, TDE.levelPill.y, 0));
    const tdLevelPillUT = sb.ut(tdLevelChipN, TDE.levelPill.w, TDE.levelPill.h);
    const tdLevelPillSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdLevelChipN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(37, 43, 66, 235),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // Back-compat alias: TokenDuelLevelChip node holds the Lv label.
    const tdLevelInnerN = sb.e.length;
    sb.node('TokenDuelLevelChip', tdLevelChipN, [], [], v3(0, 0, 0));
    const tdLevelInnerUT = sb.ut(tdLevelInnerN, TDE.levelPill.w - 16, TDE.levelPill.h - 8);
    const tdLevelChipLbl = mkLabel(sb, 'TokenDuelLevelChipLabel', tdLevelInnerN, 'Lv 1 · 0/1000', 18, 0,
        TDE.levelPill.w - 24, 32, 255, 210, 74);
    sb.e[sb.e[tdLevelChipLbl]._components[1].__id__]._isBold = true;
    sb.e[tdLevelInnerN]._components = [rf(tdLevelInnerUT)];
    sb.e[tdLevelInnerN]._children = [rf(tdLevelChipLbl)];
    const tdLevelEdgeN = mkCardEdge(sb, tdLevelChipN, TDE.levelPill.w, TDE.levelPill.h, 255, 210, 74);
    sb.e[tdLevelChipN]._components = [rf(tdLevelPillUT), rf(tdLevelPillSpr)];
    sb.e[tdLevelChipN]._children = [rf(tdLevelInnerN), rf(tdLevelEdgeN)];

    // SolPill — right of levelPill, holds "◼ 19.99 SOL" (mint, mono).
    const tdSolPillN = sb.e.length;
    sb.node('SolPill', tdN, [], [], v3(TDE.solPill.x, TDE.solPill.y, 0));
    const tdSolPillUT = sb.ut(tdSolPillN, TDE.solPill.w, TDE.solPill.h);
    const tdSolPillSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdSolPillN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(37, 43, 66, 235),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // Back-compat alias: BalanceChip node holds the SOL label.
    const tdBalanceInnerN = sb.e.length;
    sb.node('BalanceChip', tdSolPillN, [], [], v3(0, 0, 0));
    const tdBalanceInnerUT = sb.ut(tdBalanceInnerN, TDE.solPill.w - 16, TDE.solPill.h - 8);
    const tdBalanceLbl = mkLabel(sb, 'BalanceChipLabel', tdBalanceInnerN, '◼ 0.00 SOL', 18, 0,
        TDE.solPill.w - 24, 32, 168, 230, 200);
    sb.e[sb.e[tdBalanceLbl]._components[1].__id__]._isBold = true;
    style(sb, tdBalanceLbl, { mono: true });
    sb.e[tdBalanceInnerN]._components = [rf(tdBalanceInnerUT)];
    sb.e[tdBalanceInnerN]._children = [rf(tdBalanceLbl)];
    const tdSolEdgeN = mkCardEdge(sb, tdSolPillN, TDE.solPill.w, TDE.solPill.h, 168, 230, 200);
    sb.e[tdSolPillN]._components = [rf(tdSolPillUT), rf(tdSolPillSpr)];
    sb.e[tdSolPillN]._children = [rf(tdBalanceInnerN), rf(tdSolEdgeN)];

    // 6 top-row icon buttons from LAYOUT.TokenDuelPanel.templates.topRowActionBtn.
    // Row moved from y=735 → y=750 so bbox clears TitleLabel at y=700 h=44.
    const TRA = TDT.topRowActionBtn;
    const tdActionBtns = [];
    for (let i = 0; i < TRA.count; i++) {
        // Phase 24: bg color (28,34,48) → (56,64,90) for visibility against
        // canvas dark-slate (mirrors Phase 22 Home icons treatment).
        const bN = mkBtnXY(sb, TRA.names[i], tdN, TRA.labels[i],
            TRA.xs[i], TRA.y, TRA.w, TRA.h, 56, 64, 90);
        tdActionBtns.push(bN);
    }
    // 2026-04-27: HelpButton ('?' text glyph, no IconBadge) — bump label
    // font 1.5× to match the 1.5×-scaled IconBadge size on the other 3 btns.
    if (tdActionBtns.length === 4) {
        style(sb, tdActionBtns[3], { fontSize: 27 });
    }
    const [tdSettingsBtn, tdPresetsBtn, tdSuggestBtn, tdHelpBtn] = tdActionBtns;

    // BalanceChipLabel now lives inside PlayerStatusPill (see above).
    // The standalone label was removed in 2026-04-26 redesign.

    // ── 2026-04-29 token-picker rebuild — Match Setup Summary Card ──
    // 80-px tall mission bar directly under the page title. Top edge gets a
    // 4-px teal accent (mkCardEdge below). Three labels populated by
    // AppUI._refreshSquadActionButtons:
    //   • Squad/Stake row (top half, y=+18 local) at 22pt bold
    //   • Hint label (bottom half, y=-18 local) at 18pt
    // 2026-04-29 god-tier UX pass: card grew 64→80, label centers nudged
    // 14→18 (top row) and -16→-18 (hint) to balance against the new height.
    const MSC = TDE.matchSetupCard;
    const matchSetupCardN = sb.e.length;
    sb.node('MatchSetupCard', tdN, [], [], v3(MSC.x, MSC.y, 0));
    const mscUT = sb.ut(matchSetupCardN, MSC.w, MSC.h);
    const mscSpr = cardBodySpr(sb, matchSetupCardN);
    // 2026-05-02 token-picker UX — text "Squad: 0/3" replaced with 3 visual
    // pip sprites that fill teal as the squad grows. AppUI._refreshSquadActionButtons
    // drives the pip sprite color + the counter label string. The legacy
    // MatchSetupSquadLabel is kept off-canvas (still wired to AppUI binding,
    // null-safe writes).
    const mscSquadLbl = mkLabel(sb, 'MatchSetupSquadLabel', matchSetupCardN, '', 1, -2000,
        1, 1, 255, 255, 255);
    sb.e[mscSquadLbl]._lpos = v3(-2000, -2000, 0);
    sb.e[mscSquadLbl]._active = false;
    // 2026-05-02 token-picker UX — also off-canvas; stake info is conveyed by
    // the WagerValueButton pill near the CTA, and showing it here too is
    // redundant. Kept as a node so AppUI's null-safe writes don't break.
    // Distinct off-canvas position so verifier doesn't flag bbox-overlap with
    // MatchSetupSquadLabel (both are inert placeholders).
    const mscStakeLbl = mkLabel(sb, 'MatchSetupStakeLabel', matchSetupCardN, '', 1, -2200,
        1, 1, 255, 210, 74);
    sb.e[mscStakeLbl]._lpos = v3(-2200, -2200, 0);
    sb.e[mscStakeLbl]._active = false;
    style(sb, mscStakeLbl, { mono: true, bold: true });
    // 2026-05-02 token-picker UX — hint moves to the TOP row (where stake used
    // to live) so the squad-state copy reads alongside the pip progress, and
    // the bottom of the card opens up. Centered-right of pips, left-aligned.
    const mscHintLbl = mkLabel(sb, 'MatchSetupHintLabel', matchSetupCardN, 'Pick 3 tokens to start', 18, 0,
        420, 22, 184, 184, 184);
    sb.e[mscHintLbl]._lpos = v3(70, 0, 0);
    sb.e[sb.e[mscHintLbl]._components[1].__id__]._horizontalAlign = 0;
    sb.e[sb.e[mscHintLbl]._components[1].__id__]._isBold = false;
    // 2026-05-02 token-picker UX — 3 pip sprites stand in for "Squad: N/3"
    // text. Filled state = teal (Palette.cardEdge.teal); empty = slate
    // outline. AppUI tints them in _refreshSquadActionButtons.
    const SQUAD_PIP_NAMES = ['SquadPip_0', 'SquadPip_1', 'SquadPip_2'];
    const SQUAD_PIP_X = [-256, -232, -208];
    const mscPipN = [];
    for (let pi = 0; pi < 3; pi++) {
        const pipN = sb.e.length;
        sb.node(SQUAD_PIP_NAMES[pi], matchSetupCardN, [], [], v3(SQUAD_PIP_X[pi], 0, 0));
        const pipUT = sb.ut(pipN, 18, 18);
        const pipSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(pipN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(60, 70, 95, 220),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[pipN]._components = [rf(pipUT), rf(pipSpr)];
        mscPipN.push(pipN);
    }
    // Counter label sits to the right of the 3 pips. AppUI updates string
    // ("0/3" → "3/3") and color (slate → teal) per fill.
    const mscPipCounter = mkLabel(sb, 'MatchSetupSquadPipCounter', matchSetupCardN, '0/3', 16, 0,
        56, 22, 184, 184, 184);
    sb.e[mscPipCounter]._lpos = v3(-168, 0, 0);
    sb.e[sb.e[mscPipCounter]._components[1].__id__]._horizontalAlign = 0;
    sb.e[sb.e[mscPipCounter]._components[1].__id__]._isBold = true;
    const mscEdge = mkCardEdge(sb, matchSetupCardN, MSC.w, MSC.h, 20, 241, 149);
    // 2026-04-27 UI overhaul — bottom-edge ready glow strip. AppUI tints teal +
    // animates alpha breathe when squad full; muted grey otherwise. Sits
    // INSIDE the matchSetupCard so it scrolls with the card.
    const mscReadyGlowN = sb.e.length;
    // Place at card-local y = -h/2 + 1 so the strip kisses the bottom edge.
    sb.node('MatchSetupReadyGlow', matchSetupCardN, [], [],
        v3(0, -MSC.h / 2 + 1, 0));
    const mscReadyUT = sb.ut(mscReadyGlowN, MSC.w - 12, 2);
    const mscReadySpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mscReadyGlowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        // initial muted slate; AppUI swaps to teal when squad full.
        _color: cl(140, 140, 140, 80),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mscReadyGlowN]._components = [rf(mscReadyUT), rf(mscReadySpr)];
    // 2026-04-30 token-picker polish — left-side teal accent stripe + center
    // hairline divider so the Squad/Stake row reads as a structured status bar.
    // 2026-05-02 token-picker UX — both moved off-canvas: pip sprites now
    // carry the squad-progress read; stake label is also off-canvas (redundant
    // with WagerValueButton). Nodes kept as scene placeholders so any old
    // bindings stay null-safe.
    const mscSquadIconN = sb.e.length;
    sb.node('MatchSetupSquadIcon', matchSetupCardN, [], [], v3(-2000, -2000, 0));
    const mscSquadIconUT = sb.ut(mscSquadIconN, 1, 1);
    const mscSquadIconSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mscSquadIconN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 0),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mscSquadIconN]._components = [rf(mscSquadIconUT), rf(mscSquadIconSpr)];
    sb.e[mscSquadIconN]._active = false;
    const mscDivider1N = sb.e.length;
    sb.node('MatchSetupDivider1', matchSetupCardN, [], [], v3(-2000, -2000, 0));
    const mscDivider1UT = sb.ut(mscDivider1N, 1, 1);
    const mscDivider1Spr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mscDivider1N), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(60, 70, 95, 0),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mscDivider1N]._components = [rf(mscDivider1UT), rf(mscDivider1Spr)];
    sb.e[mscDivider1N]._active = false;
    sb.e[matchSetupCardN]._components = [rf(mscUT), rf(mscSpr)];
    sb.e[matchSetupCardN]._children = [
        rf(mscSquadIconN), rf(mscSquadLbl), rf(mscDivider1N), rf(mscStakeLbl), rf(mscHintLbl), rf(mscEdge), rf(mscReadyGlowN),
        rf(mscPipN[0]), rf(mscPipN[1]), rf(mscPipN[2]), rf(mscPipCounter),
    ];

    // 2026-04-26 unified card frame — wraps Row 1 (search/tabs/star/live) +
    // Row 2 (filter chips) + column headers + FeedScrollView in a single
    // dark card with a teal accent edge. Rendered BEFORE all of its visually
    // contained siblings in the panel children list (added below).
    const tdFrameCard = sb.e.length;
    sb.node('FeedFrameCardSprite', tdN, [], [],
        v3(TDE.feedFrameCard.x, TDE.feedFrameCard.y, 0));
    const tdFrameCardUT = sb.ut(tdFrameCard, TDE.feedFrameCard.w, TDE.feedFrameCard.h);
    const tdFrameCardSpr = cardBodySpr(sb, tdFrameCard);
    sb.e[tdFrameCard]._components = [rf(tdFrameCardUT), rf(tdFrameCardSpr)];
    const tdFrameCardEdge = mkCardEdge(sb, tdFrameCard,
        TDE.feedFrameCard.w, TDE.feedFrameCard.h, 48, 198, 155);
    sb.e[tdFrameCard]._children = [rf(tdFrameCardEdge)];

    // Search input + clear button. 2026-04-26 unified — search dropped to
    // 312×44 to share Row 1 with the Trending dropdown, star icon, and LIVE.
    // 2026-04-30 — Trending + Search are the hero filter controls. Search font
    // 17→20, accent edge thickened 3→4 + slightly brighter teal so the field
    // reads as the primary interaction surface.
    const tdSearch = mkEditBox(sb, 'SearchEditBox', tdN, 'Search token by symbol or mint…',
        TDE.search.x, TDE.search.y, TDE.search.w, TDE.search.h, 20);
    const tdSearchAccent = sb.e.length;
    sb.node('SearchAccentEdge', tdN, [], [], v3(TDE.search.x, TDE.search.y - TDE.search.h / 2 + 2, 0));
    const tdSearchAccentUT = sb.ut(tdSearchAccent, TDE.search.w - 8, 4);
    const tdSearchAccentSpr = sb.spr(tdSearchAccent, 20, 241, 149);
    sb.e[tdSearchAccent]._components = [rf(tdSearchAccentUT), rf(tdSearchAccentSpr)];
    const tdSearchClear = mkBtnXY(sb, 'SearchClearButton', tdN, '×',
        TDE.searchClear.x, TDE.searchClear.y, TDE.searchClear.w, TDE.searchClear.h, 45, 55, 72);
    sb.e[tdSearchClear]._active = false;

    // Header-chrome row: dropdown · watchlist star · live indicator.
    const tabY = TDE.feedTabDropdown.y;
    const tdTabDropdown = mkBtnXY(sb, 'FeedTabDropdownButton', tdN, 'New Pairs  ▾',
        TDE.feedTabDropdown.x, TDE.feedTabDropdown.y, TDE.feedTabDropdown.w, TDE.feedTabDropdown.h,
        36, 16, 48);
    // 2026-05-01 r2 — bright white label (was gold) so the trending text
    // pops on the dim violet chip BG. Gold drained to a dull yellow against
    // the alpha-150 BG; white reads BRIGHT and obvious as a hero control.
    // Font 20→22 for stronger presence.
    style(sb, tdTabDropdown, { bold: true, fontSize: 22, color: cl(244, 245, 249, 255) });
    // 2026-04-26 unified card — Watchlist is now an icon-only ★ button
    // (44×44). Empty label string; AppUI attaches the star via IconLibrary
    // centered (offsetX=0) at size 32 inside the smaller button.
    const tdWatchStar = mkBtnXY(sb, 'WatchlistStarButton', tdN, '',
        TDE.watchlistStar.x, TDE.watchlistStar.y, TDE.watchlistStar.w, TDE.watchlistStar.h,
        36, 16, 48);
    const tdWatchCancel = mkBtnXY(sb, 'CancelWatchlistButton', tdN, '✕',
        TDE.cancelWatchlist.x, TDE.cancelWatchlist.y, TDE.cancelWatchlist.w, TDE.cancelWatchlist.h,
        55, 30, 30);
    sb.e[tdWatchCancel]._active = false;
    const tdLiveLbl = mkLabel(sb, 'LiveIndicatorLabel', tdN, '●  LIVE', 18,
        TDE.liveIndicator.y, TDE.liveIndicator.w, TDE.liveIndicator.h, 20, 241, 149);
    sb.e[tdLiveLbl]._lpos = v3(TDE.liveIndicator.x, TDE.liveIndicator.y, 0);
    style(sb, tdLiveLbl, { bold: true, spacing: 1 });  // 2026-04-30 — bumped 14→18 bold

    // FeedTabDropdownPopover — 6 options from LAYOUT.TokenDuelPanel.templates.feedTabOption.
    // UX Phase 2b: emoji stripped; AppUI attaches per-row IconBadges (bolt/flame/chart/chart/brain/star).
    const FTDP = TDE.feedTabDropdownPopover;
    const FTO  = TDT.feedTabOption;
    const popN = sb.e.length;
    sb.node('FeedTabDropdownPopover', tdN, [], [], v3(FTDP.x, FTDP.y, 0));
    const popUT = sb.ut(popN, FTDP.w, FTDP.h);
    const popSpr = sb.spr(popN, 26, 8, 32);
    const popOptIndices = [];
    for (let p = 0; p < FTO.count; p++) {
        const optN = mkBtnXY(sb, `FeedTabOption_${FTO.keys[p]}`, popN, FTO.labels[p],
            0, FTO.ys[p], FTO.w, FTO.h, 36, 16, 48);
        popOptIndices.push(optN);
    }
    sb.e[popN]._components = [rf(popUT), rf(popSpr)];
    sb.e[popN]._children = popOptIndices.map(rf);
    sb.e[popN]._active = false;

    // 2 sort filter chips from LAYOUT.TokenDuelPanel.templates.feedFilterChip:
    // [Newest] + [Liquidity ▾]. The 'liq' chip opens LiqSortDropdownPopover
    // (created below) where the user picks Liq High → Low or Liq Low → High.
    const FFC = TDT.feedFilterChip;
    const chipIndices = [];
    for (let c = 0; c < FFC.count; c++) {
        const cx = FFC.xs[c];
        const cN = mkBtnXY(sb, `FilterChip_${FFC.keys[c]}`, tdN, FFC.labels[c],
            cx, FFC.y, FFC.w, FFC.h, 36, 16, 48);
        chipIndices.push(cN);
    }
    const chipY = FFC.y;
    const chipH = FFC.h;
    // [All ▾] = MinLiq dropdown trigger (label morphs at runtime to active value).
    const tdMinLiqBtn = mkBtnXY(sb, 'MinLiqDropdownButton', tdN, 'All  ▾',
        TDE.minLiqDropdown.x, TDE.minLiqDropdown.y, TDE.minLiqDropdown.w, TDE.minLiqDropdown.h,
        36, 16, 48);
    // [Cols ±] = Columns toggle. Renamed 2026-04-26 — keeps "Cols" text with ± on right
    // for clearer "open columns picker" semantics (was "⋮  Cols").
    const tdColumnsBtn = mkBtnXY(sb, 'ColumnsButton', tdN, 'Cols  ±',
        TDE.columnsBtn.x, TDE.columnsBtn.y, TDE.columnsBtn.w, TDE.columnsBtn.h,
        36, 16, 48);

    // 2026-04-29b flagship rebalance — drop the body-sprite alpha on filter
    // chips so they read as controls, not full-weight cards. The squad section
    // gets the visual emphasis instead. Body sprite is component[1] for the
    // mkBtnXY non-chrome layout.
    const dimFilterChip = (btnIdx) => {
        const sprId = sb.e[btnIdx]?._components?.[1]?.__id__;
        const sprComp = sprId != null ? sb.e[sprId] : null;
        if (sprComp && sprComp._color) sprComp._color = cl(36, 16, 48, 150);
    };
    // 2026-05-01 r2 — Trending dropdown is the HERO feed control; do not
    // dim it. Other filter chips (MinLiq, Columns, sort chips) keep dim BG
    // as secondary controls.
    dimFilterChip(tdMinLiqBtn);
    dimFilterChip(tdColumnsBtn);
    for (const cN of chipIndices) dimFilterChip(cN);

    // MinLiq popover — 4 options from LAYOUT.TokenDuelPanel.templates.minLiqOption.
    const MLP = TDE.minLiqDropdownPopover;
    const MLO = TDT.minLiqOption;
    const minLiqPopN = sb.e.length;
    sb.node('MinLiqDropdownPopover', tdN, [], [], v3(MLP.x, MLP.y, 0));
    const minLiqPopUT = sb.ut(minLiqPopN, MLP.w, MLP.h);
    const minLiqPopSpr = sb.spr(minLiqPopN, 26, 8, 32);
    const minLiqOptIndices = [];
    for (let m = 0; m < MLO.count; m++) {
        const oN = mkBtnXY(sb, `MinLiqOption_${MLO.keys[m]}`, minLiqPopN, MLO.labels[m],
            0, MLO.ys[m], MLO.w, MLO.h, 36, 16, 48);
        minLiqOptIndices.push(oN);
    }
    sb.e[minLiqPopN]._components = [rf(minLiqPopUT), rf(minLiqPopSpr)];
    sb.e[minLiqPopN]._children = minLiqOptIndices.map(rf);
    sb.e[minLiqPopN]._active = false;

    // LiqSort popover — 2 options from LAYOUT.TokenDuelPanel.templates.liqSortOption.
    // Replaces the old standalone Liq↓ / Liq↑ chips. Trigger is the 'FilterChip_liq'
    // chip emitted by the feedFilterChip loop above.
    const LSP = TDE.liqSortDropdownPopover;
    const LSO = TDT.liqSortOption;
    const liqSortPopN = sb.e.length;
    sb.node('LiqSortDropdownPopover', tdN, [], [], v3(LSP.x, LSP.y, 0));
    const liqSortPopUT = sb.ut(liqSortPopN, LSP.w, LSP.h);
    const liqSortPopSpr = sb.spr(liqSortPopN, 26, 8, 32);
    const liqSortOptIndices = [];
    for (let m = 0; m < LSO.count; m++) {
        const oN = mkBtnXY(sb, `LiqSortOption_${LSO.keys[m]}`, liqSortPopN, LSO.labels[m],
            0, LSO.ys[m], LSO.w, LSO.h, 36, 16, 48);
        liqSortOptIndices.push(oN);
    }
    sb.e[liqSortPopN]._components = [rf(liqSortPopUT), rf(liqSortPopSpr)];
    sb.e[liqSortPopN]._children = liqSortOptIndices.map(rf);
    sb.e[liqSortPopN]._active = false;

    // Columns popover — 10 toggles from LAYOUT.TokenDuelPanel.templates.columnsToggle.
    // Each shows a ✓ prefix when active (wired at runtime). Footer hint
    // "Max 6 columns" reads from TDE.columnsPopoverHint.
    const CP  = TDE.columnsPopover;
    const CPH = TDE.columnsPopoverHint;
    const CT  = TDT.columnsToggle;
    const colPopN = sb.e.length;
    sb.node('ColumnsPopover', tdN, [], [], v3(CP.x, CP.y, 0));
    const colPopUT = sb.ut(colPopN, CP.w, CP.h);
    const colPopSpr = sb.spr(colPopN, 26, 8, 32);
    const colPopIndices = [];
    for (let k = 0; k < CT.count; k++) {
        const cY = CT.startY - k * CT.rowH;
        const cN = mkBtnXY(sb, `ColToggle_${CT.keys[k]}`, colPopN, `✓  ${CT.labels[k]}`,
            0, cY, CT.w, CT.h, 36, 16, 48);
        colPopIndices.push(cN);
    }
    const colPopHintN = mkLabel(sb, 'ColMaxHintLabel', colPopN, 'Max 6 columns', 10,
        CPH.y, CPH.w, CPH.h, 140, 140, 140);
    sb.e[colPopHintN]._lpos = v3(CPH.x, CPH.y, 0);
    sb.e[colPopN]._components = [rf(colPopUT), rf(colPopSpr)];
    sb.e[colPopN]._children = [...colPopIndices.map(rf), rf(colPopHintN)];
    sb.e[colPopN]._active = false;

    // Column headers row — sticky group, docked to the top of the feed (y=462,
    // h=28). Cols sourced from LAYOUT.TokenDuelPanel.templates.feedColHeader;
    // group position from LAYOUT.TokenDuelPanel.elements.feedColumnHeaders.
    // Polish 2026-04-26: own background sprite (darker chrome tone) so the row
    // reads as part of the list rather than blending into the panel bg.
    // fontSize bumped 11→14 for readability against the new bg.
    const FCH = TDT.feedColHeader;
    const headerGroupN = sb.e.length;
    sb.node('FeedColumnHeaders', tdN, [], [],
        v3(TDE.feedColumnHeaders.x, TDE.feedColumnHeaders.y, 0));
    sb.ut(headerGroupN, TDE.feedColumnHeaders.w, TDE.feedColumnHeaders.h);
    // Background sprite as first child — sits behind the column-name labels.
    // Color picked to clearly contrast both the panel bg and the feed-row bg
    // (14,18,28). At (44,52,76) it reads as a distinct chrome strip, not a
    // gradient blur. Bumped 2026-04-26 from (18,22,34) which was too subtle.
    // 2026-04-26 — recolored to clean near-black for tighter contrast with
    // the column labels (was (44,52,76) panel chrome).
    const headerBgN = sb.e.length;
    sb.node('HeaderBg', headerGroupN, [], [], v3(0, 0, 0));
    sb.ut(headerBgN, TDE.feedColumnHeaders.w, TDE.feedColumnHeaders.h);
    sb.spr(headerBgN, 8, 12, 20);
    const hdrIndices = [headerBgN];
    for (const d of FCH.cols) {
        const hN = mkLabel(sb, `ColHeader_${d.key}`, headerGroupN, d.text, 14, 0, d.w, FCH.h, 184, 184, 184);
        sb.e[hN]._lpos = v3(d.x, 0, 0);
        const hL = sb.e[hN]._components[1].__id__;
        sb.e[hL]._horizontalAlign = d.align;
        sb.e[hL]._spacingX = 1; // letter-spacing
        hdrIndices.push(hN);
    }
    sb.e[headerGroupN]._children = hdrIndices.map(rf);

    // Feed ScrollView + 20 rows. Window pos/size from
    // LAYOUT.TokenDuelPanel.elements.feedScrollView; row internals from
    // LAYOUT.TokenDuelPanel.templates.feedRow.
    const FR = TDT.feedRow;
    const FEED_ROW_LIMIT = FR.count;
    const rowHeight = FR.h;
    const rowStride = -FR.gapY; // gapY is negative (rows stack downward)
    const rowW = FR.w;
    const { root: tdFeedSV, content: tdFeedContent, contentUT: tdFeedContentUT } = mkScrollView(
        sb, 'FeedScrollView', tdN,
        TDE.feedScrollView.x, TDE.feedScrollView.y,
        TDE.feedScrollView.w, TDE.feedScrollView.h,
    );
    // Size content to fit the full 20-row pool so the ScrollView can scroll.
    sb.e[tdFeedContentUT]._contentSize = sz(rowW, FEED_ROW_LIMIT * rowStride);

    // 2026-04-26 — top + bottom teal accent stripes on the FeedScrollView so
    // the token list reads as a defined region (was blending into the panel).
    const tdFeedAccentTop = sb.e.length;
    sb.node('FeedScrollAccentTop', tdN, [], [], v3(
        TDE.feedScrollView.x,
        TDE.feedScrollView.y + TDE.feedScrollView.h / 2 - 1,
        0,
    ));
    const tdFeedAccentTopUT = sb.ut(tdFeedAccentTop, TDE.feedScrollView.w, 3);
    const tdFeedAccentTopSpr = sb.spr(tdFeedAccentTop, 48, 198, 155);
    sb.e[tdFeedAccentTop]._components = [rf(tdFeedAccentTopUT), rf(tdFeedAccentTopSpr)];

    // 2026-04-27: bottom teal stripe removed per user feedback (only top stripe kept).

    // Row internal layout matches FeedColumnHeaders x positions exactly so
    // numeric columns line up under each label. SelectedEdge + Checkbox are
    // hidden by default; toggled at runtime when watchlist-mode is active.
    // Phase 8b: SymbolLabel.w shrunk 160 → 140 so its right edge clears
    // ScoreLabel's left edge (eliminates 20× SymbolLabel↔ScoreLabel overlap).
    const feedRowIndices = [];
    for (let i = 0; i < FEED_ROW_LIMIT; i++) {
        const ry = FR.baseY + i * FR.gapY;
        const rn = sb.e.length;
        sb.node(`FeedRow_${i}`, tdFeedContent, [], [], v3(0, ry, 0));
        const rUT  = sb.ut(rn, rowW, rowHeight);
        const rSpr = sb.spr(rn, 14, 18, 28);
        const rBtn = sb.btn(rn, 14, 18, 28);

        // SelectedEdge — emerald strip on row's left edge (hidden).
        const selEdgeN = sb.e.length;
        sb.node('SelectedEdge', rn, [], [], v3(FR.selectedEdge.x, FR.selectedEdge.y, 0));
        const selEdgeUT = sb.ut(selEdgeN, FR.selectedEdge.w, FR.selectedEdge.h);
        const selEdgeSpr = sb.spr(selEdgeN, 48, 198, 155);
        sb.e[selEdgeN]._components = [rf(selEdgeUT), rf(selEdgeSpr)];
        sb.e[selEdgeN]._active = false;

        // CheckboxSprite — square at far left, ALWAYS visible (2026-04-26).
        // Checked state colored emerald at runtime; black ✓ overlay child.
        // Renders AFTER the logo in the children list so it sits ON TOP of
        // the avatar (was being hidden under the bigger 150×150 logo).
        const chkN = sb.e.length;
        sb.node('CheckboxSprite', rn, [], [], v3(FR.checkbox.x, FR.checkbox.y, 0));
        const chkUT = sb.ut(chkN, FR.checkbox.w, FR.checkbox.h);
        const chkSpr = sb.spr(chkN, 45, 52, 70);
        const chkIconN = sb.e.length;
        sb.node('CheckmarkIcon', chkN, [], [], v3(FR.checkmark.x, FR.checkmark.y, 0));
        const chkIconUT = sb.ut(chkIconN, FR.checkmark.w, FR.checkmark.h);
        const chkIconL  = sb.lbl(chkIconN, '✓', 18, 0, 0, 0);
        sb.e[chkIconL]._isBold = true;
        sb.e[chkIconN]._components = [rf(chkIconUT), rf(chkIconL)];
        sb.e[chkIconN]._active = false;
        sb.e[chkN]._components = [rf(chkUT), rf(chkSpr)];
        sb.e[chkN]._children = [rf(chkIconN)];
        // chkN stays active=true so the checkbox is visible on every row.

        // Logo — round 28×28 at left. AppUI nudges right 20px in watchlist mode.
        const logoN = sb.e.length;
        sb.node('LogoSprite', rn, [], [], v3(FR.logo.x, FR.logo.y, 0));
        const logoUT = sb.ut(logoN, FR.logo.w, FR.logo.h);
        const logoSpr = sb.spr(logoN, 255, 255, 255);
        sb.e[logoN]._components = [rf(logoUT), rf(logoSpr)];

        // SymbolLabel — top line, bold, left-aligned. fontSize 18→22 in card redesign.
        const symN = sb.e.length;
        sb.node('SymbolLabel', rn, [], [], v3(FR.symbol.x, FR.symbol.y, 0));
        const symUT = sb.ut(symN, FR.symbol.w, FR.symbol.h);
        const symL  = sb.lbl(symN, '—', 22, 255, 255, 255);
        sb.e[symL]._horizontalAlign = 0;
        sb.e[symL]._isBold = true;
        sb.e[symN]._components = [rf(symUT), rf(symL)];

        // NameLabel — bottom line, muted. fontSize 11→14 for legibility.
        const nameN = sb.e.length;
        sb.node('NameLabel', rn, [], [], v3(FR.name.x, FR.name.y, 0));
        const nameUT = sb.ut(nameN, FR.name.w, FR.name.h);
        const nameL  = sb.lbl(nameN, '', 14, 184, 184, 184);
        sb.e[nameL]._horizontalAlign = 0;
        sb.e[nameN]._components = [rf(nameUT), rf(nameL)];

        // ScoreBadgeBg — small gold pill behind ScoreLabel. Renders BEFORE
        // ScoreLabel in the row's children list so it sits behind.
        const scoreBgN = sb.e.length;
        sb.node('ScoreBadgeBg', rn, [], [], v3(FR.score.x, FR.score.y, 0));
        const scoreBgUT = sb.ut(scoreBgN, FR.score.w, FR.score.h);
        const scoreBgSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(scoreBgN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(255, 210, 74, 60),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[scoreBgN]._components = [rf(scoreBgUT), rf(scoreBgSpr)];

        // ScoreLabel — small gold chip (subordinate to 24H hero). 18→14pt.
        const scoreN = sb.e.length;
        sb.node('ScoreLabel', rn, [], [], v3(FR.score.x, FR.score.y, 0));
        const scoreUT = sb.ut(scoreN, FR.score.w, FR.score.h);
        const scoreL  = sb.lbl(scoreN, '—', 14, 255, 210, 74);
        sb.e[scoreL]._isBold = true;
        sb.e[scoreN]._components = [rf(scoreUT), rf(scoreL)];

        // LiqLabel — small mono, aligned under ColHeader_Liq.
        const liqN = sb.e.length;
        sb.node('LiqLabel', rn, [], [], v3(FR.liq.x, FR.liq.y, 0));
        const liqUT = sb.ut(liqN, FR.liq.w, FR.liq.h);
        const liqL  = sb.lbl(liqN, '—', 14, 168, 230, 200);
        sb.e[liqN]._components = [rf(liqUT), rf(liqL)];

        // VolLabel — small mono.
        const volN = sb.e.length;
        sb.node('VolLabel', rn, [], [], v3(FR.vol.x, FR.vol.y, 0));
        const volUT = sb.ut(volN, FR.vol.w, FR.vol.h);
        const volL  = sb.lbl(volN, '—', 14, 200, 200, 200);
        sb.e[volN]._components = [rf(volUT), rf(volL)];

        // ChangeLabel — HERO 24H% (visual focus). 2026-04-29 god-tier UX
        // pass: 26→30pt right-aligned, color set per sign by AppUI.
        const changeN = sb.e.length;
        sb.node('ChangeLabel', rn, [], [], v3(FR.change.x, FR.change.y, 0));
        const changeUT = sb.ut(changeN, FR.change.w, FR.change.h);
        const changeL  = sb.lbl(changeN, '', 30, 200, 200, 200);
        sb.e[changeL]._isBold = true;
        sb.e[changeL]._horizontalAlign = 2;
        sb.e[changeN]._components = [rf(changeUT), rf(changeL)];

        // DeltaLabel — alternate of ChangeLabel; hidden by default.
        const deltaN = sb.e.length;
        sb.node('DeltaLabel', rn, [], [], v3(FR.delta.x, FR.delta.y, 0));
        const deltaUT = sb.ut(deltaN, FR.delta.w, FR.delta.h);
        const deltaL  = sb.lbl(deltaN, '', 30, 200, 200, 200);
        sb.e[deltaL]._isBold = true;
        sb.e[deltaL]._horizontalAlign = 2;
        sb.e[deltaN]._components = [rf(deltaUT), rf(deltaL)];
        sb.e[deltaN]._active = false;

        // PriceLabel — gold mono, right-aligned. Subordinate to 24H hero (14pt).
        const priceN = sb.e.length;
        sb.node('PriceLabel', rn, [], [], v3(FR.price.x, FR.price.y, 0));
        const priceUT = sb.ut(priceN, FR.price.w, FR.price.h);
        const priceL  = sb.lbl(priceN, '', 14, 255, 210, 74);
        sb.e[priceL]._horizontalAlign = 2;
        style(sb, priceN, { mono: true });
        sb.e[priceN]._components = [rf(priceUT), rf(priceL)];

        // AgeLabel — top line, far right. Aligned under ColHeader_Age.
        const ageN = sb.e.length;
        sb.node('AgeLabel', rn, [], [], v3(FR.age.x, FR.age.y, 0));
        const ageUT = sb.ut(ageN, FR.age.w, FR.age.h);
        const ageL  = sb.lbl(ageN, '—', 12, 140, 200, 150);
        sb.e[ageN]._components = [rf(ageUT), rf(ageL)];

        // DexLabel — bottom line, muted.
        const dexN = sb.e.length;
        sb.node('DexLabel', rn, [], [], v3(FR.dex.x, FR.dex.y, 0));
        const dexUT = sb.ut(dexN, FR.dex.w, FR.dex.h);
        const dexL  = sb.lbl(dexN, '', 11, 140, 140, 155);
        sb.e[dexN]._components = [rf(dexUT), rf(dexL)];

        // LiveDot — right of AgeLabel (bottom line); hidden by default.
        const liveN = sb.e.length;
        sb.node('LiveDot', rn, [], [], v3(FR.liveDot.x, FR.liveDot.y, 0));
        const liveUT = sb.ut(liveN, FR.liveDot.w, FR.liveDot.h);
        const liveSpr = sb.spr(liveN, 90, 200, 120);
        sb.e[liveN]._components = [rf(liveUT), rf(liveSpr)];
        sb.e[liveN]._active = false;

        // 2026-05-02 token-picker UX — "IN SQUAD" badge. Pill sprite + label
        // sit inline with $SYMBOL on the top row. AppUI toggles _active when
        // the row's mint matches a squad slot, so a glance scans which feed
        // rows are already drafted.
        const sqBadgeN = sb.e.length;
        sb.node('SquadBadge', rn, [], [], v3(FR.squadBadge.x, FR.squadBadge.y, 0));
        const sqBadgeUT = sb.ut(sqBadgeN, FR.squadBadge.w, FR.squadBadge.h);
        const sqBadgeSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(sqBadgeN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(20, 241, 149, 60),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        const sqBadgeLblN = mkLabel(sb, 'SquadBadgeLabel', sqBadgeN, 'IN SQUAD', 11, 0,
            FR.squadBadge.w, FR.squadBadge.h, 20, 241, 149);
        sb.e[sqBadgeLblN]._lpos = v3(0, 0, 0);
        sb.e[sb.e[sqBadgeLblN]._components[1].__id__]._horizontalAlign = 1;
        sb.e[sb.e[sqBadgeLblN]._components[1].__id__]._isBold = true;
        sb.e[sb.e[sqBadgeLblN]._components[1].__id__]._spacingX = 1;
        sb.e[sqBadgeN]._components = [rf(sqBadgeUT), rf(sqBadgeSpr)];
        sb.e[sqBadgeN]._children = [rf(sqBadgeLblN)];
        sb.e[sqBadgeN]._active = false;

        // Phase 17 (item 2): tap-down glow halo — teal flash on TOUCH_START.
        // Initial alpha 0; AppUI._initFeedRowTactile activates + tweens.
        // Sized 1.04× row (688×74). Named BtnGlow_FeedRow_<i> so verifier's
        // BtnGlow_* skip rule (Phase 13) handles the bbox overlap with siblings.
        const glowN = sb.e.length;
        sb.node(`BtnGlow_FeedRow_${i}`, rn, [], [], v3(0, 0, 0));
        const glowUT = sb.ut(glowN, rowW + 28, rowHeight + 8);
        const glowSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(glowN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(48, 198, 155, 0),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[glowN]._components = [rf(glowUT), rf(glowSpr)];
        sb.e[glowN]._active = false;

        sb.e[rn]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
        sb.e[rn]._children = [
            rf(glowN),  // tap-down flash, behind row content
            rf(selEdgeN),
            rf(logoN),
            // chkN renders AFTER logoN so the always-visible checkbox sits
            // on top of the 150×150 avatar (was being clipped underneath).
            rf(chkN),
            rf(symN), rf(nameN),
            rf(scoreBgN), rf(scoreN), rf(liqN), rf(volN), rf(changeN), rf(deltaN),
            rf(priceN), rf(ageN), rf(dexN), rf(liveN),
            rf(sqBadgeN),
        ];
        // Age + Dex hidden in card view (template positions are off-screen).
        sb.e[ageN]._active = false;
        sb.e[dexN]._active = false;
        sb.e[rn]._active = false;
        feedRowIndices.push(rn);
    }
    // sb.node(name, parent, ...) only writes _parent on the child; the
    // back-reference on the parent has to be written explicitly or
    // getChildByName('FeedRow_N') walks an empty list.
    sb.e[tdFeedContent]._children = feedRowIndices.map(rf);

    // 2026-05-01 squad-select pass — soft violet+teal ambient halo behind
    // the 3 slot pillars. Single static sprite (no Graphics — keeps Cocos
    // 3.8 SIGSEGV risk at zero per memory:feedback_cocos_graphics_rules).
    // Inserted into the panel children list BEFORE SquadPanel so it sits
    // beneath the panel bg + slot cards.
    const SAG = TDE.squadAmbientGlow;
    const squadAmbientGlowN = sb.e.length;
    sb.node('SquadAmbientGlow', tdN, [], [], v3(SAG.x, SAG.y, 0));
    const sagUT = sb.ut(squadAmbientGlowN, SAG.w, SAG.h);
    const sagSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(squadAmbientGlowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        // 50/50 violet+teal blend at low alpha (0x28 = 40).
        _color: cl(86, 155, 122, 40),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[squadAmbientGlowN]._components = [rf(sagUT), rf(sagSpr)];

    // ── 2026-04-26 redesign — Sticky Squad Panel wrapper ───────────────
    // Visual card bg behind the squad header, 3 slots, wager row, and ghost
    // links. Card sprite + teal accent edge. Rendered BEFORE squad/wager
    // nodes in the children list so it sits behind them.
    const SQP = TDE.squadPanel;
    const squadPanelN = sb.e.length;
    sb.node('SquadPanel', tdN, [], [], v3(SQP.x, SQP.y, 0));
    const sqpUT = sb.ut(squadPanelN, SQP.w, SQP.h);
    const sqpSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(squadPanelN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(26, 8, 32, 240),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // 2026-04-27: top cyan accent edge removed per user feedback.
    sb.e[squadPanelN]._components = [rf(sqpUT), rf(sqpSpr)];
    sb.e[squadPanelN]._children = [];

    // Lone secondary action — Manage Squad ▸. The +Pick button was removed:
    // tapping a row already adds it via _onFeedRowClick, so a separate Pick
    // button competed with the WagerStartButton primary CTA.
    const SAB = TDT.squadActionBtn;
    const tdSquadActionBtns = [];
    for (let i = 0; i < SAB.count; i++) {
        const [r, g, b] = SAB.colors[i];
        const bN = mkBtnXY(sb, SAB.names[i], tdN, SAB.labels[i],
                           SAB.xs[i], SAB.y, SAB.w, SAB.h, r, g, b);
        if (SAB.bold[i]) style(sb, bN, { bold: true });
        tdSquadActionBtns.push(bN);
    }
    // 2026-04-26 — global Pick / Manage Squad removed (count: 0).
    // Safe-guard the destructure so [null, null] flows through the children
    // list without breaking. The rf() entries are stripped below.
    const [tdSquadDrop = null, tdSquadPick = null] = tdSquadActionBtns;

    // Squad header band — eyebrow + label + hairline rule. 2026-04-29b
    // flagship rebalance: this is the page's main objective marker, so the
    // band is hero-weight (bigger label, bold, white) with a small uppercase
    // eyebrow above and a thin teal hairline below to signal "this is where
    // the action lives." Each slot is a composite from mkSquadSlot().
    // 2026-05-01 r2 — eyebrow font 11→16 (h 14→22), label font 22→30 (h 28→38).
    // Hero-weight YOUR SQUAD reads as the page's primary objective marker.
    const tdSquadEyebrow = mkLabel(sb, 'SquadHeaderEyebrow', tdN, 'BUILD YOUR LINEUP', 16,
        TDE.squadHeaderEyebrow.y, TDE.squadHeaderEyebrow.w, TDE.squadHeaderEyebrow.h, 130, 138, 168);
    style(sb, tdSquadEyebrow, { bold: true, spacing: 2 });
    const tdSquadHeader = mkLabel(sb, 'SquadHeaderLabel', tdN, 'YOUR SQUAD', 30,
        TDE.squadHeaderLabel.y, TDE.squadHeaderLabel.w, TDE.squadHeaderLabel.h, 255, 255, 255);
    style(sb, tdSquadHeader, { bold: true, spacing: 3 });
    // Thin teal hairline directly under the label — alpha 80, 240w.
    const tdSquadRule = sb.e.length;
    sb.node('SquadHeaderRule', tdN, [], [], v3(TDE.squadHeaderRule.x, TDE.squadHeaderRule.y, 0));
    const tdSquadRuleUT = sb.ut(tdSquadRule, TDE.squadHeaderRule.w, TDE.squadHeaderRule.h);
    const tdSquadRuleSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdSquadRule), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 80),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdSquadRule]._components = [rf(tdSquadRuleUT), rf(tdSquadRuleSpr)];

    // 2026-04-30 — flanking hairlines on left/right of the eyebrow text so
    // "BUILD YOUR LINEUP" reads as a framed section header (premium feel)
    // instead of a floating caption. Low-alpha white at 50/255 (~20%).
    const tdSquadEyebrowRuleL = sb.e.length;
    sb.node('SquadEyebrowRuleLeft', tdN, [], [], v3(-150, TDE.squadHeaderEyebrow.y, 0));
    const tdSquadEyebrowRuleLUT = sb.ut(tdSquadEyebrowRuleL, 70, 1);
    const tdSquadEyebrowRuleLSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdSquadEyebrowRuleL), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 50),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdSquadEyebrowRuleL]._components = [rf(tdSquadEyebrowRuleLUT), rf(tdSquadEyebrowRuleLSpr)];
    const tdSquadEyebrowRuleR = sb.e.length;
    sb.node('SquadEyebrowRuleRight', tdN, [], [], v3(150, TDE.squadHeaderEyebrow.y, 0));
    const tdSquadEyebrowRuleRUT = sb.ut(tdSquadEyebrowRuleR, 70, 1);
    const tdSquadEyebrowRuleRSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdSquadEyebrowRuleR), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 50),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdSquadEyebrowRuleR]._components = [rf(tdSquadEyebrowRuleRUT), rf(tdSquadEyebrowRuleRSpr)];

    // 2026-04-27 UI overhaul — pillar squad cards.
    // Each card: stacked-sprite gradient bg + faint border + LogoSprite top-left
    // + SymbolLabel right of logo + hero DeltaLabel centered + ScoreBadge
    // bottom-left + thin PerformanceBar at bottom + RemoveButton top-right.
    // AppUI tints PerformanceBar by sign and the cardEdge by active/filled
    // state at runtime.
    const SS = TDT.squadSlot;
    function mkSquadSlot(slotIdx) {
        const x = SS.xs[slotIdx];
        // Root button node — receives taps for empty-slot pick targeting.
        const bn = sb.e.length;
        sb.node(`SquadSlot_${slotIdx}`, tdN, [], [], v3(x, SS.y, 0));
        const bnUT = sb.ut(bn, SS.w, SS.h);
        // Background: bottom half of the simulated gradient (darker).
        const bnSpr = sb.spr(bn, 16, 4, 24); // bg.primary-ish
        const bnBtn = sb.btn(bn, 50, 20, 72);
        sb.e[bnBtn]._normalColor   = cl(16, 4, 24, 240);
        sb.e[bnBtn]._hoverColor    = cl(26, 8, 32, 240);
        sb.e[bnBtn]._pressedColor  = cl(60, 28, 88, 240);
        sb.e[bnBtn]._disabledColor = cl(16, 4, 24, 200);

        // 2026-05-01 squad-select pass — per-slot glow halo (sits BEHIND
        // every other child). AppUI tints this teal when filled, violet on
        // hover, alpha 0 when empty/idle.
        const haloN = sb.e.length;
        sb.node('SlotGlowHalo', bn, [], [], v3(SS.glowHalo.x, SS.glowHalo.y, 0));
        const haloUT = sb.ut(haloN, SS.glowHalo.w, SS.glowHalo.h);
        const haloSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(haloN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(20, 241, 149, 0),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[haloN]._components = [rf(haloUT), rf(haloSpr)];

        // Top-half gradient overlay sprite — child, drawn over bg.
        const gradN = sb.e.length;
        sb.node('GradientTop', bn, [], [], v3(0, SS.h / 4, 0));
        const gradUT = sb.ut(gradN, SS.w, SS.h / 2);
        const gradSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(gradN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(26, 8, 32, 200),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[gradN]._components = [rf(gradUT), rf(gradSpr)];

        // Back-compat: hidden Label node so legacy AppUI lookups for the slot
        // primary label still resolve. Active=false so it's invisible.
        const ln = sb.e.length;
        sb.node('Label', bn, [], [], v3(0, 0, 0));
        const lnUT = sb.ut(ln, SS.w, SS.h);
        const lnL = sb.lbl(ln, '', 1, 0, 0, 0, 0);
        sb.e[ln]._components = [rf(lnUT), rf(lnL)];
        sb.e[ln]._active = false;

        // 2026-04-28 fighter-card redesign — faint "+" silhouette behind the
        // "Pick +" text on empty slots so the drop zone reads as intentional.
        // 2026-04-29b flagship rebalance — silhouette 90→110, font 84→100,
        // alpha 64→88 so empty slots feel like fighter-ready slots.
        const silN = sb.e.length;
        sb.node('SilhouettePlus', bn, [], [], v3(SS.silhouette.x, SS.silhouette.y, 0));
        const silUT = sb.ut(silN, SS.silhouette.w, SS.silhouette.h);
        const silL = sb.lbl(silN, '+', 100, 140, 140, 140);
        sb.e[silL]._color = cl(140, 140, 140, 88);
        sb.e[silL]._horizontalAlign = 1; // center
        sb.e[silL]._verticalAlign = 1;   // middle
        sb.e[silL]._isBold = true;
        sb.e[silN]._components = [rf(silUT), rf(silL)];

        // Logo top-left.
        const logoN = sb.e.length;
        sb.node('LogoSprite', bn, [], [], v3(SS.logo.x, SS.logo.y, 0));
        const logoUT = sb.ut(logoN, SS.logo.w, SS.logo.h);
        const logoSpr = sb.spr(logoN, 255, 255, 255);
        sb.e[logoN]._components = [rf(logoUT), rf(logoSpr)];
        sb.e[logoN]._active = false; // hidden until slot filled

        // Symbol label — right of logo when filled, centered "Pick +" when empty.
        const symN = sb.e.length;
        sb.node('SymbolLabel', bn, [], [], v3(SS.symbol.x, SS.symbol.y, 0));
        const symUT = sb.ut(symN, SS.symbol.w, SS.symbol.h);
        const symL = sb.lbl(symN, 'Pick +', 24, 168, 230, 200);
        sb.e[symL]._isBold = true;
        sb.e[symL]._horizontalAlign = 0; // left-align for filled state (right of logo)
        sb.e[symN]._components = [rf(symUT), rf(symL)];

        // 2026-04-28 fighter-card redesign — small "Slot N" label at top of
        // empty cards. AppUI populates text + toggles _active by fill state.
        const idxN = sb.e.length;
        sb.node('SlotIndexLabel', bn, [], [], v3(SS.slotIndex.x, SS.slotIndex.y, 0));
        const idxUT = sb.ut(idxN, SS.slotIndex.w, SS.slotIndex.h);
        const idxL = sb.lbl(idxN, `Slot ${slotIdx + 1}`, 13, 130, 138, 168);
        sb.e[idxL]._horizontalAlign = 1; // center
        sb.e[idxL]._isBold = true;
        sb.e[idxN]._components = [rf(idxUT), rf(idxL)];

        // Hero Δ% label — centered, prominent.
        const dltN = sb.e.length;
        sb.node('DeltaLabel', bn, [], [], v3(SS.delta.x, SS.delta.y, 0));
        const dltUT = sb.ut(dltN, SS.delta.w, SS.delta.h);
        const dltL = sb.lbl(dltN, '', 28, 184, 184, 184);
        sb.e[dltL]._horizontalAlign = 1; // center
        sb.e[dltL]._isBold = true;
        sb.e[dltN]._components = [rf(dltUT), rf(dltL)];
        sb.e[dltN]._active = false; // hidden until slot filled

        // Score / rank badge — bottom-left.
        const scoN = sb.e.length;
        sb.node('ScoreBadge', bn, [], [], v3(SS.score.x, SS.score.y, 0));
        const scoUT = sb.ut(scoN, SS.score.w, SS.score.h);
        const scoL = sb.lbl(scoN, '', 14, 184, 184, 184);
        sb.e[scoL]._horizontalAlign = 0;
        sb.e[scoN]._components = [rf(scoUT), rf(scoL)];
        sb.e[scoN]._active = false; // populated by AppUI

        // Performance bar — thin glowing line at bottom edge.
        const perfN = sb.e.length;
        sb.node('PerformanceBar', bn, [], [], v3(SS.perfBar.x, SS.perfBar.y, 0));
        const perfUT = sb.ut(perfN, SS.perfBar.w, SS.perfBar.h);
        const perfSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(perfN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            // muted slate by default; AppUI tints teal/rose by sign of 24h%.
            _color: cl(140, 140, 140, 120),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[perfN]._components = [rf(perfUT), rf(perfSpr)];

        // RemoveButton — × at top-right. 2026-04-30 — bumped hit area 26→28
        // and × glyph 20→24pt with brighter (244,245,249) so the remove
        // affordance reads as intentional rather than incidental decoration.
        const rmN = sb.e.length;
        sb.node('RemoveButton', bn, [], [], v3(SS.w / 2 - 18, SS.h / 2 - 18, 0));
        const rmUT = sb.ut(rmN, 28, 28);
        const rmSpr = sb.spr(rmN, 60, 30, 36);
        const rmBtn = sb.btn(rmN, 60, 30, 36);
        const rmLblN = sb.e.length;
        sb.node('Label', rmN, [], [], v3(0, 0, 0));
        const rmLblUT = sb.ut(rmLblN, 28, 28);
        const rmLblL = sb.lbl(rmLblN, '×', 24, 255, 255, 255);
        sb.e[rmLblL]._isBold = true;
        sb.e[rmLblN]._components = [rf(rmLblUT), rf(rmLblL)];
        sb.e[rmN]._components = [rf(rmUT), rf(rmSpr), rf(rmBtn)];
        sb.e[rmN]._children = [rf(rmLblN)];
        sb.e[rmN]._active = false; // shown by AppUI when slot fills

        // Card top-edge accent — 2026-04-28 fighter-card redesign: idle alpha
        // bumped 40 → 80 so empty cards' borders read as intentional, not weak.
        // AppUI swaps the strip to violet (target) / teal (positive) / rose
        // (negative) at runtime via _squadSlotEdges[i].
        const edgeN = mkCardEdge(sb, bn, SS.w, SS.h, 255, 255, 255, 80);

        sb.e[bn]._components = [rf(bnUT), rf(bnSpr), rf(bnBtn)];
        // Render order (back→front): glow halo, bg gradient, hidden compat
        // label, faint silhouette, logo, symbol, hero delta, score, perf bar,
        // slot index label, top-edge accent, remove button (×).
        sb.e[bn]._children = [rf(haloN), rf(gradN), rf(ln), rf(silN), rf(logoN), rf(symN), rf(dltN), rf(scoN), rf(perfN), rf(idxN), rf(edgeN), rf(rmN)];
        return bn;
    }
    const tdSquad0 = mkSquadSlot(0);
    const tdSquad1 = mkSquadSlot(1);
    const tdSquad2 = mkSquadSlot(2);
    // Slots stay visible at scene-gen so empty "+" placeholders read as
    // intentional drop zones (was: hidden until filled).

    // Legacy stake cluster — solo commit→start→claim flow is dead on the
    // betting-duel branch. Nodes preserved for back-compat (AppUI's
    // _setStakeClusterVisible / _hideLegacyBettingDuelNodes still target them
    // by name) but force `_active = false` at scene-gen so the verifier sees
    // the truthful state. Positions sourced from LAYOUT for completeness.
    const tdStakeHeader = mkLabel(sb, 'StakeHeaderLabel', tdN, 'STAKE AMOUNT', 11,
        TDE.stakeHeaderLabel.y, TDE.stakeHeaderLabel.w, TDE.stakeHeaderLabel.h, 140, 140, 140);
    sb.e[sb.e[tdStakeHeader]._components[1].__id__]._spacingX = 1;
    sb.e[tdStakeHeader]._active = false;

    const tdStakeValueLabel = mkLabel(sb, 'StakeValueLabel', tdN, '0.010 SOL', 20,
        TDE.stakeValueLabel.y, TDE.stakeValueLabel.w, TDE.stakeValueLabel.h, 255, 210, 74);
    style(sb, tdStakeValueLabel, { mono: true, bold: true });  // Phase 15 (B5): hero numeric
    sb.e[tdStakeValueLabel]._active = false;

    const tdStakeSlider = mkSlider(sb, 'StakeSlider', tdN, TDE.stakeSlider.x, TDE.stakeSlider.y,
        TDE.stakeSlider.w, TDE.stakeSlider.h, 0.1);
    sb.e[tdStakeSlider]._active = false;

    const SCH = TDT.stakeChip;
    const tdStakeChips = [];
    for (let i = 0; i < SCH.count; i++) {
        const cN = mkBtnXY(sb, SCH.names[i], tdN, SCH.labels[i],
                           SCH.xs[i], SCH.y, SCH.w, SCH.h, 36, 16, 48);
        sb.e[cN]._active = false;
        tdStakeChips.push(cN);
    }
    const [tdStake001, tdStake010, tdStake100] = tdStakeChips;

    const tdCommit = mkBtn(sb, 'StakeCommitButton', tdN, 'Stake + Commit',
        TDE.stakeCommitButton.y, TDE.stakeCommitButton.w, TDE.stakeCommitButton.h, 56, 148, 252,
        { tier: 'secondary' });
    style(sb, tdCommit, { bold: true });
    sb.e[tdCommit]._active = false;

    const tdStartGame = mkBtn(sb, 'StartGameButton', tdN, 'Start Game',
        TDE.startGameButton.y, TDE.startGameButton.w, TDE.startGameButton.h, 255, 210, 74,
        { tier: 'secondary' });
    style(sb, tdStartGame, { bold: true });
    sb.e[tdStartGame]._active = false;

    const tdClaim = mkBtn(sb, 'ClaimPayoutButton', tdN, 'Claim Payout',
        TDE.claimPayoutButton.y, TDE.claimPayoutButton.w, TDE.claimPayoutButton.h, 150, 85, 210,
        { tier: 'secondary' });
    style(sb, tdClaim, { bold: true });
    sb.e[tdClaim]._active = false;

    // 2026-04-29b — thin hairline divider above the wager row, visually
    // grouping stake selector + CTA into a "lock in" commitment cluster
    // distinct from the squad cards above. Alpha 40 dim slate.
    const tdWagerDivider = sb.e.length;
    sb.node('WagerRowDivider', tdN, [], [], v3(TDE.wagerRowDivider.x, TDE.wagerRowDivider.y, 0));
    const tdWagerDividerUT = sb.ut(tdWagerDivider, TDE.wagerRowDivider.w, TDE.wagerRowDivider.h);
    const tdWagerDividerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdWagerDivider), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(184, 184, 184, 40),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdWagerDivider]._components = [rf(tdWagerDividerUT), rf(tdWagerDividerSpr)];

    // Wager row — live betting-duel CTA. Two buttons (tier selector left,
    // start match right) + tiny hint label below. Positions from
    // LAYOUT.TokenDuelPanel.elements.{wagerValueButton,wagerStartButton,wagerHintLabel}.
    // 2026-05-01 r3 — STAKE pill: half-width chunky CENTERED control
    // below the CTA. Single-line "0.05 SOL  ▾" at 32pt gold bold reads
    // big and obvious as a tap target. Helper text gets its OWN row
    // below this pill (no more side-by-side overlap).
    const tdWagerValueBtn = mkBtnXY(sb, 'WagerValueButton', tdN, '0.05 SOL  ▾',
        TDE.wagerValueButton.x, TDE.wagerValueButton.y,
        TDE.wagerValueButton.w, TDE.wagerValueButton.h, 44, 24, 64);
    // 2026-05-02 Pass 2 — value label drops from button-local center y=0 to
    // y=-14 (lower half of new 72h pill) so the WAGER caption can sit above it.
    style(sb, tdWagerValueBtn, { bold: true, fontSize: 22, color: cl(255, 210, 74, 255), spacing: 1 });
    sb.e[tdWagerValueBtn + 1]._lpos = v3(0, -14, 0); // existing 'Label' child
    // WagerCaptionLabel — 10pt micro caps "WAGER" gold-dim, sits above value.
    const tdWagerCaption = mkLabel(sb, 'WagerCaptionLabel', tdWagerValueBtn, 'WAGER', 10, 18,
        120, 14, 255, 210, 74);
    sb.e[tdWagerCaption]._lpos = v3(0, 18, 0);
    sb.e[sb.e[tdWagerCaption]._components[1].__id__]._isBold = true;
    sb.e[sb.e[tdWagerCaption]._components[1].__id__]._spacingX = 2;
    sb.e[sb.e[tdWagerCaption]._components[1].__id__]._color = cl(255, 210, 74, 180);
    // 2026-05-01 r3 — top-edge accent stripe for "decisive primary" read.
    const tdWagerValueEdge = mkCardEdge(sb, tdWagerValueBtn, TDE.wagerValueButton.w, TDE.wagerValueButton.h, 255, 210, 74, 200);
    // 2026-04-30 — clone Home FindMatch styling exactly: teal base + tier=primary
    // (glow alpha 110, pad 16, idle pulse + ripple), 32 pt label, shimmer sweep.
    // Only the size differs (640×64 vs FindMatch 680×136) to fit picker layout.
    const { glow: tdWagerStartGlow, btn: tdWagerStartBtn } = mkBtnHero(sb,
        'WagerStartButton', tdN, '▶ Start Match',
        TDE.wagerStartButton.x, TDE.wagerStartButton.y,
        TDE.wagerStartButton.w, TDE.wagerStartButton.h,
        20, 241, 149,                          // teal — Palette.accent.teal #14F195
        { tier: 'primary' });
    style(sb, tdWagerStartBtn, { bold: true, fontSize: 32 });

    // Shimmer_WagerStartButton — naming convention picked up by
    // ButtonFX.addShimmerSweep (looks for `Shimmer_${node.name}` child).
    // 90×h white@80 band, parked off-screen (_active=false) until AppUI
    // calls addShimmerSweep(wagerStartBtn) — same lifecycle as FindMatch.
    const tdWagerShimmerN = sb.e.length;
    sb.node('Shimmer_WagerStartButton', tdWagerStartBtn, [], [], v3(0, 0, 0));
    const tdWagerShimmerUT = sb.ut(tdWagerShimmerN, 90, TDE.wagerStartButton.h);
    const tdWagerShimmerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdWagerShimmerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 80),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdWagerShimmerN]._components = [rf(tdWagerShimmerUT), rf(tdWagerShimmerSpr)];
    sb.e[tdWagerShimmerN]._active = false;
    sb.e[tdWagerStartBtn]._children = [...(sb.e[tdWagerStartBtn]._children ?? []), rf(tdWagerShimmerN)];
    // 2026-04-30 token-picker polish — restored as the under-CTA helper caption.
    // Sits at y=-528 (per LayoutSpec), 16pt, muted text.lo (#5D6485). The user-
    // facing "Pick your final token to lock in your squad" copy lives here;
    // _refreshWagerControlRow updates per mode (create / bot / join / resume).
    const tdWagerHint = mkLabel(sb, 'WagerHintLabel', tdN, '', 18,
        TDE.wagerHintLabel.y, TDE.wagerHintLabel.w, TDE.wagerHintLabel.h, 184, 184, 184);
    // 2026-04-30 v2 — hint shifted right of the new under-CTA chip; explicit x so it stops centering.
    sb.e[tdWagerHint]._lpos = v3(TDE.wagerHintLabel.x, TDE.wagerHintLabel.y, 0);
    sb.e[sb.e[tdWagerHint]._components[1].__id__]._spacingX = 1;

    // ── WagerLockChip — JOIN-MODE only ─────────────────────────────────
    // Replaces WagerValueButton when AppUI._pickerJoinTarget is set (user
    // tapped a match in FindMatchPanel + confirmed). Same x/y/w/h as the
    // wager-value button so layout doesn't shift; appears as a locked-style
    // chip with "🔒 0.05 SOL · joining 5Ksq…sDst". _active=false by default;
    // AppUI._refreshWagerControlRow toggles based on _isJoinMode().
    const tdWagerLockChip = sb.e.length;
    sb.node('WagerLockChip', tdN, [], [], v3(TDE.wagerLockChip.x, TDE.wagerLockChip.y, 0));
    const tdWagerLockUT = sb.ut(tdWagerLockChip, TDE.wagerLockChip.w, TDE.wagerLockChip.h);
    const tdWagerLockSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdWagerLockChip), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(36, 30, 56, 240), // muted violet — feels "locked"
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const tdWagerLockLabel = mkLabel(sb, 'WagerLockChipLabel', tdWagerLockChip, '🔒 0.05 SOL', 16, 0,
        TDE.wagerLockChip.w - 24, TDE.wagerLockChip.h - 12, 255, 210, 74);
    sb.e[sb.e[tdWagerLockLabel]._components[1].__id__]._isBold = true;
    sb.e[tdWagerLockChip]._components = [rf(tdWagerLockUT), rf(tdWagerLockSpr)];
    sb.e[tdWagerLockChip]._children = [rf(tdWagerLockLabel)];
    sb.e[tdWagerLockChip]._active = false;

    // ── WagerBotChip — BOT-MODE only ───────────────────────────────────
    // Stage 1: replaces WagerValueButton when AppUI._pickerBotMode is true
    // (user tapped Home Bot Match). Same x/y/w/h as wager-value button so
    // layout doesn't shift; appears as a rose chip "🤖 FREE · Bot Match".
    // _active=false by default; AppUI._refreshWagerControlRow toggles.
    const tdWagerBotChip = sb.e.length;
    sb.node('WagerBotChip', tdN, [], [], v3(TDE.wagerBotChip.x, TDE.wagerBotChip.y, 0));
    const tdWagerBotUT = sb.ut(tdWagerBotChip, TDE.wagerBotChip.w, TDE.wagerBotChip.h);
    const tdWagerBotSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdWagerBotChip), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(76, 38, 56, 240), // muted rose — paper / training feel
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // 2026-04-30 v2 — chip shrunk 200→120 wide; shorter copy "🤖 BOT" fits the smaller square.
    const tdWagerBotLabel = mkLabel(sb, 'WagerBotChipLabel', tdWagerBotChip, '🤖 BOT', 16, 0,
        TDE.wagerBotChip.w - 24, TDE.wagerBotChip.h - 12, 255, 92, 138);
    sb.e[sb.e[tdWagerBotLabel]._components[1].__id__]._isBold = true;
    sb.e[tdWagerBotChip]._components = [rf(tdWagerBotUT), rf(tdWagerBotSpr)];
    sb.e[tdWagerBotChip]._children = [rf(tdWagerBotLabel)];
    sb.e[tdWagerBotChip]._active = false;

    // WagerDropdown — 8 tier rows, opens upward from WagerValueButton.
    // Anchor (0.5, 0) bottom-center so _lpos.y is the dropdown's bottom edge,
    // positioned just above WagerValueButton's top. Hidden by default.
    // AppUI._onWagerRowTap maps display row → on-chain tier via
    // WAGER_DISPLAY_TO_TIER in ModeDefs.ts ([0,1,2,3,4,6,7,5]).
    const WDR = TDT.wagerDropdownRow;
    const tdWagerDropdown = sb.e.length;
    const dropdownH = WDR.count * WDR.rowH + WDR.padding * 2;
    sb.node('WagerDropdown', tdN, [], [], v3(TDE.wagerDropdown.x, TDE.wagerDropdown.y, 0));
    const dropdownUT = sb.ut(tdWagerDropdown, TDE.wagerDropdown.w, dropdownH);
    sb.e[dropdownUT]._anchorPoint = v2(0.5, 0);
    const dropdownSpr = sb.spr(tdWagerDropdown, 18, 22, 32);
    sb.e[tdWagerDropdown]._components = [rf(dropdownUT), rf(dropdownSpr)];
    sb.e[tdWagerDropdown]._active = false;

    const wagerDropdownRows = [];
    for (let i = 0; i < WDR.count; i++) {
        const rowLocalY = dropdownH - WDR.padding - (i + 0.5) * WDR.rowH;
        const rowN = mkBtnXY(sb, `WagerDropdownRow_${i}`, tdWagerDropdown, WDR.labels[i],
                             0, rowLocalY, WDR.w, WDR.h, 36, 16, 48);
        wagerDropdownRows.push(rowN);
    }
    // INTRO row (last) gets a rare-state gold tint so the free-practice tier
    // reads as a bonus item, not a leftover option.
    const introRowN = wagerDropdownRows[wagerDropdownRows.length - 1];
    if (introRowN != null) {
        const introComps = sb.e[introRowN]._components ?? [];
        for (const c of introComps) {
            const comp = sb.e[c.__id__];
            if (!comp) continue;
            if (comp.__type__ === 'cc.Sprite')  comp._color = cl(64, 52, 20, 255);
            if (comp.__type__ === 'cc.Button') {
                comp._normalColor   = cl(64,  52,  20, 255);
                comp._hoverColor    = cl(92,  76,  32, 255);
                comp._pressedColor  = cl(46,  36,  14, 255);
            }
        }
        style(sb, introRowN, { color: GOLD() });
    }
    sb.e[tdWagerDropdown]._children = wagerDropdownRows.map(rf);

    // Hero tile stub indices — placeholders kept at (-999, -999) only so the
    // children-list patch below doesn't shift. Hero tiles were deleted in
    // Session 14 A6 (cosmetic-only; game never read _pickedHeroSymbol).
    const tdHero1 = mkBtnXY(sb, 'HeroTile1Button_deleted', tdN, '', -999, -999, 1, 1, 0, 0, 0);
    const tdHero2 = mkBtnXY(sb, 'HeroTile2Button_deleted', tdN, '', -999, -999, 1, 1, 0, 0, 0);
    const tdHero3 = mkBtnXY(sb, 'HeroTile3Button_deleted', tdN, '', -999, -999, 1, 1, 0, 0, 0);
    sb.e[tdHero1]._active = false;
    sb.e[tdHero2]._active = false;
    sb.e[tdHero3]._active = false;

    // Legacy Holding labels — back-compat safety net; AppUI._renderHoldings
    // is no-op'd on this branch (_holdingLabels[] cleared in
    // _hideLegacyBettingDuelNodes).
    const h1N = mkLabel(sb, 'Holding1Label', tdN, '--', 28,
        TDE.holding1Label.y, TDE.holding1Label.w, TDE.holding1Label.h, 255, 255, 255);
    const h2N = mkLabel(sb, 'Holding2Label', tdN, '--', 28,
        TDE.holding2Label.y, TDE.holding2Label.w, TDE.holding2Label.h, 255, 255, 255);
    const h3N = mkLabel(sb, 'Holding3Label', tdN, '--', 28,
        TDE.holding3Label.y, TDE.holding3Label.w, TDE.holding3Label.h, 255, 255, 255);
    sb.e[h1N]._active = false;
    sb.e[h2N]._active = false;
    sb.e[h3N]._active = false;

    // GameArea — hidden full-panel container for the tower, active block, and
    // HUD (paper-match flow; inactive on betting-duel branch). Size from
    // LAYOUT.TokenDuelPanel.elements.gameArea. HUD children retain inline
    // positions — internal to a hidden container, will be revisited if the
    // paper-match flow ever returns.
    const tdGameArea = sb.e.length;
    sb.node('GameArea', tdN, [], [tdGameArea+1], v3(TDE.gameArea.x, TDE.gameArea.y, 0));
    sb.ut(tdGameArea, TDE.gameArea.w, TDE.gameArea.h);
    sb.e[tdGameArea]._active = false;

    const tdHeight = sb.e.length;
    sb.node('HeightLabel', tdGameArea, [], [tdHeight+1, tdHeight+2], v3(-220, 440, 0));
    sb.ut(tdHeight, 220, 60);
    sb.lbl(tdHeight, 'Height: 0', 30, 255, 255, 255);

    const tdBadge = sb.e.length;
    sb.node('TokenBadgeLabel', tdGameArea, [], [tdBadge+1, tdBadge+2], v3(220, 440, 0));
    sb.ut(tdBadge, 260, 60);
    sb.lbl(tdBadge, 'SOL', 30, 255, 210, 74);

    const tdBlockTpl = sb.e.length;
    sb.node('BlockTemplate', tdGameArea, [], [tdBlockTpl+1, tdBlockTpl+2], v3(0, -600, 0));
    sb.ut(tdBlockTpl, 100, 60);
    sb.spr(tdBlockTpl, 100, 100, 100);
    sb.e[tdBlockTpl]._active = false;

    sb.e[tdGameArea]._children = [rf(tdHeight), rf(tdBadge), rf(tdBlockTpl)];

    // Game-over overlay — full-panel; inactive on betting-duel branch.
    const tdGameOver = sb.e.length;
    sb.node('GameOverLabel', tdN, [], [tdGameOver+1, tdGameOver+2],
        v3(TDE.gameOverLabel.x, TDE.gameOverLabel.y, 0));
    sb.ut(tdGameOver, TDE.gameOverLabel.w, TDE.gameOverLabel.h);
    sb.lbl(tdGameOver, 'Game Over — Height: 0\n(Tier: Forfeit)', 44, 255, 210, 74);
    sb.e[tdGameOver]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // betting-duel Phase 3 — RacePanel
    // Fullscreen overlay shown during Active match. AppUI pipes
    // PortfolioRace tick snapshots to this via _onRaceTick(). Pre-
    // allocates 5 token cards; AppUI activates only as many as the
    // current squad size (1, 3, or 5 — Phase 5 wires the selector).
    // ═══════════════════════════════════════════════════════════════
    // All RacePanel positions sourced from LAYOUT.RacePanel — no literals.
    const RPE = LAYOUT.RacePanel.elements;
    const RPT = LAYOUT.RacePanel.templates;

    const racePanelN = sb.e.length;
    // 2026-04-29 — RacePanel is a canvas-root sibling, not a TD child.
    // Every other panel uses lobbyMount() against canvas; nesting Race under
    // tdN stacked TD's mount.y on Race's, shifting the 1800-tall scrim down
    // and exposing canvas violet at the viewport top (~14px bleed).
    sb.node('RacePanel', canvas, [], [racePanelN+1, racePanelN+2], lobbyMount('RacePanel'));
    sb.ut(racePanelN, LAYOUT.RacePanel.canvas.w, LAYOUT.RacePanel.canvas.h);
    sb.spr(racePanelN, 8, 12, 20);                // near-black scrim — covers feed/HUD below
    sb.e[racePanelN]._active = false;

    // Stage-1A polish: radial timer ring (draining arc). Graphics node drawn
    // by AppUI._drawTimerRing on each tick. Digital mm:ss sits centered inside.
    const raceTimerRingN = sb.e.length;
    sb.node('RaceTimerRing', racePanelN, [], [raceTimerRingN + 1, raceTimerRingN + 2], v3(RPE.timerRing.x, RPE.timerRing.y, 0));
    sb.ut(raceTimerRingN, RPE.timerRing.w, RPE.timerRing.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(raceTimerRingN), _enabled: true, __prefab: null,
        _lineWidth: 8, _miterLimit: 10,
        _strokeColor: cl(48, 198, 155, 255),
        _fillColor: cl(255, 255, 255, 0),
        _id: gid(),
    });
    // Inner last-5s pulse ring (hidden until remainingMs<=5000).
    const raceTimerPulseN = sb.e.length;
    sb.node('RaceTimerPulse', raceTimerRingN, [], [raceTimerPulseN + 1, raceTimerPulseN + 2], v3(RPE.timerPulse.x, RPE.timerPulse.y, 0));
    sb.ut(raceTimerPulseN, RPE.timerPulse.w, RPE.timerPulse.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(raceTimerPulseN), _enabled: true, __prefab: null,
        _lineWidth: 3, _miterLimit: 10,
        _strokeColor: cl(240, 110, 110, 180),
        _fillColor: cl(255, 255, 255, 0),
        _id: gid(),
    });
    sb.e[raceTimerPulseN]._active = false;
    sb.e[raceTimerRingN]._children = [rf(raceTimerPulseN)];

    // Countdown digits — shrunk to fit inside the ring.
    // 2026-05-01 — font 26→30 (matches the +15% timer ring scale).
    const raceCountdownN = mkLabel(sb, 'RaceCountdownLabel',  racePanelN, '0:30', 30,
        RPE.countdownLabel.y, RPE.countdownLabel.w, RPE.countdownLabel.h, 240, 245, 255);
    // Hero portfolio % — top-right of battle UI; bold/primary, smaller (56pt)
    // than the legacy centered 96pt because it shares the row with timer + Lv chip.
    const raceHeroN = sb.e.length;
    sb.node('RaceHeroDeltaLabel', racePanelN, [], [raceHeroN+1, raceHeroN+2],
        v3(RPE.heroDelta.x, RPE.heroDelta.y, 0));
    sb.ut(raceHeroN, RPE.heroDelta.w, RPE.heroDelta.h);
    const raceHeroL = sb.lbl(raceHeroN, '+0.00%', 56, 255, 255, 255);
    sb.e[raceHeroL]._isBold = true;
    // Stage 5N — monospace the number columns so roll-tweens don't "dance".
    style(sb, raceCountdownN, { mono: true });
    style(sb, raceHeroN, { mono: true });

    // Token cards — 5 slots stacked per LAYOUT.RacePanel.templates.raceCard.
    // Internal layout (sym/entry/cur/delta) also from the template.
    const raceCardIndices = [];
    const RC = RPT.raceCard;
    for (let i = 0; i < RC.count; i++) {
        const cardY = RC.baseY + i * RC.gapY;
        const cardN = sb.e.length;
        sb.node(`RaceTokenCard_${i}`, racePanelN, [], [cardN+1, cardN+2], v3(0, cardY, 0));
        sb.ut(cardN, RC.w, RC.h);
        sb.spr(cardN, 26, 8, 32);
        // Phase 22 duel layout: legacy stacked cards default hidden — AppUI
        // re-enables them only when requiredPlayers > 2 (4p/8p mode).
        sb.e[cardN]._active = false;

        const symN = sb.e.length;
        sb.node(`TokenSymbolLabel_${i}`, cardN, [], [symN+1, symN+2], v3(RC.sym.x, RC.sym.y, 0));
        sb.ut(symN, RC.sym.w, RC.sym.h);
        sb.lbl(symN, 'SYM', 30, 255, 255, 255);

        const entryN = sb.e.length;
        sb.node(`TokenEntryLabel_${i}`, cardN, [], [entryN+1, entryN+2], v3(RC.entry.x, RC.entry.y, 0));
        sb.ut(entryN, RC.entry.w, RC.entry.h);
        sb.lbl(entryN, 'entry —', 20, 120, 130, 150);

        const curN = sb.e.length;
        sb.node(`TokenCurrentLabel_${i}`, cardN, [], [curN+1, curN+2], v3(RC.cur.x, RC.cur.y, 0));
        sb.ut(curN, RC.cur.w, RC.cur.h);
        sb.lbl(curN, '—', 22, 230, 230, 240);

        const deltaN = sb.e.length;
        sb.node(`TokenDeltaLabel_${i}`, cardN, [], [deltaN+1, deltaN+2], v3(RC.delta.x, RC.delta.y, 0));
        sb.ut(deltaN, RC.delta.w, RC.delta.h);
        sb.lbl(deltaN, '0.00%', 34, 200, 200, 210);

        style(sb, entryN, { mono: true });
        style(sb, curN, { mono: true });
        style(sb, deltaN, { mono: true });

        sb.e[cardN]._children = [rf(symN), rf(entryN), rf(curN), rf(deltaN)];
        raceCardIndices.push(cardN);
    }

    // Opponent card — same visual weight as a player token card.
    // 640×110 matches RaceTokenCard_X so the bot feels like a real contender,
    // not a half-height afterthought.
    // Opponent card — internals from LAYOUT.RacePanel.templates.oppCardInternal.
    const OCI = RPT.oppCardInternal;
    const raceOppCard = sb.e.length;
    sb.node('RaceOpponentCard', racePanelN, [], [raceOppCard+1, raceOppCard+2], v3(RPE.opponentCard.x, RPE.opponentCard.y, 0));
    sb.ut(raceOppCard, RPE.opponentCard.w, RPE.opponentCard.h);
    sb.spr(raceOppCard, 38, 28, 46);
    sb.e[raceOppCard]._active = false;
    const raceOppAvatarN = sb.e.length;
    sb.node('OpponentAvatarLabel', raceOppCard, [], [raceOppAvatarN+1, raceOppAvatarN+2], v3(OCI.avatar.x, OCI.avatar.y, 0));
    sb.ut(raceOppAvatarN, OCI.avatar.w, OCI.avatar.h);
    sb.lbl(raceOppAvatarN, '', 40, 255, 255, 255);
    const raceOppNameN = sb.e.length;
    sb.node('OpponentNameLabel', raceOppCard, [], [raceOppNameN+1, raceOppNameN+2], v3(OCI.name.x, OCI.name.y, 0));
    sb.ut(raceOppNameN, OCI.name.w, OCI.name.h);
    const raceOppNameL = sb.lbl(raceOppNameN, 'Bot', 20, 230, 230, 240);
    sb.e[raceOppNameL]._isBold = true;
    const raceOppSymsN = sb.e.length;
    sb.node('OpponentSymbolsLabel', raceOppCard, [], [raceOppSymsN+1, raceOppSymsN+2], v3(OCI.syms.x, OCI.syms.y, 0));
    sb.ut(raceOppSymsN, OCI.syms.w, OCI.syms.h);
    sb.lbl(raceOppSymsN, '— · — · —', 16, 170, 180, 200);
    const raceOppDeltaN = sb.e.length;
    sb.node('OpponentDeltaLabel', raceOppCard, [], [raceOppDeltaN+1, raceOppDeltaN+2], v3(OCI.delta.x, OCI.delta.y, 0));
    sb.ut(raceOppDeltaN, OCI.delta.w, OCI.delta.h);
    sb.lbl(raceOppDeltaN, '0.00%', 32, 200, 200, 210);
    const raceOppGapN = sb.e.length;
    sb.node('OpponentGapLabel', raceOppCard, [], [raceOppGapN+1, raceOppGapN+2], v3(OCI.gap.x, OCI.gap.y, 0));
    sb.ut(raceOppGapN, OCI.gap.w, OCI.gap.h);
    sb.lbl(raceOppGapN, '—', 14, 184, 184, 184);
    // Stage 5N — monospace the opponent number columns.
    style(sb, raceOppDeltaN, { mono: true });
    style(sb, raceOppGapN, { mono: true });
    sb.e[raceOppCard]._children = [rf(raceOppAvatarN), rf(raceOppNameN), rf(raceOppSymsN), rf(raceOppDeltaN), rf(raceOppGapN)];

    // 4p/8p multi-bot leaderboard strip. Used in place of the big opponent
    // card when mode.requiredPlayers > 2. Pre-allocates 7 compact rows
    // (4p → rows 0/1/2 active; 8p → 0-6 active). BR10 truncates to top-7.
    // Opponent strip + 7 rows from LAYOUT.RacePanel.templates.oppRow.
    const ORW = RPT.oppRow;
    const raceOppStripN = sb.e.length;
    sb.node('RaceOpponentStrip', racePanelN, [], [raceOppStripN + 1], v3(RPE.opponentStrip.x, RPE.opponentStrip.y, 0));
    sb.ut(raceOppStripN, RPE.opponentStrip.w, RPE.opponentStrip.h);
    sb.e[raceOppStripN]._active = false;
    const raceOppRowIndices = [];
    for (let i = 0; i < ORW.count; i++) {
        const ry = ORW.baseY + i * ORW.gapY;
        const rowN = sb.e.length;
        sb.node(`RaceOpponentRow_${i}`, raceOppStripN, [], [rowN + 1, rowN + 2], v3(0, ry, 0));
        sb.ut(rowN, ORW.w, ORW.h);
        sb.spr(rowN, 26, 32, 46);
        const avN = sb.e.length;
        sb.node('AvatarLabel', rowN, [], [avN + 1, avN + 2], v3(ORW.avatar.x, ORW.avatar.y, 0));
        sb.ut(avN, ORW.avatar.w, ORW.avatar.h);
        sb.lbl(avN, '', 18, 255, 255, 255);
        const nmN = sb.e.length;
        sb.node('NameLabel', rowN, [], [nmN + 1, nmN + 2], v3(ORW.name.x, ORW.name.y, 0));
        sb.ut(nmN, ORW.name.w, ORW.name.h);
        const nmL = sb.lbl(nmN, `Bot ${i + 1}`, 13, 220, 225, 240);
        sb.e[nmL]._isBold = true;
        const smN = sb.e.length;
        sb.node('SymbolsLabel', rowN, [], [smN + 1, smN + 2], v3(ORW.symbols.x, ORW.symbols.y, 0));
        sb.ut(smN, ORW.symbols.w, ORW.symbols.h);
        sb.lbl(smN, '— · — · —', 12, 184, 184, 184);
        const dtN = sb.e.length;
        sb.node('DeltaLabel', rowN, [], [dtN + 1, dtN + 2], v3(ORW.delta.x, ORW.delta.y, 0));
        sb.ut(dtN, ORW.delta.w, ORW.delta.h);
        const dtL = sb.lbl(dtN, '0.00%', 17, 210, 210, 220);
        sb.e[dtL]._isBold = true;
        const gpN = sb.e.length;
        sb.node('GapLabel', rowN, [], [gpN + 1, gpN + 2], v3(ORW.gap.x, ORW.gap.y, 0));
        sb.ut(gpN, ORW.gap.w, ORW.gap.h);
        sb.lbl(gpN, '', 11, 184, 184, 184);
        style(sb, dtN, { mono: true });
        style(sb, gpN, { mono: true });
        sb.e[rowN]._children = [rf(avN), rf(nmN), rf(smN), rf(dtN), rf(gpN)];
        raceOppRowIndices.push(rowN);
    }
    sb.e[raceOppStripN]._children = raceOppRowIndices.map(rf);

    // Forfeit + vignette + mascot. 1v1 duel layout downplays Forfeit —
    // recessed dark surface (28,32,44) sits below opponent section so it
    // doesn't compete with the duel bar / hero numbers. Tier DANGER — tap
    // costs the SOL stake. Visual treatment stays subdued (recessed surface
    // + dim label) so the button reads as low-priority rather than alarming;
    // the rose-tinted press flash via ButtonFX provides the consequence cue.
    const raceCancelN = mkBtnXY(sb, 'RaceCancelButton', racePanelN, 'Forfeit',
        RPE.cancelBtn.x, RPE.cancelBtn.y, RPE.cancelBtn.w, RPE.cancelBtn.h, 28, 32, 44,
        { tier: 'danger' });
    // Dim the label so the button reads as low-priority.
    style(sb, raceCancelN, { color: cl(140, 145, 160, 255), fontSize: 18 });

    // 2026-04-27 — "← Home" button paired LEFT of Forfeit on y=-260 row.
    // Tap → activates HomePanel, leaves PortfolioRace running in background;
    // match resumable via MatchesInProgressPanel.
    // 2026-05-01 — promoted to brand-violet (Palette.accent.violet #9945FF)
    // so the escape CTA reads as the primary action; label stays white.
    const raceHomeBtnN = mkBtnXY(sb, 'RaceHomeButton', racePanelN, '← Home',
        RPE.homeBtn.x, RPE.homeBtn.y, RPE.homeBtn.w, RPE.homeBtn.h, 153, 69, 255);
    style(sb, raceHomeBtnN, { fontSize: 18 });

    // Gameplay hint (sits below Forfeit, child of RacePanel so it draws
    // above the panel scrim). String is overwritten by AppUI on race entry.
    const raceHintN = mkLabel(sb, 'RaceHintLabel', racePanelN,
        'Tap to drop - stack as high as you can', 18,
        RPE.hintLabel.y, RPE.hintLabel.w, RPE.hintLabel.h, 184, 184, 184);

    // 2026-04-27 — Multi-player condensed opponent grid (Trio / 4p / 8p).
    // Built once with 7 cards; AppUI activates the right subset per mode
    // and switches between collapsed grid + expanded 1v1-style opp view.
    const MOG = LAYOUT.RacePanel.templates.multiOppCard;
    const multiGridN = sb.e.length;
    sb.node('RaceMultiOppGrid', racePanelN, [], [], v3(RPE.multiOppGrid.x, RPE.multiOppGrid.y, 0));
    sb.ut(multiGridN, RPE.multiOppGrid.w, RPE.multiOppGrid.h);
    // Local invis-btn helper (mkInvisBtnXY is declared later in this fn — TDZ).
    const raceMultiInvisBtn = (name, parent, x, y, w, h) => {
        const hN = sb.e.length;
        sb.node(name, parent, [], [], v3(x, y, 0));
        const hUT = sb.ut(hN, w, h);
        const hBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(hN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.04, _target: rf(hN), _id: gid(),
        });
        sb.e[hN]._components = [rf(hUT), rf(hBtn)];
        return hN;
    };
    const ROW1_XS = [-258, -86, 86, 258];
    const ROW2_XS = [-172, 0, 172];
    const multiCardIndices = [];
    for (let i = 0; i < 7; i++) {
        const inRow1 = i < 4;
        const cx = inRow1 ? ROW1_XS[i] : ROW2_XS[i - 4];
        const cy = inRow1 ? MOG.row1Y : MOG.row2Y;
        const cardN = sb.e.length;
        sb.node(`MultiOppCard_${i}`, multiGridN, [], [], v3(cx, cy, 0));
        const cardUT = sb.ut(cardN, MOG.w, MOG.h);
        const cardSpr = cardBodySpr(sb, cardN);
        // Tap target — sits behind visible content. Generic name; verifier
        // uses suffix-stripped match ('MultiOppCardTap_0' → 'MultiOppCardTap').
        const tapN = raceMultiInvisBtn(`MultiOppCardTap_${i}`, cardN, MOG.tap.x, MOG.tap.y, MOG.tap.w, MOG.tap.h);
        // Rank chip (top-LEFT of card)
        const rankN = mkLabel(sb, `MultiOppRankChip_${i}`, cardN, '—', 12,
            MOG.rankChip.y, MOG.rankChip.w, MOG.rankChip.h, 184, 184, 184);
        sb.e[rankN]._lpos = v3(MOG.rankChip.x, MOG.rankChip.y, 0);
        sb.e[sb.e[rankN]._components[1].__id__]._isBold = true;
        // Name label
        const nameN = mkLabel(sb, `MultiOppName_${i}`, cardN, '—', 14,
            MOG.name.y, MOG.name.w, MOG.name.h, 255, 255, 255);
        // Delta (big colored)
        const deltaN = mkLabel(sb, `MultiOppDelta_${i}`, cardN, '—', 22,
            MOG.delta.y, MOG.delta.w, MOG.delta.h, 184, 184, 184);
        sb.e[sb.e[deltaN]._components[1].__id__]._isBold = true;
        style(sb, deltaN, { mono: true });
        // PnL-vs-me bar (horizontal stripe near bottom)
        const barN = sb.e.length;
        sb.node(`MultiOppPnlBar_${i}`, cardN, [], [], v3(MOG.pnlBar.x, MOG.pnlBar.y, 0));
        const barUT = sb.ut(barN, MOG.pnlBar.w, MOG.pnlBar.h);
        const barSpr = sb.spr(barN, 48, 198, 155);
        sb.e[barN]._components = [rf(barUT), rf(barSpr)];
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(tapN), rf(rankN), rf(nameN), rf(deltaN), rf(barN)];
        sb.e[cardN]._active = false;
        multiCardIndices.push(cardN);
    }
    sb.e[multiGridN]._children = multiCardIndices.map(rf);
    sb.e[multiGridN]._active = false;

    // "← Back" — only visible when an opponent card is expanded.
    const raceMultiBackN = mkBtnXY(sb, 'RaceMultiBackButton', racePanelN, '← Back',
        RPE.multiBackBtn.x, RPE.multiBackBtn.y, RPE.multiBackBtn.w, RPE.multiBackBtn.h, 36, 16, 48);
    style(sb, raceMultiBackN, { color: cl(184, 184, 184, 255), fontSize: 18 });
    sb.e[raceMultiBackN]._active = false;

    // 2026-04-27 — Force-hide the legacy 7-row opponent strip (replaced by
    // RaceMultiOppGrid + tap-to-expand for 4p/8p modes).
    sb.e[raceOppStripN]._active = false;

    const raceVignetteN = sb.e.length;
    sb.node('ScreenVignette', racePanelN, [], [raceVignetteN + 1, raceVignetteN + 2], v3(RPE.vignette.x, RPE.vignette.y, 0));
    const raceVignetteUT = sb.ut(raceVignetteN, RPE.vignette.w, RPE.vignette.h);
    sb.e[raceVignetteUT]._anchorPoint = v2(0.5, 0.5);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(raceVignetteN), _enabled: true, __prefab: null,
        _lineWidth: 140, _miterLimit: 10,
        _strokeColor: cl(48, 198, 155, 0),
        _fillColor: cl(255, 255, 255, 0),
        _id: gid(),
    });

    // Mascot container — bottom-right per LAYOUT.RacePanel.elements.mascot.
    // Battle-UI polish (2026-04-26): UIOpacity attached so AppUI can dim the
    // mascot to ~55% during a duel (decorative role, not a focal point).
    const raceMascotN = sb.e.length;
    sb.node('RaceMascotContainer', racePanelN, [], [], v3(RPE.mascot.x, RPE.mascot.y, 0));
    const raceMascotUT = sb.ut(raceMascotN, RPE.mascot.w, RPE.mascot.h);
    const raceMascotOpacityN = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(raceMascotN), _enabled: true, __prefab: null,
        _opacity: 255,
    });
    sb.e[raceMascotN]._components = [rf(raceMascotUT), rf(raceMascotOpacityN)];

    // ═══════════════════════════════════════════════════════════════
    // Phase 22 — 1v1 Duel-format surfaces (additive; legacy 5-stack
    // + RaceOpponentCard remain for 4p/8p fallback).
    // ═══════════════════════════════════════════════════════════════
    const ICT = RPT.identityCard;
    const DTC = RPT.duelTokenCard;

    // Helper: build an identity card (sprite body + green dot + name + level).
    function mkIdentityCard(name, parent, eltSpec, dimmed) {
        const cardN = sb.e.length;
        sb.node(name, parent, [], [cardN+1, cardN+2], v3(eltSpec.x, eltSpec.y, 0));
        sb.ut(cardN, eltSpec.w, eltSpec.h);
        // Bg.card surface (#1E2438 = 26, 8, 32). Dimmed variant uses bg.surface.
        if (dimmed) sb.spr(cardN, 26, 8, 32);
        else        sb.spr(cardN, 26, 8, 32);
        // Connected dot (Graphics). Player = teal-green; opponent = muted gray.
        const dotN = sb.e.length;
        sb.node(`${name === 'PlayerIdentityCard' ? 'PlayerIdentityDot' : 'OpponentIdentityDot'}`,
            cardN, [], [dotN+1, dotN+2], v3(ICT.dot.x, ICT.dot.y, 0));
        sb.ut(dotN, ICT.dot.w, ICT.dot.h);
        const dotCol = dimmed ? cl(184, 184, 184, 200) : cl(20, 241, 149, 255);
        sb.add({
            __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(dotN), _enabled: true, __prefab: null,
            _lineWidth: 0, _miterLimit: 10,
            _strokeColor: dotCol, _fillColor: dotCol,
            _id: gid(),
        });
        // Name label (wallet truncated or "Bot").
        const isPlayer = name === 'PlayerIdentityCard';
        const nameNodeName = isPlayer ? 'PlayerIdentityNameLabel' : 'OpponentIdentityNameLabel';
        const levelNodeName = isPlayer ? 'PlayerIdentityLevelLabel' : 'OpponentIdentityLevelLabel';
        const nameN = sb.e.length;
        sb.node(nameNodeName, cardN, [], [nameN+1, nameN+2], v3(ICT.name.x, ICT.name.y, 0));
        sb.ut(nameN, ICT.name.w, ICT.name.h);
        const nameLbl = sb.lbl(nameN, isPlayer ? 'Connecting…' : 'Bot', 18,
            dimmed ? 200 : 244, dimmed ? 205 : 245, dimmed ? 220 : 249);
        sb.e[nameLbl]._isBold = true;
        sb.e[nameLbl]._horizontalAlign = 0; // left-align
        // Level pill label.
        const lvlN = sb.e.length;
        sb.node(levelNodeName, cardN, [], [lvlN+1, lvlN+2], v3(ICT.level.x, ICT.level.y, 0));
        sb.ut(lvlN, ICT.level.w, ICT.level.h);
        const lvlLbl = sb.lbl(lvlN, 'Lv 1', 13, 184, 184, 184);
        sb.e[lvlLbl]._horizontalAlign = 0;
        sb.e[cardN]._children = [rf(dotN), rf(nameN), rf(lvlN)];
        return cardN;
    }

    // RacePlayerLevelChip — small Lv pill, top-left of battle UI top row.
    // Replaces the larger PlayerIdentityCard (wallet + Lv stack) — wallet
    // shows in post-match summary instead, keeping the gameplay top row tight.
    const playerLevelChipN = sb.e.length;
    sb.node('RacePlayerLevelChip', racePanelN, [], [playerLevelChipN+1, playerLevelChipN+2],
        v3(RPE.racePlayerLevelChip.x, RPE.racePlayerLevelChip.y, 0));
    sb.ut(playerLevelChipN, RPE.racePlayerLevelChip.w, RPE.racePlayerLevelChip.h);
    // 2026-05-01 — match token-card body (cardBodySpr → rounded UUID + alpha 235)
    // so the Lv chip reads as the same grey as the token cards beneath it.
    cardBodySpr(sb, playerLevelChipN);
    const playerLevelChipLblN = sb.e.length;
    sb.node('RacePlayerLevelChipLabel', playerLevelChipN, [], [playerLevelChipLblN+1, playerLevelChipLblN+2], v3(0, 0, 0));
    sb.ut(playerLevelChipLblN, RPE.racePlayerLevelChip.w - 16, RPE.racePlayerLevelChip.h - 8);
    sb.lbl(playerLevelChipLblN, 'Lv 1', 16, 200, 205, 220);
    sb.e[playerLevelChipN]._children = [rf(playerLevelChipLblN)];

    // PlayerTokenCardsRow + 3 horizontal cards. Internal sym + delta + contribution
    // bar (Graphics, drawn per tick by AppUI to show which token carries the squad).
    function mkDuelTokenRow(rowName, parent, rowSpec, prefix) {
        const rowN = sb.e.length;
        sb.node(rowName, parent, [], [rowN+1], v3(rowSpec.x, rowSpec.y, 0));
        sb.ut(rowN, rowSpec.w, rowSpec.h);
        const childIdx = [];
        for (let i = 0; i < DTC.count; i++) {
            const cardN = sb.e.length;
            const cx = DTC.baseX + i * DTC.gapX;
            sb.node(`${prefix}TokenCard_${i}`, rowN, [], [cardN+1, cardN+2], v3(cx, 0, 0));
            sb.ut(cardN, DTC.w, DTC.h);
            // 2026-05-01 race-card restyle — body recolored to bg.cardHover
            // (#321448 = 50,20,72) so cards read purple at rest, matching the
            // squad / picker cards. Opponent slightly dimmer to keep the two
            // rows visually distinct. AppUI lerps toward green/rose by sign
            // in _applyDuelTokenCardFeedback.
            if (prefix === 'Player') sb.spr(cardN, 50, 20, 72);
            else                     sb.spr(cardN, 38, 16, 56);
            // Logo on the LEFT — circular token icon, same row as symbol.
            // AppUI swaps the spriteFrame via _loadLogoInto each tick.
            // White tint so the loaded image shows untinted; hidden by
            // default until AppUI confirms a holding has a logoUri.
            const logoN = sb.e.length;
            sb.node(`${prefix}TokenLogo_${i}`, cardN, [], [logoN+1, logoN+2], v3(DTC.logo.x, DTC.logo.y, 0));
            sb.ut(logoN, DTC.logo.w, DTC.logo.h);
            sb.spr(logoN, 255, 255, 255);
            sb.e[logoN]._active = false;
            const symN = sb.e.length;
            sb.node(`${prefix}TokenSymLabel_${i}`, cardN, [], [symN+1, symN+2], v3(DTC.sym.x, DTC.sym.y, 0));
            sb.ut(symN, DTC.sym.w, DTC.sym.h);
            const symLbl = sb.lbl(symN, '—', 22, 255, 255, 255);
            sb.e[symLbl]._isBold = true;
            sb.e[symLbl]._horizontalAlign = 0; // left, sits right of the logo
            const dtN = sb.e.length;
            sb.node(`${prefix}TokenDeltaLabel_${i}`, cardN, [], [dtN+1, dtN+2], v3(DTC.delta.x, DTC.delta.y, 0));
            sb.ut(dtN, DTC.delta.w, DTC.delta.h);
            sb.lbl(dtN, '+0.00%', 28, 184, 184, 184);
            style(sb, dtN, { mono: true });
            // Contribution bar — Graphics drawn per tick by AppUI showing
            // |delta_i| normalized vs squad max. Empty/transparent at scene-gen.
            const barN = sb.e.length;
            sb.node(`${prefix}TokenContributionBar_${i}`, cardN, [], [barN+1, barN+2],
                v3(DTC.bar.x, DTC.bar.y, 0));
            sb.ut(barN, DTC.bar.w, DTC.bar.h);
            sb.add({
                __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(barN), _enabled: true, __prefab: null,
                _lineWidth: 0, _miterLimit: 10,
                _strokeColor: cl(184, 184, 184, 0),
                _fillColor:   cl(184, 184, 184, 0),
                _id: gid(),
            });
            sb.e[cardN]._children = [rf(logoN), rf(symN), rf(dtN), rf(barN)];
            childIdx.push(cardN);
        }
        sb.e[rowN]._children = childIdx.map(rf);
        return rowN;
    }
    const playerTokenRowN   = mkDuelTokenRow('PlayerTokenCardsRow',   racePanelN, RPE.playerTokenRow,   'Player');
    const opponentTokenRowN = mkDuelTokenRow('OpponentTokenCardsRow', racePanelN, RPE.opponentTokenRow, 'Opponent');

    // Duel bar — center tug-of-war. Container holds Track, Fill, Glow,
    // CenterTick, two side tags, and the leading-pp label. AppUI integrates
    // a critically-damped spring at 60Hz to drive Fill + Glow (see
    // _duelBarUpdate).
    const duelBarN = sb.e.length;
    sb.node('RaceDuelBarContainer', racePanelN, [], [duelBarN+1],
        v3(RPE.duelBarContainer.x, RPE.duelBarContainer.y, 0));
    sb.ut(duelBarN, RPE.duelBarContainer.w, RPE.duelBarContainer.h);

    // Track (background channel)
    const duelTrackN = sb.e.length;
    sb.node('DuelBarTrack', duelBarN, [], [duelTrackN+1, duelTrackN+2],
        v3(RPE.duelBarTrack.x, RPE.duelBarTrack.y, 0));
    sb.ut(duelTrackN, RPE.duelBarTrack.w, RPE.duelBarTrack.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(duelTrackN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(255, 255, 255, 20),
        _fillColor:   cl(255, 255, 255, 20),
        _id: gid(),
    });

    // Fill (player-side or opponent-side from center)
    const duelFillN = sb.e.length;
    sb.node('DuelBarFill', duelBarN, [], [duelFillN+1, duelFillN+2],
        v3(RPE.duelBarFill.x, RPE.duelBarFill.y, 0));
    sb.ut(duelFillN, RPE.duelBarFill.w, RPE.duelBarFill.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(duelFillN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(20, 241, 149, 255),
        _fillColor:   cl(20, 241, 149, 230),
        _id: gid(),
    });

    // Glow (breathing radial alpha at leading tip)
    const duelGlowN = sb.e.length;
    sb.node('DuelBarGlow', duelBarN, [], [duelGlowN+1, duelGlowN+2],
        v3(RPE.duelBarGlow.x, RPE.duelBarGlow.y, 0));
    sb.ut(duelGlowN, RPE.duelBarGlow.w, RPE.duelBarGlow.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(duelGlowN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(20, 241, 149, 0),
        _fillColor:   cl(20, 241, 149, 0),
        _id: gid(),
    });

    // Center tick — vertical splitter at x=0
    const duelTickN = sb.e.length;
    sb.node('DuelBarCenterTick', duelBarN, [], [duelTickN+1, duelTickN+2],
        v3(RPE.duelBarCenterTick.x, RPE.duelBarCenterTick.y, 0));
    sb.ut(duelTickN, RPE.duelBarCenterTick.w, RPE.duelBarCenterTick.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(duelTickN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(184, 184, 184, 200),
        _fillColor:   cl(184, 184, 184, 200),
        _id: gid(),
    });

    // Side tags ("you" / opponent name)
    const duelPlayerTagN = sb.e.length;
    sb.node('DuelBarPlayerTagLabel', duelBarN, [], [duelPlayerTagN+1, duelPlayerTagN+2],
        v3(RPE.duelBarPlayerTag.x, RPE.duelBarPlayerTag.y, 0));
    sb.ut(duelPlayerTagN, RPE.duelBarPlayerTag.w, RPE.duelBarPlayerTag.h);
    sb.lbl(duelPlayerTagN, 'you', 12, 184, 184, 184);

    const duelOppTagN = sb.e.length;
    sb.node('DuelBarOppTagLabel', duelBarN, [], [duelOppTagN+1, duelOppTagN+2],
        v3(RPE.duelBarOppTag.x, RPE.duelBarOppTag.y, 0));
    sb.ut(duelOppTagN, RPE.duelBarOppTag.w, RPE.duelBarOppTag.h);
    sb.lbl(duelOppTagN, 'bot', 12, 184, 184, 184);

    // Leading pp label — floats above leading tip; AppUI repositions per tick.
    const duelLeadingPpN = sb.e.length;
    sb.node('DuelBarLeadingPpLabel', duelBarN, [], [duelLeadingPpN+1, duelLeadingPpN+2],
        v3(RPE.duelBarLeadingPp.x, RPE.duelBarLeadingPp.y, 0));
    sb.ut(duelLeadingPpN, RPE.duelBarLeadingPp.w, RPE.duelBarLeadingPp.h);
    const duelLeadingPpLbl = sb.lbl(duelLeadingPpN, '', 18, 184, 184, 184);
    sb.e[duelLeadingPpLbl]._isBold = true;
    style(sb, duelLeadingPpN, { mono: true });

    sb.e[duelBarN]._children = [
        rf(duelTrackN), rf(duelFillN), rf(duelGlowN), rf(duelTickN),
        rf(duelPlayerTagN), rf(duelOppTagN), rf(duelLeadingPpN),
    ];

    // ─────────────────────────────────────────────────────────────────
    // Round Advantage card (2026-04-29) — wraps the big opponent-side hero
    // label with a glowing rounded border + outer halo + caption + subtext.
    // The big number is repurposed to show the LEAD (player − bot, in pp).
    // Border + halo + subtext color-flip green/red on lead reversal at runtime
    // (AppUI._updateAdvantageCard). Halo Graphics is empty here — AppUI fills
    // it via installSoftGlow() so the concentric-circle falloff is computed
    // against the live UITransform.
    // ─────────────────────────────────────────────────────────────────

    // Halo — soft outer glow. Concentric circles drawn at runtime.
    const advHaloN = sb.e.length;
    sb.node('RaceAdvantageHalo', racePanelN, [], [advHaloN+1, advHaloN+2],
        v3(RPE.advantageHalo.x, RPE.advantageHalo.y, 0));
    sb.ut(advHaloN, RPE.advantageHalo.w, RPE.advantageHalo.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(advHaloN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(51, 204, 85, 0),
        _fillColor:   cl(51, 204, 85, 0),
        _id: gid(),
    });

    // Border — 2px stroked rounded rect. AppUI redraws on lead flip.
    const advBorderN = sb.e.length;
    sb.node('RaceAdvantageBorder', racePanelN, [], [advBorderN+1, advBorderN+2],
        v3(RPE.advantageBorder.x, RPE.advantageBorder.y, 0));
    sb.ut(advBorderN, RPE.advantageBorder.w, RPE.advantageBorder.h);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(advBorderN), _enabled: true, __prefab: null,
        _lineWidth: 2, _miterLimit: 10,
        _strokeColor: cl(51, 204, 85, 220),
        _fillColor:   cl(0, 0, 0, 0),
        _id: gid(),
    });

    // Caption — "ROUND ADVANTAGE", small caps above the number.
    const advCaptionN = mkLabel(sb, 'RaceAdvantageCaption', racePanelN, 'ROUND ADVANTAGE', 16,
        RPE.advantageCaption.y, RPE.advantageCaption.w, RPE.advantageCaption.h, 184, 184, 184);
    style(sb, advCaptionN, { bold: true });

    // Opponent hero delta — bumped 72→80pt for symmetry of stake when losing.
    // 2026-04-29: text repurposed to render the LEAD in pp (player − bot).
    const oppHeroN = mkLabel(sb, 'OpponentDeltaHeroLabel', racePanelN, '+0.00 pp', 80,
        RPE.opponentDelta.y, RPE.opponentDelta.w, RPE.opponentDelta.h, 200, 200, 210);
    style(sb, oppHeroN, { mono: true });

    // Subtext — "You're ahead/behind this round!" below the number.
    const advSubtextN = mkLabel(sb, 'RaceAdvantageSubtext', racePanelN, '', 18,
        RPE.advantageSubtext.y, RPE.advantageSubtext.w, RPE.advantageSubtext.h, 184, 184, 184);

    // Lead-state line — promoted from "you +X.XX pp ahead" (14pt) to a 2-line
    // emphasis line above the duel bar ("YOU LEAD\n+0.48 pp"). 22pt bold.
    const oppGapSubN = mkLabel(sb, 'OpponentSubtitleGapLabel', racePanelN, '—', 22,
        RPE.opponentSubtitle.y, RPE.opponentSubtitle.w, RPE.opponentSubtitle.h, 184, 184, 184);
    style(sb, oppGapSubN, { bold: true });

    // OpponentIdentityCard (mirror of player, dimmed)
    const opponentIdentityCardN = mkIdentityCard('OpponentIdentityCard', racePanelN, RPE.opponentIdentityCard, true);

    // 2026-04-30 — Bot portfolio % (bottom-left mirror of RaceHeroDeltaLabel).
    // 56pt bold mono; AppUI._onRaceTick writes string + color each tick. Hidden
    // by AppUI outside duel layout (no single opponent in 4p/8p).
    const raceOppPortN = sb.e.length;
    sb.node('RaceOpponentPortfolioDeltaLabel', racePanelN, [], [raceOppPortN+1, raceOppPortN+2],
        v3(RPE.opponentPortfolioDelta.x, RPE.opponentPortfolioDelta.y, 0));
    sb.ut(raceOppPortN, RPE.opponentPortfolioDelta.w, RPE.opponentPortfolioDelta.h);
    const raceOppPortL = sb.lbl(raceOppPortN, '+0.00%', 56, 255, 255, 255);
    sb.e[raceOppPortL]._isBold = true;
    style(sb, raceOppPortN, { mono: true });

    sb.e[racePanelN]._children = [
        rf(raceVignetteN),
        rf(playerLevelChipN),
        rf(raceTimerRingN), rf(raceCountdownN), rf(raceHeroN),
        rf(playerTokenRowN),
        rf(oppGapSubN),
        rf(duelBarN),
        // Round Advantage card layered z-order: halo (back) → border → caption → big number → subtext (front).
        rf(advHaloN),
        rf(advBorderN),
        rf(advCaptionN),
        rf(oppHeroN),
        rf(advSubtextN),
        rf(opponentIdentityCardN),
        rf(opponentTokenRowN),
        rf(raceOppPortN),
        ...raceCardIndices.map(rf),
        rf(raceOppCard),
        rf(raceOppStripN),
        // 2026-04-27 — multi-player condensed grid + back btn (hidden until 4p/8p).
        rf(multiGridN),
        rf(raceMultiBackN),
        rf(raceCancelN),
        rf(raceHomeBtnN),                                  // 2026-04-27 — Home pair (LEFT of Forfeit)
        rf(raceHintN),
        rf(raceMascotN),
    ];

    // Session 12: StatusLabel — muted strip at the very bottom.
    // BackButton moved to top-left as a link (tdBackBtn above); nothing else
    // needs a full-width back slab.
    // Polish 2026-04-26: fontSize 15→18 (FontSize.body) so "Holdings loaded (5Ksq…sDst)"
    // reads on device. Container h bumped 22→26 in LayoutSpec to accommodate.
    const tdStatus = mkLabel(sb, 'StatusLabel', tdN, '', 18,
        TDE.status.y, TDE.status.w, TDE.status.h, 184, 184, 184);

    // ═══════════════════════════════════════════════════════════════
    // Session D Part 2 — ModePickerOverlay (shown on Run Squad tap)
    // 2026-04-30 immersive redesign — full-screen pre-match staging arena
    // ═══════════════════════════════════════════════════════════════
    // Layered background: opaque dark base scrim (panel-level Sprite, fills
    // viewport at runtime via _relayoutModePickerToViewport) + ModePickerBackdrop
    // (no-UTransform container, invisible to verifier) holding the top half-canvas
    // violet gradient + center radial soft-glow. Five vertical zones: Header /
    // Mode (2×2 dominant tiles) / Settings (Duration + Track + Difficulty stack)
    // / Summary (premium gold-edged card) / CTA (cinematic Enter Match).
    const modePickerN = sb.e.length;
    sb.node('ModePickerOverlay', tdN, [], [], v3(0, 0, 0));
    const mpUT = sb.ut(modePickerN, 720, 1280);
    const mpSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(modePickerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        // Opaque modal bg = Palette.bg.primary near-black. AppUI runtime resizes
        // this Sprite + the panel UTransform to view.getVisibleSize() so the dark
        // base never leaves a purple-top / green-bottom bleed band on tall
        // viewports (mirrors PostMatchPanel.OutcomeBgTint behavior).
        _color: cl(10, 4, 16, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const mpScrimBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(modePickerN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(modePickerN), _id: gid(),
    });
    // All positions sourced from LAYOUT.ModePickerOverlay — no literals.
    const MPE = LAYOUT.ModePickerOverlay.elements;
    const MPT = LAYOUT.ModePickerOverlay.templates;

    // ── BACKDROP container ─────────────────────────────────────────────
    // Wraps the gradient + radial glow so they aren't direct children of the
    // panel (verifier walks panel children only; backdrop has no UITransform
    // → bbox_of returns None → skipped). Decorative-only.
    const mpBackdropN = sb.e.length;
    sb.node('ModePickerBackdrop', modePickerN, [], [], v3(0, 0, 0));
    sb.e[mpBackdropN]._components = [];

    // Full-viewport violet wash sprite — 2026-05-01 staging polish: extended
    // 2026-05-01 round 2 — violet wash KILLED (alpha 0). Read as "purple at
    // top" on the user's device. Solid near-black panel base + the existing
    // radial center glow (peakAlpha 70) carry the visual on their own. Sprite
    // node stays in scene with its bbox so the verifier walks it cleanly.
    const mpGradientN = sb.e.length;
    sb.node('ModePickerGradientTop', mpBackdropN, [], [], v3(0, 0, 0));
    const mpGradientUT = sb.ut(mpGradientN, 720, 1280);
    const mpGradientSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mpGradientN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(26, 11, 46, 0),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mpGradientN]._components = [rf(mpGradientUT), rf(mpGradientSpr)];

    // Center radial soft-glow anchor — empty Node; AppUI._wireModePickerFx
    // attaches LandingFX.installSoftGlow at start (which routes through
    // enqueuePostDraw → safeAddGraphics for SIGSEGV-safe Graphics attachment).
    const mpCenterGlowN = sb.e.length;
    sb.node('ModePickerCenterGlow', mpBackdropN, [], [], v3(0, 80, 0));
    const mpCenterGlowUT = sb.ut(mpCenterGlowN, 480, 480);
    sb.e[mpCenterGlowN]._components = [rf(mpCenterGlowUT)];

    sb.e[mpBackdropN]._children = [rf(mpGradientN), rf(mpCenterGlowN)];

    // ── TOP BAR (Back + Close on the same horizontal line, anchored to
    //    viewport top by AppUI._relayoutModePickerToViewport) ────────────
    const pickerBackBtn = mkBtnXY(sb, 'PickerBackButton', modePickerN, '← Back',
        MPE.backBtn.x, MPE.backBtn.y, MPE.backBtn.w, MPE.backBtn.h, 26, 8, 32,
        { tier: 'tertiary' });

    // ── HEADER zone (title + divider + subtitle) ──────────────────────
    const mpTitle = mkLabel(sb, 'ModePickerTitleLabel', modePickerN, 'Configure Your Duel', 30,
        MPE.title.y, MPE.title.w, MPE.title.h, 255, 255, 255);
    style(sb, mpTitle, { bold: true, color: GOLD(), spacing: 1.4 });

    // Thin gold divider sprite under title.
    const mpTitleDividerN = sb.e.length;
    sb.node('ModePickerTitleDivider', modePickerN, [], [], v3(MPE.titleDivider.x, MPE.titleDivider.y, 0));
    const mpTitleDividerUT = sb.ut(mpTitleDividerN, MPE.titleDivider.w, MPE.titleDivider.h);
    const mpTitleDividerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mpTitleDividerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 210, 74, 180),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mpTitleDividerN]._components = [rf(mpTitleDividerUT), rf(mpTitleDividerSpr)];

    // Subtitle — sets the room: "Choose your mode, stake, and match rules".
    const mpSubtitle = mkLabel(sb, 'ModePickerSubtitleLabel', modePickerN,
        'Choose your mode, stake, and match rules', 14,
        MPE.subtitle.y, MPE.subtitle.w, MPE.subtitle.h, 184, 184, 184);
    style(sb, mpSubtitle, { spacing: 0.4 });

    // ── SECTION HEADERS — uppercase + tracked premium chrome ──────────
    const mpSecMode = mkLabel(sb, 'PickerSectionLabel_Mode', modePickerN, 'MODE', 13,
        MPE.sectionMode.y, MPE.sectionMode.w, MPE.sectionMode.h, 184, 184, 184);
    style(sb, mpSecMode, { bold: true, spacing: 1.2 });
    const mpSecDuration = mkLabel(sb, 'PickerSectionLabel_Duration', modePickerN, 'DURATION', 13,
        MPE.sectionDuration.y, MPE.sectionDuration.w, MPE.sectionDuration.h, 184, 184, 184);
    style(sb, mpSecDuration, { bold: true, spacing: 1.2 });
    const mpSecTrack = mkLabel(sb, 'PickerSectionLabel_Track', modePickerN, 'TRACK', 13,
        MPE.sectionTrack.y, MPE.sectionTrack.w, MPE.sectionTrack.h, 184, 184, 184);
    style(sb, mpSecTrack, { bold: true, spacing: 1.2 });
    const mpSecDifficulty = mkLabel(sb, 'PickerSectionLabel_Difficulty', modePickerN, 'DIFFICULTY', 13,
        MPE.sectionDifficulty.y, MPE.sectionDifficulty.w, MPE.sectionDifficulty.h, 184, 184, 184);
    style(sb, mpSecDifficulty, { bold: true, spacing: 1.2 });

    // ── MODE zone — 2×2 dominant tile grid ─────────────────────────────
    // 280×140 cards (was 320×96 flat buttons). Default body = Palette.bg.card
    // (#1E2438 RGB 30/36/56). At h=140 ≥ BTN_CHROME_MIN_H, mkBtnXY adds
    // TopHighlight + BottomShadow chrome → premium raised-card feel. AppUI
    // runtime tints body teal + adds glow pulse on selected. tier='secondary'
    // promotes label fontSize to 24pt per ButtonTierSpec.
    const mpModeIndices = [];
    for (let i = 0; i < MPT.modeBtn.count; i++) {
        const key = MPT.modeBtn.keys[i];
        const label = MPT.modeBtn.labels[i];
        const pos = MPT.modeBtn.positions[i];
        const mN = mkBtnXY(sb, `Mode_${key}`, modePickerN, label,
            pos.x, pos.y, MPT.modeBtn.w, MPT.modeBtn.h, 26, 8, 32,
            { tier: 'secondary' });
        mpModeIndices.push(mN);
    }

    // ── SETTINGS zone — Duration pills (6×) ────────────────────────────
    // 92×52 (was 92×44); pill radius via 9-slice. Default = Palette.bg.pillTray
    // (#1F2438 RGB 31/36/56); selected tinted teal.
    const windowIndices = [];
    for (let w = 0; w < MPT.windowBtn.count; w++) {
        const wx = MPT.windowBtn.baseX + w * MPT.windowBtn.gapX;
        const wN = mkBtnXY(sb, `Window_${MPT.windowBtn.keys[w]}`, modePickerN,
            MPT.windowBtn.labels[w], wx, MPT.windowBtn.y,
            MPT.windowBtn.w, MPT.windowBtn.h, 31, 36, 56);
        windowIndices.push(wN);
    }

    // ── SETTINGS zone — Track toggle (Paper/Real, conditional) ─────────
    // Visible only for non-Bot/non-Guest flows; AppUI._refreshModePickerUi
    // toggles visibility and shifts everything below up by SHIFT=80 when
    // hidden. Paper-selected default uses Solana teal; Real ghost.
    const pickerPaperBtn = mkBtnXY(sb, 'PickerPaperToggle', modePickerN, 'Paper',
        MPE.paperToggle.x, MPE.paperToggle.y, MPE.paperToggle.w, MPE.paperToggle.h,
        20, 241, 149);
    const pickerRealBtn = mkBtnXY(sb, 'PickerRealToggle', modePickerN, 'Real',
        MPE.realToggle.x, MPE.realToggle.y, MPE.realToggle.w, MPE.realToggle.h,
        31, 36, 56);

    // ── SETTINGS zone — Difficulty pills (3×) ──────────────────────────
    // 184×56 (was 168×44); edge-to-edge spacing.
    const difficultyDefaultColors = [[31, 36, 56], [20, 241, 149], [31, 36, 56]];
    const difficultyBtns = [];
    for (let d = 0; d < MPT.difficultyBtn.count; d++) {
        const dx = MPT.difficultyBtn.baseX + d * MPT.difficultyBtn.gapX;
        const [r, g, b] = difficultyDefaultColors[d];
        const dN = mkBtnXY(sb, MPT.difficultyBtn.names[d], modePickerN, MPT.difficultyBtn.labels[d],
            dx, MPT.difficultyBtn.y, MPT.difficultyBtn.w, MPT.difficultyBtn.h, r, g, b);
        difficultyBtns.push(dN);
    }
    const [pickerEasyBtn, pickerMediumBtn, pickerHardBtn] = difficultyBtns;

    // ── SUMMARY zone — premium gold-edged commitment card ──────────────
    // 620×180. Inner gradient sprite child (PickerSummaryGradient) gives
    // "deep blue → black" feel. Labels stack: mode (h4 bold 26pt) →
    // modifiers (small mid 16pt) → stake hero (display gold 32pt mono w/
    // runtime addGlowPulse). Y-position is anchored to viewport bottom by
    // AppUI._relayoutModePickerToViewport.
    const MPSC = MPE.summaryCard;
    const summaryCardN = sb.e.length;
    sb.node('PickerSummaryCard', modePickerN, [], [], v3(MPSC.x, MPSC.y, 0));
    const summaryCardUT = sb.ut(summaryCardN, MPSC.w, MPSC.h);
    const summaryCardSpr = cardBodySpr(sb, summaryCardN);
    // Inner gradient — top half of card tinted violet at low alpha.
    const summaryGradientN = sb.e.length;
    sb.node('PickerSummaryGradient', summaryCardN, [], [], v3(0, MPSC.h * 0.25, 0));
    const summaryGradientUT = sb.ut(summaryGradientN, MPSC.w - 12, MPSC.h * 0.5);
    const summaryGradientSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(summaryGradientN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(153, 69, 255, 28),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[summaryGradientN]._components = [rf(summaryGradientUT), rf(summaryGradientSpr)];
    // Label Y values scaled to the 196h hero card (2026-05-01 polish).
    const summaryModeLbl = mkLabel(sb, 'PickerSummaryModeLabel', summaryCardN, '1v1 Duel', 26,
        56, 600, 32, 255, 255, 255);
    style(sb, summaryModeLbl, { bold: true });
    const summaryModifiersLbl = mkLabel(sb, 'PickerSummaryModifiersLabel', summaryCardN,
        '30s · Paper · Medium', 16, 14, 600, 22, 184, 184, 184);
    const summaryStakeLbl = mkLabel(sb, 'PickerSummaryStakeLabel', summaryCardN,
        'Stake: 0.05 SOL', 32, -50, 600, 42, 255, 210, 74);
    style(sb, summaryStakeLbl, { bold: true, mono: true });
    const summaryEdge = mkCardEdge(sb, summaryCardN, MPSC.w, MPSC.h, 255, 210, 74);
    sb.e[summaryCardN]._components = [rf(summaryCardUT), rf(summaryCardSpr)];
    sb.e[summaryCardN]._children = [
        rf(summaryGradientN),
        rf(summaryModeLbl), rf(summaryModifiersLbl), rf(summaryStakeLbl),
        rf(summaryEdge),
    ];

    // ── SUMMARY → CTA visual link — tiny gold connector chip ──────────
    // 16×14 gold sprite sitting between the summary card's bottom edge
    // and the CTA's top edge. Makes summary + CTA read as a single
    // commitment unit.
    const summaryConnectorN = sb.e.length;
    sb.node('PickerSummaryConnector', modePickerN, [], [],
        v3(MPE.summaryConnector.x, MPE.summaryConnector.y, 0));
    const summaryConnectorUT = sb.ut(summaryConnectorN, MPE.summaryConnector.w, MPE.summaryConnector.h);
    const summaryConnectorSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(summaryConnectorN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 210, 74, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[summaryConnectorN]._components = [rf(summaryConnectorUT), rf(summaryConnectorSpr)];

    // ── CTA zone — cinematic START DUEL launch hero ───────────────────
    // 2026-05-01 staging polish: 640×132 (was 632×120) for taller hero feel
    // edge-to-edge; copy "START DUEL" (was "Enter Match") to read as the
    // launch moment, not a navigation step; body color (123, 90, 255) — a
    // vibrant violet-blue stepped from Palette.accent.violet so the existing
    // hero glow halo + ripple read as a launch gradient. tier='primary' →
    // glowAlpha=110, glowPad=16. mkBtnHero builds BtnGlow_PickerStartButton +
    // Ripple_PickerStartButton siblings the existing enhancePrimaryCTA helper expects.
    const pickerStartBundle = mkBtnHero(sb, 'PickerStartButton', modePickerN, 'START DUEL',
        0, MPE.startBtn.y, MPE.startBtn.w, MPE.startBtn.h, 123, 90, 255,
        { tier: 'primary' });
    const pickerStartGlowN = pickerStartBundle.glow;
    const pickerStartBtn = pickerStartBundle.btn;

    // Cancel X — ghost neutral (was dark-red 55,30,30) so it doesn't compete
    // with the gold title.
    const pickerCancelBtn = mkBtnXY(sb, 'PickerCancelButton', modePickerN, '✕',
        MPE.cancelBtn.x, MPE.cancelBtn.y, MPE.cancelBtn.w, MPE.cancelBtn.h, 26, 8, 32,
        { tier: 'tertiary' });

    // Footer microcopy — "1v1 Duel · 0.05 SOL · 30s · Paper · medium". AppUI
    // _refreshModePickerUi seeds + updates the string on every state change;
    // diagnostic strings still take precedence on error.
    const pickerStatus = mkLabel(sb, 'PickerStatusLabel', modePickerN, '', 12,
        MPE.statusLbl.y, MPE.statusLbl.w, MPE.statusLbl.h, 184, 184, 184);

    sb.e[modePickerN]._components = [rf(mpUT), rf(mpSpr), rf(mpScrimBtn)];
    // Backdrop FIRST so gradient + glow render behind all interactive content.
    // Hero glow halo (BtnGlow_PickerStartButton) is a sibling of the CTA and
    // must render BEFORE the CTA so the halo sits behind it.
    const startBtnChildren = [];
    if (pickerStartGlowN >= 0) startBtnChildren.push(rf(pickerStartGlowN));
    startBtnChildren.push(rf(pickerStartBtn));
    sb.e[modePickerN]._children = [
        rf(mpBackdropN),
        rf(pickerBackBtn), rf(pickerCancelBtn),
        rf(mpTitle), rf(mpTitleDividerN), rf(mpSubtitle),
        rf(mpSecMode),       ...mpModeIndices.map(rf),
        rf(mpSecDuration),   ...windowIndices.map(rf),
        rf(mpSecTrack),      rf(pickerPaperBtn), rf(pickerRealBtn),
        rf(mpSecDifficulty), rf(pickerEasyBtn), rf(pickerMediumBtn), rf(pickerHardBtn),
        rf(summaryCardN), rf(summaryConnectorN),
        ...startBtnChildren,
        rf(pickerStatus),
    ];
    sb.e[modePickerN]._active = false;

    // SquadDropOverlay — modal that appears when user taps Manage Squad.
    // Darkened scrim + tap-outside-close + 3 DropPill children from
    // LAYOUT.TokenDuelPanel.templates.squadDropPill.
    const SDO = TDE.squadDropOverlay;
    const SDP = TDT.squadDropPill;
    const dropOverlayN = sb.e.length;
    sb.node('SquadDropOverlay', tdN, [], [], v3(SDO.x, SDO.y, 0));
    const dropOvUT = sb.ut(dropOverlayN, SDO.w, SDO.h);
    const dropOvSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(dropOverlayN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 180),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const dropOvBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(dropOverlayN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(dropOverlayN), _id: gid(),
    });
    const dropModalHeaderN = mkLabel(sb, 'SquadDropTitleLabel', dropOverlayN, 'DROP FROM SQUAD', 14,
        TDE.squadDropTitle.y, TDE.squadDropTitle.w, TDE.squadDropTitle.h, 140, 140, 140);
    style(sb, dropModalHeaderN, { spacing: 1 });  // Phase 15 (B5)
    const dropModalHintN = mkLabel(sb, 'SquadDropHintLabel', dropOverlayN, 'Tap a token to remove · Tap outside to close', 11,
        TDE.squadDropHint.y, TDE.squadDropHint.w, TDE.squadDropHint.h, 184, 184, 184);
    const dropPillIndices = [];
    for (let d = 0; d < SDP.count; d++) {
        const pN = mkBtnXY(sb, `DropPill_${d}`, dropOverlayN, '—',
            0, SDP.ys[d], SDP.w, SDP.h, 38, 44, 64);
        dropPillIndices.push(pN);
        sb.e[pN]._active = false;
    }
    sb.e[dropOverlayN]._components = [rf(dropOvUT), rf(dropOvSpr), rf(dropOvBtn)];
    sb.e[dropOverlayN]._children = [rf(dropModalHeaderN), rf(dropModalHintN), ...dropPillIndices.map(rf)];
    sb.e[dropOverlayN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 10 Bundle 3 / pt2: SquadPresetsOverlay — manage saved squads.
    // Scrim + tap-outside-close (PresetsScrim), title, 5 PresetRow nodes
    // with delete buttons, bottom Save button, and a PresetNameModal with
    // EditBox for naming a new preset.
    // ═══════════════════════════════════════════════════════════════
    // SquadPresetsOverlay — manage saved squads. All positions sourced from
    // LAYOUT.TokenDuelPanel.elements.presets* and templates.presetRow.
    const SPO = TDE.squadPresetsOverlay;
    const PR  = TDT.presetRow;
    const presetsOvN = sb.e.length;
    sb.node('SquadPresetsOverlay', tdN, [], [], v3(SPO.x, SPO.y, 0));
    const presetsOvUT = sb.ut(presetsOvN, SPO.w, SPO.h);
    const presetsOvSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(presetsOvN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        // UX Phase 2d: fully opaque modal bg (was alpha=180 → content bled through).
        // Color = Palette.bg.primary so the modal blends with the app UI.
        _color: cl(10, 4, 16, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // Scrim button — covers the full overlay, tap-outside-to-close.
    const presetsScrimBtn = mkBtnXY(sb, 'PresetsScrim', presetsOvN, '',
        TDE.presetsScrim.x, TDE.presetsScrim.y, TDE.presetsScrim.w, TDE.presetsScrim.h, 0, 0, 0);
    // Zero-alpha button bg so the scrim sprite color stays dominant.
    sb.e[sb.e[presetsScrimBtn]._components[1].__id__]._color = cl(0, 0, 0, 0);
    const presetsTitle = mkLabel(sb, 'PresetsTitleLabel', presetsOvN, 'SQUAD PRESETS', 24,
        TDE.presetsTitle.y, TDE.presetsTitle.w, TDE.presetsTitle.h, 255, 210, 74);
    style(sb, presetsTitle, { spacing: 1 });  // Phase 15 (B5)
    const presetsHint = mkLabel(sb, 'PresetsHintLabel', presetsOvN, 'Tap a preset to load · swipe or tap delete to remove', 11,
        TDE.presetsHint.y, TDE.presetsHint.w, TDE.presetsHint.h, 184, 184, 184);

    // 5 preset rows from templates.presetRow.
    const presetRowIndices = [];
    for (let i = 0; i < PR.count; i++) {
        const rN = sb.e.length;
        sb.node(`PresetRow_${i}`, presetsOvN, [], [], v3(0, PR.ys[i], 0));
        const rUT = sb.ut(rN, PR.w, PR.h);
        const rSpr = sb.spr(rN, 26, 8, 32);
        const rBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(rN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.02, _target: rf(rN), _id: gid(),
        });
        const nameL = mkLabel(sb, `PresetNameLabel_${i}`, rN, '—', 18, 0, PR.name.w, PR.name.h, 255, 255, 255);
        sb.e[nameL]._lpos = v3(PR.name.x, PR.name.y, 0);
        sb.e[sb.e[nameL]._components[1].__id__]._horizontalAlign = 0;
        const symbolsL = mkLabel(sb, `PresetSymbolsLabel_${i}`, rN, '', 13, 0, PR.symbols.w, PR.symbols.h, 184, 184, 184);
        sb.e[symbolsL]._lpos = v3(PR.symbols.x, PR.symbols.y, 0);
        sb.e[sb.e[symbolsL]._components[1].__id__]._horizontalAlign = 0;
        // UX Phase 2b: empty label; AppUI attaches IconBadge trash.
        const delBtn = mkBtnXY(sb, `PresetDeleteButton_${i}`, rN, '',
            PR.deleteBtn.x, PR.deleteBtn.y, PR.deleteBtn.w, PR.deleteBtn.h, 55, 30, 30);
        sb.e[rN]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
        sb.e[rN]._children = [rf(nameL), rf(symbolsL), rf(delBtn)];
        sb.e[rN]._active = false; // AppUI enables when render finds saved preset
        presetRowIndices.push(rN);
    }
    // Save button — opens the PresetNameModal. Disabled (grayed) when squad not full.
    const presetsSaveBtn = mkBtn(sb, 'PresetSaveButton', presetsOvN, 'Save current squad',
        TDE.presetsSaveButton.y, TDE.presetsSaveButton.w, TDE.presetsSaveButton.h, 255, 210, 74,
        { tier: 'secondary' });
    style(sb, presetsSaveBtn, { bold: true });
    const presetsEmptyL = mkLabel(sb, 'PresetsEmptyLabel', presetsOvN, 'No saved presets yet — pick 3 tokens and tap Save', 13,
        TDE.presetsEmptyLabel.y, TDE.presetsEmptyLabel.w, TDE.presetsEmptyLabel.h, 130, 140, 160);
    sb.e[presetsEmptyL]._active = false;

    // PresetNameModal — small card with EditBox + Save/Cancel buttons.
    const PM = TDE.presetsModal;
    const presetsModalN = sb.e.length;
    sb.node('PresetNameModal', presetsOvN, [], [], v3(PM.x, PM.y, 0));
    const presetsModalUT = sb.ut(presetsModalN, PM.w, PM.h);
    const presetsModalSpr = sb.spr(presetsModalN, 36, 16, 48);
    const presetsModalTitle = mkLabel(sb, 'PresetModalTitleLabel', presetsModalN, 'Name your preset', 16,
        TDE.presetsModalTitle.y, TDE.presetsModalTitle.w, TDE.presetsModalTitle.h, 200, 210, 230);
    const presetNameEB = mkEditBox(sb, 'PresetNameEditBox', presetsModalN, 'e.g. "Meme Monday"',
        TDE.presetsModalEditBox.x, TDE.presetsModalEditBox.y,
        TDE.presetsModalEditBox.w, TDE.presetsModalEditBox.h, 17);
    const presetModalSave = mkBtnXY(sb, 'PresetSaveConfirmButton', presetsModalN, 'Save',
        TDE.presetsModalSave.x, TDE.presetsModalSave.y,
        TDE.presetsModalSave.w, TDE.presetsModalSave.h, 48, 198, 155);
    const presetModalCancel = mkBtnXY(sb, 'PresetSaveCancelButton', presetsModalN, 'Cancel',
        TDE.presetsModalCancel.x, TDE.presetsModalCancel.y,
        TDE.presetsModalCancel.w, TDE.presetsModalCancel.h, 62, 72, 92);
    sb.e[presetsModalN]._components = [rf(presetsModalUT), rf(presetsModalSpr)];
    sb.e[presetsModalN]._children = [rf(presetsModalTitle), rf(presetNameEB), rf(presetModalSave), rf(presetModalCancel)];
    sb.e[presetsModalN]._active = false;

    sb.e[presetsOvN]._components = [rf(presetsOvUT), rf(presetsOvSpr)];
    sb.e[presetsOvN]._children = [
        rf(presetsScrimBtn),
        rf(presetsTitle), rf(presetsHint),
        ...presetRowIndices.map(rf),
        rf(presetsSaveBtn), rf(presetsEmptyL),
        rf(presetsModalN),
    ];
    sb.e[presetsOvN]._active = false;

    // Invisible full-panel BackdropButton for tap-outside-close. Position
    // from LAYOUT.TokenDuelPanel.elements.backdropButton.
    const BB = TDE.backdropButton;
    const tdBackdrop = sb.e.length;
    sb.node('BackdropButton', tdN, [], [], v3(BB.x, BB.y, 0));
    const tdBackdropUT = sb.ut(tdBackdrop, BB.w, BB.h);
    const tdBackdropSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdBackdrop), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 1),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const tdBackdropBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdBackdrop), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(tdBackdrop), _id: gid(),
    });
    sb.e[tdBackdrop]._components = [rf(tdBackdropUT), rf(tdBackdropSpr), rf(tdBackdropBtn)];
    sb.e[tdBackdrop]._active = false;

    // 2026-04-27 — Row-tap popover (Pick + / View Chart). Hidden by default;
    // AppUI._onFeedRowTap (default branch) re-anchors and shows it.
    const RAP = TDE.rowActionPopover;
    const tdRowActionPop = sb.e.length;
    sb.node('RowActionPopover', tdN, [], [], v3(RAP.x, RAP.y, 0));
    const tdRowActionPopUT = sb.ut(tdRowActionPop, RAP.w, RAP.h);
    const tdRowActionPopSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdRowActionPop), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 25, 38, 235),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdRowActionPop]._components = [rf(tdRowActionPopUT), rf(tdRowActionPopSpr)];
    const tdRowActionPickBtn = mkBtnXY(sb, 'RowActionPickButton', tdRowActionPop, '+ Pick',
        TDE.rowActionPickBtn.x, TDE.rowActionPickBtn.y,
        TDE.rowActionPickBtn.w, TDE.rowActionPickBtn.h, 56, 148, 252);
    style(sb, tdRowActionPickBtn, { bold: true });
    const tdRowActionChartBtn = mkBtnXY(sb, 'RowActionChartButton', tdRowActionPop, 'View Chart',
        TDE.rowActionChartBtn.x, TDE.rowActionChartBtn.y,
        TDE.rowActionChartBtn.w, TDE.rowActionChartBtn.h, 40, 50, 70);
    sb.e[tdRowActionPop]._children = [rf(tdRowActionPickBtn), rf(tdRowActionChartBtn)];
    sb.e[tdRowActionPop]._active = false;

    // SearchSuggestionPopover — 5 pre-instantiated rows from suggestRow template.
    // Rendered LAST in children order so it overlays the feed when visible.
    // Hidden by default; AppUI toggles _active via SearchEditBox text events.
    const SSP = TDE.searchSuggestionPopover;
    const suggestN = sb.e.length;
    sb.node('SearchSuggestionPopover', tdN, [], [], v3(SSP.x, SSP.y, 0));
    const suggUT = sb.ut(suggestN, SSP.w, SSP.h);
    const suggSpr = sb.spr(suggestN, 25, 28, 44);
    // 5 suggestion rows from LAYOUT.TokenDuelPanel.templates.suggestRow.
    const SR = TDT.suggestRow;
    const suggestChildIdx = [];
    for (let s = 0; s < SR.count; s++) {
        const sY = SR.baseY - s * SR.rowH;
        const sN = sb.e.length;
        sb.node(`Suggest_${s}`, suggestN, [], [], v3(0, sY, 0));
        const sUT = sb.ut(sN, SR.w, SR.h);
        const sSpr = sb.spr(sN, 38, 40, 58);
        const sBtn = sb.btn(sN, 38, 40, 58);

        const sLogoN = sb.e.length;
        sb.node('LogoSprite', sN, [], [], v3(SR.logo.x, SR.logo.y, 0));
        const sLogoUT = sb.ut(sLogoN, SR.logo.w, SR.logo.h);
        const sLogoSpr = sb.spr(sLogoN, 255, 255, 255);
        sb.e[sLogoN]._components = [rf(sLogoUT), rf(sLogoSpr)];

        const sSymN = sb.e.length;
        sb.node('SymbolLabel', sN, [], [], v3(SR.symbol.x, SR.symbol.y, 0));
        const sSymUT = sb.ut(sSymN, SR.symbol.w, SR.symbol.h);
        const sSymL  = sb.lbl(sSymN, '—', 18, 255, 255, 255);
        sb.e[sSymL]._horizontalAlign = 0;
        sb.e[sSymL]._isBold = true;
        sb.e[sSymN]._components = [rf(sSymUT), rf(sSymL)];

        const sMintN = sb.e.length;
        sb.node('MintLabel', sN, [], [], v3(SR.mint.x, SR.mint.y, 0));
        const sMintUT = sb.ut(sMintN, SR.mint.w, SR.mint.h);
        const sMintL  = sb.lbl(sMintN, '', 12, 130, 130, 145);
        sb.e[sMintL]._horizontalAlign = 0;
        sb.e[sMintN]._components = [rf(sMintUT), rf(sMintL)];

        const sPriceN = sb.e.length;
        sb.node('PriceLabel', sN, [], [], v3(SR.price.x, SR.price.y, 0));
        const sPriceUT = sb.ut(sPriceN, SR.price.w, SR.price.h);
        const sPriceL  = sb.lbl(sPriceN, '', 14, 255, 210, 74);
        sb.e[sPriceN]._components = [rf(sPriceUT), rf(sPriceL)];

        const sVolN = sb.e.length;
        sb.node('VolLabel', sN, [], [], v3(SR.vol.x, SR.vol.y, 0));
        const sVolUT = sb.ut(sVolN, SR.vol.w, SR.vol.h);
        const sVolL  = sb.lbl(sVolN, '', 12, 170, 170, 180);
        sb.e[sVolN]._components = [rf(sVolUT), rf(sVolL)];

        const sChangeN = sb.e.length;
        sb.node('ChangeLabel', sN, [], [], v3(SR.change.x, SR.change.y, 0));
        const sChangeUT = sb.ut(sChangeN, SR.change.w, SR.change.h);
        const sChangeL  = sb.lbl(sChangeN, '', 12, 200, 200, 200);
        sb.e[sChangeN]._components = [rf(sChangeUT), rf(sChangeL)];

        sb.e[sN]._components = [rf(sUT), rf(sSpr), rf(sBtn)];
        sb.e[sN]._children = [rf(sLogoN), rf(sSymN), rf(sMintN), rf(sPriceN), rf(sVolN), rf(sChangeN)];
        sb.e[sN]._active = false; // hidden when no suggestion at index s
        suggestChildIdx.push(sN);
    }
    sb.e[suggestN]._components = [rf(suggUT), rf(suggSpr)];
    sb.e[suggestN]._children = suggestChildIdx.map(rf);
    sb.e[suggestN]._active = false;

    // Patch TokenDuelPanel children. Order IS the draw order: later indices
    // render on top. Dropdown popover + search suggestions + game overlay go
    // near the end so they cover the feed when active.
    sb.e[tdN]._children = [
        rf(tdBackLink), rf(tdBackBtn),
        rf(tdTitleBg),                                         // 2026-04-26 — full-width black bar BEHIND title
        rf(tdTitle), rf(tdSubtitle), rf(tdHeaderUnderline),    // 2026-05-02 token-picker UX — DRAFT YOUR SQUAD eyebrow under title
        rf(tdLevelChipN), rf(tdSolPillN),                      // 2026-04-26 v2 — two separate pills (Lv + SOL)
        rf(tdSettingsBtn),
        rf(tdPresetsBtn), rf(tdSuggestBtn), rf(tdHelpBtn),
        rf(matchSetupCardN),                                  // 2026-04-26 redesign — Match Setup Summary Card
        rf(tdFrameCard),                                      // 2026-04-26 unified — frame card sits BEHIND Row 1/2/headers/feed
        rf(tdSearch), rf(tdSearchClear), rf(tdSearchAccent),
        rf(tdTabDropdown), rf(tdWatchStar), rf(tdWatchCancel), rf(tdLiveLbl),
        ...chipIndices.map(rf), rf(tdMinLiqBtn), rf(tdColumnsBtn),
        rf(headerGroupN),
        rf(tdFeedSV),
        rf(tdFeedAccentTop),                                  // 2026-04-26 — teal stripe top of token list (bottom removed 2026-04-27)
        rf(squadAmbientGlowN),                                // 2026-05-01 squad-select pass — soft halo BEHIND squad panel
        rf(squadPanelN),                                      // 2026-04-26 redesign — Sticky Squad Panel wrapper (renders BEHIND squad/wager nodes)
        // Global Pick / Manage Squad removed 2026-04-26 — slot-level Pick + + per-slot × replaces them.
        rf(tdSquadEyebrow), rf(tdSquadEyebrowRuleL), rf(tdSquadEyebrowRuleR), rf(tdSquadHeader), rf(tdSquadRule),  // 2026-04-29b — hero header band (eyebrow + flanking hairlines + label + bottom hairline)
        rf(tdSquad0), rf(tdSquad1), rf(tdSquad2),
        rf(tdStakeHeader), rf(tdStakeValueLabel), rf(tdStakeSlider),
        rf(tdStake001), rf(tdStake010), rf(tdStake100),
        rf(tdCommit), rf(tdStartGame), rf(tdClaim),
        rf(tdWagerDivider),                                   // 2026-04-29b — hairline above stake+CTA commitment row
        rf(tdWagerValueBtn), rf(tdWagerStartGlow), rf(tdWagerStartBtn), rf(tdWagerHint), rf(tdWagerLockChip), rf(tdWagerBotChip), rf(tdWagerDropdown),
        rf(tdHero1), rf(tdHero2), rf(tdHero3),
        rf(h1N), rf(h2N), rf(h3N),
        rf(tdGameArea), rf(tdGameOver),                       // 2026-04-29: racePanelN moved to canvas root
        rf(tdBackdrop),                                       // below popovers for tap-outside-close
        rf(tdRowActionPop),                                   // Pick + / View Chart popover (above backdrop)
        rf(popN), rf(minLiqPopN), rf(liqSortPopN), rf(colPopN), rf(suggestN),
        rf(dropOverlayN),
        rf(modePickerN),                                      // Session D Part 2 (top-most overlay)
        rf(tdStatus),
    ];
    sb.e[tdN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session 13 — TOKEN DETAIL PANEL (chart + stats)
    // Sibling of TokenDuelPanel. Shown when user taps a feed row.
    // 2026-04-28 scouting redesign:
    //   +612  Identity band — ← Back · centered $SYMBOL/Name · MintChip
    //   +552  Slim premium CTA (560×42) with teal halo
    //   +506  SAFETY label  · +474 4 safety chips
    //   +446  RANGE label   · +414 6 timeframe buttons
    //   +386  VIEW / UNIT labels · +354 4 denom toggles
    //    +60  ChartCard (680×600 opaque) — header inside + ChartArea
    //   -310  TOKEN STATS label · -365/-445 6-card grid w/ edge accents
    //   -625  Status line
    // ═══════════════════════════════════════════════════════════════
    const tdetN = sb.e.length;
    sb.node('TokenDetailPanel', canvas, [], [], lobbyMount('TokenDetailPanel'));
    sb.ut(tdetN, 720, 1280);
    sb.spr(tdetN, 10, 14, 22); // Phase 25: dark-slate backdrop hides BackgroundFX halos behind chart/stats

    // Chrome from LAYOUT.TokenDetailPanel.elements.
    const TDETE = LAYOUT.TokenDetailPanel.elements;

    // ─── Identity band ───────────────────────────────────────────────
    logBackParity('TokenDetailPanel', TDETE.backLink.y);
    const detBackLink = mkLabel(sb, 'BackLinkLabel', tdetN, '← Back', 18,
        TDETE.backLink.y, TDETE.backLink.w, TDETE.backLink.h, 200, 210, 230);
    sb.e[detBackLink]._lpos = v3(TDETE.backLink.x, TDETE.backLink.y, 0);
    const detBackLinkL = sb.e[detBackLink]._components[1].__id__;
    sb.e[detBackLinkL]._horizontalAlign = 0;
    const detBackBtn = sb.e.length;
    sb.node('BackButton', tdetN, [], [], v3(TDETE.backBtn.x, TDETE.backBtn.y, 0));
    const detBackBtnUT = sb.ut(detBackBtn, TDETE.backBtn.w, TDETE.backBtn.h);
    const detBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(detBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(detBackBtn), _id: gid(),
    });
    sb.e[detBackBtn]._components = [rf(detBackBtnUT), rf(detBackBtnBtn)];

    // Symbol (hero) + Name (secondary), centered as a single identity block.
    const detSymbol = mkLabel(sb, 'DetailSymbolLabel', tdetN, '$—', 26,
        TDETE.symbolLabel.y, TDETE.symbolLabel.w, TDETE.symbolLabel.h, 255, 255, 255);
    sb.e[detSymbol]._lpos = v3(TDETE.symbolLabel.x, TDETE.symbolLabel.y, 0);
    style(sb, detSymbol, { bold: true, spacing: 1 });
    const detName = mkLabel(sb, 'DetailNameLabel', tdetN, '', 13,
        TDETE.nameLabel.y, TDETE.nameLabel.w, TDETE.nameLabel.h, 184, 184, 184);
    sb.e[detName]._lpos = v3(TDETE.nameLabel.x, TDETE.nameLabel.y, 0);

    // MintChip — small pill at the right edge of the identity row.
    const detMintChip = mkBtnXY(sb, 'DetailMintChip', tdetN, 'mint…',
        TDETE.mintChip.x, TDETE.mintChip.y, TDETE.mintChip.w, TDETE.mintChip.h, 36, 16, 48);
    style(sb, detMintChip, { spacing: 1, fontSize: 12 });

    // ─── Slim premium CTA — SECONDARY (sub-CTA inside detail panel; primary
    // hero is the panel-level Start Match button).
    const detPickHero = mkBtnHero(sb, 'DetailPickUnpickButton', tdetN, '+ Pick Token',
        0, TDETE.pickBtn.y, TDETE.pickBtn.w, TDETE.pickBtn.h, 48, 198, 155, { tier: 'secondary' });
    const detPickGlow = detPickHero.glow;
    const detPickBtn  = detPickHero.btn;

    // ─── Section labels (uppercase mini, lo-tier) ────────────────────
    const detSafetyHdr = mkLabel(sb, 'SafetyHeaderLabel', tdetN, 'SAFETY', 11,
        TDETE.safetyHeader.y, TDETE.safetyHeader.w, TDETE.safetyHeader.h, 140, 140, 140);
    sb.e[detSafetyHdr]._lpos = v3(TDETE.safetyHeader.x, TDETE.safetyHeader.y, 0);
    const detSafetyHdrL = sb.e[detSafetyHdr]._components[1].__id__;
    sb.e[detSafetyHdrL]._horizontalAlign = 0;
    sb.e[detSafetyHdrL]._spacingX = 2;

    const detRangeHdr = mkLabel(sb, 'RangeHeaderLabel', tdetN, 'RANGE', 11,
        TDETE.rangeHeader.y, TDETE.rangeHeader.w, TDETE.rangeHeader.h, 140, 140, 140);
    sb.e[detRangeHdr]._lpos = v3(TDETE.rangeHeader.x, TDETE.rangeHeader.y, 0);
    const detRangeHdrL = sb.e[detRangeHdr]._components[1].__id__;
    sb.e[detRangeHdrL]._horizontalAlign = 0;
    sb.e[detRangeHdrL]._spacingX = 2;

    const detViewHdr = mkLabel(sb, 'ViewHeaderLabel', tdetN, 'VIEW', 11,
        TDETE.viewHeader.y, TDETE.viewHeader.w, TDETE.viewHeader.h, 140, 140, 140);
    sb.e[detViewHdr]._lpos = v3(TDETE.viewHeader.x, TDETE.viewHeader.y, 0);
    const detViewHdrL = sb.e[detViewHdr]._components[1].__id__;
    sb.e[detViewHdrL]._horizontalAlign = 0;
    sb.e[detViewHdrL]._spacingX = 2;

    const detUnitHdr = mkLabel(sb, 'UnitHeaderLabel', tdetN, 'UNIT', 11,
        TDETE.unitHeader.y, TDETE.unitHeader.w, TDETE.unitHeader.h, 140, 140, 140);
    sb.e[detUnitHdr]._lpos = v3(TDETE.unitHeader.x, TDETE.unitHeader.y, 0);
    const detUnitHdrL = sb.e[detUnitHdr]._components[1].__id__;
    sb.e[detUnitHdrL]._horizontalAlign = 0;
    sb.e[detUnitHdrL]._spacingX = 2;

    // ─── Safety chips row ────────────────────────────────────────────
    const SC = LAYOUT.TokenDetailPanel.templates.safetyChip;
    const safetyIndices = [];
    for (let s = 0; s < SC.count; s++) {
        const sx = SC.baseX + s * SC.gapX;
        const sN = mkBtnXY(sb, `SafetyChip_${SC.defs[s].key}`, tdetN, SC.defs[s].label,
            sx, SC.y, SC.w, SC.h, 36, 16, 48);
        style(sb, sN, { fontSize: 13 });
        safetyIndices.push(sN);
    }

    // ─── Timeframe segmented control ─────────────────────────────────
    const TF = LAYOUT.TokenDetailPanel.templates.timeframeBtn;
    const tfIndices = [];
    for (let t = 0; t < TF.count; t++) {
        const tx = TF.baseX + t * TF.gapX;
        const tN = mkBtnXY(sb, `TF_${TF.defs[t].key}`, tdetN, TF.defs[t].label,
            tx, TF.y, TF.w, TF.h, 36, 16, 48);
        tfIndices.push(tN);
    }

    // ─── Denom toggles (paired Price/MCap | USD/SOL) ─────────────────
    const DB = LAYOUT.TokenDetailPanel.templates.denomBtn;
    const denomBtnIndices = [];
    for (const d of DB.defs) {
        const dN = mkBtnXY(sb, `Denom_${d.key}`, tdetN, d.label,
            d.x, DB.y, DB.w, DB.h, 36, 16, 48);
        style(sb, dN, { fontSize: 12 });
        denomBtnIndices.push(dN);
    }
    const [denomPriceBtn, denomMcapBtn, denomUsdBtn, denomSolBtn] = denomBtnIndices;

    // ─── Hairline divider between control band and ChartCard ────────
    const chartDivN = sb.e.length;
    sb.node('ChartDivider', tdetN, [], [],
        v3(TDETE.chartDivider.x, TDETE.chartDivider.y, 0));
    const chartDivUT = sb.ut(chartDivN, TDETE.chartDivider.w, TDETE.chartDivider.h);
    const chartDivSpr = sb.spr(chartDivN, 56, 148, 252);
    sb.e[chartDivSpr]._color = cl(56, 148, 252, 60);
    sb.e[chartDivN]._components = [rf(chartDivUT), rf(chartDivSpr)];

    // ─── Chart card wrapper (opaque, blocks BG halo bleed) ───────────
    const chartCardN = sb.e.length;
    sb.node('ChartCard', tdetN, [], [], v3(TDETE.chartCard.x, TDETE.chartCard.y, 0));
    const chartCardUT = sb.ut(chartCardN, TDETE.chartCard.w, TDETE.chartCard.h);
    const chartCardSpr = cardBodySpr(sb, chartCardN);
    sb.e[chartCardN]._components = [rf(chartCardUT), rf(chartCardSpr)];

    // Subtle blue hairline at top of chart card (low alpha = framing, not loud).
    const chartCardEdge = mkCardEdge(sb, chartCardN, TDETE.chartCard.w, TDETE.chartCard.h, 56, 148, 252, 80);

    // Chart header label inside the card — "PRICE · 15m · USD" (AppUI rewrites).
    // Anchored top-left INSIDE ChartCard (left-aligned, dim) so it reads as a
    // caption, not a centered title-bar.
    const chartHeaderLbl = mkLabel(sb, 'ChartHeaderLabel', chartCardN, 'PRICE · 15m · USD', 11,
        TDETE.chartHeader.y, TDETE.chartHeader.w, TDETE.chartHeader.h, 125, 134, 158);
    sb.e[chartHeaderLbl]._lpos = v3(TDETE.chartHeader.x, TDETE.chartHeader.y, 0);
    const chartHeaderLblL = sb.e[chartHeaderLbl]._components[1].__id__;
    sb.e[chartHeaderLblL]._horizontalAlign = 0; // 0 = LEFT
    sb.e[chartHeaderLblL]._color = cl(125, 134, 158, 180);
    sb.e[chartHeaderLblL]._spacingX = 2;

    // ChartArea — cc.Graphics surface for candles + volume bars.
    const chartN = sb.e.length;
    sb.node('ChartArea', chartCardN, [], [], v3(TDETE.chartArea.x, TDETE.chartArea.y, 0));
    const chartUT = sb.ut(chartN, TDETE.chartArea.w, TDETE.chartArea.h);
    const chartGfx = sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(chartN), _enabled: true, __prefab: null,
        _materials: [], _visFlags: 0,
        _srcBlendFactor: 2, _dstBlendFactor: 4,
        _lineWidth: 1, _strokeColor: cl(48, 198, 155, 255), _fillColor: cl(48, 198, 155, 255),
        _lineJoin: 2, _lineCap: 0, _miterLimit: 10,
        _id: gid(),
    });
    sb.e[chartN]._components = [rf(chartUT), rf(chartGfx)];

    // Chart placeholder label (shown while loading) — child of ChartArea.
    const chartLoadLbl = mkLabel(sb, 'ChartStatusLabel', chartN, 'Loading chart…', 14,
        TDETE.chartLoadLabel.y, TDETE.chartLoadLabel.w, TDETE.chartLoadLabel.h, 184, 184, 184);

    sb.e[chartCardN]._children = [rf(chartCardEdge), rf(chartHeaderLbl), rf(chartN)];

    // ─── Token Stats label ───────────────────────────────────────────
    const detStatsHdr = mkLabel(sb, 'StatsHeaderLabel', tdetN, 'TOKEN STATS', 11,
        TDETE.statsHeader.y, TDETE.statsHeader.w, TDETE.statsHeader.h, 140, 140, 140);
    sb.e[detStatsHdr]._lpos = v3(TDETE.statsHeader.x, TDETE.statsHeader.y, 0);
    const detStatsHdrL = sb.e[detStatsHdr]._components[1].__id__;
    sb.e[detStatsHdrL]._horizontalAlign = 0;
    sb.e[detStatsHdrL]._spacingX = 2;

    // ─── Stats grid: 6 cards with per-def edge accent colors ─────────
    // Accent palette (Palette.cardEdge.*):
    //   amber=255,210,74  blue=56,148,252  slate=93,100,133  dynamic=168,174,201
    const STAT_ACCENT = {
        amber:   [255, 210,  74],
        blue:    [ 56, 148, 252],
        slate:   [ 140, 140, 140],
        dynamic: [184, 184, 184], // neutral default — AppUI recolors at runtime
    };
    const DSC = LAYOUT.TokenDetailPanel.templates.detailStatCard;
    const statIndices = [];
    for (const d of DSC.defs) {
        const cardN = sb.e.length;
        sb.node(`StatCard_${d.key}`, tdetN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, DSC.w, DSC.h);
        const cardSpr = cardBodySpr(sb, cardN);
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(DSC.header.x, DSC.header.y, 0));
        const lblUT = sb.ut(lblN, DSC.header.w, DSC.header.h);
        const lblL  = sb.lbl(lblN, d.label, 10, 140, 140, 140);
        sb.e[lblL]._spacingX = 1;
        sb.e[lblN]._components = [rf(lblUT), rf(lblL)];
        const valN = sb.e.length;
        sb.node('Value', cardN, [], [], v3(DSC.value.x, DSC.value.y, 0));
        const valUT = sb.ut(valN, DSC.value.w, DSC.value.h);
        const valL  = sb.lbl(valN, '—', 20, 255, 255, 255);
        sb.e[valL]._isBold = true;
        sb.e[valN]._components = [rf(valUT), rf(valL)];
        const accent = STAT_ACCENT[d.accent] ?? STAT_ACCENT.blue;
        const detEdge = mkCardEdge(sb, cardN, DSC.w, DSC.h, accent[0], accent[1], accent[2]);
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(lblN), rf(valN), rf(detEdge)];
        statIndices.push(cardN);
    }

    const detStatus = mkLabel(sb, 'DetailStatusLabel', tdetN, '', 13,
        TDETE.status.y, TDETE.status.w, TDETE.status.h, 184, 184, 184);

    sb.e[tdetN]._children = [
        rf(detBackLink), rf(detBackBtn),
        rf(detSymbol), rf(detName), rf(detMintChip),
        rf(detPickGlow), rf(detPickBtn),
        rf(detSafetyHdr), rf(detRangeHdr), rf(detViewHdr), rf(detUnitHdr),
        ...safetyIndices.map(rf),
        ...tfIndices.map(rf),
        rf(denomPriceBtn), rf(denomMcapBtn), rf(denomUsdBtn), rf(denomSolBtn),
        rf(chartDivN),
        rf(chartCardN),
        rf(detStatsHdr),
        ...statIndices.map(rf),
        rf(detStatus),
    ];
    sb.e[tdetN]._active = false; // hidden until a row is opened

    // ═══════════════════════════════════════════════════════════════
    // Session 14 C2 — LEADERBOARD PANEL (full-screen list of top 10)
    // ═══════════════════════════════════════════════════════════════
    // All LeaderboardPanel positions sourced from LAYOUT.LeaderboardPanel.
    const LP = LAYOUT.LeaderboardPanel.elements;
    const LPT = LAYOUT.LeaderboardPanel.templates;

    const lbN = sb.e.length;
    sb.node('LeaderboardPanel', canvas, [], [], lobbyMount('LeaderboardPanel'));
    sb.ut(lbN, LAYOUT.LeaderboardPanel.canvas.w, LAYOUT.LeaderboardPanel.canvas.h);
    sb.spr(lbN, 10, 14, 22); // Phase 25: dark-slate backdrop hides BackgroundFX halos behind rank rows

    // 2026-04-30 UX polish — full-canvas content scrim. Mirrors HomeContentScrim
    // (generate-scenes.js:1546) and FindMatchContentScrim. Sits FIRST in panel
    // children so the parent BackgroundFX (starfield + violet/teal glows) does
    // not bleed through the leaderboard rows. Color = Palette.bg.primary @ alpha
    // 110 — same recipe as the home + find-match scrim treatment.
    const lbScrimN = sb.e.length;
    sb.node('LeaderboardContentScrim', lbN, [], [], v3(LP.leaderboardContentScrim.x, LP.leaderboardContentScrim.y, 0));
    const lbScrimUT = sb.ut(lbScrimN, LP.leaderboardContentScrim.w, LP.leaderboardContentScrim.h);
    const lbScrimSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(lbScrimN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.primary.r, P.bg.primary.g, P.bg.primary.b, 110),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[lbScrimN]._components = [rf(lbScrimUT), rf(lbScrimSpr)];

    logBackParity('LeaderboardPanel', LP.backLink.y);
    const lbBackLink = mkLabel(sb, 'BackLinkLabel', lbN, '← Back', 18,
        LP.backLink.y, LP.backLink.w, LP.backLink.h, 200, 210, 230);
    sb.e[lbBackLink]._lpos = v3(LP.backLink.x, LP.backLink.y, 0);
    const lbBackLinkL = sb.e[lbBackLink]._components[1].__id__;
    sb.e[lbBackLinkL]._horizontalAlign = 0;
    const lbBackBtn = sb.e.length;
    sb.node('BackButton', lbN, [], [], v3(LP.backBtn.x, LP.backBtn.y, 0));
    const lbBackBtnUT = sb.ut(lbBackBtn, LP.backBtn.w, LP.backBtn.h);
    const lbBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(lbBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(lbBackBtn), _id: gid(),
    });
    sb.e[lbBackBtn]._components = [rf(lbBackBtnUT), rf(lbBackBtnBtn)];
    // 2026-04-30 trophy fix: collapsed sibling-icon (LeaderboardTitleIcon)
    // back into a single inline-emoji label. The two-sibling layout was
    // overlapping the "L" of Leaderboard (visually rendered as "🏆🏆eaderboard").
    // Mirrors the working PortfolioTitleLabel pattern below.
    const lbTitle = mkLabel(sb, 'LeaderboardTitleLabel', lbN, '🏆 Leaderboard', 30,
        LP.title.y, LP.title.w, LP.title.h, 255, 210, 74);
    style(sb, lbTitle, { bold: true });

    // Subtitle ("1v1 Duel · This Week"). AppUI rewrites string per active mode/chip.
    // 2026-04-29 v2: font 16 → 22 so subtitle is readable, not lost above the hero card.
    const lbSubtitle = mkLabel(sb, 'LeaderboardSubtitleLabel', lbN, '1v1 Duel · This Week', 22,
        LP.subtitle.y, LP.subtitle.w, LP.subtitle.h, 184, 184, 184);

    // 2026-04-29 v2: ModeTabsContainer (asymmetric left-anchored x=-90 sprite) deleted.
    // Runtime LBModePill (AppUI._buildSegmentedPill, tier='mode') fully owns the visual;
    // the scene-bound container leaked past the pill's left edge.

    // 4 mode tabs (segmented control). Active tab = teal, others = container surface.
    const lbTabIndices = [];
    for (let i = 0; i < LPT.lbTab.count; i++) {
        const active = i === LPT.lbTab.activeIdx;
        const bg = active ? [48, 198, 155] : [36, 16, 48];
        const btn = mkBtnXY(sb, `LBTab_${LPT.lbTab.keys[i]}`, lbN, LPT.lbTab.labels[i],
            LPT.lbTab.xs[i], LPT.lbTab.y, LPT.lbTab.w, LPT.lbTab.h, bg[0], bg[1], bg[2]);
        // Tint the inner Label too: white when active, mid-grey when inactive.
        const labelChildRef = sb.e[btn]._children?.[2];
        if (labelChildRef) {
            const labelChild = sb.e[labelChildRef.__id__];
            const lblComp = labelChild?._components?.[1]?.__id__;
            if (lblComp != null) {
                sb.e[lblComp]._color = active ? cl(255, 255, 255, 255) : cl(184, 184, 184, 255);
            }
        }
        lbTabIndices.push(btn);
    }

    // Standalone "This Week" chip (node name LBTab_season — handler binds modeU8=4).
    const TWC = LP.thisWeekChip;
    const lbThisWeekChip = mkBtnXY(sb, 'LBTab_season', lbN, 'This Week',
        TWC.x, TWC.y, TWC.w, TWC.h, 36, 16, 48);
    {
        const labelChildRef = sb.e[lbThisWeekChip]._children?.[2];
        if (labelChildRef) {
            const labelChild = sb.e[labelChildRef.__id__];
            const lblComp = labelChild?._components?.[1]?.__id__;
            if (lblComp != null) sb.e[lblComp]._color = cl(184, 184, 184, 255);
        }
    }

    // Hero card for rank #1.
    const TPC = LP.topPlayerCard;
    const TPCC = TPC.children;
    const tpcN = sb.e.length;
    sb.node('TopPlayerCard', lbN, [], [], v3(TPC.x, TPC.y, 0));
    const tpcUT = sb.ut(tpcN, TPC.w, TPC.h);
    const tpcSpr = cardBodySpr(sb, tpcN);
    const tpcEdge = mkCardEdge(sb, tpcN, TPC.w, TPC.h, 255, 210, 74, 255);
    // 2026-04-29 v2: smaller crown glyph (28 → 24) since the slim hero card has h=88
    // not 110; rank stays bold gold; player/score/elapsed bumped one notch for readability.
    const tpcCrown = mkLabel(sb, 'CrownLabel', tpcN, '👑', 24,
        TPCC.crown.y, TPCC.crown.w, TPCC.crown.h, 255, 210, 74);
    sb.e[tpcCrown]._lpos = v3(TPCC.crown.x, TPCC.crown.y, 0);
    // 2026-04-29 v2: rank label is white-bright (244,245,249) so it reads on top
    // of the runtime gold rank badge mounted by AppUI._mountRankBadge.
    const tpcRank = mkLabel(sb, 'RankLabel', tpcN, '#1', 24,
        TPCC.rank.y, TPCC.rank.w, TPCC.rank.h, 255, 255, 255);
    sb.e[tpcRank]._lpos = v3(TPCC.rank.x, TPCC.rank.y, 0);
    style(sb, tpcRank, { bold: true });
    const tpcPlayer = mkLabel(sb, 'PlayerLabel', tpcN, '—', 22,
        TPCC.player.y, TPCC.player.w, TPCC.player.h, 255, 255, 255);
    sb.e[tpcPlayer]._lpos = v3(TPCC.player.x, TPCC.player.y, 0);
    sb.e[sb.e[tpcPlayer]._components[1].__id__]._horizontalAlign = 0;
    style(sb, tpcPlayer, { bold: true });
    const tpcElapsed = mkLabel(sb, 'ElapsedLabel', tpcN, '', 14,
        TPCC.elapsed.y, TPCC.elapsed.w, TPCC.elapsed.h, 184, 184, 184);
    sb.e[tpcElapsed]._lpos = v3(TPCC.elapsed.x, TPCC.elapsed.y, 0);
    sb.e[sb.e[tpcElapsed]._components[1].__id__]._horizontalAlign = 0;
    const tpcScore = mkLabel(sb, 'ScoreLabel', tpcN, '—', 28,
        TPCC.score.y, TPCC.score.w, TPCC.score.h, 255, 210, 74);
    sb.e[tpcScore]._lpos = v3(TPCC.score.x, TPCC.score.y, 0);
    sb.e[sb.e[tpcScore]._components[1].__id__]._horizontalAlign = 2;
    style(sb, tpcScore, { bold: true });
    sb.e[tpcN]._components = [rf(tpcUT), rf(tpcSpr)];
    sb.e[tpcN]._children = [rf(tpcEdge), rf(tpcCrown), rf(tpcRank), rf(tpcPlayer), rf(tpcElapsed), rf(tpcScore)];
    sb.e[tpcN]._active = false;

    // 9 standard rank rows (LBRow_1..LBRow_9). Rank-1 lives in TopPlayerCard.
    const lbRowIndices = [];
    const LR = LPT.lbRow;
    for (let i = 0; i < LR.count; i++) {
        const r = i + 1;
        const ry = LR.baseY + i * LR.gapY;
        const rN = sb.e.length;
        sb.node(`LBRow_${r}`, lbN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, LR.w, LR.h);
        const rSpr = sb.spr(rN, 26, 8, 32);
        // 2026-04-29 v2: row fonts bumped — rank 18→22, player 16→20 bold, score 18→22,
        // elapsed 11→13 — so a 72-tall row reads cleanly on phone screens.
        const rankN = mkLabel(sb, 'RankLabel', rN, `#${r + 1}`, 22,
            LR.rank.y, LR.rank.w, LR.rank.h, 255, 255, 255);
        sb.e[rankN]._lpos = v3(LR.rank.x, LR.rank.y, 0);
        style(sb, rankN, { bold: true });
        const playerN = mkLabel(sb, 'PlayerLabel', rN, '—', 20,
            LR.player.y, LR.player.w, LR.player.h, 255, 255, 255);
        sb.e[playerN]._lpos = v3(LR.player.x, LR.player.y, 0);
        sb.e[sb.e[playerN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, playerN, { bold: true });
        const scoreN = mkLabel(sb, 'ScoreLabel', rN, '—', 22,
            LR.score.y, LR.score.w, LR.score.h, 20, 241, 149);
        sb.e[scoreN]._lpos = v3(LR.score.x, LR.score.y, 0);
        sb.e[sb.e[scoreN]._components[1].__id__]._horizontalAlign = 2;
        style(sb, scoreN, { bold: true });
        const elapsedN = mkLabel(sb, 'ElapsedLabel', rN, '', 13,
            LR.elapsed.y, LR.elapsed.w, LR.elapsed.h, 140, 140, 140);
        sb.e[elapsedN]._lpos = v3(LR.elapsed.x, LR.elapsed.y, 0);
        sb.e[sb.e[elapsedN]._components[1].__id__]._horizontalAlign = 0;
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(rankN), rf(playerN), rf(scoreN), rf(elapsedN)];
        sb.e[rN]._active = false;
        lbRowIndices.push(rN);
    }

    // Empty state cluster (icon + title + subtitle + CTA). Toggled by AppUI.
    const ES = LP.emptyState;
    const ESC = ES.children;
    const esN = sb.e.length;
    sb.node('EmptyStateGroup', lbN, [], [], v3(ES.x, ES.y, 0));
    const esUT = sb.ut(esN, ES.w, ES.h);
    const esIcon = mkLabel(sb, 'IconLabel', esN, '🏆', 96,
        ESC.icon.y, ESC.icon.w, ESC.icon.h, 255, 210, 74);
    const esTitle = mkLabel(sb, 'TitleLabel', esN, 'No competition yet', 24,
        ESC.title.y, ESC.title.w, ESC.title.h, 255, 210, 74);
    style(sb, esTitle, { bold: true });
    const esSub = mkLabel(sb, 'SubtitleLabel', esN, 'Be the first to climb the leaderboard', 14,
        ESC.sub.y, ESC.sub.w, ESC.sub.h, 184, 184, 184);
    const esCta = mkBtnXY(sb, 'EmptyStartMatchButton', esN, 'Start a Match',
        ESC.cta.x, ESC.cta.y, ESC.cta.w, ESC.cta.h, 20, 241, 149,
        { tier: 'secondary' });
    style(sb, esCta, { bold: true });
    sb.e[esN]._components = [rf(esUT)];
    sb.e[esN]._children = [rf(esIcon), rf(esTitle), rf(esSub), rf(esCta)];
    sb.e[esN]._active = false;

    const lbStatus = mkLabel(sb, 'LeaderboardStatusLabel', lbN, '', 14,
        LP.status.y, LP.status.w, LP.status.h, 184, 184, 184);

    // Personal rank footer card (sticky-bottom YOU).
    const PRC = LP.personalRankCard.children;
    const prcN = sb.e.length;
    sb.node('PersonalRankCard', lbN, [], [], v3(LP.personalRankCard.x, LP.personalRankCard.y, 0));
    const prcUT = sb.ut(prcN, LP.personalRankCard.w, LP.personalRankCard.h);
    const prcSpr = cardBodySpr(sb, prcN);
    const prcEdge = mkCardEdge(sb, prcN, LP.personalRankCard.w, LP.personalRankCard.h, 20, 241, 149, 220);
    // 2026-04-29 v2: YOU eyebrow stays compact; rank string bumped 18 → 22; stats 13 → 14.
    const prcHeader = mkLabel(sb, 'HeaderLabel', prcN, 'YOU', 14,
        PRC.header.y, PRC.header.w, PRC.header.h, 20, 241, 149);
    sb.e[prcHeader]._lpos = v3(PRC.header.x, PRC.header.y, 0);
    sb.e[sb.e[prcHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, prcHeader, { bold: true });
    const prcRank = mkLabel(sb, 'RankLabel', prcN, 'Not ranked yet · win to climb', 22,
        PRC.rank.y, PRC.rank.w, PRC.rank.h, 255, 255, 255);
    sb.e[prcRank]._lpos = v3(PRC.rank.x, PRC.rank.y, 0);
    sb.e[sb.e[prcRank]._components[1].__id__]._horizontalAlign = 0;
    style(sb, prcRank, { bold: true });
    const prcStats = mkLabel(sb, 'StatsLabel', prcN, 'W–L —  ·  Level —  ·  P/L —', 14,
        PRC.stats.y, PRC.stats.w, PRC.stats.h, 184, 184, 184);
    sb.e[prcStats]._lpos = v3(PRC.stats.x, PRC.stats.y, 0);
    sb.e[sb.e[prcStats]._components[1].__id__]._horizontalAlign = 0;
    // 2026-04-29 v2: tier 'secondary' → 'primary' so the YOU footer reads as
    // "act here" rather than a dim ghost button. Color stays teal (action).
    // 2026-04-30 UX polish — label "Play your first match" → "Play match" so
    // the button text fits inside the 240w chip without crowding/clipping. The
    // surrounding "Not yet ranked · win to climb" copy already explains the why.
    const prcCta = mkBtnXY(sb, 'PlayCTAButton', prcN, 'Play match',
        PRC.cta.x, PRC.cta.y, PRC.cta.w, PRC.cta.h, 20, 241, 149,
        { tier: 'primary' });
    sb.e[prcN]._components = [rf(prcUT), rf(prcSpr)];
    sb.e[prcN]._children = [rf(prcEdge), rf(prcHeader), rf(prcRank), rf(prcStats), rf(prcCta)];
    sb.e[prcN]._active = false;

    sb.e[lbN]._children = [
        // Scrim FIRST so it z-orders behind every other panel child.
        rf(lbScrimN),
        rf(lbBackLink), rf(lbBackBtn), rf(lbTitle), rf(lbSubtitle),
        ...lbTabIndices.map(rf),
        rf(lbThisWeekChip),
        rf(tpcN),
        ...lbRowIndices.map(rf),
        rf(esN),
        rf(prcN), rf(lbStatus),
    ];
    sb.e[lbN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 10 Bundle 3 / pt2 — DAILY CHALLENGE PANEL
    // Streak card + 3 challenge rows + season podium card. AppUI hydrates
    // from UserStats + DailyChallenge + Season RPCs.
    // ═══════════════════════════════════════════════════════════════
    const dcN = sb.e.length;
    sb.node('DailyChallengePanel', canvas, [], [], lobbyMount('DailyChallengePanel'));
    sb.ut(dcN, 720, 1280);
    sb.spr(dcN, 10, 14, 22);
    // Chrome from LAYOUT.DailyChallengePanel.elements.
    const DCE = LAYOUT.DailyChallengePanel.elements;
    logBackParity('DailyChallengePanel', DCE.backLink.y);
    const dcBackLink = mkLabel(sb, 'BackLinkLabel', dcN, '← Back', 18,
        DCE.backLink.y, DCE.backLink.w, DCE.backLink.h, 200, 210, 230);
    sb.e[dcBackLink]._lpos = v3(DCE.backLink.x, DCE.backLink.y, 0);
    sb.e[sb.e[dcBackLink]._components[1].__id__]._horizontalAlign = 0;
    const dcBackBtn = sb.e.length;
    sb.node('BackButton', dcN, [], [], v3(DCE.backBtn.x, DCE.backBtn.y, 0));
    const dcBackBtnUT = sb.ut(dcBackBtn, DCE.backBtn.w, DCE.backBtn.h);
    const dcBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(dcBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(dcBackBtn), _id: gid(),
    });
    sb.e[dcBackBtn]._components = [rf(dcBackBtnUT), rf(dcBackBtnBtn)];
    // UX Phase 2b: IconBadge flame attached by AppUI. Phase 2c: bold.
    // 9c: title w 600→400 to clear BackButton bbox right x=-210.
    const dcTitle = mkLabel(sb, 'DailyChallengeTitleLabel', dcN, "Today's Challenges", 30,
        DCE.title.y, DCE.title.w, DCE.title.h, 255, 210, 74);
    style(sb, dcTitle, { bold: true });

    // Streak card from LAYOUT.DailyChallengePanel.elements.streakCard + internals.
    const streakCardN = sb.e.length;
    sb.node('DailyStreakCard', dcN, [], [], v3(DCE.streakCard.x, DCE.streakCard.y, 0));
    const streakCardUT = sb.ut(streakCardN, DCE.streakCard.w, DCE.streakCard.h);
    const streakCardSpr = cardBodySpr(sb, streakCardN);
    const streakHeader = mkLabel(sb, 'HeaderLabel', streakCardN, 'STREAK', 11,
        DCE.streakHeader.y, DCE.streakHeader.w, DCE.streakHeader.h, 184, 184, 184);
    sb.e[streakHeader]._lpos = v3(DCE.streakHeader.x, DCE.streakHeader.y, 0);
    sb.e[sb.e[streakHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, streakHeader, { spacing: 1 });  // Phase 15 (B5): tracked uppercase
    // 9c: streakDay h 46→38 so its bbox bottom y=-17 touches StreakBest top y=-17 (no overlap).
    const streakDay = mkLabel(sb, 'StreakDayLabel', streakCardN, 'Day 0', 36,
        0, DCE.streakDayLabel.w, DCE.streakDayLabel.h, 255, 255, 255);
    sb.e[streakDay]._lpos = v3(DCE.streakDayLabel.x, DCE.streakDayLabel.y, 0);
    style(sb, streakDay, { bold: true, mono: true });  // Phase 15 (B5): hero streak number
    const streakBest = mkLabel(sb, 'StreakBestLabel', streakCardN, 'Best: 0', 14,
        -28, DCE.streakBestLabel.w, DCE.streakBestLabel.h, 184, 184, 184);
    sb.e[streakBest]._lpos = v3(DCE.streakBestLabel.x, DCE.streakBestLabel.y, 0);
    // Phase 14 (B4): amber edge accent — warm achievement card.
    const streakEdge = mkCardEdge(sb, streakCardN, DCE.streakCard.w, DCE.streakCard.h, 255, 210, 74);
    sb.e[streakCardN]._components = [rf(streakCardUT), rf(streakCardSpr)];
    sb.e[streakCardN]._children = [rf(streakHeader), rf(streakDay), rf(streakBest), rf(streakEdge)];

    // 3 challenge rows from LAYOUT.DailyChallengePanel.templates.challengeRow.
    const CR = LAYOUT.DailyChallengePanel.templates.challengeRow;
    const challengeRowIndices = [];
    for (let i = 0; i < CR.count; i++) {
        const rN = sb.e.length;
        sb.node(`ChallengeRow_${i}`, dcN, [], [], v3(0, CR.ys[i], 0));
        const rUT = sb.ut(rN, CR.w, CR.h);
        const rSpr = cardBodySpr(sb, rN);
        const descL = mkLabel(sb, `ChallengeDescriptionLabel_${i}`, rN, '—', 17, 0, CR.description.w, CR.description.h, 255, 255, 255);
        sb.e[descL]._lpos = v3(CR.description.x, CR.description.y, 0);
        sb.e[sb.e[descL]._components[1].__id__]._horizontalAlign = 0;
        const subL = mkLabel(sb, `ChallengeProgressLabel_${i}`, rN, '', 13, 0, CR.progress.w, CR.progress.h, 184, 184, 184);
        sb.e[subL]._lpos = v3(CR.progress.x, CR.progress.y, 0);
        sb.e[sb.e[subL]._components[1].__id__]._horizontalAlign = 0;
        const rewardL = mkLabel(sb, `ChallengeRewardLabel_${i}`, rN, '+0 XP', 15, 0, CR.reward.w, CR.reward.h, 255, 210, 74);
        sb.e[rewardL]._lpos = v3(CR.reward.x, CR.reward.y, 0);
        const checkL = mkLabel(sb, `ChallengeCheckmark_${i}`, rN, '·', 28, 0, CR.checkmark.w, CR.checkmark.h, 90, 100, 120);
        sb.e[checkL]._lpos = v3(CR.checkmark.x, CR.checkmark.y, 0);
        // Phase 14 (B4): violet edge accent — daily action card.
        const cEdge = mkCardEdge(sb, rN, CR.w, CR.h, 153, 69, 255);
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(descL), rf(subL), rf(rewardL), rf(checkL), rf(cEdge)];
        challengeRowIndices.push(rN);
    }

    // Season summary card from LAYOUT.DailyChallengePanel.elements.season*.
    const seasonSumN = sb.e.length;
    sb.node('SeasonSummaryCard', dcN, [], [], v3(DCE.seasonCard.x, DCE.seasonCard.y, 0));
    const seasonSumUT = sb.ut(seasonSumN, DCE.seasonCard.w, DCE.seasonCard.h);
    const seasonSumSpr = cardBodySpr(sb, seasonSumN);
    const seasonHeader = mkLabel(sb, 'SeasonHeaderLabel', seasonSumN, 'THIS WEEK', 11,
        DCE.seasonHeader.y, DCE.seasonHeader.w, DCE.seasonHeader.h, 184, 184, 184);
    sb.e[seasonHeader]._lpos = v3(DCE.seasonHeader.x, DCE.seasonHeader.y, 0);
    sb.e[sb.e[seasonHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, seasonHeader, { spacing: 1 });  // Phase 15 (B5)
    const seasonRank = mkLabel(sb, 'SeasonRankLabel', seasonSumN, 'Rank: —  ·  Wins: 0', 17,
        DCE.seasonRank.y, DCE.seasonRank.w, DCE.seasonRank.h, 255, 255, 255);
    sb.e[seasonRank]._lpos = v3(DCE.seasonRank.x, DCE.seasonRank.y, 0);
    style(sb, seasonRank, { mono: true });  // Phase 15 (B5): live rank/wins
    const seasonPodium = mkLabel(sb, 'SeasonPodiumLabel', seasonSumN, 'Podium: —', 13,
        DCE.seasonPodium.y, DCE.seasonPodium.w, DCE.seasonPodium.h, 184, 184, 184);
    sb.e[seasonPodium]._lpos = v3(DCE.seasonPodium.x, DCE.seasonPodium.y, 0);
    const seasonPrize = mkLabel(sb, 'SeasonPrizeLabel', seasonSumN, '', 12,
        DCE.seasonPrize.y, DCE.seasonPrize.w, DCE.seasonPrize.h, 130, 140, 160);
    sb.e[seasonPrize]._lpos = v3(DCE.seasonPrize.x, DCE.seasonPrize.y, 0);
    // Phase 14 (B4): teal edge accent — weekly progress card.
    const seasonEdge = mkCardEdge(sb, seasonSumN, DCE.seasonCard.w, DCE.seasonCard.h, 20, 241, 149);
    sb.e[seasonSumN]._components = [rf(seasonSumUT), rf(seasonSumSpr)];
    sb.e[seasonSumN]._children = [rf(seasonHeader), rf(seasonRank), rf(seasonPodium), rf(seasonPrize), rf(seasonEdge)];

    const dcStatus = mkLabel(sb, 'DailyChallengeStatusLabel', dcN, '', 13,
        DCE.status.y, DCE.status.w, DCE.status.h, 184, 184, 184);

    sb.e[dcN]._children = [
        rf(dcBackLink), rf(dcBackBtn), rf(dcTitle),
        rf(streakCardN),
        ...challengeRowIndices.map(rf),
        rf(seasonSumN),
        rf(dcStatus),
    ];
    sb.e[dcN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session 14 C3 — PORTFOLIO PANEL (user stats — Paper / Real tabs)
    // ═══════════════════════════════════════════════════════════════
    const pfN = sb.e.length;
    sb.node('PortfolioPanel', canvas, [], [], lobbyMount('PortfolioPanel'));
    sb.ut(pfN, 720, 1280);
    sb.spr(pfN, 10, 14, 22); // Phase 25: dark-slate backdrop hides BackgroundFX halos behind stats/history/trophies
    // 2026-05-01 — match Leaderboard scrim. Wine-eggplant @ alpha 110 sits on
    // top of the dark-slate panel sprite so all three subtabs (Stats, History,
    // Trophies) read with the same transparent backdrop as the leaderboard.
    const pfScrimN = sb.e.length;
    sb.node('PortfolioContentScrim', pfN, [], [], v3(0, 0, 0));
    const pfScrimUT = sb.ut(pfScrimN, 720, 1280);
    const pfScrimSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pfScrimN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.primary.r, P.bg.primary.g, P.bg.primary.b, 110),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[pfScrimN]._components = [rf(pfScrimUT), rf(pfScrimSpr)];
    // betting-duel polish: stretch the panel to fill the Canvas on any device
    // aspect ratio. Without a Widget, tall-screen devices shrink the panel to
    // a fraction of the viewport. Inner labels use absolute Y offsets so they
    // track the panel's center as it stretches.
    sb.widget(pfN);
    // betting-duel polish (FIXED_WIDTH spread): Y range stretched from
    // [-620, +620] → [-760, +720] to use the full 1602px viewport on device.
    // Chrome from LAYOUT.PortfolioPanel.elements (9c addition).
    const PFE = LAYOUT.PortfolioPanel.elements;
    logBackParity('PortfolioPanel', PFE.backLink.y);
    const pfBackLink = mkLabel(sb, 'BackLinkLabel', pfN, '← Back', 18,
        PFE.backLink.y, PFE.backLink.w, PFE.backLink.h, 200, 210, 230);
    sb.e[pfBackLink]._lpos = v3(PFE.backLink.x, PFE.backLink.y, 0);
    const pfBackLinkL = sb.e[pfBackLink]._components[1].__id__;
    sb.e[pfBackLinkL]._horizontalAlign = 0;
    const pfBackBtn = sb.e.length;
    sb.node('BackButton', pfN, [], [], v3(PFE.backBtn.x, PFE.backBtn.y, 0));
    const pfBackBtnUT = sb.ut(pfBackBtn, PFE.backBtn.w, PFE.backBtn.h);
    const pfBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pfBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(pfBackBtn), _id: gid(),
    });
    sb.e[pfBackBtn]._components = [rf(pfBackBtnUT), rf(pfBackBtnBtn)];
    // UX Phase 2b: IconBadge user attached by AppUI. Phase 2c: bold + gold.
    const pfTitle = mkLabel(sb, 'PortfolioTitleLabel', pfN, 'Portfolio', 30,
        PFE.title.y, PFE.title.w, PFE.title.h, 255, 210, 74);
    style(sb, pfTitle, { bold: true, color: GOLD() });
    const pfPubkeyLabel = mkLabel(sb, 'PortfolioPubkeyLabel', pfN, 'not connected', 16,
        PFE.pubkeyLabel.y, PFE.pubkeyLabel.w, PFE.pubkeyLabel.h, 140, 220, 180);
    // Dashboard redesign (foamy-sphinx): subtitle eyebrow under title.
    const pfSubtitle = mkLabel(sb, 'PortfolioSubtitleLabel', pfN, 'Your performance', 14,
        PFE.subtitle.y, PFE.subtitle.w, PFE.subtitle.h, 184, 184, 184);
    // Primary tabs — Stats / History / Trophies (full-width segmented control).
    const pfStatsTab    = mkBtnXY(sb, 'PortfolioStatsTab',    pfN, 'Stats',
        PFE.statsTab.x, PFE.statsTab.y, PFE.statsTab.w, PFE.statsTab.h, 48, 198, 155);
    const pfHistoryTab  = mkBtnXY(sb, 'PortfolioHistoryTab',  pfN, 'History',
        PFE.historyTab.x, PFE.historyTab.y, PFE.historyTab.w, PFE.historyTab.h, 36, 16, 48);
    const pfTrophiesTab = mkBtnXY(sb, 'PortfolioTrophiesTab', pfN, 'Trophies',
        PFE.trophiesTab.x, PFE.trophiesTab.y, PFE.trophiesTab.w, PFE.trophiesTab.h, 36, 16, 48);
    // MODE eyebrow + smaller secondary Paper/Real toggle.
    const pfModeLabel = mkLabel(sb, 'PortfolioModeLabel', pfN, 'MODE', 11,
        PFE.modeLabel.y, PFE.modeLabel.w, PFE.modeLabel.h, 184, 184, 184);
    style(sb, pfModeLabel, { spacing: 2 });
    const pfPaperTab = mkBtnXY(sb, 'PortfolioPaperTab', pfN, 'Paper',
        PFE.paperTab.x, PFE.paperTab.y, PFE.paperTab.w, PFE.paperTab.h, 48, 198, 155);
    const pfRealTab  = mkBtnXY(sb, 'PortfolioRealTab',  pfN, 'Real',
        PFE.realTab.x, PFE.realTab.y, PFE.realTab.w, PFE.realTab.h, 36, 16, 48);
    // ───── Hero P/L card (focal point) ─────
    // Keeps the legacy node name PFStatCard_pnl so AppUI's _pfStatValues['pnl']
    // and the runtime tint hooks resolve through getChildByName('Value').
    const PHC = LAYOUT.PortfolioPanel.templates.heroPnLCard;
    const heroCardN = sb.e.length;
    sb.node('PFStatCard_pnl', pfN, [], [], v3(PHC.x, PHC.y, 0));
    const heroCardUT = sb.ut(heroCardN, PHC.w, PHC.h);
    const heroCardSpr = cardBodySpr(sb, heroCardN);
    const heroHeaderN = sb.e.length;
    sb.node('Header', heroCardN, [], [], v3(PHC.header.x, PHC.header.y, 0));
    const heroHeaderUT = sb.ut(heroHeaderN, PHC.header.w, PHC.header.h);
    const heroHeaderL = sb.lbl(heroHeaderN, 'TOTAL PROFIT', 12, 184, 184, 184);
    sb.e[heroHeaderL]._spacingX = 2;
    sb.e[heroHeaderN]._components = [rf(heroHeaderUT), rf(heroHeaderL)];
    const heroValueN = sb.e.length;
    sb.node('Value', heroCardN, [], [], v3(PHC.value.x, PHC.value.y, 0));
    const heroValueUT = sb.ut(heroValueN, PHC.value.w, PHC.value.h);
    const heroValueL = sb.lbl(heroValueN, '—', 56, 255, 255, 255);
    sb.e[heroValueL]._isBold = true;
    sb.e[heroValueN]._components = [rf(heroValueUT), rf(heroValueL)];
    const heroSubN = sb.e.length;
    sb.node('Subtitle', heroCardN, [], [], v3(PHC.subtitle.x, PHC.subtitle.y, 0));
    const heroSubUT = sb.ut(heroSubN, PHC.subtitle.w, PHC.subtitle.h);
    const heroSubL = sb.lbl(heroSubN, 'Across all matches', 13, 184, 184, 184);
    sb.e[heroSubN]._components = [rf(heroSubUT), rf(heroSubL)];
    // Neutral edge by default; AppUI re-tints to green/red based on P/L sign.
    const heroEdge = mkCardEdge(sb, heroCardN, PHC.w, PHC.h, 184, 184, 184);
    sb.e[heroCardN]._components = [rf(heroCardUT), rf(heroCardSpr)];
    sb.e[heroCardN]._children = [rf(heroHeaderN), rf(heroValueN), rf(heroSubN), rf(heroEdge)];

    // ───── Group eyebrow headers ─────
    const pfGroupPerf = mkLabel(sb, 'PortfolioGroupHeaderPerformance', pfN, 'PERFORMANCE', 12,
        PFE.groupHeaderPerformance.y, PFE.groupHeaderPerformance.w, PFE.groupHeaderPerformance.h,
        184, 184, 184);
    sb.e[pfGroupPerf]._lpos = v3(PFE.groupHeaderPerformance.x, PFE.groupHeaderPerformance.y, 0);
    const pfGroupPerfL = sb.e[pfGroupPerf]._components[1].__id__;
    sb.e[pfGroupPerfL]._horizontalAlign = 0;
    sb.e[pfGroupPerfL]._spacingX = 2;
    const pfGroupAct = mkLabel(sb, 'PortfolioGroupHeaderActivity', pfN, 'ACTIVITY', 12,
        PFE.groupHeaderActivity.y, PFE.groupHeaderActivity.w, PFE.groupHeaderActivity.h,
        184, 184, 184);
    sb.e[pfGroupAct]._lpos = v3(PFE.groupHeaderActivity.x, PFE.groupHeaderActivity.y, 0);
    const pfGroupActL = sb.e[pfGroupAct]._components[1].__id__;
    sb.e[pfGroupActL]._horizontalAlign = 0;
    sb.e[pfGroupActL]._spacingX = 2;

    // ───── Secondary stat cards (Wins / Losses / Win % / Games) ─────
    const PSC = LAYOUT.PortfolioPanel.templates.statCard;
    const pfStatIndices = [];
    for (const d of PSC.defs) {
        const cardW = d.w ?? PSC.w;
        const cardN = sb.e.length;
        sb.node(`PFStatCard_${d.key}`, pfN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, cardW, PSC.h);
        const cardSpr = cardBodySpr(sb, cardN);
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(PSC.header.x, PSC.header.y, 0));
        const lblUT = sb.ut(lblN, PSC.header.w, PSC.header.h);
        const lblL = sb.lbl(lblN, d.label, 11, 184, 184, 184);
        sb.e[lblL]._spacingX = 2;
        sb.e[lblN]._components = [rf(lblUT), rf(lblL)];
        const valN = sb.e.length;
        sb.node('Value', cardN, [], [], v3(PSC.value.x, PSC.value.y, 0));
        const valUT = sb.ut(valN, PSC.value.w, PSC.value.h);
        const valL = sb.lbl(valN, '—', 26, 255, 255, 255);
        sb.e[valL]._isBold = true;
        sb.e[valN]._components = [rf(valUT), rf(valL)];
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(lblN), rf(valN)];
        pfStatIndices.push(cardN);
    }

    // ───── XP/Level card (gamified progress to next level) ─────
    const PXC = LAYOUT.PortfolioPanel.templates.xpCard;
    const xpCardN = sb.e.length;
    sb.node('PFStatCard_xp', pfN, [], [], v3(PXC.x, PXC.y, 0));
    const xpCardUT = sb.ut(xpCardN, PXC.w, PXC.h);
    const xpCardSpr = sb.spr(xpCardN, 18, 22, 32);
    // "LEVEL" eyebrow — left-aligned at top of card.
    const xpHeaderN = sb.e.length;
    sb.node('Label', xpCardN, [], [], v3(PXC.header.x, PXC.header.y, 0));
    const xpHeaderUT = sb.ut(xpHeaderN, PXC.header.w, PXC.header.h);
    const xpHeaderL = sb.lbl(xpHeaderN, 'LEVEL', 11, 184, 184, 184);
    sb.e[xpHeaderL]._spacingX = 2;
    sb.e[xpHeaderL]._horizontalAlign = 0;
    sb.e[xpHeaderN]._components = [rf(xpHeaderUT), rf(xpHeaderL)];
    // Big "L#" — right-aligned at top.
    const xpValN = sb.e.length;
    sb.node('Value', xpCardN, [], [], v3(PXC.value.x, PXC.value.y, 0));
    const xpValUT = sb.ut(xpValN, PXC.value.w, PXC.value.h);
    const xpValL = sb.lbl(xpValN, '—', 16, 255, 255, 255);
    sb.e[xpValL]._isBold = true;
    sb.e[xpValL]._horizontalAlign = 2;
    sb.e[xpValN]._components = [rf(xpValUT), rf(xpValL)];
    // Progress bar track.
    const xpTrackN = sb.e.length;
    sb.node('PFXpProgressBar', xpCardN, [], [], v3(PXC.track.x, PXC.track.y, 0));
    const xpTrackUT = sb.ut(xpTrackN, PXC.track.w, PXC.track.h);
    const xpTrackSpr = sb.spr(xpTrackN, 38, 44, 64);
    sb.e[xpTrackN]._components = [rf(xpTrackUT), rf(xpTrackSpr)];
    // Progress bar fill — left-anchored so scale.x grows from the left edge.
    // Initial scale (0,1,1); AppUI tweens up to actual progress fraction.
    const xpFillN = sb.e.length;
    sb.node('PFXpProgressBarFill', xpCardN, [], [], v3(PXC.track.x - PXC.track.w / 2, PXC.track.y, 0));
    const xpFillUT = sb.ut(xpFillN, PXC.track.w, PXC.track.h);
    sb.e[xpFillUT]._anchorPoint = v2(0, 0.5);
    const xpFillSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(xpFillN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[xpFillN]._components = [rf(xpFillUT), rf(xpFillSpr)];
    sb.e[xpFillN]._lscale = v3(0, 1, 1);
    // Footer — flips between "Earn XP by winning matches" (zero XP) and
    // "X / Y XP" (in-progress) at runtime.
    const xpFooterN = sb.e.length;
    sb.node('PFXpFooterLabel', xpCardN, [], [], v3(PXC.footer.x, PXC.footer.y, 0));
    const xpFooterUT = sb.ut(xpFooterN, PXC.footer.w, PXC.footer.h);
    const xpFooterL = sb.lbl(xpFooterN, 'Earn XP by winning matches', 11, 184, 184, 184);
    sb.e[xpFooterN]._components = [rf(xpFooterUT), rf(xpFooterL)];
    sb.e[xpCardN]._components = [rf(xpCardUT), rf(xpCardSpr)];
    sb.e[xpCardN]._children = [rf(xpHeaderN), rf(xpValN), rf(xpTrackN), rf(xpFillN), rf(xpFooterN)];

    // ───── Empty state (zero games / un-initialized real PDA) ─────
    const pfEmptyStateN = sb.e.length;
    sb.node('PortfolioEmptyState', pfN, [], [], v3(PFE.emptyState.x, PFE.emptyState.y, 0));
    const pfEmptyStateUT = sb.ut(pfEmptyStateN, PFE.emptyState.w, PFE.emptyState.h);
    const pfEmptyTitle = mkLabel(sb, 'PortfolioEmptyStateTitle', pfEmptyStateN, 'No matches yet',
        24, PFE.emptyStateTitle.y, PFE.emptyStateTitle.w, PFE.emptyStateTitle.h, 255, 255, 255);
    style(sb, pfEmptyTitle, { bold: true });
    const pfEmptySub = mkLabel(sb, 'PortfolioEmptyStateSubtitle', pfEmptyStateN,
        'Start playing to build your stats', 14,
        PFE.emptyStateSubtitle.y, PFE.emptyStateSubtitle.w, PFE.emptyStateSubtitle.h, 184, 184, 184);
    const pfEmptyCta = mkBtnXY(sb, 'PortfolioEmptyStateCta', pfEmptyStateN, 'Start Match',
        PFE.emptyStateCta.x, PFE.emptyStateCta.y, PFE.emptyStateCta.w, PFE.emptyStateCta.h,
        20, 241, 149,
        { tier: 'secondary' });
    style(sb, pfEmptyCta, { bold: true });
    sb.e[pfEmptyStateN]._components = [rf(pfEmptyStateUT)];
    sb.e[pfEmptyStateN]._children = [rf(pfEmptyTitle), rf(pfEmptySub), rf(pfEmptyCta)];
    sb.e[pfEmptyStateN]._active = false;

    const pfHint = mkLabel(sb, 'PortfolioHintLabel', pfN, 'Real mode stats update after your first match', 12,
        PFE.hint.y, PFE.hint.w, PFE.hint.h, 184, 184, 184);
    const pfStatus = mkLabel(sb, 'PortfolioStatusLabel', pfN, '', 14,
        PFE.status.y, PFE.status.w, PFE.status.h, 184, 184, 184);

    // Part 9: MatchHistory view — hidden when Stats tab is active.
    // Container anchors label + scrollview + load-more button as a unit.
    const pfHistoryViewN = sb.e.length;
    sb.node('PortfolioHistoryView', pfN, [], [], v3(0, 0, 0));
    sb.ut(pfHistoryViewN, 720, 1280);
    const pfHistoryEmpty = mkLabel(sb, 'PortfolioHistoryEmptyLabel', pfHistoryViewN,
        'No matches yet — play a Real match to see history.',
        14, PFE.historyEmpty.y, PFE.historyEmpty.w, PFE.historyEmpty.h, 184, 184, 184);
    // 2026-05-01 — drop the scrollview backdrop sprite to alpha 0 so the
    // history list reads as transparent over the bg, matching Leaderboard
    // (which builds rank rows directly on the panel, no backdrop at all).
    const pfHistorySV = mkScrollView(sb, 'PortfolioHistoryScroll', pfHistoryViewN,
        PFE.historyScroll.x, PFE.historyScroll.y, PFE.historyScroll.w, PFE.historyScroll.h, 0);
    // 30-row pool from LAYOUT.PortfolioPanel.templates.matchHistoryRow.
    // 2026-04-29 redesign — taller card (660×116) split into 4 columns by
    // 1×84 hairline dividers. Column 1: Icon (medal, attached at runtime
    // via IconLibrary) + Date below. Column 2: Mode + Placement stacked.
    // Column 3: Chip (track icon) + Opponent label. Column 4: Payout.
    // AppUI toggles _active per row + writes labels + attaches icons per
    // entry (AppUI._renderMatchHistoryRows).
    const MHR = LAYOUT.PortfolioPanel.templates.matchHistoryRow;
    const pfHistoryRows = [];
    const mkDivider = (parentN, name, cfg) => {
        const dn = sb.e.length;
        sb.node(name, parentN, [], [], v3(cfg.x, cfg.y, 0));
        const dut = sb.ut(dn, cfg.w, cfg.h);
        const dspr = sb.spr(dn, cfg.color[0], cfg.color[1], cfg.color[2], UUID_WHITE_SPRITE, 1);
        sb.e[dspr]._color = cl(cfg.color[0], cfg.color[1], cfg.color[2], cfg.color[3] ?? 255);
        sb.e[dn]._components = [rf(dut), rf(dspr)];
        return dn;
    };
    const mkIconNode = (parentN, name, x, y, size) => {
        const inN = sb.e.length;
        sb.node(name, parentN, [], [], v3(x, y, 0));
        const inUT = sb.ut(inN, size, size);
        sb.e[inN]._components = [rf(inUT)];
        return inN;
    };
    for (let i = 0; i < MHR.count; i++) {
        const ry = MHR.baseY + i * MHR.gapY;
        const rowN = sb.e.length;
        sb.node(`MatchHistoryRow_${i}`, pfHistorySV.content, [], [], v3(0, ry, 0));
        const rowUT = sb.ut(rowN, MHR.w, MHR.h);
        const rowSpr = sb.spr(rowN, 26, 8, 32);
        const iconN = mkIconNode(rowN, 'Icon', MHR.icon.x, MHR.icon.y, MHR.icon.size);
        const dateL = mkLabel(sb, 'Date', rowN, '—', 14, 0, MHR.date.w, MHR.date.h,
            MHR.date.color[0], MHR.date.color[1], MHR.date.color[2]);
        sb.e[dateL]._lpos = v3(MHR.date.x, MHR.date.y, 0);
        const dividerA = mkDivider(rowN, 'Divider0', MHR.dividerA);
        const modeL = mkLabel(sb, 'Mode', rowN, '—', 22, 0, MHR.mode.w, MHR.mode.h,
            MHR.mode.color[0], MHR.mode.color[1], MHR.mode.color[2]);
        sb.e[modeL]._lpos = v3(MHR.mode.x, MHR.mode.y, 0);
        style(sb, modeL, { bold: true });
        const placeL = mkLabel(sb, 'Placement', rowN, '—', 16, 0, MHR.placement.w, MHR.placement.h,
            MHR.placement.color[0], MHR.placement.color[1], MHR.placement.color[2]);
        sb.e[placeL]._lpos = v3(MHR.placement.x, MHR.placement.y, 0);
        const dividerB = mkDivider(rowN, 'Divider1', MHR.dividerB);
        const chipN = mkIconNode(rowN, 'Chip', MHR.chip.x, MHR.chip.y, MHR.chip.size);
        const oppL = mkLabel(sb, 'Opponent', rowN, '—', 22, 0, MHR.opponent.w, MHR.opponent.h,
            MHR.opponent.color[0], MHR.opponent.color[1], MHR.opponent.color[2]);
        sb.e[oppL]._lpos = v3(MHR.opponent.x, MHR.opponent.y, 0);
        style(sb, oppL, { bold: true });
        const dividerC = mkDivider(rowN, 'Divider2', MHR.dividerC);
        const payoutL = mkLabel(sb, 'Payout', rowN, '—', 26, 0, MHR.payout.w, MHR.payout.h,
            MHR.payout.color[0], MHR.payout.color[1], MHR.payout.color[2]);
        sb.e[payoutL]._lpos = v3(MHR.payout.x, MHR.payout.y, 0);
        style(sb, payoutL, { bold: true });
        sb.e[rowN]._components = [rf(rowUT), rf(rowSpr)];
        sb.e[rowN]._children = [
            rf(iconN), rf(dateL),
            rf(dividerA),
            rf(modeL), rf(placeL),
            rf(dividerB),
            rf(chipN), rf(oppL),
            rf(dividerC),
            rf(payoutL),
        ];
        sb.e[rowN]._active = false;
        pfHistoryRows.push(rowN);
    }
    sb.e[pfHistorySV.content]._children = pfHistoryRows.map(rf);
    const pfHistoryLoadMore = mkBtn(sb, 'PortfolioHistoryLoadMoreButton', pfHistoryViewN, 'Load more',
        PFE.historyLoadMore.y, PFE.historyLoadMore.w, PFE.historyLoadMore.h, 48, 70, 90,
        { tier: 'tertiary' });
    sb.e[pfHistoryLoadMore]._lpos = v3(PFE.historyLoadMore.x, PFE.historyLoadMore.y, 0);
    sb.e[pfHistoryLoadMore]._active = false;

    sb.e[pfHistoryViewN]._children = [rf(pfHistoryEmpty), rf(pfHistorySV.root), rf(pfHistoryLoadMore)];
    sb.e[pfHistoryViewN]._active = false;

    // Part 11 B: Trophies view — header band + 3×2 cNFT tile grid + footer
    // band, all parented to PortfolioTrophiesView so the entire subtree
    // toggles with the Trophies tab. Tile spec lives in
    // LAYOUT.PortfolioPanel.templates.trophyTile (220×260, 16-px gap).
    const pfTrophiesViewN = sb.e.length;
    sb.node('PortfolioTrophiesView', pfN, [], [], v3(PFE.trophiesView.x, PFE.trophiesView.y, 0));
    sb.ut(pfTrophiesViewN, PFE.trophiesView.w, PFE.trophiesView.h);
    const pfTrophiesEmpty = mkLabel(sb, 'PortfolioTrophiesEmptyLabel', pfTrophiesViewN,
        'No trophies yet — win a weekly season to earn your first',
        14, PFE.trophiesEmpty.y, PFE.trophiesEmpty.w, PFE.trophiesEmpty.h, 184, 184, 184);

    // Header band — title + subtitle + (right-aligned) pagination row.
    const pfTrophiesHeaderTitle = mkLabel(sb, 'PortfolioTrophiesHeaderTitle', pfTrophiesViewN,
        'Weekly Trophies', 22, PFE.trophiesHeaderTitle.y,
        PFE.trophiesHeaderTitle.w, PFE.trophiesHeaderTitle.h, 220, 200, 140);
    const pfTrophiesHeaderSubtitle = mkLabel(sb, 'PortfolioTrophiesHeaderSubtitle', pfTrophiesViewN,
        'Your best performances by week', 12, PFE.trophiesHeaderSubtitle.y,
        PFE.trophiesHeaderSubtitle.w, PFE.trophiesHeaderSubtitle.h, 184, 184, 184);
    const pfTrophiesPagePrev = mkBtnXY(sb, 'PortfolioTrophiesPagePrev', pfTrophiesViewN, '‹',
        PFE.trophiesPagePrev.x, PFE.trophiesPagePrev.y,
        PFE.trophiesPagePrev.w, PFE.trophiesPagePrev.h, 16, 70, 90, { tier: 'tertiary' });
    const pfTrophiesPageLabel = mkLabel(sb, 'PortfolioTrophiesPageLabel', pfTrophiesViewN,
        'Page 1 / 1', 12, PFE.trophiesPageLabel.y,
        PFE.trophiesPageLabel.w, PFE.trophiesPageLabel.h, 184, 184, 184);
    sb.e[pfTrophiesPageLabel]._lpos = v3(PFE.trophiesPageLabel.x, PFE.trophiesPageLabel.y, 0);
    const pfTrophiesPageNext = mkBtnXY(sb, 'PortfolioTrophiesPageNext', pfTrophiesViewN, '›',
        PFE.trophiesPageNext.x, PFE.trophiesPageNext.y,
        PFE.trophiesPageNext.w, PFE.trophiesPageNext.h, 16, 70, 90, { tier: 'tertiary' });
    // Pagination row hidden when total trophies fit in a single page; AppUI
    // toggles per render in _renderTrophyPage.
    sb.e[pfTrophiesPagePrev]._active = false;
    sb.e[pfTrophiesPageLabel]._active = false;
    sb.e[pfTrophiesPageNext]._active = false;

    const PTT = LAYOUT.PortfolioPanel.templates.trophyTile;
    const pfTrophyTileIndices = [];
    for (let row = 0; row < PTT.rows; row++) {
        for (let col = 0; col < PTT.cols; col++) {
            const i = row * PTT.cols + col;
            const tx = (col + PTT.gridXOffset) * (PTT.w + PTT.gap);
            const ty = PTT.gridYBase + row * PTT.gridYStride;
            const tN = sb.e.length;
            sb.node(`TrophyTile_${i}`, pfTrophiesViewN, [], [], v3(tx, ty, 0));
            const tUT = sb.ut(tN, PTT.w, PTT.h);
            const tSpr = cardBodySpr(sb, tN);
            // WEEK eyebrow — small dim caps above the icon ("WEEK #6").
            const eyebrowLbl = mkLabel(sb, 'WeekEyebrow', tN, 'WEEK #0', 11,
                PTT.weekEyebrow.y, PTT.weekEyebrow.w, PTT.weekEyebrow.h, 184, 184, 184);
            // Emoji node — IconLibrary.attach swaps in a 90-pt medal/star
            // sprite at runtime (size set in AppUI._renderTrophyPage).
            const emojiLbl = mkLabel(sb, 'Emoji', tN, '', 56,
                PTT.emoji.y, PTT.emoji.w, PTT.emoji.h, 255, 255, 255);
            // Big number ("12") — bold white, replaces the prior "Title" slot.
            const winsValueLbl = mkLabel(sb, 'WinsValue', tN, '0', 28,
                PTT.winsValue.y, PTT.winsValue.w, PTT.winsValue.h, 255, 255, 255);
            // Small label ("wins") under the big number.
            const winsLbl = mkLabel(sb, 'WinsLabel', tN, 'wins', 12,
                PTT.winsLabel.y, PTT.winsLabel.w, PTT.winsLabel.h, 184, 184, 184);
            // Top-edge stripe — placeholder gold; AppUI re-tints per rank
            // (gold/silver/bronze/purple) in _renderTrophyPage.
            const tEdge = mkCardEdge(sb, tN, PTT.w, PTT.h, 255, 210, 74);
            sb.e[tN]._components = [rf(tUT), rf(tSpr)];
            sb.e[tN]._children = [rf(eyebrowLbl), rf(emojiLbl), rf(winsValueLbl), rf(winsLbl), rf(tEdge)];
            sb.e[tN]._active = false;
            pfTrophyTileIndices.push(tN);
        }
    }

    // Footer band — two-line caption explaining reset cadence + ghost Share
    // button. AppUI._onTrophyShareClick stubs out the action with a toast.
    const pfTrophiesFooterLine1 = mkLabel(sb, 'PortfolioTrophiesFooterLine1', pfTrophiesViewN,
        'Trophies are based on your weekly performance', 11, PFE.trophiesFooterLine1.y,
        PFE.trophiesFooterLine1.w, PFE.trophiesFooterLine1.h, 184, 184, 184);
    const pfTrophiesFooterLine2 = mkLabel(sb, 'PortfolioTrophiesFooterLine2', pfTrophiesViewN,
        'New week starts every Monday 00:00 UTC', 11, PFE.trophiesFooterLine2.y,
        PFE.trophiesFooterLine2.w, PFE.trophiesFooterLine2.h, 184, 184, 184);
    const pfTrophiesShareBtn = mkBtn(sb, 'PortfolioTrophiesShareButton', pfTrophiesViewN, 'Share',
        PFE.trophiesShareBtn.y, PFE.trophiesShareBtn.w, PFE.trophiesShareBtn.h, 20, 70, 90, { tier: 'tertiary' });

    sb.e[pfTrophiesViewN]._children = [
        rf(pfTrophiesEmpty),
        rf(pfTrophiesHeaderTitle), rf(pfTrophiesHeaderSubtitle),
        rf(pfTrophiesPagePrev), rf(pfTrophiesPageLabel), rf(pfTrophiesPageNext),
        ...pfTrophyTileIndices.map(rf),
        rf(pfTrophiesFooterLine1), rf(pfTrophiesFooterLine2),
        rf(pfTrophiesShareBtn),
    ];
    sb.e[pfTrophiesViewN]._active = false;

    sb.e[pfN]._children = [
        // 2026-05-01 — scrim FIRST so it z-orders behind every other panel
        // child. Mirrors Leaderboard pattern.
        rf(pfScrimN),
        rf(pfBackLink), rf(pfBackBtn),
        rf(pfTitle), rf(pfSubtitle), rf(pfPubkeyLabel),
        rf(pfStatsTab), rf(pfHistoryTab), rf(pfTrophiesTab),
        rf(pfModeLabel), rf(pfPaperTab), rf(pfRealTab),
        rf(heroCardN),
        rf(pfGroupPerf), ...pfStatIndices.map(rf),
        rf(pfGroupAct), rf(xpCardN),
        rf(pfEmptyStateN),
        rf(pfHistoryViewN), rf(pfTrophiesViewN),
        rf(pfHint), rf(pfStatus),
    ];
    sb.e[pfN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // 2026-04-27 — MATCHES IN PROGRESS PANEL (live-battle redesign)
    // Each row is a 150-px battle card: cardGlow + cardBg + edge stripe +
    // top-row (winLine/vsLabel/timeLabel/ring) + middle duel-bar group
    // (track/fill/glow/tick) + bottom-row (windowLine/stakeChip/Resume).
    // AppUI animates duel-bar fill, leader-tip glow, and low-time pulse
    // per-frame; recomputes labels + ring fraction on a 1-s tick.
    // ═══════════════════════════════════════════════════════════════
    const MIPE = LAYOUT.MatchesInProgressPanel.elements;
    const MIPR = LAYOUT.MatchesInProgressPanel.templates.mipRow;
    // Local invis-btn helper (mkInvisBtnXY isn't declared until later in this
    // generate() function — TDZ. Inline a tiny equivalent.)
    const mipInvisBtn = (name, parent, x, y, w, h) => {
        const hN = sb.e.length;
        sb.node(name, parent, [], [], v3(x, y, 0));
        const hUT = sb.ut(hN, w, h);
        const hBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(hN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.04, _target: rf(hN), _id: gid(),
        });
        sb.e[hN]._components = [rf(hUT), rf(hBtn)];
        return hN;
    };
    // Local solid-color sprite helper (returns new node index).
    const mipSolidSprite = (name, parent, x, y, w, h, r, g, b, alpha = 255) => {
        const sN = sb.e.length;
        sb.node(name, parent, [], [], v3(x, y, 0));
        const sUT = sb.ut(sN, w, h);
        const sSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(sN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(r, g, b, alpha),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[sN]._components = [rf(sUT), rf(sSpr)];
        return sN;
    };
    // Local Graphics-only node helper (for duel bar + ring; AppUI draws into it).
    const mipGraphicsNode = (name, parent, x, y, w, h) => {
        const gN = sb.e.length;
        sb.node(name, parent, [], [], v3(x, y, 0));
        const gUT = sb.ut(gN, w, h);
        const gG = sb.add({
            __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(gN), _enabled: true, __prefab: null,
            _lineWidth: 5, _miterLimit: 10,
            _strokeColor: cl(48, 198, 155, 255),
            _fillColor: cl(255, 255, 255, 0),
            _id: gid(),
        });
        sb.e[gN]._components = [rf(gUT), rf(gG)];
        return gN;
    };

    // 2026-04-29 — Nuclear rebuild: fixed 6-row pool, NO scrollview, NO Mask.
    // Mirrors the FindMatchPanel pattern (which renders correctly). Rows are
    // direct children of the panel. Each row carries only a UITransform; its
    // content lives in child Sprite/Label/Button nodes. The thin teal stripe
    // is the only chrome — page sits directly on the app background.
    const mipN = sb.e.length;
    sb.node('MatchesInProgressPanel', canvas, [], [mipN+1], lobbyMount('MatchesInProgressPanel'));
    sb.ut(mipN, 720, 1280);
    // 2026-05-01 — match Leaderboard backdrop. Dark-slate panel sprite (full
    // canvas) hides BackgroundFX bleed; MipContentScrim @ alpha 110 sits on
    // top so the match cards float on a clean transparent dark wash.
    sb.spr(mipN, 10, 14, 22);
    const mipScrimN = sb.e.length;
    sb.node('MipContentScrim', mipN, [], [], v3(0, 0, 0));
    const mipScrimUT = sb.ut(mipScrimN, 720, 1280);
    const mipScrimSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mipScrimN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.primary.r, P.bg.primary.g, P.bg.primary.b, 110),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mipScrimN]._components = [rf(mipScrimUT), rf(mipScrimSpr)];

    logBackParity('MatchesInProgressPanel', MIPE.backLink.y);
    const mipBackLink = mkLabel(sb, 'BackLinkLabel', mipN, '← Back', 18,
        MIPE.backLink.y, MIPE.backLink.w, MIPE.backLink.h, 200, 210, 230);
    sb.e[mipBackLink]._lpos = v3(MIPE.backLink.x, MIPE.backLink.y, 0);
    const mipBackBtnN = mipInvisBtn('BackButton', mipN,
        MIPE.backBtn.x, MIPE.backBtn.y, MIPE.backBtn.w, MIPE.backBtn.h);

    const mipTitle = mkLabel(sb, 'MatchesInProgressTitleLabel', mipN, 'Matches In Progress', 30,
        MIPE.title.y, MIPE.title.w, MIPE.title.h, 255, 210, 74);
    style(sb, mipTitle, { bold: true });
    // 2026-04-29 v2 — bump subtitle 14→18pt + lighter hue for stronger
    // hierarchy ("2 games running" was reading as filler).
    const mipSubtitle = mkLabel(sb, 'MatchesInProgressSubtitleLabel', mipN, 'All clear', 18,
        MIPE.subtitle.y, MIPE.subtitle.w, MIPE.subtitle.h, 255, 255, 255);

    // Empty-state cluster — toggled by AppUI when 0 active matches.
    const mipEmptyN = sb.e.length;
    sb.node('MIPEmptyState', mipN, [], [], v3(MIPE.emptyState.x, MIPE.emptyState.y, 0));
    sb.ut(mipEmptyN, MIPE.emptyState.w, MIPE.emptyState.h);
    const mipEmptyTitle = mkLabel(sb, 'MIPEmptyTitle', mipEmptyN, 'No active matches', 22,
        MIPE.emptyStateTitle.y - MIPE.emptyState.y, MIPE.emptyStateTitle.w, MIPE.emptyStateTitle.h, 255, 255, 255);
    const mipEmptySub = mkLabel(sb, 'MIPEmptySubtitle', mipEmptyN, 'Start a match or resume when ready.', 14,
        MIPE.emptyStateSubtitle.y - MIPE.emptyState.y, MIPE.emptyStateSubtitle.w, MIPE.emptyStateSubtitle.h, 184, 184, 184);
    const mipEmptyCta = mkBtn(sb, 'MIPEmptyCtaButton', mipEmptyN, 'Find Match',
        MIPE.emptyStateCta.y - MIPE.emptyState.y, MIPE.emptyStateCta.w, MIPE.emptyStateCta.h, 48, 198, 155,
        { tier: 'secondary' });
    sb.e[mipEmptyN]._children = [rf(mipEmptyTitle), rf(mipEmptySub), rf(mipEmptyCta)];
    sb.e[mipEmptyN]._active = false;

    // 6 fixed rows — direct children of mipN.
    // 2026-04-29 — live-control-center redesign. Each row is now a
    // self-contained card: 9-slice rounded surface + breathing glow halo +
    // 6px leader-state edge stripe + LIVE chip + merged status row + timer
    // progress bar + idle-pulsing Resume CTA.
    const mipRows = [];
    for (let i = 0; i < MIPR.count; i++) {
        const ry = MIPR.baseY + i * MIPR.gapY;
        const rowN = sb.e.length;
        sb.node(`MIPRow_${i}`, mipN, [], [rowN+1], v3(0, ry, 0));
        sb.ut(rowN, MIPR.w, MIPR.h);

        // Glow halo (back of stack) — 9-slice, slightly larger than card.
        // AppUI tints + animates alpha via _mipFrameTick (breathes on idle,
        // urgent pulse when remaining<20%).
        const cardGlowN = sb.e.length;
        sb.node(`MIPCardGlow_${i}`, rowN, [], [], v3(MIPR.cardGlow.x, MIPR.cardGlow.y, 0));
        const cardGlowUT = sb.ut(cardGlowN, MIPR.cardGlow.w, MIPR.cardGlow.h);
        const cardGlowSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(cardGlowN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(48, 198, 155, 0),    // alpha 0 — AppUI animates
            _spriteFrame: { __uuid__: UUID_CARD_BG_R16 || UUID_WHITE_SPRITE },
            _type: UUID_CARD_BG_R16 ? 1 : 0, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[cardGlowN]._components = [rf(cardGlowUT), rf(cardGlowSpr)];

        // Card surface — 9-slice rounded slate.
        const cardBgN = sb.e.length;
        sb.node(`MIPCardBg_${i}`, rowN, [], [], v3(MIPR.cardBg.x, MIPR.cardBg.y, 0));
        const cardBgUT = sb.ut(cardBgN, MIPR.cardBg.w, MIPR.cardBg.h);
        const cardBgSpr = cardBodySpr(sb, cardBgN, 232);   // ~91% alpha
        sb.e[cardBgN]._components = [rf(cardBgUT), rf(cardBgSpr)];

        // Full-row invisible tap target (above card, below resume button).
        const tapN = mipInvisBtn(`MIPTapTarget_${i}`, rowN,
            MIPR.tapTarget.x, MIPR.tapTarget.y, MIPR.tapTarget.w, MIPR.tapTarget.h);

        // Leader-state accent stripe (left edge). 6×116. AppUI tints by state.
        const edgeN = mipSolidSprite(`MIPCardEdge_${i}`, rowN,
            MIPR.edge.x, MIPR.edge.y, MIPR.edge.w, MIPR.edge.h,
            48, 198, 155, 255);

        // Timer progress track (bottom of card).
        const progressTrackN = mipSolidSprite(`MIPProgressTrack_${i}`, rowN,
            MIPR.progressTrack.x, MIPR.progressTrack.y,
            MIPR.progressTrack.w, MIPR.progressTrack.h,
            70, 80, 110, 140);   // mid-low slate, low alpha

        // Timer progress fill — anchored to LEFT edge so width animation
        // grows rightward from the track's left. AppUI sets width =
        // 624 * elapsed/total each tick; default starts at 0.
        const progressFillN = sb.e.length;
        sb.node(`MIPProgressFill_${i}`, rowN, [], [],
            v3(MIPR.progressFill.x, MIPR.progressFill.y, 0));
        const progressFillUT = sb.ut(progressFillN, MIPR.progressFill.w, MIPR.progressFill.h);
        sb.e[progressFillUT]._anchorPoint = v2(0, 0.5);
        const progressFillSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(progressFillN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(48, 198, 155, 230),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 0, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[progressFillN]._components = [rf(progressFillUT), rf(progressFillSpr)];

        // 2026-04-29 v2 — LIVE cluster: glow halo behind dot for "active +
        // alive" feel. AppUI tints all three by leader state.
        const liveGlowN = mipSolidSprite(`MIPLiveGlow_${i}`, rowN,
            MIPR.liveGlow.x, MIPR.liveGlow.y, MIPR.liveGlow.w, MIPR.liveGlow.h,
            48, 198, 155, 90);

        // LIVE indicator dot (12×12, bumped from 8×8 for legibility).
        const liveDotN = mipSolidSprite(`MIPLiveDot_${i}`, rowN,
            MIPR.liveDot.x, MIPR.liveDot.y, MIPR.liveDot.w, MIPR.liveDot.h,
            48, 198, 155, 255);

        // LIVE microcopy (right of dot). 13pt mono bold.
        const liveLabelN = mkLabel(sb, `MIPLiveLabel_${i}`, rowN, 'LIVE', 13,
            MIPR.liveLabel.y, MIPR.liveLabel.w, MIPR.liveLabel.h, 20, 241, 149);
        sb.e[liveLabelN]._lpos = v3(MIPR.liveLabel.x, MIPR.liveLabel.y, 0);
        sb.e[sb.e[liveLabelN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, liveLabelN, { bold: true, mono: true });

        // 2026-04-29 v2 — title 20pt → 26pt. AppUI sets "VS Bot • PAPER"
        // (mixed case; stake folded in).
        const vsLblN = mkLabel(sb, `MIPVsLabel_${i}`, rowN, '', 26,
            MIPR.vsLabel.y, MIPR.vsLabel.w, MIPR.vsLabel.h, 255, 255, 255);
        sb.e[vsLblN]._lpos = v3(MIPR.vsLabel.x, MIPR.vsLabel.y, 0);
        sb.e[sb.e[vsLblN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, vsLblN, { bold: true });

        // 2026-04-29 v2 — leader chip (repurposed stakeChip slot).
        // Hidden in pregame; "YOU +0.32%" teal / "OPP +0.45%" rose otherwise.
        const stakeChipN = mkLabel(sb, `MIPStakeChip_${i}`, rowN, '', 12,
            MIPR.stakeChip.y, MIPR.stakeChip.w, MIPR.stakeChip.h, 184, 184, 184);
        sb.e[stakeChipN]._lpos = v3(MIPR.stakeChip.x, MIPR.stakeChip.y, 0);
        sb.e[sb.e[stakeChipN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, stakeChipN, { bold: true, mono: true });

        // 2026-04-29 v2 — merged phase+time line: "Mid match • 11h 32m left".
        // 13pt → 17pt, anchored left at x=-336.
        const statusLabelN = mkLabel(sb, `MIPStatusLabel_${i}`, rowN, '—', 17,
            MIPR.statusLabel.y, MIPR.statusLabel.w, MIPR.statusLabel.h, 255, 255, 255);
        sb.e[statusLabelN]._lpos = v3(MIPR.statusLabel.x, MIPR.statusLabel.y, 0);
        sb.e[sb.e[statusLabelN]._components[1].__id__]._horizontalAlign = 0;

        // Legacy time slot — folded into statusLabel; AppUI sets to '' each render.
        const timeLblN = mkLabel(sb, `MIPTimeLabel_${i}`, rowN, '', 14,
            MIPR.timeLabel.y, MIPR.timeLabel.w, MIPR.timeLabel.h, 184, 184, 184);
        sb.e[timeLblN]._lpos = v3(MIPR.timeLabel.x, MIPR.timeLabel.y, 0);
        sb.e[sb.e[timeLblN]._components[1].__id__]._horizontalAlign = 2;
        style(sb, timeLblN, { mono: true });

        // 2026-04-29 v2 — soft glow halo behind Resume button. Replaces the
        // prior addIdlePulse scale tween. Alpha breathes via _mipFrameTick
        // on a 2.5s cycle. Use 9-slice card_bg_r16 for the rounded shape.
        const resumeGlowN = sb.e.length;
        sb.node(`MIPResumeGlow_${i}`, rowN, [], [], v3(MIPR.resumeGlow.x, MIPR.resumeGlow.y, 0));
        const resumeGlowUT = sb.ut(resumeGlowN, MIPR.resumeGlow.w, MIPR.resumeGlow.h);
        const resumeGlowSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(resumeGlowN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(48, 198, 155, 0),     // alpha 0; AppUI animates
            _spriteFrame: { __uuid__: UUID_CARD_BG_R16 || UUID_WHITE_SPRITE },
            _type: UUID_CARD_BG_R16 ? 1 : 0, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[resumeGlowN]._components = [rf(resumeGlowUT), rf(resumeGlowSpr)];

        // Resume CTA — static (no scale pulse). Glow halo above provides the
        // breathing feedback.
        const resumeBtnN = mkBtnXY(sb, `MIPResumeBtn_${i}`, rowN, 'Resume →',
            MIPR.resumeBtn.x, MIPR.resumeBtn.y,
            MIPR.resumeBtn.w, MIPR.resumeBtn.h,
            48, 198, 155);

        // 2026-05-02 — small ghost details button left of the resume CTA.
        // AppUI binds MIPDetailsBtn_i to _onMipRowDetailsTap which opens the
        // LiveStandingsOverlay (per-player rank + live PnL).
        const detailsBtnN = mkBtnXY(sb, `MIPDetailsBtn_${i}`, rowN, 'Ranks',
            MIPR.detailsBtn.x, MIPR.detailsBtn.y,
            MIPR.detailsBtn.w, MIPR.detailsBtn.h,
            55, 65, 85);
        style(sb, detailsBtnN, { bold: true });

        // Z-order: cardGlow → cardBg → tap → edge → progressTrack → progressFill
        // → resumeGlow → resumeBtn → detailsBtn → liveGlow → liveDot → liveLabel → text labels.
        // (Resume glow under button so the button's solid fill draws on top.
        // Live glow sits ABOVE progress so the halo isn't hidden by the bar.)
        sb.e[rowN]._children = [
            rf(cardGlowN), rf(cardBgN),
            rf(tapN), rf(edgeN),
            rf(progressTrackN), rf(progressFillN),
            rf(resumeGlowN), rf(resumeBtnN), rf(detailsBtnN),
            rf(liveGlowN), rf(liveDotN), rf(liveLabelN),
            rf(vsLblN), rf(stakeChipN), rf(statusLabelN), rf(timeLblN),
        ];
        sb.e[rowN]._active = false;
        mipRows.push(rowN);
    }

    // "+N more" hint shown when active count > 6.
    const mipMoreLblN = mkLabel(sb, 'MIPMoreLabel', mipN, '', 12,
        MIPE.moreLabel.y, MIPE.moreLabel.w, MIPE.moreLabel.h, 184, 184, 184);
    sb.e[mipMoreLblN]._active = false;

    const mipStatus = mkLabel(sb, 'MatchesInProgressStatusLabel', mipN, '', 12,
        MIPE.status.y, MIPE.status.w, MIPE.status.h, 184, 184, 184);

    sb.e[mipN]._children = [
        // Scrim FIRST so it z-orders behind every other panel child (matches
        // Leaderboard pattern at L5142 / FindMatch pattern at L7283).
        rf(mipScrimN),
        rf(mipBackLink), rf(mipBackBtnN),
        rf(mipTitle), rf(mipSubtitle),
        rf(mipEmptyN),
        ...mipRows.map(rf),
        rf(mipMoreLblN),
        rf(mipStatus),
    ];
    sb.e[mipN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session D Part 3 — WAITING PANEL
    // Shown during real-mode matchmaking + as a brief transition for paper.
    // ═══════════════════════════════════════════════════════════════
    // All WaitingPanel positions sourced from LAYOUT.WaitingPanel.
    const WPE = LAYOUT.WaitingPanel.elements;
    const wpN = sb.e.length;
    sb.node('WaitingPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(wpN, LAYOUT.WaitingPanel.canvas.w, LAYOUT.WaitingPanel.canvas.h);
    sb.spr(wpN, 10, 14, 22);

    const wpTitle    = mkLabel(sb, 'WaitingTitleLabel', wpN, 'Finding opponent…', 28,
        WPE.title.y, WPE.title.w, WPE.title.h, 255, 255, 255);
    const wpMode     = mkLabel(sb, 'WaitingModeLabel', wpN, '1v1 · 0.05 SOL · Real', 16,
        WPE.mode.y, WPE.mode.w, WPE.mode.h, 140, 220, 180);
    style(sb, wpMode, { mono: true });  // Phase 15 (B5): mixed numeric/mode line
    const wpRake     = mkLabel(sb, 'WaitingRakeLabel', wpN, '', 13,
        WPE.rake.y, WPE.rake.w, WPE.rake.h, 184, 184, 184);
    const wpProgress = mkLabel(sb, 'WaitingProgressLabel', wpN, '0/2 players · 0:00 / 2:00', 18,
        WPE.progress.y, WPE.progress.w, WPE.progress.h, 180, 190, 210);
    style(sb, wpProgress, { mono: true });  // Phase 15 (B5): live timer + count
    const wpSpinner  = mkLabel(sb, 'WaitingSpinnerLabel', wpN, '·  ·  ·', 28,
        WPE.spinner.y, WPE.spinner.w, WPE.spinner.h, 48, 198, 155);
    const wpCancelBtn = mkBtn(sb, 'WaitingCancelButton', wpN, 'Cancel',
        WPE.cancelBtn.y, WPE.cancelBtn.w, WPE.cancelBtn.h, 55, 75, 95,
        { tier: 'tertiary' });
    const wpBotBtn    = mkBtn(sb, 'WaitingPlayBotButton', wpN, '▶ Play vs Bot',
        WPE.botBtn.y, WPE.botBtn.w, WPE.botBtn.h, 48, 198, 155,
        { tier: 'secondary' });
    sb.e[wpBotBtn]._active = false; // revealed after timeout or immediately on paper
    // Force-settle: revealed after match active 5+ min with missing players.
    // UX Phase 2b: IconBadge bolt attached by AppUI. Phase 2c: bold.
    const wpForceBtn  = mkBtn(sb, 'WaitingForceSettleButton', wpN, 'Force Settle (AFK)',
        WPE.forceBtn.y, WPE.forceBtn.w, WPE.forceBtn.h, 202, 140, 60,
        { tier: 'secondary' });
    style(sb, wpForceBtn, { bold: true });
    sb.e[wpForceBtn]._active = false;
    // Streak banner: hidden unless current_streak ≥ 3. UX Phase 2b: IconBadge flame attached by AppUI.
    const wpStreakBanner = mkLabel(sb, 'WaitingStreakBanner', wpN, 'Day 3 streak — keep the fire going', 16,
        WPE.streakBanner.y, WPE.streakBanner.w, WPE.streakBanner.h, 255, 210, 74);
    sb.e[wpStreakBanner]._active = false;
    const wpStatus = mkLabel(sb, 'WaitingStatusLabel', wpN, '', 12,
        WPE.status.y, WPE.status.w, WPE.status.h, 184, 184, 184);

    sb.e[wpN]._children = [rf(wpTitle), rf(wpMode), rf(wpRake), rf(wpProgress), rf(wpSpinner), rf(wpStreakBanner), rf(wpCancelBtn), rf(wpBotBtn), rf(wpForceBtn), rf(wpStatus)];
    sb.e[wpN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // POST-MATCH PANEL — drifting-gadget redesign
    // Five-beat hierarchy: Outcome → Mascot → SOL → Stats → CTA.
    // Mascot is the centerpiece (centered, 360×360); payout sits directly
    // below it; cards in 2×2 grid; XP progress bar; primary "Play Again"
    // teal hero + secondary "Pick New Squad" blue. Trophy is now a small
    // corner badge in the title row. Background tint Graphics layer + mascot
    // glow halo provide outcome-coded visual reaction.
    // ═══════════════════════════════════════════════════════════════
    const pmN = sb.e.length;
    // 2026-04-29 viewport-aware result scene. Panel root rests at world
    // origin so AppUI._relayoutPostMatchToViewport can place children
    // relative to the visible viewport (mascot true-centered, top zone
    // hugs the top, bottom zone hugs the bottom safe area). Children
    // start at their pm.*_Y design values; runtime overrides win.
    sb.node('PostMatchPanel', canvas, [], [], v3(0, 0, 0));
    // 2026-04-28 spatial pass keeps the canvas oversized 720×1800 so the
    // editor preview matches a tall device. AppUI re-sizes the UTransform
    // to view.getVisibleSize() at show time so the dark wash always
    // covers the full viewport, never less, never more.
    sb.ut(pmN, LAYOUT.PostMatchPanel.canvas.w, LAYOUT.PostMatchPanel.canvas.h);
    sb.spr(pmN, 10, 14, 22);

    // All PostMatchPanel positions sourced from LAYOUT.PostMatchPanel.
    const PME = LAYOUT.PostMatchPanel.elements;
    const PMC = LAYOUT.PostMatchPanel.templates.pmCard;
    const PMCO = LAYOUT.PostMatchPanel.templates.confetti;

    // Outcome-bg tint — full-canvas Graphics rect, alpha 0 by default.
    // AppUI fills (green-on-win / violet-on-loss) and tweens UIOpacity 0→60.
    const pmOutcomeBgN = sb.e.length;
    sb.node('OutcomeBgTint', pmN, [], [], v3(PME.outcomeBg.x, PME.outcomeBg.y, 0));
    const pmOutcomeBgUT = sb.ut(pmOutcomeBgN, PME.outcomeBg.w, PME.outcomeBg.h);
    const pmOutcomeBgGfx = sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pmOutcomeBgN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(0, 0, 0, 0),
        _fillColor:   cl(48, 198, 155, 255),
        _id: gid(),
    });
    const pmOutcomeBgOp = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pmOutcomeBgN), _enabled: true, __prefab: null,
        _opacity: 0,
    });
    sb.e[pmOutcomeBgN]._components = [rf(pmOutcomeBgUT), rf(pmOutcomeBgGfx), rf(pmOutcomeBgOp)];

    // 2026-04-29 win-screen redesign — Back button removed from win screen.
    // The back nodes still exist (parked at -2000,-2000 with active=false)
    // so AppUI's PostMatchBackButton lookup keeps working without crashing.
    const _pmBack = mkBackHeader(sb, pmN, { y: PME.backBtn.y, panelKey: 'PostMatchPanel' });
    sb.e[_pmBack.btnN]._name = 'PostMatchBackButton';
    sb.e[_pmBack.linkN]._name = 'PostMatchBackLinkLabel';
    sb.e[_pmBack.btnN]._lpos = v3(PME.backBtn.x, PME.backBtn.y, 0);
    sb.e[_pmBack.linkN]._lpos = v3(PME.backLink.x, PME.backLink.y, 0);
    sb.e[_pmBack.btnN]._active = false;
    sb.e[_pmBack.linkN]._active = false;
    const pmBackBtn = _pmBack.btnN;
    // Title — bold, color-coded (green on win, rose on loss) at runtime.
    // 2026-04-28 — 56pt → 60pt for slightly bigger reward-moment energy.
    const pmTitle = mkLabel(sb, 'PostMatchTitleLabel', pmN, 'YOU WON!', 60,
        PME.title.y, PME.title.w, PME.title.h, 255, 255, 255);
    style(sb, pmTitle, { bold: true });
    const pmTrack = mkLabel(sb, 'PostMatchTrackLabel', pmN, 'Paper · 1v1', 28,
        PME.track.y, PME.track.w, PME.track.h, 184, 184, 184);

    // Mascot glow halo — Graphics circle behind the mascot, drawn before so
    // the mascot renders on top. AppUI fills + fades on show.
    const pmMascotGlowN = sb.e.length;
    sb.node('MascotGlow', pmN, [], [], v3(PME.mascotGlow.x, PME.mascotGlow.y, 0));
    const pmMascotGlowUT = sb.ut(pmMascotGlowN, PME.mascotGlow.w, PME.mascotGlow.h);
    const pmMascotGlowGfx = sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pmMascotGlowN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(0, 0, 0, 0),
        _fillColor:   cl(48, 198, 155, 255),
        _id: gid(),
    });
    const pmMascotGlowOp = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pmMascotGlowN), _enabled: true, __prefab: null,
        _opacity: 0,
    });
    sb.e[pmMascotGlowN]._components = [rf(pmMascotGlowUT), rf(pmMascotGlowGfx), rf(pmMascotGlowOp)];

    // Mascot container — centered above the payout; per-state celebrate/lose
    // frames already wired in MascotController.setState().
    const pmMascotN = sb.e.length;
    sb.node('PostMatchMascotContainer', pmN, [], [], v3(PME.mascotContainer.x, PME.mascotContainer.y, 0));
    const pmMascotUT = sb.ut(pmMascotN, PME.mascotContainer.w, PME.mascotContainer.h);
    sb.e[pmMascotN]._components = [rf(pmMascotUT)];

    // 2026-04-29 — eyebrow "YOU EARNED" / "YOU LOST" sits above the payout
    // hero. 14pt dim, letter-spaced. AppUI sets the string per outcome.
    const pmEarned = mkLabel(sb, 'PostMatchEarnedLabel', pmN, 'YOU EARNED', 14,
        PME.earned.y, PME.earned.w, PME.earned.h, 184, 184, 184);
    sb.e[pmEarned]._lpos = v3(PME.earned.x, PME.earned.y, 0);
    style(sb, pmEarned, { bold: true, spacing: 2 });

    // 2026-04-28 spatial pass — payout 64pt → 72pt (+12.5% per spec).
    const pmPayout = mkLabel(sb, 'PostMatchPayoutLabel', pmN, '', 72,
        PME.payoutLabel.y, PME.payoutLabel.w, PME.payoutLabel.h, 48, 198, 155);
    // 2026-04-28 — subtitle now ONLY carries "Won by X.XX%" headline (one
    // line, 22pt). Per-token breakdown moves to PostMatchBreakdownLabel below.
    const pmSubtitle = mkLabel(sb, 'PostMatchSubtitleLabel', pmN, '', 22,
        PME.subtitle.y, PME.subtitle.w, PME.subtitle.h, 220, 226, 240);
    // 2026-04-29 — breakdown row gets a chip-pill wrapper so it reads as a
    // contained chip, not floating subtitle text. PostMatchBreakdownLabel
    // becomes a child of PostMatchBreakdownPill (local x/y both 0).
    const pmBreakdownPillN = sb.e.length;
    sb.node('PostMatchBreakdownPill', pmN, [], [], v3(PME.breakdownPill.x, PME.breakdownPill.y, 0));
    const pmBreakdownPillUT = sb.ut(pmBreakdownPillN, PME.breakdownPill.w, PME.breakdownPill.h);
    const pmBreakdownPillSpr = cardBodySpr(sb, pmBreakdownPillN, 180);
    sb.e[pmBreakdownPillN]._components = [rf(pmBreakdownPillUT), rf(pmBreakdownPillSpr)];
    const pmBreakdown = mkLabel(sb, 'PostMatchBreakdownLabel', pmBreakdownPillN, '', 18,
        PME.breakdown.y, PME.breakdown.w, PME.breakdown.h, 184, 184, 184);
    sb.e[pmBreakdown]._lpos = v3(PME.breakdown.x, PME.breakdown.y, 0);
    const pmBreakdownOp = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pmBreakdown), _enabled: true, __prefab: null,
        _opacity: 220,
    });
    sb.e[pmBreakdown]._components.push(rf(pmBreakdownOp));
    style(sb, pmBreakdown, { mono: true });
    sb.e[pmBreakdownPillN]._children = [rf(pmBreakdown)];

    const pmRake = mkLabel(sb, 'PostMatchRakeLabel', pmN, '', 24,
        PME.rake.y, PME.rake.w, PME.rake.h, 150, 160, 180);
    // Mono payout + rake for aligned digits through the ticker roll.
    style(sb, pmPayout, { mono: true, bold: true });
    style(sb, pmRake, { mono: true });

    // 4 stat cards from LAYOUT.PostMatchPanel.templates.pmCard.
    // 2026-04-29 — adds an Icon glyph in the top-left of each card so the
    // 2×2 grid reads as celebration callouts not analytics blocks. Glyph
    // tinting (▲ green / ▼ red etc.) is finalized at show time by AppUI.
    const PM_ICONS = { you: '▲', opp: '▼', xp: '★', lvl: '▰' };
    const pmCardIndices = [];
    for (const d of PMC.defs) {
        const cardN = sb.e.length;
        sb.node(`PMCard_${d.key}`, pmN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, PMC.w, PMC.h);
        const cardSpr = cardBodySpr(sb, cardN);
        // Header label — slight right-shift so the icon column has 24px breathing room.
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(PMC.header.x + 12, PMC.header.y, 0));
        const lblUT = sb.ut(lblN, PMC.header.w - 24, PMC.header.h);
        const lblL = sb.lbl(lblN, d.label, 13, 184, 184, 184);
        sb.e[lblL]._spacingX = 1;
        sb.e[lblN]._components = [rf(lblUT), rf(lblL)];
        const valN = sb.e.length;
        sb.node('Value', cardN, [], [], v3(PMC.value.x, PMC.value.y, 0));
        const valUT = sb.ut(valN, PMC.value.w, PMC.value.h);
        const valL = sb.lbl(valN, '—', PMC.value.fontSize ?? 32, 255, 255, 255);
        sb.e[valL]._isBold = true;
        style(sb, valN, { mono: true });
        sb.e[valN]._components = [rf(valUT), rf(valL)];
        // 2026-04-27 — small sub-line below the big +N value (multiplier /
        // breakdown). AppUI splits the legacy "\n"-joined string and writes
        // line 2 here so the multiplier doesn't render at 32pt.
        const valSubN = sb.e.length;
        sb.node('ValueSub', cardN, [], [], v3(PMC.valueSub.x, PMC.valueSub.y, 0));
        const valSubUT = sb.ut(valSubN, PMC.valueSub.w, PMC.valueSub.h);
        const valSubL = sb.lbl(valSubN, '', PMC.valueSub.fontSize ?? 13, 184, 184, 184);
        style(sb, valSubN, { mono: true });
        sb.e[valSubN]._components = [rf(valSubUT), rf(valSubL)];
        // 2026-04-29 — leftmost icon glyph. AppUI tints by sign at show time
        // (delta cards) or by outcome (xp/lvl). Tagged PMCardIcon_<key>.
        const iconN = sb.e.length;
        sb.node(`PMCardIcon_${d.key}`, cardN, [], [], v3(-PMC.w / 2 + 28, PMC.header.y, 0));
        const iconUT = sb.ut(iconN, 32, PMC.header.h);
        const iconL = sb.lbl(iconN, PM_ICONS[d.key] ?? '·', 18, 184, 184, 184);
        sb.e[iconL]._isBold = true;
        sb.e[iconN]._components = [rf(iconUT), rf(iconL)];
        // Edge accent — emitted neutral; AppUI tints per outcome (green/rose)
        // at show time. Tagged PMCardEdge_<key> so the binder can find it.
        const cardEdge = mkCardEdge(sb, cardN, PMC.w, PMC.h, 184, 184, 184);
        sb.e[cardEdge]._name = `PMCardEdge_${d.key}`;
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(lblN), rf(valN), rf(valSubN), rf(iconN), rf(cardEdge)];
        pmCardIndices.push(cardN);
    }

    // XP progress bar — 3 siblings: left "Lv N → Lv N+1" label, fill graphics,
    // right "+N XP" label. AppUI redraws the fill graphics on show with a
    // numeric tween from prog0 → prog1 (level-up: roll to 100%, flash, reset, roll).
    const pmXPLabelLeft = mkLabel(sb, 'PostMatchXPBarLabelLeft', pmN, 'Lv 1 → Lv 2', 14,
        PME.xpBarLabelLeft.y, PME.xpBarLabelLeft.w, PME.xpBarLabelLeft.h, 150, 160, 185);
    sb.e[pmXPLabelLeft]._lpos = v3(PME.xpBarLabelLeft.x, PME.xpBarLabelLeft.y, 0);
    const pmXPFillN = sb.e.length;
    sb.node('PostMatchXPBarFill', pmN, [], [], v3(PME.xpBarFill.x, PME.xpBarFill.y, 0));
    const pmXPFillUT = sb.ut(pmXPFillN, PME.xpBarFill.w, PME.xpBarFill.h);
    const pmXPFillGfx = sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pmXPFillN), _enabled: true, __prefab: null,
        _lineWidth: 0, _miterLimit: 10,
        _strokeColor: cl(0, 0, 0, 0),
        _fillColor:   cl(255, 210, 74, 255),
        _id: gid(),
    });
    sb.e[pmXPFillN]._components = [rf(pmXPFillUT), rf(pmXPFillGfx)];
    const pmXPLabelRight = mkLabel(sb, 'PostMatchXPBarLabelRight', pmN, '+0 XP', 18,
        PME.xpBarLabelRight.y, PME.xpBarLabelRight.w, PME.xpBarLabelRight.h, 255, 210, 74);
    sb.e[pmXPLabelRight]._lpos = v3(PME.xpBarLabelRight.x, PME.xpBarLabelRight.y, 0);
    style(sb, pmXPLabelRight, { bold: true, mono: true });

    // 2026-04-29 win-screen redesign — two-line CTAs via mkBtnHeroLayered.
    // PRIMARY (left, green): "PICK NEW SQUAD" / "Try a different lineup".
    //   Wired to _onPostMatchAgain in AppUI (re-opens ModePicker, squad intact).
    // SECONDARY (right, ghost): "HOME" / "Back to main menu".
    //   Wired to _onPostMatchBack in AppUI (returns to HomePanel).
    // Node names are kept for back-compat with existing AppUI getChildByName lookups.
    const { glow: pmSameSquadGlow, btn: pmSameSquadBtn } = mkBtnHeroLayered(sb,
        'PostMatchSameSquadButton', pmN,
        'PICK NEW SQUAD', 'Try a different lineup',
        PME.sameSquadBtn.x, PME.sameSquadBtn.y, PME.sameSquadBtn.w, PME.sameSquadBtn.h,
        48, 198, 155,
        { tier: 'primary' });
    style(sb, pmSameSquadBtn, { bold: true });
    const { btn: pmAgainBtn } = mkBtnHeroLayered(sb,
        'PostMatchAgainButton', pmN,
        'HOME', 'Back to main menu',
        PME.againBtn.x, PME.againBtn.y, PME.againBtn.w, PME.againBtn.h,
        154, 176, 214,
        { tier: 'secondary', ghost: true });
    style(sb, pmAgainBtn, { bold: true });

    // Share-to-X button — tertiary; only visible for real-track wins.
    const pmShareBtn = mkBtn(sb, 'PostMatchShareButton', pmN, 'Share · 𝕏',
        PME.shareButton.y, PME.shareButton.w, PME.shareButton.h, 29, 161, 242,
        { tier: 'tertiary' });
    sb.e[pmShareBtn]._lpos = v3(PME.shareButton.x, PME.shareButton.y, 0);

    const pmStatus = mkLabel(sb, 'PostMatchStatusLabel', pmN, '', 12,
        PME.status.y, PME.status.w, PME.status.h, 184, 184, 184);

    // Trophy — corner badge in title row. Empty label; AppUI attaches
    // rankIcon (trophy / medalSilver / medalBronze) at show time.
    const pmTrophy = mkLabel(sb, 'TrophyLabel', pmN, '', 36,
        PME.trophy.y, PME.trophy.w, PME.trophy.h, 255, 255, 255);
    sb.e[pmTrophy]._lpos = v3(PME.trophy.x, PME.trophy.y, 0);
    sb.e[pmTrophy]._active = false;

    // Confetti particles — 12 empty Node shells parented to TrophyLabel so
    // they share its transform origin. AppUI rebases burst origin to mascot
    // world position at show time so confetti emanates from the celebrate mascot.
    const pmConfettiIndices = [];
    for (let c = 0; c < PMCO.count; c++) {
        const confN = sb.e.length;
        sb.node(`Confetti_${c}`, pmTrophy, [], [], v3(PMCO.x, PMCO.y, 0));
        const confUT = sb.ut(confN, PMCO.w, PMCO.h);
        sb.e[confN]._components = [rf(confUT)];
        sb.e[confN]._active = false;
        pmConfettiIndices.push(confN);
    }
    sb.e[pmTrophy]._children = pmConfettiIndices.map(rf);

    // Children order (2026-04-29): bg-tint first (behind everything), then
    // hidden back nodes (kept for ref-safety), title row, mascot glow,
    // mascot, reward block (eyebrow → payout → breakdown pill → subtitle),
    // rake, cards, XP bar, CTAs, share, status, trophy. The breakdown pill
    // owns its label child; we don't list pmBreakdown here.
    sb.e[pmN]._children = [
        rf(pmOutcomeBgN),
        rf(_pmBack.linkN), rf(pmBackBtn), rf(pmTitle), rf(pmTrack), rf(pmTrophy),
        rf(pmMascotGlowN), rf(pmMascotN),
        rf(pmEarned), rf(pmPayout), rf(pmBreakdownPillN), rf(pmSubtitle), rf(pmRake),
        ...pmCardIndices.map(rf),
        rf(pmXPLabelLeft), rf(pmXPFillN), rf(pmXPLabelRight),
        rf(pmSameSquadGlow), rf(pmSameSquadBtn), rf(pmAgainBtn),
        rf(pmShareBtn), rf(pmStatus),
    ];
    sb.e[pmN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session D Part 8 — SETTINGS PANEL  (Phase 30 premium redesign)
    // Accessible from HomePanel (⚙) and TokenDuelPanel (⚙) top-right.
    // 5 sections: WALLET · PROFILE · DEFAULT MATCH SETTINGS · PREFERENCES · ACCOUNT.
    // Phase 30 changes:
    //   - SettingsSheetBg: subtle dark sheet behind all cards
    //   - Wallet → compact identity card (h 160→124) with violet glow border
    //   - Profile gains "Username" label + violet focus ring around input
    //   - Default Match Settings rows: ▾ replaced by › chevron child
    //   - Trading Mode toggle gains a teal glow halo behind indicator
    //   - Preferences: real toggle switches (track + sliding knob) replace pills
    //   - Account: GENERAL / SESSION group labels + row dividers
    //   - Delete Account moved 54px below account card with smaller text
    // ═══════════════════════════════════════════════════════════════
    // All SettingsPanel positions sourced from LAYOUT.SettingsPanel.
    const SP = LAYOUT.SettingsPanel.elements;
    const SPT = LAYOUT.SettingsPanel.templates;

    // Phase 29 — replaces mkCardEdge stripes. 1px subtle white hairline along
    // the top inner edge of a card. Reads as a calm elevation hint, not a
    // saturated branded bar.
    const mkCardTopHairline = (parent, w, h, alpha = 32) => {
        const eN = sb.e.length;
        sb.node('CardTopBorder', parent, [], [], v3(0, h / 2 - 1, 0));
        const eUT = sb.ut(eN, w - 2, 1);
        const eSprIdx = sb.spr(eN, 255, 255, 255);
        sb.e[eSprIdx]._color = cl(255, 255, 255, alpha);
        sb.e[eN]._components = [rf(eUT), rf(eSprIdx)];
        return eN;
    };

    // Phase 30 — generic colored sprite primitive used for dividers, glow
    // strokes, switch tracks/knobs. Returns the node index.
    const mkColoredSprite = (name, parent, x, y, w, h, r, g, b, a = 255) => {
        const eN = sb.e.length;
        sb.node(name, parent, [], [], v3(x, y, 0));
        const eUT = sb.ut(eN, w, h);
        const eSprIdx = sb.spr(eN, r, g, b);
        sb.e[eSprIdx]._color = cl(r, g, b, a);
        sb.e[eN]._components = [rf(eUT), rf(eSprIdx)];
        return eN;
    };

    // Phase 29 — invisible button overlaying a region. Used for the copy-pubkey
    // hit area and the small Delete Account text button (transparent bg).
    const mkInvisBtnXY = (name, parent, x, y, w, h) => {
        const hN = sb.e.length;
        sb.node(name, parent, [], [], v3(x, y, 0));
        const hUT = sb.ut(hN, w, h);
        const hBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(hN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.04, _target: rf(hN), _id: gid(),
        });
        sb.e[hN]._components = [rf(hUT), rf(hBtn)];
        return hN;
    };

    const stN = sb.e.length;
    sb.node('SettingsPanel', canvas, [], [], lobbyMount('SettingsPanel'));
    sb.ut(stN, LAYOUT.SettingsPanel.canvas.w, LAYOUT.SettingsPanel.canvas.h);
    sb.spr(stN, 10, 14, 22);

    // 2026-05-01 — match Leaderboard scrim recipe: Palette.bg.primary @ alpha
    // 110 so the bg shows through faintly, same transparent feel as the
    // leaderboard panel. Was opaque (alpha 255) which read as a flat slab.
    const stSheetBg = mkColoredSprite('SettingsSheetBg', stN,
        SP.sheetBg.x, SP.sheetBg.y, SP.sheetBg.w, SP.sheetBg.h,
        P.bg.primary.r, P.bg.primary.g, P.bg.primary.b, 110);

    // 2026-04-30 — single soft teal halo behind the Wallet card area. Reads as
    // a faint accent glow without adding particles. Sits between the dark sheet
    // and the cards so it lifts the wallet identity without affecting other rows.
    const stSheetGlow = mkColoredSprite('SettingsSheetGlow', stN,
        SP.sheetGlow.x, SP.sheetGlow.y, SP.sheetGlow.w, SP.sheetGlow.h,
        20, 241, 149, 18);

    logBackParity('SettingsPanel', SP.backLink.y);
    const stBackLink = mkLabel(sb, 'BackLinkLabel', stN, '← Back', 18,
        SP.backLink.y, SP.backLink.w, SP.backLink.h, 200, 210, 230);
    sb.e[stBackLink]._lpos = v3(SP.backLink.x, SP.backLink.y, 0);
    sb.e[sb.e[stBackLink]._components[1].__id__]._horizontalAlign = 0;
    const stBackBtn = sb.e.length;
    sb.node('BackButton', stN, [], [], v3(SP.backBtn.x, SP.backBtn.y, 0));
    const stBackBtnUT = sb.ut(stBackBtn, SP.backBtn.w, SP.backBtn.h);
    const stBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(stBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(stBackBtn), _id: gid(),
    });
    sb.e[stBackBtn]._components = [rf(stBackBtnUT), rf(stBackBtnBtn)];
    const stTitle = mkLabel(sb, 'SettingsTitleLabel', stN, 'Settings', 30,
        SP.title.y, SP.title.w, SP.title.h, 255, 210, 74);
    style(sb, stTitle, { bold: true });

    // WALLET → identity-anchor card. Phase 30 / 31 / 2026-04-30:
    //   - Compact 96 px tall (was 124). Single identity row: pubkey LEFT +
    //     balance RIGHT-aligned — balance is no longer floating bottom-left.
    //   - lifted bg (28,36,58) so it reads as the visually heaviest card.
    //   - "Connected · MWA" subtitle sits on the bottom row next to the dot.
    //   - Pubkey: mono 22px BOLD hi-text. Balance: mono 20px BOLD bright teal.
    //   - Divider sprite removed (no longer needed at this height).
    //   - 4-stroke teal perimeter glow ties card to the connected accent.
    //   - AppUI._hydrateSettingsPanel attaches an idle pulse to the dot when
    //     a wallet is connected (kills the tween on disconnect).
    const WC = SP.walletCard.children;
    const stWalletCard = sb.e.length;
    sb.node('WalletCard', stN, [], [], v3(SP.walletCard.x, SP.walletCard.y, 0));
    const stWalletCardUT = sb.ut(stWalletCard, SP.walletCard.w, SP.walletCard.h);
    const stWalletCardSpr = sb.spr(stWalletCard, 26, 8, 32);

    const stWalletHeader = mkLabel(sb, 'HeaderLabel', stWalletCard, 'WALLET', 12,
        WC.header.y, WC.header.w, WC.header.h, 184, 184, 184);
    sb.e[stWalletHeader]._lpos = v3(WC.header.x, WC.header.y, 0);
    sb.e[sb.e[stWalletHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stWalletHeader, { spacing: 2 });

    const stWalletDotN = sb.e.length;
    sb.node('WalletStatusDot', stWalletCard, [], [], v3(WC.statusDot.x, WC.statusDot.y, 0));
    const stWalletDotUT = sb.ut(stWalletDotN, WC.statusDot.w, WC.statusDot.h);
    const stWalletDotSpr = sb.spr(stWalletDotN, 20, 241, 149);
    sb.e[stWalletDotN]._components = [rf(stWalletDotUT), rf(stWalletDotSpr)];

    // Secondary "Connected · {wallet}" — 12px mid-text.
    const stWalletName = mkLabel(sb, 'WalletNameLabel', stWalletCard, 'Not connected', 12,
        WC.walletName.y, WC.walletName.w, WC.walletName.h, 184, 184, 184);
    sb.e[stWalletName]._lpos = v3(WC.walletName.x, WC.walletName.y, 0);
    sb.e[sb.e[stWalletName]._components[1].__id__]._horizontalAlign = 0;

    // Prominent pubkey — mono 22px bold hi-text, left-aligned.
    const stWalletPubkey = mkLabel(sb, 'WalletPubkeyLabel', stWalletCard, '—', 22,
        WC.walletPubkey.y, WC.walletPubkey.w, WC.walletPubkey.h, 255, 255, 255);
    sb.e[stWalletPubkey]._lpos = v3(WC.walletPubkey.x, WC.walletPubkey.y, 0);
    sb.e[sb.e[stWalletPubkey]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stWalletPubkey, { mono: true, bold: true });

    const stCopyBtn = mkInvisBtnXY('CopyPubkeyButton', stWalletCard,
        WC.copyPubkeyBtn.x, WC.copyPubkeyBtn.y, WC.copyPubkeyBtn.w, WC.copyPubkeyBtn.h);

    // Balance — primary stat. Mono 20px bold bright teal. 2026-04-30 — moved
    // to RIGHT-aligned at the top row (was bottom-left float). Divider sprite
    // removed.
    const stWalletBal = mkLabel(sb, 'WalletBalanceLabel', stWalletCard, '', 20,
        WC.walletBalance.y, WC.walletBalance.w, WC.walletBalance.h, 20, 241, 149);
    sb.e[stWalletBal]._lpos = v3(WC.walletBalance.x, WC.walletBalance.y, 0);
    sb.e[sb.e[stWalletBal]._components[1].__id__]._horizontalAlign = 2;
    style(sb, stWalletBal, { mono: true, bold: true });

    // 4-stroke teal perimeter glow (top, bottom, left, right). Calm halo,
    // not a saturated stripe. Echoes the connected-state status dot.
    const stWalletGlowTop   = mkColoredSprite('WalletGlowTop',   stWalletCard,
        WC.glowTop.x, WC.glowTop.y, WC.glowTop.w, WC.glowTop.h, 20, 241, 149, 90);
    const stWalletGlowBot   = mkColoredSprite('WalletGlowBot',   stWalletCard,
        WC.glowBot.x, WC.glowBot.y, WC.glowBot.w, WC.glowBot.h, 20, 241, 149, 90);
    const stWalletGlowLeft  = mkColoredSprite('WalletGlowLeft',  stWalletCard,
        WC.glowLeft.x, WC.glowLeft.y, WC.glowLeft.w, WC.glowLeft.h, 20, 241, 149, 90);
    const stWalletGlowRight = mkColoredSprite('WalletGlowRight', stWalletCard,
        WC.glowRight.x, WC.glowRight.y, WC.glowRight.w, WC.glowRight.h, 20, 241, 149, 90);

    sb.e[stWalletCard]._components = [rf(stWalletCardUT), rf(stWalletCardSpr)];
    sb.e[stWalletCard]._children = [
        rf(stWalletHeader), rf(stWalletDotN), rf(stWalletName),
        rf(stWalletPubkey), rf(stCopyBtn), rf(stWalletBal),
        rf(stWalletGlowTop), rf(stWalletGlowBot),
        rf(stWalletGlowLeft), rf(stWalletGlowRight),
    ];

    // PROFILE card. Phase 31 dual-mode:
    //   - Display mode (default): big username label + small ghost edit
    //     pencil button on the right + softened helper line with trophy
    //     glyph tying identity to leaderboard.
    //   - Edit mode (hidden by default): EditBox with violet focus ring +
    //     explicit Cancel / Confirm buttons below. AppUI flips _active on
    //     the two subtrees so committing a username feels intentional.
    const PC = SP.profileCard.children;
    const stProfileCard = sb.e.length;
    sb.node('ProfileCard', stN, [], [], v3(SP.profileCard.x, SP.profileCard.y, 0));
    const stProfileCardUT = sb.ut(stProfileCard, SP.profileCard.w, SP.profileCard.h);
    const stProfileCardSpr = cardBodySpr(sb, stProfileCard);
    const stProfileHeader = mkLabel(sb, 'HeaderLabel', stProfileCard, 'PROFILE', 12,
        PC.header.y, PC.header.w, PC.header.h, 184, 184, 184);
    sb.e[stProfileHeader]._lpos = v3(PC.header.x, PC.header.y, 0);
    sb.e[sb.e[stProfileHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stProfileHeader, { spacing: 1 });

    const stUsernameLabel = mkLabel(sb, 'UsernameLabel', stProfileCard, 'Username', 14,
        PC.usernameLabel.y, PC.usernameLabel.w, PC.usernameLabel.h, 184, 184, 184);
    sb.e[stUsernameLabel]._lpos = v3(PC.usernameLabel.x, PC.usernameLabel.y, 0);
    sb.e[sb.e[stUsernameLabel]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stUsernameLabel, { spacing: 1 });

    // ── Display-mode subtree (default visible). ────────────────────────────
    // Big username readout + small ghost pencil button on the right.
    const stUsernameDisplay = mkLabel(sb, 'UsernameDisplayLabel', stProfileCard,
        'Set username', 22,
        PC.usernameDisplay.y, PC.usernameDisplay.w, PC.usernameDisplay.h,
        255, 255, 255);
    sb.e[stUsernameDisplay]._lpos = v3(PC.usernameDisplay.x, PC.usernameDisplay.y, 0);
    sb.e[sb.e[stUsernameDisplay]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stUsernameDisplay, { bold: true });

    // Edit pencil button — soft ghost fill with a "✎" glyph child.
    const stEditUsernameBtn = sb.e.length;
    sb.node('EditUsernameButton', stProfileCard, [], [],
        v3(PC.editUsernameBtn.x, PC.editUsernameBtn.y, 0));
    const stEditBtnUT = sb.ut(stEditUsernameBtn, PC.editUsernameBtn.w, PC.editUsernameBtn.h);
    const stEditBtnSpr = sb.spr(stEditUsernameBtn, 38, 46, 70);
    const stEditBtnBtn = sb.btn(stEditUsernameBtn, 38, 46, 70);
    const stEditBtnGlyph = mkLabel(sb, 'Label', stEditUsernameBtn, '✎', 22,
        0, PC.editUsernameBtn.w, PC.editUsernameBtn.h, 184, 184, 184);
    sb.e[stEditUsernameBtn]._components = [rf(stEditBtnUT), rf(stEditBtnSpr), rf(stEditBtnBtn)];
    sb.e[stEditUsernameBtn]._children = [rf(stEditBtnGlyph)];

    // ── Edit-mode subtree (hidden by default — AppUI flips _active on tap). ─
    // Focus ring sits at the same x/y as the EditBox; AppUI tweens its
    // UIOpacity alpha on focus events. Created BEFORE the EditBox so it
    // draws beneath the input chrome.
    const stUsernameFocusRing = mkColoredSprite('UsernameFocusRing', stProfileCard,
        PC.focusRing.x, PC.focusRing.y, PC.focusRing.w, PC.focusRing.h,
        153, 69, 255, 0);
    // Add a UIOpacity component for tweenability.
    const focusRingOpacityIdx = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(stUsernameFocusRing), _enabled: true, __prefab: null,
        _opacity: 0,
    });
    sb.e[stUsernameFocusRing]._components.push(rf(focusRingOpacityIdx));
    sb.e[stUsernameFocusRing]._active = false;

    const stUsername = mkEditBox(sb, 'UsernameEditBox', stProfileCard, 'Enter username',
        PC.username.x, PC.username.y, PC.username.w, PC.username.h, 22);
    sb.e[stUsername]._active = false;

    // Cancel + Confirm — small pill buttons. Cancel is a ghost, Confirm is
    // teal-primary; AppUI dims/disables Confirm until the input differs from
    // the saved value.
    const stUsernameCancelBtn = mkBtnXY(sb, 'UsernameCancelButton', stProfileCard, 'Cancel',
        PC.usernameCancelBtn.x, PC.usernameCancelBtn.y,
        PC.usernameCancelBtn.w, PC.usernameCancelBtn.h,
        38, 46, 70);
    sb.e[stUsernameCancelBtn]._active = false;

    const stUsernameConfirmBtn = mkBtnXY(sb, 'UsernameConfirmButton', stProfileCard, 'Confirm',
        PC.usernameConfirmBtn.x, PC.usernameConfirmBtn.y,
        PC.usernameConfirmBtn.w, PC.usernameConfirmBtn.h,
        20, 241, 149);
    sb.e[stUsernameConfirmBtn]._active = false;

    // Status band — error string in edit mode, "saved ✓" flash in display mode.
    const stUsernameSaved = mkLabel(sb, 'UsernameSaveLabel', stProfileCard, '', 12,
        PC.usernameSaved.y, PC.usernameSaved.w, PC.usernameSaved.h, 48, 198, 155);
    // Helper line — softened with a trophy glyph that ties identity to the
    // leaderboard. Mid-gray + lower font + tighter spacing reads as ambient.
    // 2026-04-30 — 12→11px to match new ambient softer profile rhythm.
    const stUsernameHelp = mkLabel(sb, 'UsernameHelpLabel', stProfileCard,
        '🏆  Displayed on leaderboard & matches', 11,
        PC.usernameHelp.y, PC.usernameHelp.w, PC.usernameHelp.h, 140, 140, 140);
    const stProfileEdge = mkCardTopHairline(stProfileCard, SP.profileCard.w, SP.profileCard.h);
    sb.e[stProfileCard]._components = [rf(stProfileCardUT), rf(stProfileCardSpr)];
    sb.e[stProfileCard]._children = [
        rf(stProfileHeader), rf(stUsernameLabel),
        // Display-mode (default visible).
        rf(stUsernameDisplay), rf(stEditUsernameBtn),
        // Edit-mode (default hidden).
        rf(stUsernameFocusRing), rf(stUsername),
        rf(stUsernameCancelBtn), rf(stUsernameConfirmBtn),
        // Shared status band.
        rf(stUsernameSaved), rf(stUsernameHelp), rf(stProfileEdge),
    ];

    // GAME DEFAULTS card — Phase 29 (was QUICK PLAY DEFAULTS).
    // 3 dropdown rows + 1 segmented Trading-Mode toggle + helper line.
    // Phase 30 — value labels drop the inline `▾` glyph in favor of an
    // explicit `›` chevron child on the right (matches account row pattern).
    const QPC = SP.quickPlayCard.children;
    const stQpCardN = sb.e.length;
    sb.node('QuickPlayDefaultsCard', stN, [], [], v3(SP.quickPlayCard.x, SP.quickPlayCard.y, 0));
    const stQpUT = sb.ut(stQpCardN, SP.quickPlayCard.w, SP.quickPlayCard.h);
    const stQpSpr = cardBodySpr(sb, stQpCardN);
    // Phase 31 — sentence-case header reads as "configurable loadout" rather
    // than a SaaS settings header.
    const stQpHeader = mkLabel(sb, 'HeaderLabel', stQpCardN, 'Default Match Setup', 14,
        QPC.header.y, QPC.header.w, QPC.header.h, 200, 210, 225);
    sb.e[stQpHeader]._lpos = v3(QPC.header.x, QPC.header.y, 0);
    sb.e[sb.e[stQpHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stQpHeader, { bold: true });

    // Phase 27/30 — Dropdown row builder. Creates a Node with sprite bg + button
    // + key label (left, muted-gray) + value label (right-aligned, white) +
    // explicit `›` chevron sibling on the far right.
    const buildQPDropdownRow = (name, rowSpec, keyText, valueText) => {
        const rowN = sb.e.length;
        sb.node(name, stQpCardN, [], [], v3(rowSpec.x, rowSpec.y, 0));
        const ut = sb.ut(rowN, rowSpec.w, rowSpec.h);
        const spr = sb.spr(rowN, 36, 16, 48);
        const btn = sb.btn(rowN, 36, 16, 48);
        const keySp = rowSpec.children.keyLabel;
        const keyN = mkLabel(sb, `${name}KeyLabel`, rowN, keyText, 16,
            keySp.y, keySp.w, keySp.h, 184, 184, 184);
        sb.e[keyN]._lpos = v3(keySp.x, keySp.y, 0);
        sb.e[sb.e[keyN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, keyN, { spacing: 1 });
        const valSp = rowSpec.children.valueLabel;
        const valN = mkLabel(sb, `${name}ValueLabel`, rowN, valueText, 18,
            valSp.y, valSp.w, valSp.h, 230, 235, 245);
        sb.e[valN]._lpos = v3(valSp.x, valSp.y, 0);
        sb.e[sb.e[valN]._components[1].__id__]._horizontalAlign = 2;
        const chevSp = rowSpec.children.chevron;
        const chevN = mkLabel(sb, `${name}Chevron`, rowN, '›', 22,
            chevSp.y, chevSp.w, chevSp.h, 184, 184, 184);
        sb.e[chevN]._lpos = v3(chevSp.x, chevSp.y, 0);
        sb.e[sb.e[chevN]._components[1].__id__]._horizontalAlign = 2;
        sb.e[rowN]._components = [rf(ut), rf(spr), rf(btn)];
        sb.e[rowN]._children = [rf(keyN), rf(valN), rf(chevN)];
        return rowN;
    };
    const stQpModeRow   = buildQPDropdownRow('QPModeRow',   QPC.qpModeRow,   'MODE',      '1v1');
    const stQpWindowRow = buildQPDropdownRow('QPWindowRow', QPC.qpWindowRow, 'TIMEFRAME', '30s');
    const stQpWagerRow  = buildQPDropdownRow('QPWagerRow',  QPC.qpWagerRow,  'WAGER',     '0.1 SOL');

    // TRADING MODE row — sibling key label + segmented control. The toggle is
    // a 320×44 group with a sliding indicator behind Paper/Real labels +
    // invisible hit areas. Phase 29: TRACK → TRADING MODE.
    const trkSpc = QPC.qpTrackRow;
    const stQpTrackKey = mkLabel(sb, 'QPTrackKeyLabel', stQpCardN, 'TRADING MODE', 16,
        trkSpc.y, trkSpc.w, trkSpc.h, 184, 184, 184);
    sb.e[stQpTrackKey]._lpos = v3(trkSpc.x, trkSpc.y, 0);
    sb.e[sb.e[stQpTrackKey]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stQpTrackKey, { spacing: 1 });

    const tt = QPC.qpTrackToggle;
    const stQpTrackToggle = sb.e.length;
    sb.node('QPTrackToggle', stQpCardN, [], [], v3(tt.x, tt.y, 0));
    const ttUT = sb.ut(stQpTrackToggle, tt.w, tt.h);
    const ttSpr = sb.spr(stQpTrackToggle, 26, 8, 32);
    // Phase 30 — soft teal halo behind indicator. Created BEFORE the indicator
    // so it renders underneath; AppUI tweens its x in lockstep with indicator.
    const ttHa = tt.children.glowHalo;
    const stQpTrackGlowHalo = mkColoredSprite('QPTrackGlowHalo', stQpTrackToggle,
        ttHa.x, ttHa.y, ttHa.w, ttHa.h, 20, 241, 149, 60);
    // Indicator — semi-transparent teal sprite, slides x=-78 ↔ x=78 on tap.
    const ttIc = tt.children.indicator;
    const stQpTrackIndicator = sb.e.length;
    sb.node('QPTrackIndicator', stQpTrackToggle, [], [], v3(ttIc.x, ttIc.y, 0));
    const ttIcUT = sb.ut(stQpTrackIndicator, ttIc.w, ttIc.h);
    const ttIcSprIdx = sb.spr(stQpTrackIndicator, 48, 198, 155);
    sb.e[ttIcSprIdx]._color = cl(48, 198, 155, 200);
    sb.e[stQpTrackIndicator]._components = [rf(ttIcUT), rf(ttIcSprIdx)];
    // Labels. Active label is white+bold; inactive is muted (set by runtime).
    const ttPL = tt.children.paperLabel;
    const stQpTrackPaperLbl = mkLabel(sb, 'QPTrackPaperLabel', stQpTrackToggle, 'Paper', 16,
        ttPL.y, ttPL.w, ttPL.h, 255, 255, 255);
    sb.e[stQpTrackPaperLbl]._lpos = v3(ttPL.x, ttPL.y, 0);
    style(sb, stQpTrackPaperLbl, { bold: true });
    const ttRL = tt.children.realLabel;
    const stQpTrackRealLbl = mkLabel(sb, 'QPTrackRealLabel', stQpTrackToggle, 'Real', 16,
        ttRL.y, ttRL.w, ttRL.h, 184, 184, 184);
    sb.e[stQpTrackRealLbl]._lpos = v3(ttRL.x, ttRL.y, 0);
    // Invisible hit areas overlaying each half. Transparent buttons handle taps.
    const mkInvisHit = (name, parent, hSpc) => {
        const hN = sb.e.length;
        sb.node(name, parent, [], [], v3(hSpc.x, hSpc.y, 0));
        const hUT = sb.ut(hN, hSpc.w, hSpc.h);
        const hBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(hN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.0, _target: rf(hN), _id: gid(),
        });
        sb.e[hN]._components = [rf(hUT), rf(hBtn)];
        return hN;
    };
    const stQpTrackPaperHit = mkInvisHit('QPTrackPaperHit', stQpTrackToggle, tt.children.paperHit);
    const stQpTrackRealHit  = mkInvisHit('QPTrackRealHit',  stQpTrackToggle, tt.children.realHit);
    sb.e[stQpTrackToggle]._components = [rf(ttUT), rf(ttSpr)];
    sb.e[stQpTrackToggle]._children = [
        rf(stQpTrackGlowHalo),
        rf(stQpTrackIndicator), rf(stQpTrackPaperLbl), rf(stQpTrackRealLbl),
        rf(stQpTrackPaperHit), rf(stQpTrackRealHit),
    ];

    // Phase 31 — trading-mode helper. Splits the meaning across the toggle:
    // "Practice · no risk" tied to Paper, "Live · real SOL" with amber weight
    // tied to Real. Static below the segmented control.
    const trkHelpSpc = QPC.qpTrackHelp;
    const stQpTrackHelp = mkLabel(sb, 'QPTrackHelpLabel', stQpCardN,
        'Paper — Practice · no risk        Real — Live · real SOL', 11,
        trkHelpSpc.y, trkHelpSpc.w, trkHelpSpc.h, 130, 140, 160);

    // Phase 31 — hairline dividers between each match-setup row so they read
    // as a stack of tappable card rows rather than dense text. Alpha 16 mirrors
    // the FilterCard divider treatment in FindMatchPanel.
    const stQpDividerModeWindow = mkColoredSprite('QPRowDivider1', stQpCardN,
        0, 53, 600, 1, 255, 255, 255, 16);
    const stQpDividerWindowWager = mkColoredSprite('QPRowDivider2', stQpCardN,
        0, 7, 600, 1, 255, 255, 255, 16);

    const stQpEdge = mkCardTopHairline(stQpCardN, SP.quickPlayCard.w, SP.quickPlayCard.h);
    sb.e[stQpCardN]._components = [rf(stQpUT), rf(stQpSpr)];
    sb.e[stQpCardN]._children = [
        rf(stQpHeader),
        rf(stQpModeRow), rf(stQpDividerModeWindow),
        rf(stQpWindowRow), rf(stQpDividerWindowWager),
        rf(stQpWagerRow),
        rf(stQpTrackKey), rf(stQpTrackToggle), rf(stQpTrackHelp),
        rf(stQpEdge),
    ];

    // Phase 27 — QP dropdown popovers. Direct children of SettingsPanel
    // (NOT QPCard) so they render on top of all panel content. Hidden by
    // default; AppUI activates on dropdown row tap.
    const buildQPPopover = (name, popSpec, optTemplate) => {
        const popN = sb.e.length;
        sb.node(name, stN, [], [], v3(popSpec.x, popSpec.y, 0));
        const ut = sb.ut(popN, popSpec.w, popSpec.h);
        const spr = sb.spr(popN, 26, 8, 32);
        const optIdxs = [];
        for (let p = 0; p < optTemplate.count; p++) {
            const oN = mkBtnXY(sb, `${name}_${optTemplate.keys[p]}`, popN, optTemplate.labels[p],
                0, optTemplate.ys[p], optTemplate.w, optTemplate.h, 36, 16, 48);
            optIdxs.push(oN);
        }
        sb.e[popN]._components = [rf(ut), rf(spr)];
        sb.e[popN]._children = optIdxs.map(rf);
        sb.e[popN]._active = false;
        return popN;
    };
    const stQpModePopover   = buildQPPopover('QPModePopover',   SP.qpModePopover,   SPT.qpModeOption);
    const stQpWindowPopover = buildQPPopover('QPWindowPopover', SP.qpWindowPopover, SPT.qpWindowOption);
    const stQpWagerPopover  = buildQPPopover('QPWagerPopover',  SP.qpWagerPopover,  SPT.qpWagerOption);

    // PREFERENCES card — Phase 29 / Phase 30 redesign.
    // Phase 30 — replaces ON/OFF pills with real toggle switches (52×30
    // track + 24×24 sliding knob). Legacy `*PillBg` / `*PillLabel` nodes
    // are kept (deactivated) so verifier overlap entries and any third-party
    // bindings stay valid; the visual signal moves entirely to the switch.
    const AC = SP.audioCard.children;
    const stAudioCardN = sb.e.length;
    sb.node('AudioSettingsCard', stN, [], [], v3(SP.audioCard.x, SP.audioCard.y, 0));
    const stAudioUT = sb.ut(stAudioCardN, SP.audioCard.w, SP.audioCard.h);
    // Phase 31 — Preferences sits below Match Setup in the visual hierarchy:
    // softer card fill so the Wallet / Match Setup cards above keep dominant
    // weight. Match Setup keeps (24,30,48); Audio drops to (22,28,44).
    const stAudioSpr = cardBodySpr(sb, stAudioCardN);
    const stAudioHeader = mkLabel(sb, 'HeaderLabel', stAudioCardN, 'PREFERENCES', 12,
        AC.header.y, AC.header.w, AC.header.h, 184, 184, 184);
    sb.e[stAudioHeader]._lpos = v3(AC.header.x, AC.header.y, 0);
    sb.e[sb.e[stAudioHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stAudioHeader, { spacing: 1 });

    const buildPrefToggleRow = (rowName, rowSpec, labelText, iconChildName) => {
        const rowN = sb.e.length;
        sb.node(rowName, stAudioCardN, [], [], v3(rowSpec.x, rowSpec.y, 0));
        const rowUT = sb.ut(rowN, rowSpec.w, rowSpec.h);
        const rowSpr = sb.spr(rowN, 36, 16, 48);
        const rowBtn = sb.btn(rowN, 36, 16, 48);

        const iSp = rowSpec.children.icon;
        const iconN = sb.e.length;
        sb.node(iconChildName, rowN, [], [], v3(iSp.x, iSp.y, 0));
        const iconUT = sb.ut(iconN, iSp.w, iSp.h);
        sb.e[iconN]._components = [rf(iconUT)];

        const lSp = rowSpec.children.label;
        const lblN = mkLabel(sb, `${rowName}Label`, rowN, labelText, 16,
            lSp.y, lSp.w, lSp.h, 230, 235, 245);
        sb.e[lblN]._lpos = v3(lSp.x, lSp.y, 0);
        sb.e[sb.e[lblN]._components[1].__id__]._horizontalAlign = 0;

        // Real toggle switch — track (recolors on toggle) + knob (slides).
        const tSp = rowSpec.children.switchTrack;
        const trackN = mkColoredSprite(`${rowName}SwitchTrack`, rowN,
            tSp.x, tSp.y, tSp.w, tSp.h, 20, 241, 149, 255);

        const kSp = rowSpec.children.switchKnob;
        const knobN = mkColoredSprite(`${rowName}SwitchKnob`, rowN,
            kSp.x, kSp.y, kSp.w, kSp.h, 255, 255, 255, 255);

        // Legacy pillBg / pillLbl — deactivated nodes kept for verifier
        // allowedOverlaps + back-compat with any external lookups.
        const pSp = rowSpec.children.pillBg;
        const pillBgN = mkColoredSprite(`${rowName}PillBg`, rowN,
            pSp.x, pSp.y, pSp.w, pSp.h, 48, 198, 155, 0);
        sb.e[pillBgN]._active = false;

        const plSp = rowSpec.children.pillLbl;
        const pillLblN = mkLabel(sb, `${rowName}PillLabel`, rowN, '', 13,
            plSp.y, plSp.w, plSp.h, 10, 4, 16);
        sb.e[pillLblN]._lpos = v3(plSp.x, plSp.y, 0);
        sb.e[pillLblN]._active = false;
        style(sb, pillLblN, { bold: true, spacing: 1 });

        sb.e[rowN]._components = [rf(rowUT), rf(rowSpr), rf(rowBtn)];
        sb.e[rowN]._children = [
            rf(iconN), rf(lblN),
            rf(trackN), rf(knobN),
            rf(pillBgN), rf(pillLblN),
        ];
        return rowN;
    };
    const stSoundToggle = buildPrefToggleRow('SoundToggleButton', AC.soundRow, 'Sound', 'PrefSoundIcon');
    const stHapticsToggle = buildPrefToggleRow('HapticsToggleButton', AC.hapticsRow, 'Haptics', 'PrefHapticsIcon');

    // Subtle hairline between the two toggle rows.
    const stAudioRowDivider = mkColoredSprite('AudioRowDivider', stAudioCardN,
        AC.rowDivider.x, AC.rowDivider.y, AC.rowDivider.w, AC.rowDivider.h,
        255, 255, 255, 14);

    const stAudioEdge = mkCardTopHairline(stAudioCardN, SP.audioCard.w, SP.audioCard.h);
    sb.e[stAudioCardN]._components = [rf(stAudioUT), rf(stAudioSpr)];
    sb.e[stAudioCardN]._children = [
        rf(stAudioHeader),
        rf(stSoundToggle), rf(stAudioRowDivider), rf(stHapticsToggle),
        rf(stAudioEdge),
    ];

    // ACCOUNT card — Phase 29 / Phase 30 redesign.
    // Phase 30 — wraps the chevron rows in explicit GENERAL / SESSION group
    // headers with a hairline between, plus a row divider between Reconnect
    // and Disconnect. Card height grows 200 → 232 to accommodate the headers.
    // Legacy row node names (`FeesLinkButton`, `ReconnectSettingsButton`,
    // `DisconnectSettingsButton`) are preserved so AppUI bindings continue
    // to fire unchanged.
    const ACC = SP.accountCard.children;
    const stAccountCardN = sb.e.length;
    sb.node('AccountSettingsCard', stN, [], [], v3(SP.accountCard.x, SP.accountCard.y, 0));
    const stAccountUT = sb.ut(stAccountCardN, SP.accountCard.w, SP.accountCard.h);
    // Phase 31 — Account is the calmest card: muted bg + softer dividers so
    // the eye lands on Wallet / Match Setup first.
    const stAccountSpr = cardBodySpr(sb, stAccountCardN);
    const stAccountHeader = mkLabel(sb, 'HeaderLabel', stAccountCardN, 'ACCOUNT', 12,
        ACC.header.y, ACC.header.w, ACC.header.h, 184, 184, 184);
    sb.e[stAccountHeader]._lpos = v3(ACC.header.x, ACC.header.y, 0);
    sb.e[sb.e[stAccountHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stAccountHeader, { spacing: 1 });

    const stAccountGeneral = mkLabel(sb, 'AccountGeneralGroupLabel', stAccountCardN, 'GENERAL', 12,
        ACC.generalGroupLabel.y, ACC.generalGroupLabel.w, ACC.generalGroupLabel.h, 140, 140, 140);
    sb.e[stAccountGeneral]._lpos = v3(ACC.generalGroupLabel.x, ACC.generalGroupLabel.y, 0);
    sb.e[sb.e[stAccountGeneral]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stAccountGeneral, { spacing: 1 });

    const stAccountSession = mkLabel(sb, 'AccountSessionGroupLabel', stAccountCardN, 'SESSION', 12,
        ACC.sessionGroupLabel.y, ACC.sessionGroupLabel.w, ACC.sessionGroupLabel.h, 140, 140, 140);
    sb.e[stAccountSession]._lpos = v3(ACC.sessionGroupLabel.x, ACC.sessionGroupLabel.y, 0);
    sb.e[sb.e[stAccountSession]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stAccountSession, { spacing: 1 });

    const stAccountGroupDivider = mkColoredSprite('AccountGroupDivider', stAccountCardN,
        ACC.groupDivider.x, ACC.groupDivider.y, ACC.groupDivider.w, ACC.groupDivider.h,
        255, 255, 255, 14);

    const stAccountRowDivider = mkColoredSprite('AccountRowDivider', stAccountCardN,
        ACC.rowDivider.x, ACC.rowDivider.y, ACC.rowDivider.w, ACC.rowDivider.h,
        255, 255, 255, 12);

    // Phase 29 — account row builder. Icon · Label · ›
    const buildAccountRow = (rowName, rowSpec, labelText, iconChildName) => {
        const rowN = sb.e.length;
        sb.node(rowName, stAccountCardN, [], [], v3(rowSpec.x, rowSpec.y, 0));
        const rowUT = sb.ut(rowN, rowSpec.w, rowSpec.h);
        const rowSpr = sb.spr(rowN, 36, 16, 48);
        const rowBtn = sb.btn(rowN, 36, 16, 48);

        const iSp = rowSpec.children.icon;
        const iconN = sb.e.length;
        sb.node(iconChildName, rowN, [], [], v3(iSp.x, iSp.y, 0));
        const iconUT = sb.ut(iconN, iSp.w, iSp.h);
        sb.e[iconN]._components = [rf(iconUT)];

        const lSp = rowSpec.children.label;
        const lblN = mkLabel(sb, `${rowName}Label`, rowN, labelText, 16,
            lSp.y, lSp.w, lSp.h, 230, 235, 245);
        sb.e[lblN]._lpos = v3(lSp.x, lSp.y, 0);
        sb.e[sb.e[lblN]._components[1].__id__]._horizontalAlign = 0;

        const cSp = rowSpec.children.chevron;
        const chevN = mkLabel(sb, `${rowName}Chevron`, rowN, '›', 22,
            cSp.y, cSp.w, cSp.h, 184, 184, 184);
        sb.e[chevN]._lpos = v3(cSp.x, cSp.y, 0);
        sb.e[sb.e[chevN]._components[1].__id__]._horizontalAlign = 2;

        sb.e[rowN]._components = [rf(rowUT), rf(rowSpr), rf(rowBtn)];
        sb.e[rowN]._children = [rf(iconN), rf(lblN), rf(chevN)];
        return rowN;
    };
    const stFeesBtn       = buildAccountRow('FeesLinkButton',           ACC.feesRow,       'Fee schedule', 'AccountFeesIcon');
    const stReconnectBtn  = buildAccountRow('ReconnectSettingsButton',  ACC.reconnectRow,  'Reconnect',    'AccountReconnectIcon');
    const stDisconnectBtn = buildAccountRow('DisconnectSettingsButton', ACC.disconnectRow, 'Disconnect',   'AccountDisconnectIcon');

    const stAccountEdge = mkCardTopHairline(stAccountCardN, SP.accountCard.w, SP.accountCard.h);
    sb.e[stAccountCardN]._components = [rf(stAccountUT), rf(stAccountSpr)];
    sb.e[stAccountCardN]._children = [
        rf(stAccountHeader),
        rf(stAccountGeneral), rf(stFeesBtn),
        rf(stAccountGroupDivider), rf(stAccountSession),
        rf(stReconnectBtn), rf(stAccountRowDivider), rf(stDisconnectBtn),
        rf(stAccountEdge),
    ];

    // DANGER ZONE — Phase 31. Mini eyebrow framing the destructive action,
    // rose-tinted card row (NOT glowing). 2-tap arming flow lives in
    // AppUI._onDelete (first tap: row label morphs to "Tap again to confirm
    // · Cancel" + auto-cancel timer arms; second tap: existing delete flow).
    const stDangerLbl = mkLabel(sb, 'DangerZoneLabel', stN, 'DANGER ZONE', 11,
        SP.dangerZoneLabel.y, SP.dangerZoneLabel.w, SP.dangerZoneLabel.h,
        184, 184, 184);
    style(sb, stDangerLbl, { spacing: 2 });

    const stDeleteBtn = sb.e.length;
    sb.node('DeleteAccountSettingsButton', stN, [], [],
        v3(SP.deleteBtn.x, SP.deleteBtn.y, 0));
    const stDeleteUT = sb.ut(stDeleteBtn, SP.deleteBtn.w, SP.deleteBtn.h);
    // Rose-tinted card row, alpha 56 — present but muted (not glowing).
    const stDeleteSpr = sb.spr(stDeleteBtn, 56, 18, 32);
    sb.e[stDeleteSpr]._color = cl(56, 18, 32, 200);
    const stDeleteRowBtn = sb.btn(stDeleteBtn, 56, 18, 32);
    // Left-edge rose stripe for affordance (3px, alpha 200).
    const stDeleteStripe = mkColoredSprite('DeleteAccountStripe', stDeleteBtn,
        -SP.deleteBtn.w / 2 + 2, 0, 3, SP.deleteBtn.h - 4,
        255, 92, 138, 200);
    const stDeleteLbl = mkLabel(sb, 'Label', stDeleteBtn, 'Delete account', 18,
        0, SP.deleteBtn.w - 80, SP.deleteBtn.h, 255, 92, 138);
    sb.e[stDeleteLbl]._lpos = v3(-20, 0, 0);
    sb.e[sb.e[stDeleteLbl]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stDeleteLbl, { spacing: 1 });
    const stDeleteChev = mkLabel(sb, 'Chevron', stDeleteBtn, '›', 22,
        0, 24, SP.deleteBtn.h, 255, 92, 138);
    sb.e[stDeleteChev]._lpos = v3(SP.deleteBtn.w / 2 - 18, 0, 0);
    sb.e[sb.e[stDeleteChev]._components[1].__id__]._horizontalAlign = 2;
    sb.e[stDeleteBtn]._components = [rf(stDeleteUT), rf(stDeleteSpr), rf(stDeleteRowBtn)];
    sb.e[stDeleteBtn]._children = [rf(stDeleteStripe), rf(stDeleteLbl), rf(stDeleteChev)];

    const stStatus = mkLabel(sb, 'SettingsStatusLabel', stN, '', 12,
        SP.status.y, SP.status.w, SP.status.h, 184, 184, 184);

    sb.e[stN]._children = [
        // Phase 30 — sheet bg sits BEHIND every card by being added first.
        // 2026-04-30 — sheet glow sits between the sheet and the cards.
        rf(stSheetBg), rf(stSheetGlow),
        rf(stBackLink), rf(stBackBtn), rf(stTitle),
        rf(stWalletCard), rf(stProfileCard),
        rf(stQpCardN),
        rf(stAudioCardN),
        rf(stAccountCardN),
        rf(stDangerLbl), rf(stDeleteBtn),
        rf(stStatus),
        // Phase 27 — popovers added LAST for z-order (render on top of cards).
        rf(stQpModePopover), rf(stQpWindowPopover), rf(stQpWagerPopover),
    ];
    sb.e[stN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 9 — FIRST-RUN TUTORIAL OVERLAY
    // Shown once per wallet the first time a player enters the tap-game.
    // Dismissed on tap; flag persists via sys.localStorage['tokenduel:tutorialSeen'].
    // ═══════════════════════════════════════════════════════════════
    const tutN = sb.e.length;
    sb.node('TutorialOverlay', canvas, [], [], v3(0, 0, 0));
    const tutUT = sb.ut(tutN, 720, 1280);
    const tutSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tutN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 200),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const tutBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tutN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(tutN), _id: gid(),
    });
    // Phase 28 — gamified tutorial cards. 4 themed cards (one visible at
    // a time), each with accent halo, accent bar, icon, title, divider,
    // body, mascot, progress dots, hint. AppUI handles slide-carousel
    // transitions between cards.
    const TCT = LAYOUT.TutorialOverlay.templates.tutorialCard;
    const TCC = TCT.children;
    const tutCardIndices = [];
    const tutGlowIndices = [];
    for (let i = 0; i < TCT.count; i++) {
        const accent = TCT.accents[i];
        const isFirst = i === 0;
        // Glow halo — sibling of card, rendered FIRST in TutorialOverlay's
        // _children array → renders behind the card.
        const glowN = sb.e.length;
        sb.node(TCT.glowNames[i], tutN, [], [], v3(0, 0, 0));
        const glowUT = sb.ut(glowN, TCC.glow.w, TCC.glow.h);
        const glowSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(glowN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(accent[0], accent[1], accent[2], 80),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[glowN]._components = [rf(glowUT), rf(glowSpr)];
        sb.e[glowN]._active = isFirst;
        tutGlowIndices.push(glowN);

        // Card frame (the dark slate container).
        const cardN = sb.e.length;
        sb.node(TCT.names[i], tutN, [], [], v3(0, 0, 0));
        const cardUT = sb.ut(cardN, TCT.w, TCT.h);
        const cardSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(cardN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(26, 8, 32, 245),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });

        // Accent bar — slim colored strip at top edge of card.
        const accentN = sb.e.length;
        sb.node(`${TCT.names[i]}_AccentBar`, cardN, [], [], v3(TCC.accentBar.x, TCC.accentBar.y, 0));
        const accentUT = sb.ut(accentN, TCC.accentBar.w, TCC.accentBar.h);
        const accentSpr = sb.spr(accentN, accent[0], accent[1], accent[2]);
        sb.e[accentN]._components = [rf(accentUT), rf(accentSpr)];

        // Topic icon — large emoji glyph (AppUI may upgrade to PNG via IconLibrary).
        const iconN = mkLabel(sb, `${TCT.names[i]}_Icon`, cardN, TCT.iconGlyphs[i], 64,
            TCC.icon.y, TCC.icon.w, TCC.icon.h, accent[0], accent[1], accent[2]);
        sb.e[iconN]._lpos = v3(TCC.icon.x, TCC.icon.y, 0);

        // Title — big bold accent-colored.
        const titleN = mkLabel(sb, `${TCT.names[i]}_Title`, cardN, TCT.titles[i], 32,
            TCC.title.y, TCC.title.w, TCC.title.h, accent[0], accent[1], accent[2]);
        sb.e[titleN]._lpos = v3(TCC.title.x, TCC.title.y, 0);
        style(sb, titleN, { bold: true, spacing: 2 });

        // Divider — slim mid-gray rule below title.
        const divN = sb.e.length;
        sb.node(`${TCT.names[i]}_Divider`, cardN, [], [], v3(TCC.divider.x, TCC.divider.y, 0));
        const divUT = sb.ut(divN, TCC.divider.w, TCC.divider.h);
        const divSpr = sb.spr(divN, 90, 100, 130);
        sb.e[divN]._components = [rf(divUT), rf(divSpr)];

        // Body — multi-line tip text.
        const bodyN = mkLabel(sb, `${TCT.names[i]}_Body`, cardN, TCT.bodies[i], 24,
            TCC.body.y, TCC.body.w, TCC.body.h, 230, 235, 245);
        sb.e[bodyN]._lpos = v3(TCC.body.x, TCC.body.y, 0);
        // SHRINK overflow — wrap body text within 540×120 box. Default
        // mkLabel emits _overflow=0 (NONE) which ignores _enableWrapText
        // and lets the sentence run off the right edge of the card.
        sb.e[sb.e[bodyN]._components[1].__id__]._overflow = 2;

        // Mascot container — empty Node + UITransform; AppUI adds
        // MascotController + setSpriteSheet at runtime.
        const mascN = sb.e.length;
        sb.node(`${TCT.names[i]}_Mascot`, cardN, [], [], v3(TCC.mascot.x, TCC.mascot.y, 0));
        const mascUT = sb.ut(mascN, TCC.mascot.w, TCC.mascot.h);
        sb.e[mascN]._components = [rf(mascUT)];

        // Progress dots — 4 small circles, current+past = accent-filled,
        // future = hollow gray. AppUI paints active state.
        const dotsN = sb.e.length;
        sb.node(`${TCT.names[i]}_DotsGroup`, cardN, [], [], v3(TCC.dotsGroup.x, TCC.dotsGroup.y, 0));
        const dotsUT = sb.ut(dotsN, TCC.dotsGroup.w, TCC.dotsGroup.h);
        const dotIdxs = [];
        for (let d = 0; d < TCT.count; d++) {
            const dotN = sb.e.length;
            sb.node(`Dot_${d}`, dotsN, [], [], v3(d * TCC.dot.stride, 0, 0));
            const dotUT = sb.ut(dotN, TCC.dot.w, TCC.dot.h);
            const dotSpr = sb.spr(dotN,
                d <= i ? accent[0] : 90,
                d <= i ? accent[1] : 100,
                d <= i ? accent[2] : 130);
            sb.e[dotN]._components = [rf(dotUT), rf(dotSpr)];
            dotIdxs.push(dotN);
        }
        sb.e[dotsN]._components = [rf(dotsUT)];
        sb.e[dotsN]._children = dotIdxs.map(rf);

        // Hint label — "Tap to continue" muted.
        const hintN = mkLabel(sb, `${TCT.names[i]}_Hint`, cardN, 'Tap to continue', 14,
            TCC.hint.y, TCC.hint.w, TCC.hint.h, 184, 184, 184);
        sb.e[hintN]._lpos = v3(TCC.hint.x, TCC.hint.y, 0);
        sb.e[sb.e[hintN]._components[1].__id__]._horizontalAlign = 2;

        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [
            rf(accentN), rf(iconN), rf(titleN), rf(divN),
            rf(bodyN), rf(mascN), rf(dotsN), rf(hintN),
        ];
        sb.e[cardN]._active = isFirst;
        tutCardIndices.push(cardN);
    }
    sb.e[tutN]._components = [rf(tutUT), rf(tutSpr), rf(tutBtn)];
    // Render order: each glow first, then its card on top. Pair them.
    const tutChildren = [];
    for (let i = 0; i < TCT.count; i++) {
        tutChildren.push(rf(tutGlowIndices[i]));
        tutChildren.push(rf(tutCardIndices[i]));
    }
    sb.e[tutN]._children = tutChildren;
    sb.e[tutN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 12 Bundle D — SPECTATOR PANEL
    // Read-only live view of an in-progress (or Waiting) match. Accessed by
    // tapping a HomeMatchTicker entry. Shows per-player heights + live drop
    // event feed + optional "Join this match" button when Waiting.
    // ═══════════════════════════════════════════════════════════════
    const specN = sb.e.length;
    sb.node('SpectatorPanel', canvas, [], [], lobbyMount('SpectatorPanel'));
    sb.ut(specN, 720, 1280);
    sb.spr(specN, 10, 14, 22);

    // Chrome from LAYOUT.SpectatorPanel.elements.
    const SPE = LAYOUT.SpectatorPanel.elements;
    // 2026-04-29 — uniform "← Back" header, mirrors MIP. Renamed BackButton
    // node to SpectatorBackButton for AppUI click-handler compat.
    const _specBack = mkBackHeader(sb, specN, { y: SPE.backBtn.y, panelKey: 'SpectatorPanel' });
    sb.e[_specBack.btnN]._name = 'SpectatorBackButton';
    sb.e[_specBack.linkN]._name = 'SpectatorBackLinkLabel';
    const specBackBtn = _specBack.btnN;
    // UX Phase 2b: IconBadge eye attached by AppUI. Phase 2c: bold.
    // 9c: title w 460→300 to clear BackButton bbox right x=-180.
    // 2026-04-29 — uniform title color (gold) and size (30pt) per UNIFORM_TEXT.
    const specTitle = mkLabel(sb, 'SpectatorTitleLabel', specN, 'Spectating', 30,
        SPE.title.y, SPE.title.w, SPE.title.h, 255, 210, 74);
    style(sb, specTitle, { bold: true });
    const specMatchLabel = mkLabel(sb, 'SpectatorMatchLabel', specN, 'match —', 13,
        SPE.matchLabel.y, SPE.matchLabel.w, SPE.matchLabel.h, 184, 184, 184);
    const specStatusLabel = mkLabel(sb, 'SpectatorStatusLabel', specN, 'Connecting…', 14,
        SPE.statusLabel.y, SPE.statusLabel.w, SPE.statusLabel.h, 140, 220, 180);

    // Player list: 10 pooled rows from LAYOUT.SpectatorPanel.templates.playerRow.
    const SPL = LAYOUT.SpectatorPanel.templates.playerRow;
    const specPlayerListN = sb.e.length;
    sb.node('SpectatorPlayerList', specN, [], [], v3(SPE.playerList.x, SPE.playerList.y, 0));
    sb.ut(specPlayerListN, SPE.playerList.w, SPE.playerList.h);
    const specPlayerRowIdx = [];
    for (let i = 0; i < SPL.count; i++) {
        const rN = sb.e.length;
        const ry = SPL.baseY + i * SPL.gapY;
        sb.node(`SpectatorPlayerRow_${i}`, specPlayerListN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, SPL.w, SPL.h);
        const rSpr = sb.spr(rN, 26, 8, 32);
        const pkLbl = mkLabel(sb, 'Pubkey', rN, '—', 14, 0, SPL.pubkey.w, SPL.pubkey.h, 255, 255, 255);
        sb.e[pkLbl]._lpos = v3(SPL.pubkey.x, SPL.pubkey.y, 0);
        const hLbl = mkLabel(sb, 'Height', rN, 'H:—', 14, 0, SPL.height.w, SPL.height.h, 48, 198, 155);
        sb.e[hLbl]._lpos = v3(SPL.height.x, SPL.height.y, 0);
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(pkLbl), rf(hLbl)];
        sb.e[rN]._active = false;
        specPlayerRowIdx.push(rN);
    }
    sb.e[specPlayerListN]._children = specPlayerRowIdx.map(rf);

    // Event feed: 10 rows from templates.eventRow, most-recent-on-top.
    const SER = LAYOUT.SpectatorPanel.templates.eventRow;
    const specEventListN = sb.e.length;
    sb.node('SpectatorEventList', specN, [], [], v3(SPE.eventList.x, SPE.eventList.y, 0));
    sb.ut(specEventListN, SPE.eventList.w, SPE.eventList.h);
    const specEventHeaderL = mkLabel(sb, 'HeaderLabel', specEventListN, 'LIVE EVENTS', 11,
        SPE.eventListHeader.y, SPE.eventListHeader.w, SPE.eventListHeader.h, 184, 184, 184);
    sb.e[specEventHeaderL]._lpos = v3(SPE.eventListHeader.x, SPE.eventListHeader.y, 0);
    sb.e[sb.e[specEventHeaderL]._components[1].__id__]._horizontalAlign = 0;
    style(sb, specEventHeaderL, { spacing: 1 });  // Phase 15 (B5)
    const specEventRowIdx = [];
    for (let i = 0; i < SER.count; i++) {
        const rN = sb.e.length;
        const ry = SER.baseY + i * SER.gapY;
        sb.node(`SpectatorEventRow_${i}`, specEventListN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, SER.w, SER.h);
        const rL = mkLabel(sb, 'Text', rN, '—', 13, 0, SER.text.w, SER.text.h, 180, 190, 210);
        sb.e[rN]._components = [rf(rUT)];
        sb.e[rN]._children = [rf(rL)];
        sb.e[rN]._active = false;
        specEventRowIdx.push(rN);
    }
    sb.e[specEventListN]._children = [rf(specEventHeaderL), ...specEventRowIdx.map(rf)];

    // Join button — shown by AppUI only when match.status == Waiting + free slot.
    // Phase 13 (B3): hero halo — teal join CTA.
    const { glow: specJoinGlow, btn: specJoinBtn } = mkBtnHero(sb,
        'SpectatorJoinButton', specN, '▶ Join this match',
        SPE.joinBtn.x, SPE.joinBtn.y, SPE.joinBtn.w, SPE.joinBtn.h, 48, 198, 155,
        { tier: 'primary' });
    style(sb, specJoinBtn, { bold: true });
    sb.e[specJoinBtn]._active = false;
    sb.e[specJoinGlow]._active = false;

    sb.e[specN]._children = [
        rf(_specBack.linkN), rf(specBackBtn), rf(specTitle), rf(specMatchLabel), rf(specStatusLabel),
        rf(specPlayerListN), rf(specEventListN), rf(specJoinGlow), rf(specJoinBtn),
    ];
    sb.e[specN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 14 — TOURNAMENT PANEL
    // 10-slot roster with live heights + medals (🥇🥈🥉) on settle.
    // Entered via HomeTournamentBadge tap. Reuses SpectatorRpc for live
    // subscribe (poll every 3s + backend WS).
    // ═══════════════════════════════════════════════════════════════
    const tourN = sb.e.length;
    sb.node('TournamentPanel', canvas, [], [], lobbyMount('TournamentPanel'));
    sb.ut(tourN, 720, 1280);
    sb.spr(tourN, 18, 12, 26); // slight purple tint vs spectator's slate

    // Chrome from LAYOUT.TournamentPanel.elements.
    const TPE = LAYOUT.TournamentPanel.elements;
    // 2026-04-29 — uniform "← Back" header, mirrors MIP.
    const _tourBack = mkBackHeader(sb, tourN, { y: TPE.backBtn.y, panelKey: 'TournamentPanel' });
    sb.e[_tourBack.btnN]._name = 'TournamentBackButton';
    sb.e[_tourBack.linkN]._name = 'TournamentBackLinkLabel';
    const tourBackBtn = _tourBack.btnN;
    // UX Phase 2b: IconBadge sword attached by AppUI. Phase 2c: bold.
    // 9c: title w 460→300 to clear BackButton bbox right x=-180.
    // 2026-04-29 — uniform title color (gold) and size (30pt) per UNIFORM_TEXT.
    const tourTitle = mkLabel(sb, 'TournamentTitleLabel', tourN, 'Tournament', 30,
        TPE.title.y, TPE.title.w, TPE.title.h, 255, 210, 74);
    style(sb, tourTitle, { bold: true });
    const tourMatchLabel  = mkLabel(sb, 'TournamentMatchLabel', tourN, 'match —', 13,
        TPE.matchLabel.y, TPE.matchLabel.w, TPE.matchLabel.h, 160, 150, 200);
    const tourStatusLabel = mkLabel(sb, 'TournamentStatusLabel', tourN, 'Connecting…', 14,
        TPE.statusLabel.y, TPE.statusLabel.w, TPE.statusLabel.h, 220, 200, 240);
    const tourPrizeLabel  = mkLabel(sb, 'TournamentPrizePoolLabel', tourN, 'Prize pool: — · top-3 payout', 14,
        TPE.prizeLabel.y, TPE.prizeLabel.w, TPE.prizeLabel.h, 140, 220, 180);

    // 10-slot roster from LAYOUT.TournamentPanel. Each slot has Pubkey (left),
    // Height (mid-right), Medal (far right).
    const TR  = LAYOUT.TournamentPanel.elements.roster;
    const TST = LAYOUT.TournamentPanel.templates.tournamentSlot;
    const tourRosterN = sb.e.length;
    sb.node('TournamentRoster', tourN, [], [], v3(TR.x, TR.y, 0));
    sb.ut(tourRosterN, TR.w, TR.h);
    const tourSlotIdx = [];
    for (let i = 0; i < TST.count; i++) {
        const rN = sb.e.length;
        const ry = TST.baseY + i * TST.gapY;
        sb.node(`TournamentSlot_${i}`, tourRosterN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, TST.w, TST.h);
        const rSpr = sb.spr(rN, 28, 22, 44);
        const pkLbl = mkLabel(sb, 'Pubkey', rN, '—', 14, 0, TST.pubkey.w, TST.pubkey.h, 220, 220, 240);
        sb.e[pkLbl]._lpos = v3(TST.pubkey.x, TST.pubkey.y, 0);
        const hLbl = mkLabel(sb, 'Height', rN, 'H:—', 14, 0, TST.height.w, TST.height.h, 140, 220, 180);
        sb.e[hLbl]._lpos = v3(TST.height.x, TST.height.y, 0);
        const medalLbl = mkLabel(sb, 'Medal', rN, '', 20, 0, TST.medal.w, TST.medal.h, 255, 220, 120);
        sb.e[medalLbl]._lpos = v3(TST.medal.x, TST.medal.y, 0);
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(pkLbl), rf(hLbl), rf(medalLbl)];
        sb.e[rN]._active = false;
        tourSlotIdx.push(rN);
    }
    sb.e[tourRosterN]._children = tourSlotIdx.map(rf);

    // Join button — shown only when status=Waiting AND a slot is free AND player not already in.
    // UX Phase 2b: IconBadge sword attached by AppUI. Phase 2c: bold.
    // Phase 13 (B3): hero halo — violet join CTA.
    const { glow: tourJoinGlow, btn: tourJoinBtn } = mkBtnHero(sb,
        'TournamentJoinButton', tourN, 'Join tournament',
        TPE.joinBtn.x, TPE.joinBtn.y, TPE.joinBtn.w, TPE.joinBtn.h, 140, 80, 200,
        { tier: 'primary' });
    style(sb, tourJoinBtn, { bold: true });
    sb.e[tourJoinBtn]._active = false;
    sb.e[tourJoinGlow]._active = false;

    sb.e[tourN]._children = [
        rf(_tourBack.linkN), rf(tourBackBtn), rf(tourTitle), rf(tourMatchLabel), rf(tourStatusLabel), rf(tourPrizeLabel),
        rf(tourRosterN), rf(tourJoinGlow), rf(tourJoinBtn),
    ];
    sb.e[tourN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase A — FIND MATCH PANEL (top-level lobby browser)
    // Filters: mode (5 chips) / window (5 chips) / wager bucket (5 chips)
    //          + HideFull toggle. Up to 8 visible match rows + empty state.
    //          Host New Match CTA at bottom opens ModePickerOverlay in
    //          host mode (forceCreate=true).
    // ═══════════════════════════════════════════════════════════════
    // All FindMatchPanel positions sourced from LAYOUT.FindMatchPanel.
    const FME = LAYOUT.FindMatchPanel.elements;
    const FMT = LAYOUT.FindMatchPanel.templates;

    const fmN = sb.e.length;
    sb.node('FindMatchPanel', canvas, [], [], lobbyMount('FindMatchPanel'));
    sb.ut(fmN, LAYOUT.FindMatchPanel.canvas.w, LAYOUT.FindMatchPanel.canvas.h);
    sb.spr(fmN, 10, 14, 22);

    // 2026-04-30 UX rebuild — full-canvas content scrim. Mirrors HomeContentScrim
    // (generate-scenes.js:1546). Sits FIRST in panel children so the parent
    // BackgroundFX (starfield + violet/green glows) does not bleed through the
    // FindMatch content column. Color = Palette.bg.primary (deep navy) @ alpha
    // 110 — same recipe as the home screen's scrim treatment.
    const fmScrimN = sb.e.length;
    sb.node('FindMatchContentScrim', fmN, [], [], v3(FME.findMatchContentScrim.x, FME.findMatchContentScrim.y, 0));
    const fmScrimUT = sb.ut(fmScrimN, FME.findMatchContentScrim.w, FME.findMatchContentScrim.h);
    const fmScrimSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(fmScrimN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(P.bg.primary.r, P.bg.primary.g, P.bg.primary.b, 110),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[fmScrimN]._components = [rf(fmScrimUT), rf(fmScrimSpr)];

    // Header: back, title, refresh.
    // 2026-04-29 — uniform "← Back" header, mirrors MIP.
    const _fmBack = mkBackHeader(sb, fmN, { y: FME.backBtn.y, panelKey: 'FindMatchPanel' });
    sb.e[_fmBack.btnN]._name = 'FindMatchBackButton';
    sb.e[_fmBack.linkN]._name = 'FindMatchBackLinkLabel';
    const fmBackBtn = _fmBack.btnN;
    // 2026-04-29 god-tier rebuild — title bumps 30→32 (own row, no overlap),
    // count label bumps 14→18 (+28%) and goes left-aligned + dim text per the
    // status-bar spec ("informational, not decorative"). Title stays gold for
    // brand continuity with sibling panels.
    const fmTitle = mkLabel(sb, 'FindMatchTitleLabel', fmN, 'Find a Match', 32,
        FME.title.y, FME.title.w, FME.title.h, 255, 210, 74);
    style(sb, fmTitle, { bold: true });
    const fmRefreshBtn = mkBtnXY(sb, 'FindMatchRefreshButton', fmN, '↻',
        FME.refreshBtn.x, FME.refreshBtn.y, FME.refreshBtn.w, FME.refreshBtn.h,
        38, 44, 64,
        { tier: 'tertiary' });
    const fmCountLabel = mkLabel(sb, 'FindMatchCountLabel', fmN, 'LIVE SYSTEM · — LOBBIES ACTIVE', 18,
        FME.countLabel.y, FME.countLabel.w, FME.countLabel.h, 20, 241, 149);
    style(sb, fmCountLabel, { bold: true });
    // Left-align the count label so the pulse dot pins to a deterministic x
    // (no shift on string length).
    if (sb.e[sb.e[fmCountLabel]._components[1].__id__]) {
        sb.e[sb.e[fmCountLabel]._components[1].__id__]._horizontalAlign = 0;
    }

    // 2026-04-27 FindMatch redesign — pulse dot left of count label.
    // AppUI runs addIdlePulse on it and tints rose (Live) / teal (Open).
    const fmLivePulseDotN = sb.e.length;
    sb.node('FindMatchLiveCountPulseDot', fmN, [], [],
        v3(FME.liveCountPulseDot.x, FME.liveCountPulseDot.y, 0));
    const fmLivePulseDotUT = sb.ut(fmLivePulseDotN, FME.liveCountPulseDot.w, FME.liveCountPulseDot.h);
    const fmLivePulseDotSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(fmLivePulseDotN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 255), // teal default (Open Lobbies tab)
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[fmLivePulseDotN]._components = [rf(fmLivePulseDotUT), rf(fmLivePulseDotSpr)];

    // Phase A2 — Lv/XP chip top-left of header. Pulled from UserStats by AppUI.
    const fmLvXpChipN = sb.e.length;
    sb.node('FindMatchLvXpChip', fmN, [], [], v3(FME.lvxpChip.x, FME.lvxpChip.y, 0));
    const fmLvXpChipUT = sb.ut(fmLvXpChipN, FME.lvxpChip.w, FME.lvxpChip.h);
    const fmLvXpChipSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(fmLvXpChipN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(36, 16, 48, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const fmLvXpChipLbl = mkLabel(sb, 'FindMatchLvXpChipLabel', fmLvXpChipN, 'Lv 1 · 0 XP', 14, 0,
        FME.lvxpChip.w - 16, FME.lvxpChip.h - 6, 255, 210, 74);
    sb.e[sb.e[fmLvXpChipLbl]._components[1].__id__]._isBold = true;
    sb.e[fmLvXpChipN]._components = [rf(fmLvXpChipUT), rf(fmLvXpChipSpr)];
    sb.e[fmLvXpChipN]._children = [rf(fmLvXpChipLbl)];
    sb.e[fmLvXpChipN]._active = false; // hidden until UserStats loads

    // Mode tabs from LAYOUT.FindMatchPanel.templates.fmTab.
    const buildFmRow = (template, namePrefix, activeBg, inactiveBg) => {
        const out = [];
        for (let i = 0; i < template.count; i++) {
            const bg = i === (template.activeIdx ?? -1) ? activeBg : inactiveBg;
            const x = template.xs ? template.xs[i] : (template.baseX + i * template.gapX);
            const bN = mkBtnXY(sb, `${namePrefix}_${template.keys[i]}`, fmN, template.labels[i],
                x, template.y, template.w, template.h, bg[0], bg[1], bg[2]);
            out.push(bN);
        }
        return out;
    };
    // 2026-04-28 final pass — tabs use violet (Solana brand for navigation),
    // filter chips keep teal so the two systems read visually distinct.
    const ACTIVE_TAB = [153, 69, 255];      // violet — for tabs
    const ACTIVE_FILTER_CHIP = [48, 198, 155]; // teal — for Mode/Window/Wager
    const INACTIVE_TAB = [36, 16, 48];

    // 2026-04-30 UX rebuild — FilterCard flattens from "modal-feel" to a
    // section of the page. Bg alpha 220→110 (subtle dim, not opaque card).
    // Violet edge accent dropped; replaced by a single 1px top hairline so
    // the section is delineated without floating-card chrome.
    const makeFilterCard = () => {
        const cN = sb.e.length;
        sb.node('FilterCard', fmN, [], [], v3(FME.filterCard.x, FME.filterCard.y, 0));
        const cUT = sb.ut(cN, FME.filterCard.w, FME.filterCard.h);
        const cSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(cN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(26, 8, 32, 110),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        // Single 1px top hairline — section delineation without modal chrome.
        const hairlineN = sb.e.length;
        sb.node('FilterCardTopHairline', cN, [], [], v3(0, FME.filterCard.h / 2 - 1, 0));
        const hairlineUT = sb.ut(hairlineN, FME.filterCard.w, 1);
        const hairlineSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(hairlineN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(60, 70, 95, 80),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[hairlineN]._components = [rf(hairlineUT), rf(hairlineSpr)];
        sb.e[cN]._components = [rf(cUT), rf(cSpr)];
        sb.e[cN]._children = [rf(hairlineN)];
        return cN;
    };
    const fmFilterCard = makeFilterCard();

    // Hairline dividers separating the 3 chip rows inside FilterCard.
    const makeDivider = (nodeName, spec) => {
        const dN = sb.e.length;
        sb.node(nodeName, fmN, [], [], v3(spec.x, spec.y, 0));
        const dUT = sb.ut(dN, spec.w, spec.h);
        const dSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(dN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(60, 70, 95, 0), // 2026-04-28 polish — Phase A flatten: dividers hidden
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[dN]._components = [rf(dUT), rf(dSpr)];
        return dN;
    };
    const fmFilterDivider1 = makeDivider('FilterDivider1', FME.filterDivider1);
    const fmFilterDivider2 = makeDivider('FilterDivider2', FME.filterDivider2);
    const fmFilterDivider3 = makeDivider('FilterDivider3', FME.filterDivider3);

    // 2026-04-28 final pass — small dim row labels on the LEFT of each chip row.
    // Color = Palette.text.lo (#5D6485 = 93,100,133), font 16, left-aligned.
    const makeRowLabel = (nodeName, text, spec) => {
        const lN = mkLabel(sb, nodeName, fmN, text, 16,
            spec.y, spec.w, spec.h, 184, 184, 184);
        sb.e[lN]._lpos = v3(spec.x, spec.y, 0);
        sb.e[sb.e[lN]._components[1].__id__]._horizontalAlign = 0; // left
        return lN;
    };
    const fmModeRowLabel   = makeRowLabel('FindMatchModeRowLabel',   'Mode',     FME.fmModeLabel);
    const fmWindowRowLabel = makeRowLabel('FindMatchWindowRowLabel', 'Duration', FME.fmWindowLabel);
    const fmWagerRowLabel  = makeRowLabel('FindMatchWagerRowLabel',  'Stake',    FME.fmWagerLabel);

    // Tab active underline — slides between -122 / +122 via AppUI tween.
    const fmTabUnderlineN = sb.e.length;
    sb.node('TabActiveUnderline', fmN, [], [],
        v3(FME.tabActiveUnderline.x, FME.tabActiveUnderline.y, 0));
    const fmTabUnderlineUT = sb.ut(fmTabUnderlineN, FME.tabActiveUnderline.w, FME.tabActiveUnderline.h);
    const fmTabUnderlineSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(fmTabUnderlineN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(153, 69, 255, 255), // violet — Solana brand
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[fmTabUnderlineN]._components = [rf(fmTabUnderlineUT), rf(fmTabUnderlineSpr)];

    // 2026-04-28 final pass — tabs use violet (ACTIVE_TAB), filter chips use teal.
    const [fmTabOpen, fmTabLive] = buildFmRow(FMT.fmTab, 'FindMatchTab', ACTIVE_TAB, INACTIVE_TAB);

    // 2026-04-29 FindMatch UX rebuild: 3 filter rows are no longer rendered as
    // inline chip + glow scaffolding. Each row gets a pill-tray sprite (visible
    // container) plus a SegmentMount empty Node. AppUI runtime hydrates the
    // mount with a _buildSegmentedPill (mode tier, 5 segs).
    const makeRowTray = (nodeName, spec) => {
        const tN = sb.e.length;
        sb.node(nodeName, fmN, [], [], v3(spec.x, spec.y, 0));
        const tUT = sb.ut(tN, spec.w, spec.h);
        const tSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(tN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            // Palette.bg.pillTray (#1F2438) so the tray reads as a contained
            // surface vs the panel bg. Subtle but visible.
            _color: cl(31, 36, 56, 200),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[tN]._components = [rf(tUT), rf(tSpr)];
        return tN;
    };
    const makeSegmentMount = (nodeName, spec) => {
        const mN = sb.e.length;
        sb.node(nodeName, fmN, [], [], v3(spec.x, spec.y, 0));
        const mUT = sb.ut(mN, spec.w, spec.h);
        sb.e[mN]._components = [rf(mUT)];
        return mN;
    };
    const fmModeTrayN    = makeRowTray('FindMatchModeTray',   FME.modeTray);
    const fmWindowTrayN  = makeRowTray('FindMatchWindowTray', FME.windowTray);
    const fmWagerTrayN   = makeRowTray('FindMatchWagerTray',  FME.wagerTray);
    const fmModeMountN   = makeSegmentMount('FindMatchSegmentMountMode',   FME.segmentMountMode);
    const fmWindowMountN = makeSegmentMount('FindMatchSegmentMountWindow', FME.segmentMountWindow);
    const fmWagerMountN  = makeSegmentMount('FindMatchSegmentMountWager',  FME.segmentMountWager);

    // Phase 2b — emit a glow sibling per chip. Same position as the chip,
    // 14px larger on each side. AppUI._refreshFindMatchFilterChips toggles
    // _active per chip-row's active selection.
    const makeChipGlow = (parentN, chipName, x, y, w, h, edgeColor) => {
        const gN = sb.e.length;
        sb.node(`ChipGlow_${chipName}`, parentN, [], [], v3(x, y, 0));
        const gUT = sb.ut(gN, w + 14, h + 14);
        const gSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(gN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(edgeColor[0], edgeColor[1], edgeColor[2], 90),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[gN]._components = [rf(gUT), rf(gSpr)];
        sb.e[gN]._active = false;
        return gN;
    };
    const buildChipGlows = (template, namePrefix, color) => {
        const out = [];
        for (let i = 0; i < template.count; i++) {
            const x = template.xs ? template.xs[i] : (template.baseX + i * template.gapX);
            out.push(makeChipGlow(fmN, `${namePrefix}_${template.keys[i]}`, x, template.y, template.w, template.h, color));
        }
        return out;
    };
    // 2026-04-29 FindMatch UX rebuild: only tab glows remain. Filter rows are
    // driven by _buildSegmentedPill which provides its own active fill + halo.
    const fmTabGlows = buildChipGlows(FMT.fmTab, 'FindMatchTab', [153, 69, 255]);

    // Hide-full toggle. 2026-04-28 polish — Phase F: utility tone (smaller +
    // dimmer + 12px label) so it recedes vs the chip rows.
    const fmHideFullBtn = mkBtnXY(sb, 'FilterHideFullToggle', fmN, 'Hide full ✓',
        FME.hideFullToggle.x, FME.hideFullToggle.y, FME.hideFullToggle.w, FME.hideFullToggle.h,
        38, 150, 118);
    style(sb, fmHideFullBtn, { fontSize: 12 });

    // 8 reusable MatchCardRow_0..7 templates from templates.matchRow.
    // Phase A2 redesign: each card now has a mode-color edge stripe, a bold
    // gold wager hero, a REAL/PAPER track chip, and a capacity progress bar
    // that AppUI tweens scale-X based on playerCount/required.
    const MR = FMT.matchRow;
    const fmRowIndices = [];
    const fmRowChildArrays = [];  // [{ rN, edgeN, capFillN, glowN, gradientN }] for AppUI runtime tinting
    for (let i = 0; i < MR.count; i++) {
        const ry = MR.baseY + i * MR.gapY;
        const rN = sb.e.length;
        sb.node(`MatchCardRow_${i}`, fmN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, MR.w, MR.h);
        const rSpr = sb.spr(rN, 26, 8, 32);
        const rBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(rN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.04, _target: rf(rN), _id: gid(),
        });
        // 2026-04-28 polish — Phase C: thin always-on edge glow (alpha 36 baseline).
        // AppUI fades the SAME spr alpha to 160 on touch-press, back to 36 on release
        // (no longer back to 0) so the card always reads as a live event.
        const glowN = sb.e.length;
        sb.node(`MatchCardGlow_${i}`, rN, [], [], v3(MR.glow.x, MR.glow.y, 0));
        const glowUT = sb.ut(glowN, MR.glow.w, MR.glow.h);
        const glowSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(glowN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(153, 69, 255, 36), // baseline thin halo (Phase C); touch ramps to 160
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[glowN]._components = [rf(glowUT), rf(glowSpr)];
        // 2026-04-28 final pass — top-half sheen overlay (subtle white tint w/ alpha 18).
        // Gives flat-color cards a faux gradient feel without shaders.
        const gradientN = sb.e.length;
        sb.node(`MatchCardGradient_${i}`, rN, [], [], v3(MR.gradient.x, MR.gradient.y, 0));
        const gradientUT = sb.ut(gradientN, MR.gradient.w, MR.gradient.h);
        const gradientSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(gradientN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(255, 255, 255, 22), // 2026-04-28 polish — Phase C top sheen lift
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[gradientN]._components = [rf(gradientUT), rf(gradientSpr)];
        // Edge stripe — mode-coded color (AppUI retints in _renderMatchList).
        const edgeN = sb.e.length;
        sb.node(`MatchCardEdgeStripe_${i}`, rN, [], [], v3(MR.edgeStripe.x, MR.edgeStripe.y, 0));
        const edgeUT = sb.ut(edgeN, MR.edgeStripe.w, MR.edgeStripe.h);
        const edgeSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(edgeN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(153, 69, 255, 255), // violet default; AppUI retints
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[edgeN]._components = [rf(edgeUT), rf(edgeSpr)];

        // 2026-04-29 god-tier rebuild — 4-row card layout. Row 1: mode chip
        // LEFT (anchor 0,0.5), stake CENTER, type tag RIGHT. Row 2: metadata
        // ("5m race . 1/2 players"). Row 3: progress bar. Row 4: action btn.
        const modeL = mkLabel(sb, `MatchCardModeLabel_${i}`, rN, '1v1', 20,
            MR.mode.y, MR.mode.w, MR.mode.h, 255, 255, 255);
        sb.e[modeL]._lpos = v3(MR.mode.x, MR.mode.y, 0);
        sb.e[sb.e[modeL]._components[1].__id__]._horizontalAlign = 0;
        sb.e[sb.e[modeL]._components[1].__id__]._isBold = true;
        // Bold gold stake hero — center of row 1, larger to dominate.
        const wagerL = mkLabel(sb, `MatchCardWagerLabel_${i}`, rN, '0.05 SOL', 28,
            MR.wager.y, MR.wager.w, MR.wager.h, 255, 210, 74);
        sb.e[wagerL]._lpos = v3(MR.wager.x, MR.wager.y, 0);
        style(sb, wagerL, { mono: true, bold: true });
        sb.e[sb.e[wagerL]._components[1].__id__]._horizontalAlign = 1;
        // Track chip — tiny REAL/PAPER pill, AppUI tints rose/teal.
        const trackChipN = sb.e.length;
        sb.node(`MatchCardTrackChip_${i}`, rN, [], [], v3(MR.trackChip.x, MR.trackChip.y, 0));
        const trackChipUT = sb.ut(trackChipN, MR.trackChip.w, MR.trackChip.h);
        const trackChipSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(trackChipN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(255, 92, 138, 220), // rose — REAL by default
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        const trackChipLbl = mkLabel(sb, `MatchCardTrackChipLabel_${i}`, trackChipN, 'REAL', 12, 0,
            MR.trackChip.w - 8, MR.trackChip.h - 4, 255, 255, 255);
        sb.e[sb.e[trackChipLbl]._components[1].__id__]._isBold = true;
        sb.e[trackChipN]._components = [rf(trackChipUT), rf(trackChipSpr)];
        sb.e[trackChipN]._children = [rf(trackChipLbl)];

        // 2026-04-29 god-tier rebuild — winL hidden (sub label carries the
        // unified "5m race . 1/2 players" metadata line). Kept as a hidden
        // node so AppUI's existing winL.string updates fail silently.
        const winL = mkLabel(sb, `MatchCardWindowLabel_${i}`, rN, '', 14,
            MR.window.y, 1, 1, 140, 220, 180);
        sb.e[winL]._lpos = v3(0, -2000, 0);
        sb.e[winL]._active = false;
        sb.e[sb.e[winL]._components[1].__id__]._horizontalAlign = 0;
        // Single metadata row — duration . player count, +14% font size.
        const subL = mkLabel(sb, `MatchCardSubLabel_${i}`, rN, '5m race · 1/2 players', 16,
            MR.sub.y, MR.sub.w, MR.sub.h, 184, 184, 184);
        sb.e[subL]._lpos = v3(MR.sub.x, MR.sub.y, 0);
        sb.e[sb.e[subL]._components[1].__id__]._horizontalAlign = 0;
        // Capacity progress bar — track + tween-fill.
        const capBarN = sb.e.length;
        sb.node(`MatchCardCapBar_${i}`, rN, [], [], v3(MR.capBar.x, MR.capBar.y, 0));
        const capBarUT = sb.ut(capBarN, MR.capBar.w, MR.capBar.h);
        const capBarSpr = sb.spr(capBarN, 38, 44, 64);
        sb.e[capBarN]._components = [rf(capBarUT), rf(capBarSpr)];
        const capFillN = sb.e.length;
        sb.node(`MatchCardCapBarFill_${i}`, rN, [], [], v3(MR.capBarFill.x, MR.capBarFill.y, 0));
        const capFillUT = sb.ut(capFillN, MR.capBarFill.w, MR.capBarFill.h);
        const capFillSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(capFillN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(20, 241, 149, 255),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[capFillN]._components = [rf(capFillUT), rf(capFillSpr)];

        const joinL = mkBtnXY(sb, `MatchCardJoinButton_${i}`, rN, 'Join',
            MR.join.x, MR.join.y, MR.join.w, MR.join.h, 20, 241, 149);
        style(sb, joinL, { bold: true });
        sb.e[rN]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
        sb.e[rN]._children = [
            // Glow first so it renders BEHIND the card body but in front of canvas bg.
            rf(glowN),
            rf(edgeN),
            rf(gradientN),
            rf(modeL), rf(wagerL), rf(trackChipN), rf(winL), rf(subL),
            rf(capBarN), rf(capFillN),
            rf(joinL),
        ];
        sb.e[rN]._active = false;
        fmRowIndices.push(rN);
        fmRowChildArrays.push({ edgeN, capFillN, trackChipN, glowN, gradientN });
    }

    // 2026-04-28 polish — tail hint shown when 1-2 matches present. Copy + dual
    // CTA inline below subtitle (Reset Filters / Start a Duel). AppUI repositions
    // all 4 nodes per-render based on lastCardY.
    const fmTailHintTitle = mkLabel(sb, 'FindMatchTailHintTitle', fmN,
        'No matches right now', 16,
        FME.tailHintTitle.y, FME.tailHintTitle.w, FME.tailHintTitle.h, 184, 184, 184);
    sb.e[sb.e[fmTailHintTitle]._components[1].__id__]._isBold = true;
    sb.e[fmTailHintTitle]._active = false;
    const fmTailHintSubtitle = mkLabel(sb, 'FindMatchTailHintSubtitle', fmN,
        'Adjust filters or start your own duel', 14,
        FME.tailHintSubtitle.y, FME.tailHintSubtitle.w, FME.tailHintSubtitle.h, 140, 140, 140);
    sb.e[fmTailHintSubtitle]._active = false;
    // Reset Filters — TERTIARY (user-spec inline action). Ghost surface.
    const fmTailResetBtn = mkBtnXY(sb, 'FindMatchTailResetButton', fmN, 'Reset Filters',
        FME.tailResetBtn.x, FME.tailResetBtn.y, FME.tailResetBtn.w, FME.tailResetBtn.h,
        40, 46, 68,
        { tier: 'tertiary' });
    sb.e[fmTailResetBtn]._active = false;
    // Start a Duel — SECONDARY (host-new-match adjacent action), ghost surface.
    const fmTailStartBtn = mkBtnXY(sb, 'FindMatchTailStartButton', fmN, 'Start a Duel',
        FME.tailStartBtn.x, FME.tailStartBtn.y, FME.tailStartBtn.w, FME.tailStartBtn.h,
        40, 46, 68,
        { tier: 'secondary' });
    sb.e[fmTailStartBtn]._active = false;

    // Legacy empty state — kept for fallback. _active=false by default.
    const fmEmptyL = mkLabel(sb, 'FindMatchEmptyLabel', fmN, 'No open lobbies match these filters — host one or play a bot.', 14,
        FME.emptyLabel.y, FME.emptyLabel.w, FME.emptyLabel.h, 184, 184, 184);
    sb.e[fmEmptyL]._active = false;

    // Phase A2 — gamified empty-state cluster (mascot + dual CTAs).
    const fmEmptyMascotN = sb.e.length;
    sb.node('FindMatchEmptyMascot', fmN, [], [], v3(FME.emptyMascot.x, FME.emptyMascot.y, 0));
    const fmEmptyMascotUT = sb.ut(fmEmptyMascotN, FME.emptyMascot.w, FME.emptyMascot.h);
    sb.e[fmEmptyMascotN]._components = [rf(fmEmptyMascotUT)];
    sb.e[fmEmptyMascotN]._active = false;
    const fmEmptyTitle = mkLabel(sb, 'FindMatchEmptyTitle', fmN, 'No matches yet', 24,
        FME.emptyTitle.y, FME.emptyTitle.w, FME.emptyTitle.h, 255, 210, 74);
    style(sb, fmEmptyTitle, { bold: true });
    sb.e[fmEmptyTitle]._active = false;
    const fmEmptySubtitle = mkLabel(sb, 'FindMatchEmptySubtitle', fmN,
        'Be the first to host — others will join in seconds.', 14,
        FME.emptySubtitle.y, FME.emptySubtitle.w, FME.emptySubtitle.h, 184, 184, 184);
    sb.e[fmEmptySubtitle]._active = false;
    const fmEmptyHostBtn = mkBtnXY(sb, 'FindMatchEmptyHostButton', fmN, 'Host New Match',
        FME.emptyHostBtn.x, FME.emptyHostBtn.y, FME.emptyHostBtn.w, FME.emptyHostBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { tier: 'secondary' });
    style(sb, fmEmptyHostBtn, { bold: true });
    sb.e[fmEmptyHostBtn]._active = false;
    const fmEmptyBotBtn = mkBtnXY(sb, 'FindMatchEmptyBotButton', fmN, 'Play a Bot',
        FME.emptyBotBtn.x, FME.emptyBotBtn.y, FME.emptyBotBtn.w, FME.emptyBotBtn.h,
        VAR('warn').r, VAR('warn').g, VAR('warn').b,
        { tier: 'secondary' });
    style(sb, fmEmptyBotBtn, { bold: true });
    sb.e[fmEmptyBotBtn]._active = false;

    // 2026-05-02 arena rebuild — copy upgraded "FIND MATCH" → "ENTER MATCH"
    // so the CTA reads as a stakes-bearing decision rather than a search.
    // Tier=primary so it picks up the hero-button glow / press-pop / ripple
    // bundle. Default _active=true so it shows whenever the panel opens.
    const fmHostBtn = mkBtn(sb, 'FindMatchHostButton', fmN, 'ENTER MATCH',
        FME.hostBtn.y, FME.hostBtn.w, FME.hostBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { tier: 'primary' });
    style(sb, fmHostBtn, { bold: true });
    sb.e[fmHostBtn]._active = true;
    const fmStatus = mkLabel(sb, 'FindMatchStatusLabel', fmN, '', 12,
        FME.status.y, FME.status.w, FME.status.h, 184, 184, 184);

    // 2026-04-28 polish — Phase G: ambient particle drift container. Empty Node;
    // AppUI._showFindMatchPanel calls addParticleDrift(layer, 4) on first show.
    // Sits as the FIRST child so particles render BEHIND every other element.
    const fmAmbientLayerN = sb.e.length;
    sb.node('FindMatchAmbientLayer', fmN, [], [], v3(0, 0, 0));
    const fmAmbientLayerUT = sb.ut(fmAmbientLayerN, LAYOUT.FindMatchPanel.canvas.w, LAYOUT.FindMatchPanel.canvas.h);
    sb.e[fmAmbientLayerN]._components = [rf(fmAmbientLayerUT)];

    sb.e[fmN]._children = [
        // 2026-05-01 — scrim FIRST so it z-orders behind every other panel
        // child. Was previously created but never added → orphaned, no
        // backdrop rendered. Mirrors Leaderboard pattern at L5142.
        rf(fmScrimN),
        // Ambient layer next so 4 drifting violet/teal particles render behind everything else.
        rf(fmAmbientLayerN),
        rf(_fmBack.linkN), rf(fmBackBtn), rf(fmTitle), rf(fmRefreshBtn), rf(fmCountLabel),
        rf(fmLivePulseDotN),
        rf(fmLvXpChipN),
        // 2026-04-29 FindMatch UX rebuild: legacy filter card / dividers /
        // tab underline kept as hidden stubs (1x1 alpha 0) for back-compat
        // with AppUI lookups. Render order is irrelevant for hidden nodes.
        rf(fmFilterCard),
        rf(fmFilterDivider1), rf(fmFilterDivider2), rf(fmFilterDivider3),
        rf(fmTabUnderlineN),
        // 3 row trays sit BEHIND row labels and segment mounts.
        rf(fmModeTrayN), rf(fmWindowTrayN), rf(fmWagerTrayN),
        rf(fmModeRowLabel), rf(fmWindowRowLabel), rf(fmWagerRowLabel),
        rf(fmModeMountN), rf(fmWindowMountN), rf(fmWagerMountN),
        // Tab glows behind tab buttons.
        ...fmTabGlows.map(rf),
        rf(fmTabOpen), rf(fmTabLive),
        rf(fmHideFullBtn),
        ...fmRowIndices.map(rf),
        // Tail-hint nodes deprecated (see LayoutSpec notes); kept hidden at
        // y=-2000 so AppUI bindings don't throw.
        rf(fmTailHintTitle), rf(fmTailHintSubtitle),
        rf(fmTailResetBtn), rf(fmTailStartBtn),
        rf(fmEmptyMascotN), rf(fmEmptyTitle), rf(fmEmptySubtitle),
        rf(fmEmptyHostBtn), rf(fmEmptyBotBtn),
        rf(fmEmptyL), rf(fmHostBtn), rf(fmStatus),
    ];
    sb.e[fmN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase A — JOIN MATCH CONFIRM OVERLAY
    // Shown when user taps a match card in FindMatchPanel. Full-screen
    // scrim + violet-edged hero card showing the lobby's mode/wager/window
    // /capacity/host/age. Cancel returns to lobby; Go locks _pickerJoinTarget
    // and routes to TokenDuelPanel in join-mode (locked wager + Join CTA).
    // ═══════════════════════════════════════════════════════════════
    const JCE = LAYOUT.JoinMatchConfirmOverlay.elements;
    const jcN = sb.e.length;
    sb.node('JoinMatchConfirmOverlay', canvas, [], [], v3(0, 0, 0));
    sb.ut(jcN, LAYOUT.JoinMatchConfirmOverlay.canvas.w, LAYOUT.JoinMatchConfirmOverlay.canvas.h);
    // Full-canvas scrim (alpha 220) — blocks taps to the lobby beneath.
    const jcScrimN = sb.e.length;
    sb.node('JoinConfirmScrim', jcN, [], [], v3(JCE.scrim.x, JCE.scrim.y, 0));
    const jcScrimUT = sb.ut(jcScrimN, JCE.scrim.w, JCE.scrim.h);
    const jcScrimSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(jcScrimN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(8, 10, 18, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // Block-tap button on scrim — tapping outside the card cancels.
    const jcScrimBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(jcScrimN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(jcScrimN), _id: gid(),
    });
    sb.e[jcScrimN]._components = [rf(jcScrimUT), rf(jcScrimSpr), rf(jcScrimBtn)];

    // Hero card — Solana-violet edged.
    const jcCardN = sb.e.length;
    sb.node('JoinConfirmCard', jcN, [], [], v3(JCE.card.x, JCE.card.y, 0));
    const jcCardUT = sb.ut(jcCardN, JCE.card.w, JCE.card.h);
    const jcCardSpr = sb.spr(jcCardN, 18, 22, 36); // app-bg deep
    sb.e[jcCardN]._components = [rf(jcCardUT), rf(jcCardSpr)];

    // Title + subtitle.
    const jcTitle = mkLabel(sb, 'JoinConfirmTitleLabel', jcCardN, 'Confirm Join', 28,
        JCE.title.y, JCE.title.w, JCE.title.h, 255, 210, 74);
    style(sb, jcTitle, { bold: true });
    const jcSubtitle = mkLabel(sb, 'JoinConfirmSubtitleLabel', jcCardN, 'Review the lobby — then Join.', 14,
        JCE.subtitle.y, JCE.subtitle.w, JCE.subtitle.h, 184, 184, 184);

    // Mode badge — violet chip top-left of card.
    const jcModeBadge = sb.e.length;
    sb.node('JoinConfirmModeBadge', jcCardN, [], [], v3(JCE.modeBadge.x, JCE.modeBadge.y, 0));
    const jcModeBadgeUT = sb.ut(jcModeBadge, JCE.modeBadge.w, JCE.modeBadge.h);
    const jcModeBadgeSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(jcModeBadge), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(153, 69, 255, 200), // violet — AppUI retints by mode
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const jcModeLbl = mkLabel(sb, 'JoinConfirmModeBadgeLabel', jcModeBadge, '1v1', 18,
        JCE.modeBadgeLabel.y, JCE.modeBadgeLabel.w, JCE.modeBadgeLabel.h, 255, 255, 255);
    sb.e[sb.e[jcModeLbl]._components[1].__id__]._isBold = true;
    sb.e[jcModeBadge]._components = [rf(jcModeBadgeUT), rf(jcModeBadgeSpr)];
    sb.e[jcModeBadge]._children = [rf(jcModeLbl)];

    // Track chip — REAL (rose) or PAPER (teal). AppUI retints + relabels.
    const jcTrackChip = sb.e.length;
    sb.node('JoinConfirmTrackChip', jcCardN, [], [], v3(JCE.trackChip.x, JCE.trackChip.y, 0));
    const jcTrackChipUT = sb.ut(jcTrackChip, JCE.trackChip.w, JCE.trackChip.h);
    const jcTrackChipSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(jcTrackChip), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 92, 138, 220), // rose — REAL by default
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const jcTrackLbl = mkLabel(sb, 'JoinConfirmTrackChipLabel', jcTrackChip, 'REAL', 14,
        JCE.trackChipLabel.y, JCE.trackChipLabel.w, JCE.trackChipLabel.h, 255, 255, 255);
    sb.e[sb.e[jcTrackLbl]._components[1].__id__]._isBold = true;
    sb.e[jcTrackChip]._components = [rf(jcTrackChipUT), rf(jcTrackChipSpr)];
    sb.e[jcTrackChip]._children = [rf(jcTrackLbl)];

    // Wager hero — big gold center.
    const jcWagerHero = mkLabel(sb, 'JoinConfirmWagerHeroLabel', jcCardN, '0.05 SOL', 36,
        JCE.wagerHero.y, JCE.wagerHero.w, JCE.wagerHero.h, 255, 210, 74);
    style(sb, jcWagerHero, { bold: true, mono: true });

    // Window + capacity meta row.
    const jcWindowL = mkLabel(sb, 'JoinConfirmWindowLabel', jcCardN, '30s race', 16,
        JCE.windowLabel.y, JCE.windowLabel.w, JCE.windowLabel.h, 184, 184, 184);
    sb.e[jcWindowL]._lpos = v3(JCE.windowLabel.x, JCE.windowLabel.y, 0);
    const jcCapacityL = mkLabel(sb, 'JoinConfirmCapacityLabel', jcCardN, '1/2 players', 16,
        JCE.capacityLabel.y, JCE.capacityLabel.w, JCE.capacityLabel.h, 184, 184, 184);
    sb.e[jcCapacityL]._lpos = v3(JCE.capacityLabel.x, JCE.capacityLabel.y, 0);

    // Host + age row.
    const jcHostL = mkLabel(sb, 'JoinConfirmHostLabel', jcCardN, 'Host: 5Ksq…sDst', 14,
        JCE.hostLabel.y, JCE.hostLabel.w, JCE.hostLabel.h, 184, 184, 184);
    sb.e[jcHostL]._lpos = v3(JCE.hostLabel.x, JCE.hostLabel.y, 0);
    const jcAgeL = mkLabel(sb, 'JoinConfirmAgeLabel', jcCardN, '0:42 ago', 14,
        JCE.ageLabel.y, JCE.ageLabel.w, JCE.ageLabel.h, 184, 184, 184);
    sb.e[jcAgeL]._lpos = v3(JCE.ageLabel.x, JCE.ageLabel.y, 0);

    // Capacity progress bar — track + tween-fill.
    const jcCapBar = sb.e.length;
    sb.node('JoinConfirmCapacityBar', jcCardN, [], [], v3(JCE.capacityBar.x, JCE.capacityBar.y, 0));
    const jcCapBarUT = sb.ut(jcCapBar, JCE.capacityBar.w, JCE.capacityBar.h);
    const jcCapBarSpr = sb.spr(jcCapBar, 38, 44, 64);
    sb.e[jcCapBar]._components = [rf(jcCapBarUT), rf(jcCapBarSpr)];
    const jcCapFill = sb.e.length;
    sb.node('JoinConfirmCapacityBarFill', jcCardN, [], [], v3(JCE.capacityBarFill.x, JCE.capacityBarFill.y, 0));
    const jcCapFillUT = sb.ut(jcCapFill, JCE.capacityBarFill.w, JCE.capacityBarFill.h);
    const jcCapFillSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(jcCapFill), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(20, 241, 149, 255),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[jcCapFill]._components = [rf(jcCapFillUT), rf(jcCapFillSpr)];

    // CTA buttons.
    const jcCancelBtn = mkBtnXY(sb, 'JoinConfirmCancelButton', jcCardN, '✕  Cancel',
        JCE.cancelBtn.x, JCE.cancelBtn.y, JCE.cancelBtn.w, JCE.cancelBtn.h, 55, 65, 85);
    style(sb, jcCancelBtn, { bold: true });
    const { glow: jcGoGlow, btn: jcGoBtn } = mkBtnHero(sb,
        'JoinConfirmGoButton', jcCardN, '▶  Join Match',
        JCE.goBtn.x, JCE.goBtn.y, JCE.goBtn.w, JCE.goBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { tier: 'primary' });
    style(sb, jcGoBtn, { bold: true });
    const jcHint = mkLabel(sb, 'JoinConfirmHintLabel', jcCardN, 'You\'ll pick 3 tokens next.', 12,
        JCE.hint.y, JCE.hint.w, JCE.hint.h, 184, 184, 184);

    sb.e[jcCardN]._children = [
        rf(jcTitle), rf(jcSubtitle),
        rf(jcModeBadge), rf(jcTrackChip),
        rf(jcWagerHero),
        rf(jcWindowL), rf(jcCapacityL),
        rf(jcHostL), rf(jcAgeL),
        rf(jcCapBar), rf(jcCapFill),
        rf(jcCancelBtn), rf(jcGoGlow), rf(jcGoBtn),
        rf(jcHint),
    ];
    sb.e[jcN]._children = [rf(jcScrimN), rf(jcCardN)];
    sb.e[jcN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // 2026-05-02 — LIVE STANDINGS OVERLAY
    // Opens from a Matches In Progress card details button. Full-canvas
    // scrim + centered card listing every published squad in the race,
    // ranked by current portfolio delta. 10 row slots cover up to BR10.
    // AppUI flips active rows per player + fetches snapshot via the
    // backend GET /match/:pda/live-pnl endpoint.
    // ═══════════════════════════════════════════════════════════════
    const LSE = LAYOUT.LiveStandingsOverlay.elements;
    const LSR = LAYOUT.LiveStandingsOverlay.templates.standingsRow;
    const lsoN = sb.e.length;
    sb.node('LiveStandingsOverlay', canvas, [], [], v3(0, 0, 0));
    sb.ut(lsoN, LAYOUT.LiveStandingsOverlay.canvas.w, LAYOUT.LiveStandingsOverlay.canvas.h);

    // Full-canvas scrim (alpha 220) — blocks taps to MIP beneath. Tap dismisses.
    const lsoScrimN = sb.e.length;
    sb.node('LiveStandingsScrim', lsoN, [], [], v3(LSE.scrim.x, LSE.scrim.y, 0));
    const lsoScrimUT = sb.ut(lsoScrimN, LSE.scrim.w, LSE.scrim.h);
    const lsoScrimSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(lsoScrimN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(8, 10, 18, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const lsoScrimBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(lsoScrimN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(lsoScrimN), _id: gid(),
    });
    sb.e[lsoScrimN]._components = [rf(lsoScrimUT), rf(lsoScrimSpr), rf(lsoScrimBtn)];

    // Hero card — deep-slate surface.
    const lsoCardN = sb.e.length;
    sb.node('LiveStandingsCard', lsoN, [], [], v3(LSE.card.x, LSE.card.y, 0));
    const lsoCardUT = sb.ut(lsoCardN, LSE.card.w, LSE.card.h);
    const lsoCardSpr = sb.spr(lsoCardN, 18, 22, 36);
    sb.e[lsoCardN]._components = [rf(lsoCardUT), rf(lsoCardSpr)];

    // Title + subtitle.
    const lsoTitle = mkLabel(sb, 'LiveStandingsTitleLabel', lsoCardN, 'Live Standings', 26,
        LSE.title.y, LSE.title.w, LSE.title.h, 255, 210, 74);
    style(sb, lsoTitle, { bold: true });
    const lsoSubtitle = mkLabel(sb, 'LiveStandingsSubtitleLabel', lsoCardN, '—', 14,
        LSE.subtitle.y, LSE.subtitle.w, LSE.subtitle.h, 184, 184, 184);

    // Thin divider under the title cluster.
    const lsoDividerN = sb.e.length;
    sb.node('LiveStandingsDivider', lsoCardN, [], [], v3(LSE.divider.x, LSE.divider.y, 0));
    const lsoDividerUT = sb.ut(lsoDividerN, LSE.divider.w, LSE.divider.h);
    const lsoDividerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(lsoDividerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(70, 80, 110, 180),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 0, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[lsoDividerN]._components = [rf(lsoDividerUT), rf(lsoDividerSpr)];

    // Inline state label — "Loading…" / "Squads not yet published".
    const lsoStateN = mkLabel(sb, 'LiveStandingsStateLabel', lsoCardN, 'Loading…', 16,
        LSE.stateLbl.y, LSE.stateLbl.w, LSE.stateLbl.h, 184, 184, 184);

    // 10 standings rows pre-baked. AppUI activates min(playerCount, 10).
    const lsoRows = [];
    for (let i = 0; i < LSR.count; i++) {
        const ry = LSR.baseY + i * LSR.gapY;
        const rowN = sb.e.length;
        sb.node(`LiveStandingsRow_${i}`, lsoCardN, [], [], v3(0, ry, 0));
        sb.ut(rowN, LSR.w, LSR.h);

        // Rank chip — small filled square. AppUI tints (gold for #1, silver
        // #2, bronze #3, slate otherwise) and writes "1" / "2" / etc.
        const rankN = sb.e.length;
        sb.node(`LiveStandingsRank_${i}`, rowN, [], [], v3(LSR.rank.x, LSR.rank.y, 0));
        const rankUT = sb.ut(rankN, LSR.rank.w, LSR.rank.h);
        const rankSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(rankN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(70, 80, 110, 220),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 0, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[rankN]._components = [rf(rankUT), rf(rankSpr)];
        const rankLblN = mkLabel(sb, `LiveStandingsRankLabel_${i}`, rankN, '?', 18,
            LSR.rankLabel.y, LSR.rankLabel.w, LSR.rankLabel.h, 255, 255, 255);
        style(sb, rankLblN, { bold: true, mono: true });
        sb.e[rankN]._children = [rf(rankLblN)];

        // Player name label (top of row, left-anchored).
        const nameN = mkLabel(sb, `LiveStandingsName_${i}`, rowN, '—', 16,
            LSR.name.y, LSR.name.w, LSR.name.h, 230, 230, 240);
        sb.e[nameN]._lpos = v3(LSR.name.x, LSR.name.y, 0);
        sb.e[sb.e[nameN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, nameN, { bold: true });

        // Mints summary ("BONK · WIF · POPCAT") below the name.
        const mintsN = mkLabel(sb, `LiveStandingsMints_${i}`, rowN, '', 12,
            LSR.mints.y, LSR.mints.w, LSR.mints.h, 160, 170, 200);
        sb.e[mintsN]._lpos = v3(LSR.mints.x, LSR.mints.y, 0);
        sb.e[sb.e[mintsN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, mintsN, { mono: true });

        // PnL big % (right side, right-aligned). Tinted by AppUI per sign.
        const pnlN = mkLabel(sb, `LiveStandingsPnl_${i}`, rowN, '—', 24,
            LSR.pnl.y, LSR.pnl.w, LSR.pnl.h, 184, 184, 184);
        sb.e[pnlN]._lpos = v3(LSR.pnl.x, LSR.pnl.y, 0);
        sb.e[sb.e[pnlN]._components[1].__id__]._horizontalAlign = 2;
        style(sb, pnlN, { bold: true, mono: true });

        sb.e[rowN]._children = [rf(rankN), rf(nameN), rf(mintsN), rf(pnlN)];
        sb.e[rowN]._active = false;
        lsoRows.push(rowN);
    }

    // Close CTA — centered at card bottom. Scrim tap also dismisses.
    const lsoCloseBtn = mkBtnXY(sb, 'LiveStandingsCloseButton', lsoCardN, 'Close',
        LSE.closeBtn.x, LSE.closeBtn.y, LSE.closeBtn.w, LSE.closeBtn.h, 55, 65, 85);
    style(sb, lsoCloseBtn, { bold: true });

    sb.e[lsoCardN]._children = [
        rf(lsoTitle), rf(lsoSubtitle), rf(lsoDividerN), rf(lsoStateN),
        ...lsoRows.map(rf),
        rf(lsoCloseBtn),
    ];
    sb.e[lsoN]._children = [rf(lsoScrimN), rf(lsoCardN)];
    sb.e[lsoN]._active = false;

    // AppUI component on Canvas
    const appUI = sb.custom(canvas, UUIDS.AppUI);

    // Patch Canvas children
    // ═══════════════════════════════════════════════════════════════
    // betting-duel Block 3 — CountdownOverlay (3 · 2 · 1 · GO!)
    // Shown briefly between ModePicker-Start and RacePanel activation to
    // build tension. AppUI drives the animation with a tween chain.
    // ═══════════════════════════════════════════════════════════════
    const COE = LAYOUT.CountdownOverlay.elements;
    const countdownN = sb.e.length;
    sb.node('CountdownOverlay', canvas, [], [countdownN+1, countdownN+2], v3(0, 0, 0));
    sb.ut(countdownN, LAYOUT.CountdownOverlay.canvas.w, LAYOUT.CountdownOverlay.canvas.h);
    sb.spr(countdownN, 8, 12, 20);
    sb.e[countdownN]._active = false;
    const countdownBigN = mkLabel(sb, 'CountdownBigLabel', countdownN, '3', 160,
        COE.bigLabel.y, COE.bigLabel.w, COE.bigLabel.h, 255, 210, 74);
    const countdownSquadN = mkLabel(sb, 'CountdownSquadPreviewLabel', countdownN, 'Your squad', 24,
        COE.squadLabel.y, COE.squadLabel.w, COE.squadLabel.h, 180, 190, 210);
    const countdownHintN = mkLabel(sb, 'CountdownHintLabel', countdownN, 'Match starting…', 18,
        COE.hintLabel.y, COE.hintLabel.w, COE.hintLabel.h, 184, 184, 184);
    sb.e[countdownN]._children = [rf(countdownBigN), rf(countdownSquadN), rf(countdownHintN)];

    // ═══════════════════════════════════════════════════════════════
    // betting-duel Block 8 — SigningOverlay (wallet wait spinner)
    // ═══════════════════════════════════════════════════════════════
    const SOE = LAYOUT.SigningOverlay.elements;
    const signingN = sb.e.length;
    sb.node('SigningOverlay', canvas, [], [signingN+1, signingN+2], v3(0, 0, 0));
    sb.ut(signingN, LAYOUT.SigningOverlay.canvas.w, LAYOUT.SigningOverlay.canvas.h);
    sb.spr(signingN, 4, 6, 12);
    sb.e[signingN]._active = false;
    const signingSpinnerN = mkLabel(sb, 'SigningSpinnerLabel', signingN, '⟳', 80,
        SOE.spinner.y, SOE.spinner.w, SOE.spinner.h, 255, 210, 74);
    const signingStatusN = mkLabel(sb, 'SigningStatusLabel', signingN, 'Awaiting wallet approval…', 24,
        SOE.statusLabel.y, SOE.statusLabel.w, SOE.statusLabel.h, 230, 230, 240);
    const signingHintN = mkLabel(sb, 'SigningHintLabel', signingN, 'Check your wallet app — sign to continue.', 16,
        SOE.hintLabel.y, SOE.hintLabel.w, SOE.hintLabel.h, 184, 184, 184);
    sb.e[signingN]._children = [rf(signingSpinnerN), rf(signingStatusN), rf(signingHintN)];

    // ═══════════════════════════════════════════════════════════════
    // Phase 19 — LoadingOverlay (post-connect / reconnect gap polish).
    // Mirrors SigningOverlay structure + adds MascotContainer for greeter.
    // ═══════════════════════════════════════════════════════════════
    const LOE = LAYOUT.LoadingOverlay.elements;
    const loadingN = sb.e.length;
    sb.node('LoadingOverlay', canvas, [], [], v3(0, 0, 0));
    sb.ut(loadingN, LAYOUT.LoadingOverlay.canvas.w, LAYOUT.LoadingOverlay.canvas.h);
    sb.spr(loadingN, 4, 6, 12);
    sb.e[loadingN]._active = false;

    const loadingMascotN = sb.e.length;
    sb.node('LoadingMascotContainer', loadingN, [], [], v3(LOE.mascotContainer.x, LOE.mascotContainer.y, 0));
    sb.ut(loadingMascotN, LOE.mascotContainer.w, LOE.mascotContainer.h);

    const loadingSpinnerN = mkLabel(sb, 'LoadingSpinnerLabel', loadingN, '⟳', 80,
        LOE.spinner.y, LOE.spinner.w, LOE.spinner.h, 255, 210, 74);
    const loadingStatusN  = mkLabel(sb, 'LoadingStatusLabel',  loadingN, 'Loading…', 24,
        LOE.statusLabel.y, LOE.statusLabel.w, LOE.statusLabel.h, 230, 230, 240);
    const loadingTipN     = mkLabel(sb, 'LoadingTipLabel',     loadingN, '', 16,
        LOE.tipLabel.y, LOE.tipLabel.w, LOE.tipLabel.h, 184, 184, 184);
    style(sb, loadingTipN, { spacing: 1 });

    sb.e[loadingN]._children = [rf(loadingMascotN), rf(loadingSpinnerN), rf(loadingStatusN), rf(loadingTipN)];

    // ═══════════════════════════════════════════════════════════════
    // Phase H4 — LevelUpOverlay (full-screen XP celebration cinematic)
    // Triggered from AppUI._onGameOver / _showPostMatchPanel when newLevel > previousLevel.
    // Shows: scrim · "LEVEL UP" · big level number · rake-discount callout.
    // Auto-dismisses after 2.8s; also tap-to-dismiss anywhere.
    // ═══════════════════════════════════════════════════════════════
    const LUE = LAYOUT.LevelUpOverlay.elements;
    const luN = sb.e.length;
    sb.node('LevelUpOverlay', canvas, [], [], v3(0, 0, 0));
    const luUT = sb.ut(luN, LAYOUT.LevelUpOverlay.canvas.w, LAYOUT.LevelUpOverlay.canvas.h);
    const luBgSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(luN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(8, 6, 14, 235),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    // Tap-to-dismiss button covering the whole scrim. Wired by AppUI.
    const luDismissBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(luN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(luN), _id: gid(),
    });
    sb.e[luN]._components = [rf(luUT), rf(luBgSpr), rf(luDismissBtn)];
    // Title.
    const luTitle = mkLabel(sb, 'LevelUpTitleLabel', luN, 'LEVEL UP', 64,
        LUE.title.y, LUE.title.w, LUE.title.h, 255, 210, 74);
    style(sb, luTitle, { bold: true });
    // Big level number with count-up tween at runtime.
    const luBigLevel = mkLabel(sb, 'LevelUpBigLevel', luN, '5', 180,
        LUE.bigLevel.y, LUE.bigLevel.w, LUE.bigLevel.h, 255, 240, 200);
    style(sb, luBigLevel, { bold: true });
    // Caption (e.g. "Level 5 reached").
    const luCaption = mkLabel(sb, 'LevelUpCaptionLabel', luN, 'Level 5 reached', 26,
        LUE.caption.y, LUE.caption.w, LUE.caption.h, 255, 255, 255);
    // Rake discount callout (teal accent).
    const luRake = mkLabel(sb, 'LevelUpRakeLabel', luN, 'Your rake: 4.5% (was 5.0%)', 22,
        LUE.rake.y, LUE.rake.w, LUE.rake.h, 48, 198, 155);
    // Hint at the bottom.
    const luHint = mkLabel(sb, 'LevelUpHintLabel', luN, 'tap to continue', 14,
        LUE.hint.y, LUE.hint.w, LUE.hint.h, 184, 184, 184);
    sb.e[luN]._children = [rf(luTitle), rf(luBigLevel), rf(luCaption), rf(luRake), rf(luHint)];
    sb.e[luN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase N3 — NotificationPanel (right-side tray slide-in).
    // 2026-04-29 premium-feed redesign: single-row header (title left +
    // tertiary "Mark all read" + ✕ corner), section labels (TODAY /
    // EARLIER) injected between rows by AppUI, simplified row chrome
    // (icon · title · body · time · dot · right-edge accent). Per-item
    // selection mode dropped — tap-a-card = mark that one read.
    // ═══════════════════════════════════════════════════════════════
    const NPC = LAYOUT.NotificationPanel.card;
    const NPE = LAYOUT.NotificationPanel.elements;
    const npN = sb.e.length;
    sb.node('NotificationPanel', canvas, [], [], lobbyMount('NotificationPanel'));
    const npUT = sb.ut(npN, 720, 1280);
    // Tap-outside-to-dismiss: invisible Button on the panel root. Card
    // children intercept their own taps; misses fall through to here.
    const npBackdropBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(npN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(npN), _id: gid(),
    });

    // Scrim child — its UIOpacity is what AppUI tweens on show/hide so
    // the full-screen dim fades cleanly (and starts hidden so the panel's
    // first paint isn't a flash of black).
    const npBackdropN = sb.e.length;
    sb.node('NotifBackdrop', npN, [], [], v3(0, 0, 0));
    const npBackdropUT = sb.ut(npBackdropN, 720, 1280);
    const npBackdropSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(npBackdropN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 255), // Color is solid black; UIOpacity drives the alpha.
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const npBackdropOpacity = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(npBackdropN), _enabled: true, __prefab: null,
        _opacity: 0, _id: gid(),
    });
    sb.e[npBackdropN]._components = [rf(npBackdropUT), rf(npBackdropSpr), rf(npBackdropOpacity)];

    // Card container — 400×1280 anchored to right edge. restingX=160 ⇒
    // card right edge sits at canvas right edge (160 + 200 = 360).
    const npCardN = sb.e.length;
    sb.node('NotifPanelCard', npN, [], [], v3(NPC.restingX, 0, 0));
    const npCardUT = sb.ut(npCardN, NPC.w, NPC.h);
    const npCardSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(npCardN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(10, 4, 16, 255), // Palette.bg.primary
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[npCardN]._components = [rf(npCardUT), rf(npCardSpr)];

    // Header row — single line: title (left) · "Mark all read" (right of title) ·
    // close ✕ (corner). 2026-04-29 redesign dropped the per-item bulk-select
    // CTA; tap-a-card now marks that one read.
    const npHeader = mkLabel(sb, 'NotifHeaderLabel', npCardN, 'Notifications', 22,
        NPE.cardHeaderLabel.y, NPE.cardHeaderLabel.w, NPE.cardHeaderLabel.h, 255, 210, 74);
    sb.e[npHeader]._lpos = v3(NPE.cardHeaderLabel.x, NPE.cardHeaderLabel.y, 0);
    sb.e[sb.e[npHeader]._components[0].__id__]._anchorPoint = v2(0, 0.5); // left-anchor: label starts at _lpos.x, fits inside 400-wide card
    sb.e[sb.e[npHeader]._components[1].__id__]._horizontalAlign = 0; // left-align
    sb.e[sb.e[npHeader]._components[1].__id__]._isBold = true;
    const npCloseBtn = mkBtnXY(sb, 'NotifCloseButton', npCardN, '✕',
        NPE.cardCloseButton.x, NPE.cardCloseButton.y,
        NPE.cardCloseButton.w, NPE.cardCloseButton.h, 30, 36, 52,
        { tier: 'tertiary' });
    // Low-emphasis tertiary pill — small, dim, sits inline with the title.
    const npMarkAllBtn = mkBtnXY(sb, 'NotifMarkAllReadButton', npCardN, 'Mark all read',
        NPE.cardMarkAllReadButton.x, NPE.cardMarkAllReadButton.y,
        NPE.cardMarkAllReadButton.w, NPE.cardMarkAllReadButton.h, 30, 36, 52,
        { tier: 'tertiary' });

    // 1px divider beneath the header row.
    const npDividerN = sb.e.length;
    sb.node('NotifHeaderDivider', npCardN, [], [],
        v3(NPE.cardHeaderDivider.x, NPE.cardHeaderDivider.y, 0));
    const npDividerUT = sb.ut(npDividerN, NPE.cardHeaderDivider.w, NPE.cardHeaderDivider.h);
    const npDividerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(npDividerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 28),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[npDividerN]._components = [rf(npDividerUT), rf(npDividerSpr)];

    // List area — 8 reusable rows + 3 reusable group labels. AppUI
    // computes Y at runtime to interleave group labels above their rows.
    const npListN = sb.e.length;
    sb.node('NotifListContainer', npCardN, [], [],
        v3(NPE.listContainer.x, NPE.listContainer.y, 0));
    const npListUT = sb.ut(npListN, NPE.listContainer.w, NPE.listContainer.h);
    sb.e[npListN]._components = [rf(npListUT)];

    // Section labels — uppercase, low-emphasis (Palette.text.lo). AppUI
    // activates the relevant ones at render time and positions Y above
    // each group's first row.
    const groupSpecs = [
        { name: 'NotifGroupLabel_today',   spec: NPE.groupLabelToday,   text: 'TODAY' },
        { name: 'NotifGroupLabel_earlier', spec: NPE.groupLabelEarlier, text: 'EARLIER' },
    ];
    const npGroupLabelIndices = [];
    for (const { name, spec, text } of groupSpecs) {
        const gN = mkLabel(sb, name, npListN, text, 11, spec.y, spec.w, spec.h, 140, 140, 140);
        sb.e[gN]._lpos = v3(spec.x, spec.y, 0);
        sb.e[sb.e[gN]._components[1].__id__]._horizontalAlign = 0; // left-align
        sb.e[sb.e[gN]._components[1].__id__]._isBold = true;
        sb.e[gN]._active = false;
        npGroupLabelIndices.push(gN);
    }

    const npRowIndices = [];
    {
        const NR = LAYOUT.NotificationPanel.templates.notifRow;
        for (let i = 0; i < NR.count; i++) {
            const rN = sb.e.length;
            const ry = NR.baseY + i * NR.gapY;
            sb.node(`NotifRow_${i}`, npListN, [], [], v3(0, ry, 0));
            const rUT = sb.ut(rN, NR.w, NR.h);
            const rSpr = sb.spr(rN, 26, 8, 32); // dark slate card
            const rBtn = sb.add({
                __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(rN), _enabled: true, __prefab: null,
                _interactable: true, _transition: 0,
                _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
                _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
                _duration: 0.1, _zoomScale: 1.02, _target: rf(rN), _id: gid(),
            });
            // UIOpacity drives the read/unread fade — full alpha when unread,
            // ~70% when read. AppUI mutates this directly.
            const rOp = sb.add({
                __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(rN), _enabled: true, __prefab: null,
                _opacity: 255, _id: gid(),
            });
            // Icon container.
            const iconN = sb.e.length;
            sb.node(`NotifRowIcon_${i}`, rN, [], [], v3(NR.icon.x, NR.icon.y, 0));
            const iconUT = sb.ut(iconN, NR.icon.w, NR.icon.h);
            sb.e[iconN]._components = [rf(iconUT)];
            // Title — bold 16pt.
            const titleN = mkLabel(sb, `NotifRowTitleLabel_${i}`, rN, 'Title', 16, NR.title.y, NR.title.w, NR.title.h, 255, 255, 255);
            sb.e[titleN]._lpos = v3(NR.title.x, NR.title.y, 0);
            sb.e[sb.e[titleN]._components[1].__id__]._horizontalAlign = 0;
            sb.e[sb.e[titleN]._components[1].__id__]._isBold = true;
            // Body — 12pt, single line.
            const bodyN = mkLabel(sb, `NotifRowBodyLabel_${i}`, rN, 'Body', 12, NR.body.y, NR.body.w, NR.body.h, 184, 184, 184);
            sb.e[bodyN]._lpos = v3(NR.body.x, NR.body.y, 0);
            sb.e[sb.e[bodyN]._components[1].__id__]._horizontalAlign = 0;
            sb.e[sb.e[bodyN]._components[1].__id__]._overflow = 2;
            // Time-ago — 10pt muted, top-right corner.
            const timeN = mkLabel(sb, `NotifRowTimeLabel_${i}`, rN, '2m ago', 10, NR.time.y, NR.time.w, NR.time.h, 130, 140, 160);
            sb.e[timeN]._lpos = v3(NR.time.x, NR.time.y, 0);
            sb.e[sb.e[timeN]._components[1].__id__]._horizontalAlign = 2; // right-align
            // Unread dot — bottom-right, hidden when read.
            const dotN = sb.e.length;
            sb.node(`NotifRowUnreadDot_${i}`, rN, [], [], v3(NR.dot.x, NR.dot.y, 0));
            const dotUT = sb.ut(dotN, NR.dot.w, NR.dot.h);
            const dotSpr = sb.add({
                __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(dotN), _enabled: true, __prefab: null,
                _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
                _color: cl(20, 241, 149, 255),
                _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
                _type: 1, _fillType: 0, _sizeMode: 0,
                _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
                _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
                _id: gid(),
            });
            sb.e[dotN]._components = [rf(dotUT), rf(dotSpr)];
            // Right-edge accent — 3px teal stripe; visible only when unread.
            const edgeN = sb.e.length;
            sb.node(`NotifRowAccentEdge_${i}`, rN, [], [], v3(NR.accentEdge.x, NR.accentEdge.y, 0));
            const edgeUT = sb.ut(edgeN, NR.accentEdge.w, NR.accentEdge.h);
            const edgeSpr = sb.add({
                __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(edgeN), _enabled: true, __prefab: null,
                _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
                _color: cl(20, 241, 149, 255),
                _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
                _type: 1, _fillType: 0, _sizeMode: 0,
                _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
                _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
                _id: gid(),
            });
            sb.e[edgeN]._components = [rf(edgeUT), rf(edgeSpr)];
            sb.e[rN]._components = [rf(rUT), rf(rSpr), rf(rBtn), rf(rOp)];
            sb.e[rN]._children = [rf(iconN), rf(titleN), rf(bodyN), rf(timeN), rf(dotN), rf(edgeN)];
            sb.e[rN]._active = false;
            npRowIndices.push(rN);
        }
    }
    sb.e[npListN]._children = [...npGroupLabelIndices.map(rf), ...npRowIndices.map(rf)];

    // Empty-state group: centered icon + title + subtitle. Hidden when
    // any rows are visible. AppUI does IconLibrary.attach('bell') on the
    // icon container at start.
    const npEmptyN = sb.e.length;
    sb.node('NotifEmptyGroup', npCardN, [], [], v3(0, 0, 0));
    const npEmptyUT = sb.ut(npEmptyN, NPC.w, 400);
    sb.e[npEmptyN]._components = [rf(npEmptyUT)];
    const npEmptyIconN = sb.e.length;
    sb.node('NotifEmptyIcon', npEmptyN, [], [],
        v3(NPE.emptyIcon.x, NPE.emptyIcon.y, 0));
    const npEmptyIconUT = sb.ut(npEmptyIconN, NPE.emptyIcon.w, NPE.emptyIcon.h);
    sb.e[npEmptyIconN]._components = [rf(npEmptyIconUT)];
    const npEmptyTitleN = mkLabel(sb, 'NotifEmptyTitleLabel', npEmptyN,
        'No notifications yet', 16,
        NPE.emptyTitleLabel.y, NPE.emptyTitleLabel.w, NPE.emptyTitleLabel.h,
        255, 255, 255);
    style(sb, npEmptyTitleN, { bold: true });
    const npEmptySubL = mkLabel(sb, 'NotifEmptySubtitleLabel', npEmptyN,
        'Matches, wins, and updates will show here', 13,
        NPE.emptySubtitleLabel.y, NPE.emptySubtitleLabel.w, NPE.emptySubtitleLabel.h,
        184, 184, 184);
    sb.e[npEmptyN]._children = [rf(npEmptyIconN), rf(npEmptyTitleN), rf(npEmptySubL)];
    sb.e[npEmptyN]._active = false;

    sb.e[npCardN]._children = [
        rf(npHeader), rf(npCloseBtn), rf(npMarkAllBtn),
        rf(npDividerN), rf(npListN), rf(npEmptyN),
    ];
    sb.e[npN]._components = [rf(npUT), rf(npBackdropBtn)];
    sb.e[npN]._children = [rf(npBackdropN), rf(npCardN)];
    sb.e[npN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase N2 — NotificationToastOverlay (top-of-screen premium card).
    // 720×360 transparent container with 3 stacked toast slots (y=600/490/380).
    // Each slot is a 640×96 card with: color stripe · icon · title · body ·
    // dismiss · progress bar. AppUI's NotificationToastQueue paints + animates.
    // ═══════════════════════════════════════════════════════════════
    // Toast overlay + 3 slots from LAYOUT.NotificationToastOverlay.
    // Phase 9b: Title/Body labels shrunk + shifted to clear icon (left), dismiss
    // (right), and each other (top/bottom).
    const TO  = LAYOUT.NotificationToastOverlay.elements.overlay;
    const TS  = LAYOUT.NotificationToastOverlay.templates.toastSlot;
    const toastOvN = sb.e.length;
    sb.node('NotificationToastOverlay', canvas, [], [], v3(TO.x, TO.y, 0));
    sb.ut(toastOvN, TO.w, TO.h);
    // No backdrop sprite — fully transparent so taps fall through.
    const toastSlotIndices = [];
    for (let i = 0; i < TS.count; i++) {
        const slotN = sb.e.length;
        sb.node(`NotificationToastSlot_${i}`, toastOvN, [], [], v3(0, TS.ys[i], 0));
        const slotUT = sb.ut(slotN, TS.w, TS.h);
        // Card background — dark slate with subtle border feel via opacity.
        const slotBg = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(slotN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(16, 4, 24, 245),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        // Color stripe — left edge. AppUI tints per kind.
        const stripeN = sb.e.length;
        sb.node(`ToastColorStripe_${i}`, slotN, [], [], v3(TS.stripe.x, TS.stripe.y, 0));
        const stripeUT = sb.ut(stripeN, TS.stripe.w, TS.stripe.h);
        const stripeSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(stripeN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(153, 69, 255, 255), // default violet; AppUI overwrites per kind
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[stripeN]._components = [rf(stripeUT), rf(stripeSpr)];
        // Icon container — empty Node; IconLibrary.attach injects a Graphics + Label sibling.
        const iconN = sb.e.length;
        sb.node(`ToastIconContainer_${i}`, slotN, [], [], v3(TS.icon.x, TS.icon.y, 0));
        const iconUT = sb.ut(iconN, TS.icon.w, TS.icon.h);
        sb.e[iconN]._components = [rf(iconUT)];
        // Title — bold 18pt, single line.
        const titleN = mkLabel(sb, `ToastTitleLabel_${i}`, slotN, 'Title', 18, 18, TS.title.w, TS.title.h, 255, 255, 255);
        sb.e[titleN]._lpos = v3(TS.title.x, TS.title.y, 0);
        sb.e[sb.e[titleN]._components[1].__id__]._horizontalAlign = 0;
        sb.e[sb.e[titleN]._components[1].__id__]._isBold = true;
        // Body — regular 13pt, two-line.
        const bodyN = mkLabel(sb, `ToastBodyLabel_${i}`, slotN, 'Body line', 13, -10, TS.body.w, TS.body.h, 184, 184, 184);
        sb.e[bodyN]._lpos = v3(TS.body.x, TS.body.y, 0);
        sb.e[sb.e[bodyN]._components[1].__id__]._horizontalAlign = 0;
        sb.e[sb.e[bodyN]._components[1].__id__]._overflow = 2; // ENABLE_RESIZE_HEIGHT
        // Dismiss button — full right-edge tap area.
        const dismissN = mkBtnXY(sb, `ToastDismissButton_${i}`, slotN, '✕',
            TS.dismiss.x, TS.dismiss.y, TS.dismiss.w, TS.dismiss.h, 30, 36, 52);
        // Progress bar — bottom strip, scaleX shrinks 1→0 over duration.
        const progN = sb.e.length;
        sb.node(`ToastProgressBar_${i}`, slotN, [], [], v3(TS.progress.x, TS.progress.y, 0));
        const progUT = sb.ut(progN, TS.progress.w, TS.progress.h);
        const progSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(progN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(48, 198, 155, 200),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[progN]._components = [rf(progUT), rf(progSpr)];
        sb.e[slotN]._components = [rf(slotUT), rf(slotBg)];
        sb.e[slotN]._children = [rf(stripeN), rf(iconN), rf(titleN), rf(bodyN), rf(dismissN), rf(progN)];
        sb.e[slotN]._active = false;
        toastSlotIndices.push(slotN);
    }
    sb.e[toastOvN]._children = toastSlotIndices.map(rf);
    // _active stays true — overlay container is always on, individual slots toggle.

    // 2026-04-29 — racePanelN sits above all content panels but below
    // gameplay overlays (countdown/signing/loading/levelup/notification).
    // Re-parented from tdN to canvas root so lobbyMount() applies in the
    // correct coordinate space and the 1800-tall scrim covers full screen.
    sb.e[canvas]._children = [rf(camN), rf(bgN), rf(fxN), rf(mwaN), rf(lpN), rf(hpN), rf(tdN), rf(tdetN), rf(lbN), rf(dcN), rf(pfN), rf(mipN), rf(wpN), rf(pmN), rf(stN), rf(tutN), rf(specN), rf(tourN), rf(fmN), rf(jcN), rf(lsoN), rf(racePanelN), rf(countdownN), rf(signingN), rf(loadingN), rf(luN), rf(npN), rf(toastOvN)];
    sb.e[canvas]._components = [rf(cUT), rf(cCV), rf(cWG), rf(appUI)];

    // Scene Globals
    const gl = sb.globals();
    sb.e[1]._globals = rf(gl);

    return sb.toJSON();
}

// Write single scene
const out = path.join(__dirname, 'assets', 'demo', 'scenes');
fs.mkdirSync(out, { recursive: true });

// Remove old scenes
try { fs.unlinkSync(path.join(out, 'Landing.scene')); } catch(e){}
try { fs.unlinkSync(path.join(out, 'Home.scene')); } catch(e){}

// Write new single scene
fs.writeFileSync(path.join(out, 'Main.scene'), generate());
console.log('Generated Main.scene (single scene with Landing + Home panels)');
console.log('Old Landing.scene and Home.scene removed');

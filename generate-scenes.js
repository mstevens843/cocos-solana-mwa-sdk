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
const { Palette: P, ButtonVariants: BV, rgba } = Theme;
// rgb-tuple helpers — pull from a Theme variant.
const VAR = (name) => BV[name]?.normal ?? BV.primary.normal;

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
const TEXT_HI = () => cl(244, 245, 249, 255); // Palette.text.hi
// Phase 15 (B5): mid + lo tier helpers for the 3-tier text hierarchy.
const TEXT_MID = () => cl(168, 174, 201, 255); // Palette.text.mid — secondary
const TEXT_LO  = () => cl(93,  100, 133, 255); // Palette.text.lo  — tertiary / muted

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
    return { linkN, btnN };
}

function mkBtn(sb, name, parent, text, y, w=500, h=75, br=60, bg=120, bb=200) {
    const bn=sb.e.length;
    const tHN=bn+1, bSN=bn+2, ln=bn+3, bu=bn+4, sp=bn+5, bt=bn+6;
    const tHUt=bn+7, tHSp=bn+8, bSUt=bn+9, bSSp=bn+10, lUt=bn+11, ll=bn+12;
    const fontSize = Math.max(26, Math.round(h*0.34));
    sb.node(name, parent, [tHN, bSN, ln], [bu, sp, bt], v3(0, y, 0));
    sb.node('TopHighlight', bn, [], [tHUt, tHSp], v3(0, h * 0.30, 0));
    sb.node('BottomShadow', bn, [], [bSUt, bSSp], v3(0, -h * 0.42, 0));
    sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
    sb.ut(bn, w, h); sb.spr(bn, br, bg, bb); sb.btn(bn, br, bg, bb);
    sb.ut(tHN, w - 4, h * 0.40); sb.spr(tHN, 255, 255, 255);
    sb.e[tHSp]._color = cl(255, 255, 255, 52); // 20% white — top lift
    sb.ut(bSN, w - 4, h * 0.16); sb.spr(bSN, 0, 0, 0);
    sb.e[bSSp]._color = cl(0, 0, 0, 46); // 18% black — bottom depth
    sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
    // Polish 2026-04-26: SHRINK so labels (e.g. "Newest", "Top Gainers") never
    // exceed the button rect. Without this, long words bleed past the bg sprite
    // and the active-state highlight visibly clips text.
    sb.e[ll]._overflow = 2;
    return bn;
}

function mkBtnXY(sb, name, parent, text, x, y, w=500, h=75, br=60, bg=120, bb=200) {
    const bn=sb.e.length;
    const tHN=bn+1, bSN=bn+2, ln=bn+3, bu=bn+4, sp=bn+5, bt=bn+6;
    const tHUt=bn+7, tHSp=bn+8, bSUt=bn+9, bSSp=bn+10, lUt=bn+11, ll=bn+12;
    const fontSize = Math.max(22, Math.round(h*0.34));
    sb.node(name, parent, [tHN, bSN, ln], [bu, sp, bt], v3(x, y, 0));
    sb.node('TopHighlight', bn, [], [tHUt, tHSp], v3(0, h * 0.30, 0));
    sb.node('BottomShadow', bn, [], [bSUt, bSSp], v3(0, -h * 0.42, 0));
    sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
    sb.ut(bn, w, h); sb.spr(bn, br, bg, bb); sb.btn(bn, br, bg, bb);
    sb.ut(tHN, w - 4, h * 0.40); sb.spr(tHN, 255, 255, 255);
    sb.e[tHSp]._color = cl(255, 255, 255, 52);
    sb.ut(bSN, w - 4, h * 0.16); sb.spr(bSN, 0, 0, 0);
    sb.e[bSSp]._color = cl(0, 0, 0, 46);
    sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
    // Polish 2026-04-26: see mkBtn — SHRINK long labels to button rect.
    sb.e[ll]._overflow = 2;
    return bn;
}

// Phase 13 (B3): hero CTA — adds a brand-color glow halo behind the button.
// The halo is a sibling rendered FIRST (before the button) so it appears
// behind. Default 12-px bleed on every side, alpha 80, tinted the button's
// own brand color. V2: callers can pass `opts.glowAlpha` and `opts.glowPad`
// to tier the glow intensity per CTA hierarchy (Start > Find > Bot).
// Returns { glow, btn, ripple }.
function mkBtnHero(sb, name, parent, text, x, y, w, h, br, bg, bb, opts) {
    const glowAlpha = (opts && typeof opts.glowAlpha === 'number') ? opts.glowAlpha : 80;
    const glowPad   = (opts && typeof opts.glowPad   === 'number') ? opts.glowPad   : 12;
    // Halo sibling — w+pad*2, h+pad*2, brand-color at the chosen alpha.
    const glowN = sb.e.length;
    sb.node(`BtnGlow_${name}`, parent, [], [], v3(x, y, 0));
    const glowUT = sb.ut(glowN, w + glowPad * 2, h + glowPad * 2);
    const glowSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(glowN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(br, bg, bb, glowAlpha),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[glowN]._components = [rf(glowUT), rf(glowSpr)];
    // Actual button.
    const btnN = mkBtnXY(sb, name, parent, text, x, y, w, h, br, bg, bb);
    // Phase 18 — ripple-on-click child sprite. AppUI's ButtonFX.addRipple
    // activates + tweens scale/opacity on CLICK. Initially _active=false +
    // alpha 0 so it's invisible until tapped. Sized = button size; sits
    // centered (0,0) inside the button.
    const rippleN = sb.e.length;
    sb.node(`Ripple_${name}`, btnN, [], [], v3(0, 0, 0));
    const rippleUT = sb.ut(rippleN, w, h);
    const rippleSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(rippleN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 0),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
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
    const ghost = opts.ghost === true;
    const haloAlpha = opts.haloAlpha ?? 80;
    const hasGradient = opts.gradient === true;
    const bodyR = ghost ? 21 : br, bodyG = ghost ? 25 : bg, bodyB = ghost ? 41 : bb;
    const titleR = ghost ? br : 255, titleG = ghost ? bg : 255, titleB = ghost ? bb : 255;
    const subAlpha = 220;
    const titleFs = Math.max(24, Math.round(h * 0.28));
    const subFs   = Math.max(14, Math.round(h * 0.16));

    // Glow halo sibling — added BEFORE button body so it renders behind.
    let glowN = -1;
    if (!ghost) {
        glowN = sb.e.length;
        sb.node(`BtnGlow_${name}`, parent, [], [], v3(x, y, 0));
        const glowUT  = sb.ut(glowN, w + 24, h + 24);
        const glowSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(glowN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(br, bg, bb, haloAlpha),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
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

    sb.ut(bn, w, h); sb.spr(bn, bodyR, bodyG, bodyB); sb.btn(bn, bodyR, bodyG, bodyB);
    sb.ut(tHN, w - 4, h * 0.40); sb.spr(tHN, 255, 255, 255);
    sb.e[tHSp]._color = cl(255, 255, 255, ghost ? 24 : 52);
    sb.ut(bSN, w - 4, h * 0.16); sb.spr(bSN, 0, 0, 0);
    sb.e[bSSp]._color = cl(0, 0, 0, ghost ? 22 : 46);
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
    const rippleN = sb.e.length;
    sb.node(`Ripple_${name}`, bn, [], [], v3(0, 0, 0));
    const rippleUT = sb.ut(rippleN, w, h);
    const rippleSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(rippleN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 255, 255, 0),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
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
    const eUT = sb.ut(eN, w - 4, 4);
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
        12, w - 4, 14, 93, 100, 133);
    style(sb, keyN, { spacing: 1 });
    const valN = mkLabel(sb, `${prefix}ChipVal_${baseName}`, cN, valText, valFs,
        -10, w - 4, 22, 244, 245, 249);
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

    // 2026-04-27 UX upgrade — vertical depth gradient (deep-purple top →
    // near-black bottom). 3-stack opacity falloff per band, mirrors the
    // BackgroundGlow_TopLeft_Outer/Mid/Inner pattern. White-square sprites
    // tinted with Palette.bg.gradientTop / gradientBot.
    const gradTop = Theme.rgba(P.bg.gradientTop);
    const gradBot = Theme.rgba(P.bg.gradientBot);
    const mkLandingPlate = (name, spec, r, g, b, a) => {
        const n = sb.e.length;
        sb.node(name, lpN, [], [], v3(spec.x, spec.y, 0));
        const ut = sb.ut(n, spec.w, spec.h);
        const sp = sb.spr(n, r, g, b);
        sb.e[sp]._color = cl(r, g, b, a);
        sb.e[n]._components = [rf(ut), rf(sp)];
        return n;
    };
    const bgGradTopOuter = mkLandingPlate('BgGradientTopOuter', LE.bgGradientTopOuter, gradTop.r, gradTop.g, gradTop.b, 18);
    const bgGradTopMid   = mkLandingPlate('BgGradientTopMid',   LE.bgGradientTopMid,   gradTop.r, gradTop.g, gradTop.b, 40);
    const bgGradTopInner = mkLandingPlate('BgGradientTopInner', LE.bgGradientTopInner, gradTop.r, gradTop.g, gradTop.b, 80);
    const bgGradBotOuter = mkLandingPlate('BgGradientBotOuter', LE.bgGradientBotOuter, gradBot.r, gradBot.g, gradBot.b, 22);
    const bgGradBotMid   = mkLandingPlate('BgGradientBotMid',   LE.bgGradientBotMid,   gradBot.r, gradBot.g, gradBot.b, 55);
    const bgGradBotInner = mkLandingPlate('BgGradientBotInner', LE.bgGradientBotInner, gradBot.r, gradBot.g, gradBot.b, 110);

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

    const title = mkLabel(sb, 'TitleLabel', lpN, 'Token Duel',
        64, LE.title.y, LE.title.w, LE.title.h);
    // 2026-04-27 UX upgrade — letter-spacing for more "decided" feel.
    style(sb, title, { bold: true, color: GOLD(), spacing: 2 });

    // 2026-04-27 UX upgrade — sharper subtitle copy + slightly smaller (24 → 22).
    const sub = mkLabel(sb, 'SubtitleLabel', lpN, 'Outperform. Or get outperformed.',
        22, LE.subtitle.y, LE.subtitle.w, LE.subtitle.h, 168, 174, 201);

    // 2026-04-27 UX upgrade — violet radial bloom behind mascot. Sized 440×440
    // (vs mascot 280×280) so it spills 80px past the mascot on every side.
    const mascotGlow = sb.e.length;
    sb.node('MascotGlow', lpN, [], [], v3(LE.mascotGlow.x, LE.mascotGlow.y, 0));
    const mascotGlowUT  = sb.ut(mascotGlow, LE.mascotGlow.w, LE.mascotGlow.h);
    const mascotGlowSpr = sb.spr(mascotGlow, 153, 69, 255);
    sb.e[mascotGlowSpr]._color = cl(153, 69, 255, 80);
    sb.e[mascotGlow]._components = [rf(mascotGlowUT), rf(mascotGlowSpr)];

    // 2026-04-27 UX upgrade — flat dark ellipse below mascot for grounding.
    const mascotShadow = sb.e.length;
    sb.node('MascotShadow', lpN, [], [], v3(LE.mascotShadow.x, LE.mascotShadow.y, 0));
    const mascotShadowUT  = sb.ut(mascotShadow, LE.mascotShadow.w, LE.mascotShadow.h);
    const mascotShadowSpr = sb.spr(mascotShadow, 0, 0, 0);
    sb.e[mascotShadowSpr]._color = cl(0, 0, 0, 90);
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
    const cardBgSpr = sb.spr(cardBgN, 30, 36, 56);
    sb.e[cardBgSpr]._color = cl(30, 36, 56, 130); // bg.card #1E2438 @ ~51%
    sb.e[cardBgN]._components = [rf(cardBgUT), rf(cardBgSpr)];
    const cardEdgeN = mkCardEdge(sb, cardBgN, LE.ctaCardBg.w, LE.ctaCardBg.h, 153, 69, 255, 140);
    sb.e[cardBgN]._children = [rf(cardEdgeN)];

    // ── Action stack ────────────────────────────────────────────────
    // PRIMARY — Enter the Duel (gold, matches the title color above).
    // 2026-04-28 hackathon UX — copy upgrade "Play Token Duel" → "Enter the
    // Duel" (game-first command verb). Subtitle "Stake SOL · Win SOL" stays.
    const { glow: connectGlow, btn: connectBtn } = mkBtnHeroLayered(sb,
        'ConnectButton', lpN,
        'Enter the Duel', 'Stake SOL · Win SOL',
        LE.connectBtn.x, LE.connectBtn.y, LE.connectBtn.w, LE.connectBtn.h,
        255, 210, 74,
        { gradient: true, haloAlpha: 100 });

    // Right-aligned chevron — directional cue. Child of ConnectButton.
    const chevronN = sb.e.length;
    sb.node('ConnectChevron', connectBtn, [], [chevronN+1, chevronN+2],
        v3(LE.connectChevron.x, 0, 0));
    sb.ut(chevronN, LE.connectChevron.w, LE.connectChevron.h);
    sb.lbl(chevronN, '›', 38, 255, 255, 255);
    sb.e[chevronN+2]._color = cl(255, 255, 255, 230);
    style(sb, chevronN, { bold: true });
    sb.e[connectBtn]._children = [...(sb.e[connectBtn]._children ?? []), rf(chevronN)];

    // Trust line — directly under Connect, inside card. Small + muted.
    // 2026-04-27 UX upgrade — green-tinted (150, 220, 180) for subtle
    // reassurance accent (was neutral text.mid 168/174/201).
    // 2026-04-28 hackathon UX — font 14 → 12 to reduce visual weight (now
    // shares space with new LiveSignal label below).
    const trustLine = mkLabel(sb, 'TrustLineLabel', lpN,
        '🔒  Secure · Non-custodial · You control your wallet',
        12, LE.trustLine.y, LE.trustLine.w, LE.trustLine.h, 150, 220, 180);

    // 2026-04-28 hackathon UX — "live system" sub-CTA cue between trust line
    // and Guest button. Teal-tinted (20, 241, 149 ≈ Theme.accent.teal). Static —
    // no RPC dependency on first paint. Goal: instant signal that this is a
    // live, populated game.
    // 2026-04-28 polish — emoji replaced with a live Sprite dot whose alpha
    // pulses at runtime via LandingFX.addGlowPulse for "alive" cue.
    const liveSignal = mkLabel(sb, 'LiveSignalLabel', lpN,
        'Live now · Join in seconds',
        12, LE.liveSignalLabel.y, LE.liveSignalLabel.w, LE.liveSignalLabel.h, 20, 241, 149);

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
    const { btn: reconnBtn } = mkBtnHeroLayered(sb,
        'ReconnectButton', lpN,
        '⟳  Reconnect', 'Continue with saved wallet',
        LE.reconnBtn.x, LE.reconnBtn.y, LE.reconnBtn.w, LE.reconnBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { ghost: true });
    sb.e[reconnBtn]._active = false;

    // TERTIARY — Play as Guest (teal, DIM halo so it visibly defers).
    const { glow: guestGlow, btn: guestBtn } = mkBtnHeroLayered(sb,
        'PlayAsGuestButton', lpN,
        '👤  Play as Guest', 'Practice with bots · no wallet needed',
        LE.playAsGuestBtn.x, LE.playAsGuestBtn.y, LE.playAsGuestBtn.w, LE.playAsGuestBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { haloAlpha: 40 });

    // ── Footer ──────────────────────────────────────────────────────
    const statusPill = mkPill(sb, 'ConnectionStatusPill', lpN, '● Disconnected',
        LE.connectionStatusPill.x, LE.connectionStatusPill.y,
        LE.connectionStatusPill.w, LE.connectionStatusPill.h);

    // Patch LandingPanel children — render order matters.
    // 2026-04-27 UX upgrade — gradient bands render FIRST (deepest behind),
    // then mascot glow + shadow + title glow as decorative anchors,
    // then content + CTA stack on top.
    sb.e[lpN]._children = [
        // Depth gradient (bottom-most)
        rf(bgGradTopOuter), rf(bgGradTopMid), rf(bgGradTopInner),
        rf(bgGradBotOuter), rf(bgGradBotMid), rf(bgGradBotInner),
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
        HE.walletNameLabel.y, HE.walletNameLabel.w, HE.walletNameLabel.h, 168, 174, 201);
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
        HE.homeXpProgressLabel.y, HE.homeXpProgressLabel.w, HE.homeXpProgressLabel.h, 244, 245, 249);
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
        HE.homeLastResultLabel.y, HE.homeLastResultLabel.w, HE.homeLastResultLabel.h, 93, 100, 133);
    sb.e[lastResultLabel]._lpos = v3(HE.homeLastResultLabel.x, HE.homeLastResultLabel.y, 0);
    {
        const lblComp = sb.e[sb.e[lastResultLabel]._components[1].__id__];
        lblComp._horizontalAlign = 0; // left
    }
    style(sb, lastResultLabel, { spacing: 2 });

    // V5 — outcome label "WON" / "LOST" / "—". Color tinted at runtime.
    const lastResultOutcome = mkLabel(sb, 'HomeLastResultOutcome', matchTickerN, '—', 22,
        HE.homeLastResultOutcome.y, HE.homeLastResultOutcome.w, HE.homeLastResultOutcome.h, 168, 174, 201);
    sb.e[lastResultOutcome]._lpos = v3(HE.homeLastResultOutcome.x, HE.homeLastResultOutcome.y, 0);
    style(sb, lastResultOutcome, { bold: true });
    {
        const lblComp = sb.e[sb.e[lastResultOutcome]._components[1].__id__];
        lblComp._horizontalAlign = 0; // left
    }

    // V5 — delta SOL "+0.10 SOL" / "-0.05 SOL". Right-aligned, same color as outcome.
    const lastResultDelta = mkLabel(sb, 'HomeLastResultDelta', matchTickerN, '—', 22,
        HE.homeLastResultDelta.y, HE.homeLastResultDelta.w, HE.homeLastResultDelta.h, 168, 174, 201);
    sb.e[lastResultDelta]._lpos = v3(HE.homeLastResultDelta.x, HE.homeLastResultDelta.y, 0);
    style(sb, lastResultDelta, { bold: true });
    {
        const lblComp = sb.e[sb.e[lastResultDelta]._components[1].__id__];
        lblComp._horizontalAlign = 2; // right
    }

    // V5 — meta line "1v1 · 0.10 stake · 12m ago" 12pt muted (bottom row).
    const lastResultMeta = mkLabel(sb, 'HomeLastResultMeta', matchTickerN, 'No recent matches', 12,
        HE.homeLastResultMeta.y, HE.homeLastResultMeta.w, HE.homeLastResultMeta.h, 168, 174, 201);
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
            subtitleSpec.y, subtitleSpec.w, subtitleSpec.h, 244, 245, 249);
        sb.e[subN]._lpos = v3(subtitleSpec.x, subtitleSpec.y, 0);
        const chevN = mkLabel(sb, chevronName, btnN, '›', 28,
            chevronSpec.y, chevronSpec.w, chevronSpec.h, 244, 245, 249);
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

    // Find Match — V4 HERO (instant play).
    const { glow: findMatchGlow, btn: findMatch } = mkBtnHero(sb,
        'FindMatchButton', hpN, 'Find Match',
        HE.findMatchBtn.x, HE.findMatchBtn.y, HE.findMatchBtn.w, HE.findMatchBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b,
        { glowAlpha: 110, glowPad: 16 });
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
    const findMatchBadgeLbl = mkLabel(sb, 'FindMatchButtonCountLabel', findMatchBadgeN, '0', 16, 0, 70, 32, 11, 14, 26);
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

    // V4 — Start Match demoted to secondary purple (was hero, now h=96 below FindMatch).
    const { glow: startMatchGlow, btn: startMatch } = mkBtnHero(sb,
        'StartMatchButton', hpN, 'Start Match',
        HE.startMatchBtn.x, HE.startMatchBtn.y, HE.startMatchBtn.w, HE.startMatchBtn.h,
        VAR('primary').r, VAR('primary').g, VAR('primary').b,
        { glowAlpha: 70, glowPad: 12 });
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

    // V4 — Matches In Progress NEUTRAL (charcoal/ghost, no glow halo).
    const mipColor = P.bg.card; // dark slate #1E2438 — true neutral, distinct from teal/violet/gold.
    const { glow: mipGlow, btn: mipBtn } = mkBtnHero(sb,
        'MatchesInProgressButton', hpN, 'Matches In Progress',
        HE.matchesInProgressBtn.x, HE.matchesInProgressBtn.y, HE.matchesInProgressBtn.w, HE.matchesInProgressBtn.h,
        mipColor.r, mipColor.g, mipColor.b,
        { ghost: true });
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
    const mipBadgeLbl = mkLabel(sb, 'MatchesInProgressCountLabel', mipBadgeN, '0', 14, 0, 60, 28, 11, 14, 26);
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
        { glowAlpha: 60, glowPad: 10 });

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
        HE.botMatchSubtitleLine2.y, HE.botMatchSubtitleLine2.w, HE.botMatchSubtitleLine2.h, 168, 174, 201);
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
        HE.homeStatus.y, HE.homeStatus.w, HE.homeStatus.h, 93, 100, 133);
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
    //   chrome bg (28, 34, 48)  — search, dropdown, chips idle
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
    const tdTitleBg = sb.e.length;
    sb.node('TitleBgSprite', tdN, [], [], v3(0, TDE.title.y, 0));
    const tdTitleBgUT = sb.ut(tdTitleBg, 720, 56);
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

    const tdTitle = mkLabel(sb, 'TitleLabel', tdN, 'Token Duel', 32,
        TDE.title.y, TDE.title.w, TDE.title.h, 218, 165, 32);
    style(sb, tdTitle, { bold: true });

    // ── 2026-04-27 UI overhaul — header underline ──────────────────────
    // Thin violet glow line under the title, anchoring the header band so
    // it stops feeling like floating chrome. Solana violet at 80 alpha.
    const tdHeaderUnderline = sb.e.length;
    sb.node('HeaderUnderline', tdN, [], [],
        v3(TDE.headerUnderline.x, TDE.headerUnderline.y, 0));
    const tdHUUT = sb.ut(tdHeaderUnderline,
        TDE.headerUnderline.w, TDE.headerUnderline.h);
    const tdHUSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdHeaderUnderline), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(153, 69, 255, 90),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdHeaderUnderline]._components = [rf(tdHUUT), rf(tdHUSpr)];

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

    // ── 2026-04-26 redesign — Match Setup Summary Card ─────────────────
    // Multi-line state card under the title: mode tag + squad/stake/hint.
    // 4 child labels populated by AppUI._refreshSquadActionButtons.
    const MSC = TDE.matchSetupCard;
    const matchSetupCardN = sb.e.length;
    sb.node('MatchSetupCard', tdN, [], [], v3(MSC.x, MSC.y, 0));
    const mscUT = sb.ut(matchSetupCardN, MSC.w, MSC.h);
    const mscSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(matchSetupCardN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(30, 36, 56, 180),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const mscModeTag = mkLabel(sb, 'MatchSetupModeTag', matchSetupCardN, 'TOKEN DUEL · 1V1', 14, 32,
        220, 18, 168, 174, 201);
    sb.e[mscModeTag]._lpos = v3(-180, 32, 0);
    sb.e[sb.e[mscModeTag]._components[1].__id__]._horizontalAlign = 0;
    sb.e[sb.e[mscModeTag]._components[1].__id__]._spacingX = 1;
    const mscSquadLbl = mkLabel(sb, 'MatchSetupSquadLabel', matchSetupCardN, 'Squad: 0/3', 22, 0,
        260, 28, 244, 245, 249);
    sb.e[mscSquadLbl]._lpos = v3(-180, 0, 0);
    sb.e[sb.e[mscSquadLbl]._components[1].__id__]._horizontalAlign = 0;
    sb.e[sb.e[mscSquadLbl]._components[1].__id__]._isBold = true;
    const mscStakeLbl = mkLabel(sb, 'MatchSetupStakeLabel', matchSetupCardN, 'Stake: 0.05 SOL', 22, 0,
        260, 28, 255, 210, 74);
    sb.e[mscStakeLbl]._lpos = v3(180, 0, 0);
    sb.e[sb.e[mscStakeLbl]._components[1].__id__]._horizontalAlign = 2;
    style(sb, mscStakeLbl, { mono: true, bold: true });
    const mscHintLbl = mkLabel(sb, 'MatchSetupHintLabel', matchSetupCardN, 'Pick 3 tokens to start', 18, -32,
        620, 22, 20, 241, 149);
    sb.e[sb.e[mscHintLbl]._components[1].__id__]._isBold = true;
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
        _color: cl(93, 100, 133, 80),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mscReadyGlowN]._components = [rf(mscReadyUT), rf(mscReadySpr)];
    sb.e[matchSetupCardN]._components = [rf(mscUT), rf(mscSpr)];
    sb.e[matchSetupCardN]._children = [rf(mscModeTag), rf(mscSquadLbl), rf(mscStakeLbl), rf(mscHintLbl), rf(mscEdge), rf(mscReadyGlowN)];

    // 2026-04-26 unified card frame — wraps Row 1 (search/tabs/star/live) +
    // Row 2 (filter chips) + column headers + FeedScrollView in a single
    // dark card with a teal accent edge. Rendered BEFORE all of its visually
    // contained siblings in the panel children list (added below).
    const tdFrameCard = sb.e.length;
    sb.node('FeedFrameCardSprite', tdN, [], [],
        v3(TDE.feedFrameCard.x, TDE.feedFrameCard.y, 0));
    const tdFrameCardUT = sb.ut(tdFrameCard, TDE.feedFrameCard.w, TDE.feedFrameCard.h);
    const tdFrameCardSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdFrameCard), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(14, 18, 28, 235),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[tdFrameCard]._components = [rf(tdFrameCardUT), rf(tdFrameCardSpr)];
    const tdFrameCardEdge = mkCardEdge(sb, tdFrameCard,
        TDE.feedFrameCard.w, TDE.feedFrameCard.h, 48, 198, 155);
    sb.e[tdFrameCard]._children = [rf(tdFrameCardEdge)];

    // Search input + clear button. 2026-04-26 unified — search dropped to
    // 312×44 to share Row 1 with the Trending dropdown, star icon, and LIVE.
    const tdSearch = mkEditBox(sb, 'SearchEditBox', tdN, 'Search token by symbol or mint…',
        TDE.search.x, TDE.search.y, TDE.search.w, TDE.search.h, 17);
    const tdSearchAccent = sb.e.length;
    sb.node('SearchAccentEdge', tdN, [], [], v3(TDE.search.x, TDE.search.y - TDE.search.h / 2 + 2, 0));
    const tdSearchAccentUT = sb.ut(tdSearchAccent, TDE.search.w - 8, 3);
    const tdSearchAccentSpr = sb.spr(tdSearchAccent, 48, 198, 155);
    sb.e[tdSearchAccent]._components = [rf(tdSearchAccentUT), rf(tdSearchAccentSpr)];
    const tdSearchClear = mkBtnXY(sb, 'SearchClearButton', tdN, '×',
        TDE.searchClear.x, TDE.searchClear.y, TDE.searchClear.w, TDE.searchClear.h, 45, 55, 72);
    sb.e[tdSearchClear]._active = false;

    // Header-chrome row: dropdown · watchlist star · live indicator.
    const tabY = TDE.feedTabDropdown.y;
    const tdTabDropdown = mkBtnXY(sb, 'FeedTabDropdownButton', tdN, 'New Pairs  ▾',
        TDE.feedTabDropdown.x, TDE.feedTabDropdown.y, TDE.feedTabDropdown.w, TDE.feedTabDropdown.h,
        28, 34, 48);
    // 2026-04-26 unified card — Watchlist is now an icon-only ★ button
    // (44×44). Empty label string; AppUI attaches the star via IconLibrary
    // centered (offsetX=0) at size 32 inside the smaller button.
    const tdWatchStar = mkBtnXY(sb, 'WatchlistStarButton', tdN, '',
        TDE.watchlistStar.x, TDE.watchlistStar.y, TDE.watchlistStar.w, TDE.watchlistStar.h,
        28, 34, 48);
    const tdWatchCancel = mkBtnXY(sb, 'CancelWatchlistButton', tdN, '✕',
        TDE.cancelWatchlist.x, TDE.cancelWatchlist.y, TDE.cancelWatchlist.w, TDE.cancelWatchlist.h,
        55, 30, 30);
    sb.e[tdWatchCancel]._active = false;
    const tdLiveLbl = mkLabel(sb, 'LiveIndicatorLabel', tdN, '●  LIVE', 14,
        TDE.liveIndicator.y, TDE.liveIndicator.w, TDE.liveIndicator.h, 48, 198, 155);
    sb.e[tdLiveLbl]._lpos = v3(TDE.liveIndicator.x, TDE.liveIndicator.y, 0);
    style(sb, tdLiveLbl, { spacing: 1 });  // Phase 15 (B5): tracked uppercase

    // FeedTabDropdownPopover — 6 options from LAYOUT.TokenDuelPanel.templates.feedTabOption.
    // UX Phase 2b: emoji stripped; AppUI attaches per-row IconBadges (bolt/flame/chart/chart/brain/star).
    const FTDP = TDE.feedTabDropdownPopover;
    const FTO  = TDT.feedTabOption;
    const popN = sb.e.length;
    sb.node('FeedTabDropdownPopover', tdN, [], [], v3(FTDP.x, FTDP.y, 0));
    const popUT = sb.ut(popN, FTDP.w, FTDP.h);
    const popSpr = sb.spr(popN, 18, 24, 36);
    const popOptIndices = [];
    for (let p = 0; p < FTO.count; p++) {
        const optN = mkBtnXY(sb, `FeedTabOption_${FTO.keys[p]}`, popN, FTO.labels[p],
            0, FTO.ys[p], FTO.w, FTO.h, 28, 34, 48);
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
            cx, FFC.y, FFC.w, FFC.h, 28, 34, 48);
        chipIndices.push(cN);
    }
    const chipY = FFC.y;
    const chipH = FFC.h;
    // [All ▾] = MinLiq dropdown trigger (label morphs at runtime to active value).
    const tdMinLiqBtn = mkBtnXY(sb, 'MinLiqDropdownButton', tdN, 'All  ▾',
        TDE.minLiqDropdown.x, TDE.minLiqDropdown.y, TDE.minLiqDropdown.w, TDE.minLiqDropdown.h,
        28, 34, 48);
    // [Cols ±] = Columns toggle. Renamed 2026-04-26 — keeps "Cols" text with ± on right
    // for clearer "open columns picker" semantics (was "⋮  Cols").
    const tdColumnsBtn = mkBtnXY(sb, 'ColumnsButton', tdN, 'Cols  ±',
        TDE.columnsBtn.x, TDE.columnsBtn.y, TDE.columnsBtn.w, TDE.columnsBtn.h,
        28, 34, 48);

    // MinLiq popover — 4 options from LAYOUT.TokenDuelPanel.templates.minLiqOption.
    const MLP = TDE.minLiqDropdownPopover;
    const MLO = TDT.minLiqOption;
    const minLiqPopN = sb.e.length;
    sb.node('MinLiqDropdownPopover', tdN, [], [], v3(MLP.x, MLP.y, 0));
    const minLiqPopUT = sb.ut(minLiqPopN, MLP.w, MLP.h);
    const minLiqPopSpr = sb.spr(minLiqPopN, 18, 24, 36);
    const minLiqOptIndices = [];
    for (let m = 0; m < MLO.count; m++) {
        const oN = mkBtnXY(sb, `MinLiqOption_${MLO.keys[m]}`, minLiqPopN, MLO.labels[m],
            0, MLO.ys[m], MLO.w, MLO.h, 28, 34, 48);
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
    const liqSortPopSpr = sb.spr(liqSortPopN, 18, 24, 36);
    const liqSortOptIndices = [];
    for (let m = 0; m < LSO.count; m++) {
        const oN = mkBtnXY(sb, `LiqSortOption_${LSO.keys[m]}`, liqSortPopN, LSO.labels[m],
            0, LSO.ys[m], LSO.w, LSO.h, 28, 34, 48);
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
    const colPopSpr = sb.spr(colPopN, 18, 24, 36);
    const colPopIndices = [];
    for (let k = 0; k < CT.count; k++) {
        const cY = CT.startY - k * CT.rowH;
        const cN = mkBtnXY(sb, `ColToggle_${CT.keys[k]}`, colPopN, `✓  ${CT.labels[k]}`,
            0, cY, CT.w, CT.h, 28, 34, 48);
        colPopIndices.push(cN);
    }
    const colPopHintN = mkLabel(sb, 'ColMaxHintLabel', colPopN, 'Max 6 columns', 10,
        CPH.y, CPH.w, CPH.h, 100, 110, 130);
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
        const hN = mkLabel(sb, `ColHeader_${d.key}`, headerGroupN, d.text, 14, 0, d.w, FCH.h, 168, 174, 201);
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
        const symL  = sb.lbl(symN, '—', 22, 244, 245, 249);
        sb.e[symL]._horizontalAlign = 0;
        sb.e[symL]._isBold = true;
        sb.e[symN]._components = [rf(symUT), rf(symL)];

        // NameLabel — bottom line, muted. fontSize 11→14 for legibility.
        const nameN = sb.e.length;
        sb.node('NameLabel', rn, [], [], v3(FR.name.x, FR.name.y, 0));
        const nameUT = sb.ut(nameN, FR.name.w, FR.name.h);
        const nameL  = sb.lbl(nameN, '', 14, 168, 174, 201);
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

        // ChangeLabel — HERO 24H% (visual focus). 22→26pt bold right-aligned colored.
        const changeN = sb.e.length;
        sb.node('ChangeLabel', rn, [], [], v3(FR.change.x, FR.change.y, 0));
        const changeUT = sb.ut(changeN, FR.change.w, FR.change.h);
        const changeL  = sb.lbl(changeN, '', 26, 200, 200, 200);
        sb.e[changeL]._isBold = true;
        sb.e[changeL]._horizontalAlign = 2;
        sb.e[changeN]._components = [rf(changeUT), rf(changeL)];

        // DeltaLabel — alternate of ChangeLabel; hidden by default.
        const deltaN = sb.e.length;
        sb.node('DeltaLabel', rn, [], [], v3(FR.delta.x, FR.delta.y, 0));
        const deltaUT = sb.ut(deltaN, FR.delta.w, FR.delta.h);
        const deltaL  = sb.lbl(deltaN, '', 26, 200, 200, 200);
        sb.e[deltaL]._isBold = true;
        sb.e[deltaL]._horizontalAlign = 2;
        sb.e[deltaN]._components = [rf(deltaUT), rf(deltaL)];
        sb.e[deltaN]._active = false;

        // PriceLabel — gold mono, right-aligned. 18→16pt (subordinate to 24H hero).
        const priceN = sb.e.length;
        sb.node('PriceLabel', rn, [], [], v3(FR.price.x, FR.price.y, 0));
        const priceUT = sb.ut(priceN, FR.price.w, FR.price.h);
        const priceL  = sb.lbl(priceN, '', 16, 255, 210, 74);
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
            rf(glowN),  // first so it renders BEHIND row content
            rf(selEdgeN),
            rf(logoN),
            // chkN renders AFTER logoN so the always-visible checkbox sits
            // on top of the 150×150 avatar (was being clipped underneath).
            rf(chkN),
            rf(symN), rf(nameN),
            rf(scoreBgN), rf(scoreN), rf(liqN), rf(volN), rf(changeN), rf(deltaN),
            rf(priceN), rf(ageN), rf(dexN), rf(liveN),
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
        _color: cl(21, 25, 41, 240),
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

    // Squad header + 3 slots from LAYOUT.TokenDuelPanel.{elements.squadHeaderLabel,
    // templates.squadSlot}. Each slot is a composite: bg button + back-compat Label
    // (hidden) + LogoSprite + SymbolLabel + DeltaLabel. Slots _active=false until
    // AppUI populates squad. squadSlot.logo.x = -squadSlotW/2 + 26 = -64.
    // Polish 2026-04-26: fontSize 11→18 (FontSize.body). Color stays muted but
    // bumped 100→168 so the all-caps "YOUR SQUAD" tracker reads cleanly.
    const tdSquadHeader = mkLabel(sb, 'SquadHeaderLabel', tdN, 'YOUR SQUAD', 18,
        TDE.squadHeaderLabel.y, TDE.squadHeaderLabel.w, TDE.squadHeaderLabel.h, 168, 174, 201);
    sb.e[sb.e[tdSquadHeader]._components[1].__id__]._spacingX = 1;

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
        const bnSpr = sb.spr(bn, 20, 24, 38); // bg.primary-ish
        const bnBtn = sb.btn(bn, 26, 32, 48);
        sb.e[bnBtn]._normalColor   = cl(20, 24, 38, 240);
        sb.e[bnBtn]._hoverColor    = cl(30, 36, 56, 240);
        sb.e[bnBtn]._pressedColor  = cl(40, 48, 72, 240);
        sb.e[bnBtn]._disabledColor = cl(20, 24, 38, 200);

        // Top-half gradient overlay sprite — child, drawn over bg.
        const gradN = sb.e.length;
        sb.node('GradientTop', bn, [], [], v3(0, SS.h / 4, 0));
        const gradUT = sb.ut(gradN, SS.w, SS.h / 2);
        const gradSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(gradN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(30, 36, 56, 200),
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
        // Hidden by AppUI when the slot fills.
        const silN = sb.e.length;
        sb.node('SilhouettePlus', bn, [], [], v3(SS.silhouette.x, SS.silhouette.y, 0));
        const silUT = sb.ut(silN, SS.silhouette.w, SS.silhouette.h);
        const silL = sb.lbl(silN, '+', 84, 93, 100, 133);
        sb.e[silL]._color = cl(93, 100, 133, 64); // faint slate, alpha 64
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
        const dltL = sb.lbl(dltN, '', 28, 160, 170, 190);
        sb.e[dltL]._horizontalAlign = 1; // center
        sb.e[dltL]._isBold = true;
        sb.e[dltN]._components = [rf(dltUT), rf(dltL)];
        sb.e[dltN]._active = false; // hidden until slot filled

        // Score / rank badge — bottom-left.
        const scoN = sb.e.length;
        sb.node('ScoreBadge', bn, [], [], v3(SS.score.x, SS.score.y, 0));
        const scoUT = sb.ut(scoN, SS.score.w, SS.score.h);
        const scoL = sb.lbl(scoN, '', 14, 168, 174, 201);
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
            _color: cl(93, 100, 133, 120),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[perfN]._components = [rf(perfUT), rf(perfSpr)];

        // RemoveButton — × at top-right.
        const rmN = sb.e.length;
        sb.node('RemoveButton', bn, [], [], v3(SS.w / 2 - 18, SS.h / 2 - 18, 0));
        const rmUT = sb.ut(rmN, 26, 26);
        const rmSpr = sb.spr(rmN, 60, 30, 36);
        const rmBtn = sb.btn(rmN, 60, 30, 36);
        const rmLblN = sb.e.length;
        sb.node('Label', rmN, [], [], v3(0, 0, 0));
        const rmLblUT = sb.ut(rmLblN, 26, 26);
        const rmLblL = sb.lbl(rmLblN, '×', 20, 240, 200, 210);
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
        // Render order (back→front): bg gradient, hidden compat label, faint
        // silhouette, logo, symbol, hero delta, score, perf bar, slot index
        // label, top-edge accent, remove button (×).
        sb.e[bn]._children = [rf(gradN), rf(ln), rf(silN), rf(logoN), rf(symN), rf(dltN), rf(scoN), rf(perfN), rf(idxN), rf(edgeN), rf(rmN)];
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
        TDE.stakeHeaderLabel.y, TDE.stakeHeaderLabel.w, TDE.stakeHeaderLabel.h, 100, 110, 130);
    sb.e[sb.e[tdStakeHeader]._components[1].__id__]._spacingX = 1;
    sb.e[tdStakeHeader]._active = false;

    const tdStakeValueLabel = mkLabel(sb, 'StakeValueLabel', tdN, '0.010 SOL', 20,
        TDE.stakeValueLabel.y, TDE.stakeValueLabel.w, TDE.stakeValueLabel.h, 218, 165, 32);
    style(sb, tdStakeValueLabel, { mono: true, bold: true });  // Phase 15 (B5): hero numeric
    sb.e[tdStakeValueLabel]._active = false;

    const tdStakeSlider = mkSlider(sb, 'StakeSlider', tdN, TDE.stakeSlider.x, TDE.stakeSlider.y,
        TDE.stakeSlider.w, TDE.stakeSlider.h, 0.1);
    sb.e[tdStakeSlider]._active = false;

    const SCH = TDT.stakeChip;
    const tdStakeChips = [];
    for (let i = 0; i < SCH.count; i++) {
        const cN = mkBtnXY(sb, SCH.names[i], tdN, SCH.labels[i],
                           SCH.xs[i], SCH.y, SCH.w, SCH.h, 28, 34, 48);
        sb.e[cN]._active = false;
        tdStakeChips.push(cN);
    }
    const [tdStake001, tdStake010, tdStake100] = tdStakeChips;

    const tdCommit = mkBtn(sb, 'StakeCommitButton', tdN, 'Stake + Commit',
        TDE.stakeCommitButton.y, TDE.stakeCommitButton.w, TDE.stakeCommitButton.h, 56, 148, 252);
    style(sb, tdCommit, { bold: true });
    sb.e[tdCommit]._active = false;

    const tdStartGame = mkBtn(sb, 'StartGameButton', tdN, 'Start Game',
        TDE.startGameButton.y, TDE.startGameButton.w, TDE.startGameButton.h, 218, 165, 32);
    style(sb, tdStartGame, { bold: true });
    sb.e[tdStartGame]._active = false;

    const tdClaim = mkBtn(sb, 'ClaimPayoutButton', tdN, 'Claim Payout',
        TDE.claimPayoutButton.y, TDE.claimPayoutButton.w, TDE.claimPayoutButton.h, 150, 85, 210);
    style(sb, tdClaim, { bold: true });
    sb.e[tdClaim]._active = false;

    // Wager row — live betting-duel CTA. Two buttons (tier selector left,
    // start match right) + tiny hint label below. Positions from
    // LAYOUT.TokenDuelPanel.elements.{wagerValueButton,wagerStartButton,wagerHintLabel}.
    const tdWagerValueBtn = mkBtnXY(sb, 'WagerValueButton', tdN, '0.05 SOL  ▾',
        TDE.wagerValueButton.x, TDE.wagerValueButton.y,
        TDE.wagerValueButton.w, TDE.wagerValueButton.h, 34, 44, 68);
    style(sb, tdWagerValueBtn, { bold: true });
    // Phase 13 (B3): hero halo — blue match-start CTA.
    // 2026-04-27 UI overhaul — blue→violet horizontal gradient via stacked
    // sprite overlays. Base button is blue (56,148,252); a violet (153,69,255)
    // half-overlay covers the right half so the read is "blue→violet."
    const { glow: tdWagerStartGlow, btn: tdWagerStartBtn } = mkBtnHero(sb,
        'WagerStartButton', tdN, '▶ Start Match',
        TDE.wagerStartButton.x, TDE.wagerStartButton.y,
        TDE.wagerStartButton.w, TDE.wagerStartButton.h, 56, 148, 252);
    style(sb, tdWagerStartBtn, { bold: true, fontSize: 28 });
    // Violet right-half overlay — sits over button face but below label.
    {
        const wsW = TDE.wagerStartButton.w;
        const wsH = TDE.wagerStartButton.h;
        const overlayN = sb.e.length;
        sb.node('GradientRight', tdWagerStartBtn, [], [],
            v3(wsW / 4, 0, 0));
        const overlayUT = sb.ut(overlayN, wsW / 2, wsH);
        const overlaySpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(overlayN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(153, 69, 255, 220),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[overlayN]._components = [rf(overlayUT), rf(overlaySpr)];
        // mkBtnHero already inserted Ripple as first child; insert this overlay
        // right after Ripple but before any label so the text still reads.
        const existing = sb.e[tdWagerStartBtn]._children ?? [];
        // existing layout: [Ripple, TopHighlight, BottomShadow, Label]
        // We insert overlay between Ripple and TopHighlight.
        sb.e[tdWagerStartBtn]._children = [
            existing[0],            // Ripple
            rf(overlayN),
            ...existing.slice(1),
        ];
    }
    // Polish 2026-04-26: fontSize 11→18 (FontSize.body). Bumped contrast 120→168 so
    // the "Pick X more" hint actually reads on device.
    const tdWagerHint = mkLabel(sb, 'WagerHintLabel', tdN, '', 18,
        TDE.wagerHintLabel.y, TDE.wagerHintLabel.w, TDE.wagerHintLabel.h, 168, 174, 201);
    sb.e[sb.e[tdWagerHint]._components[1].__id__]._spacingX = 1;
    // 2026-04-26 redesign — hint moved into MatchSetupCard.MatchSetupHintLabel.
    // WagerHintLabel kept as hidden node for AppUI binding compatibility.
    sb.e[tdWagerHint]._active = false;

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
        TDE.wagerLockChip.w - 24, TDE.wagerLockChip.h - 12, 218, 165, 32);
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
    const tdWagerBotLabel = mkLabel(sb, 'WagerBotChipLabel', tdWagerBotChip, '🤖 FREE · Bot Match', 16, 0,
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
                             0, rowLocalY, WDR.w, WDR.h, 28, 34, 48);
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
    sb.lbl(tdBadge, 'SOL', 30, 218, 165, 32);

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
    sb.lbl(tdGameOver, 'Game Over — Height: 0\n(Tier: Forfeit)', 44, 218, 165, 32);
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
    sb.node('RacePanel', tdN, [], [racePanelN+1, racePanelN+2], lobbyMount('RacePanel'));
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
    const raceCountdownN = mkLabel(sb, 'RaceCountdownLabel',  racePanelN, '0:30', 26,
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
        sb.spr(cardN, 22, 28, 42);
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
    sb.lbl(raceOppGapN, '—', 14, 140, 150, 170);
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
        sb.lbl(smN, '— · — · —', 12, 160, 170, 190);
        const dtN = sb.e.length;
        sb.node('DeltaLabel', rowN, [], [dtN + 1, dtN + 2], v3(ORW.delta.x, ORW.delta.y, 0));
        sb.ut(dtN, ORW.delta.w, ORW.delta.h);
        const dtL = sb.lbl(dtN, '0.00%', 17, 210, 210, 220);
        sb.e[dtL]._isBold = true;
        const gpN = sb.e.length;
        sb.node('GapLabel', rowN, [], [gpN + 1, gpN + 2], v3(ORW.gap.x, ORW.gap.y, 0));
        sb.ut(gpN, ORW.gap.w, ORW.gap.h);
        sb.lbl(gpN, '', 11, 140, 150, 170);
        style(sb, dtN, { mono: true });
        style(sb, gpN, { mono: true });
        sb.e[rowN]._children = [rf(avN), rf(nmN), rf(smN), rf(dtN), rf(gpN)];
        raceOppRowIndices.push(rowN);
    }
    sb.e[raceOppStripN]._children = raceOppRowIndices.map(rf);

    // Forfeit + vignette + mascot. 1v1 duel layout downplays Forfeit —
    // recessed dark surface (28,32,44) sits below opponent section so it
    // doesn't compete with the duel bar / hero numbers.
    const raceCancelN = mkBtnXY(sb, 'RaceCancelButton', racePanelN, 'Forfeit',
        RPE.cancelBtn.x, RPE.cancelBtn.y, RPE.cancelBtn.w, RPE.cancelBtn.h, 28, 32, 44);
    // Dim the label so the button reads as low-priority.
    style(sb, raceCancelN, { color: cl(140, 145, 160, 255), fontSize: 18 });

    // 2026-04-27 — "← Home" button paired LEFT of Forfeit on y=-260 row.
    // Tap → activates HomePanel, leaves PortfolioRace running in background;
    // match resumable via MatchesInProgressPanel.
    const raceHomeBtnN = mkBtnXY(sb, 'RaceHomeButton', racePanelN, '← Home',
        RPE.homeBtn.x, RPE.homeBtn.y, RPE.homeBtn.w, RPE.homeBtn.h, 28, 34, 48);
    style(sb, raceHomeBtnN, { color: cl(168, 174, 201, 255), fontSize: 18 });

    // Gameplay hint (sits below Forfeit, child of RacePanel so it draws
    // above the panel scrim). String is overwritten by AppUI on race entry.
    const raceHintN = mkLabel(sb, 'RaceHintLabel', racePanelN,
        'Tap to drop - stack as high as you can', 18,
        RPE.hintLabel.y, RPE.hintLabel.w, RPE.hintLabel.h, 168, 174, 201);

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
        const cardSpr = sb.spr(cardN, 22, 28, 44);
        // Tap target — sits behind visible content. Generic name; verifier
        // uses suffix-stripped match ('MultiOppCardTap_0' → 'MultiOppCardTap').
        const tapN = raceMultiInvisBtn(`MultiOppCardTap_${i}`, cardN, MOG.tap.x, MOG.tap.y, MOG.tap.w, MOG.tap.h);
        // Rank chip (top-LEFT of card)
        const rankN = mkLabel(sb, `MultiOppRankChip_${i}`, cardN, '—', 12,
            MOG.rankChip.y, MOG.rankChip.w, MOG.rankChip.h, 168, 174, 201);
        sb.e[rankN]._lpos = v3(MOG.rankChip.x, MOG.rankChip.y, 0);
        sb.e[sb.e[rankN]._components[1].__id__]._isBold = true;
        // Name label
        const nameN = mkLabel(sb, `MultiOppName_${i}`, cardN, '—', 14,
            MOG.name.y, MOG.name.w, MOG.name.h, 244, 245, 249);
        // Delta (big colored)
        const deltaN = mkLabel(sb, `MultiOppDelta_${i}`, cardN, '—', 22,
            MOG.delta.y, MOG.delta.w, MOG.delta.h, 168, 174, 201);
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
        RPE.multiBackBtn.x, RPE.multiBackBtn.y, RPE.multiBackBtn.w, RPE.multiBackBtn.h, 28, 34, 48);
    style(sb, raceMultiBackN, { color: cl(168, 174, 201, 255), fontSize: 18 });
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
        // Bg.card surface (#1E2438 = 30, 36, 56). Dimmed variant uses bg.surface.
        if (dimmed) sb.spr(cardN, 21, 25, 41);
        else        sb.spr(cardN, 30, 36, 56);
        // Connected dot (Graphics). Player = teal-green; opponent = muted gray.
        const dotN = sb.e.length;
        sb.node(`${name === 'PlayerIdentityCard' ? 'PlayerIdentityDot' : 'OpponentIdentityDot'}`,
            cardN, [], [dotN+1, dotN+2], v3(ICT.dot.x, ICT.dot.y, 0));
        sb.ut(dotN, ICT.dot.w, ICT.dot.h);
        const dotCol = dimmed ? cl(140, 150, 170, 200) : cl(20, 241, 149, 255);
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
        const lvlLbl = sb.lbl(lvlN, 'Lv 1', 13, 168, 174, 201);
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
    sb.spr(playerLevelChipN, 30, 36, 56);
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
            // Player cards = bg.card; opponent cards slightly dimmer = bg.surface.
            if (prefix === 'Player') sb.spr(cardN, 30, 36, 56);
            else                     sb.spr(cardN, 21, 25, 41);
            const symN = sb.e.length;
            sb.node(`${prefix}TokenSymLabel_${i}`, cardN, [], [symN+1, symN+2], v3(DTC.sym.x, DTC.sym.y, 0));
            sb.ut(symN, DTC.sym.w, DTC.sym.h);
            const symLbl = sb.lbl(symN, '—', 22, 244, 245, 249);
            sb.e[symLbl]._isBold = true;
            const dtN = sb.e.length;
            sb.node(`${prefix}TokenDeltaLabel_${i}`, cardN, [], [dtN+1, dtN+2], v3(DTC.delta.x, DTC.delta.y, 0));
            sb.ut(dtN, DTC.delta.w, DTC.delta.h);
            sb.lbl(dtN, '+0.00%', 28, 168, 174, 201);
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
                _strokeColor: cl(168, 174, 201, 0),
                _fillColor:   cl(168, 174, 201, 0),
                _id: gid(),
            });
            sb.e[cardN]._children = [rf(symN), rf(dtN), rf(barN)];
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
        _strokeColor: cl(168, 174, 201, 200),
        _fillColor:   cl(168, 174, 201, 200),
        _id: gid(),
    });

    // Side tags ("you" / opponent name)
    const duelPlayerTagN = sb.e.length;
    sb.node('DuelBarPlayerTagLabel', duelBarN, [], [duelPlayerTagN+1, duelPlayerTagN+2],
        v3(RPE.duelBarPlayerTag.x, RPE.duelBarPlayerTag.y, 0));
    sb.ut(duelPlayerTagN, RPE.duelBarPlayerTag.w, RPE.duelBarPlayerTag.h);
    sb.lbl(duelPlayerTagN, 'you', 12, 168, 174, 201);

    const duelOppTagN = sb.e.length;
    sb.node('DuelBarOppTagLabel', duelBarN, [], [duelOppTagN+1, duelOppTagN+2],
        v3(RPE.duelBarOppTag.x, RPE.duelBarOppTag.y, 0));
    sb.ut(duelOppTagN, RPE.duelBarOppTag.w, RPE.duelBarOppTag.h);
    sb.lbl(duelOppTagN, 'bot', 12, 168, 174, 201);

    // Leading pp label — floats above leading tip; AppUI repositions per tick.
    const duelLeadingPpN = sb.e.length;
    sb.node('DuelBarLeadingPpLabel', duelBarN, [], [duelLeadingPpN+1, duelLeadingPpN+2],
        v3(RPE.duelBarLeadingPp.x, RPE.duelBarLeadingPp.y, 0));
    sb.ut(duelLeadingPpN, RPE.duelBarLeadingPp.w, RPE.duelBarLeadingPp.h);
    const duelLeadingPpLbl = sb.lbl(duelLeadingPpN, '', 18, 168, 174, 201);
    sb.e[duelLeadingPpLbl]._isBold = true;
    style(sb, duelLeadingPpN, { mono: true });

    sb.e[duelBarN]._children = [
        rf(duelTrackN), rf(duelFillN), rf(duelGlowN), rf(duelTickN),
        rf(duelPlayerTagN), rf(duelOppTagN), rf(duelLeadingPpN),
    ];

    // Opponent hero delta — bumped 72→80pt for symmetry of stake when losing.
    const oppHeroN = mkLabel(sb, 'OpponentDeltaHeroLabel', racePanelN, '+0.00%', 80,
        RPE.opponentDelta.y, RPE.opponentDelta.w, RPE.opponentDelta.h, 200, 200, 210);
    style(sb, oppHeroN, { mono: true });
    // Lead-state line — promoted from "you +X.XX pp ahead" (14pt) to a 2-line
    // emphasis line above the duel bar ("YOU LEAD\n+0.48 pp"). 22pt bold.
    const oppGapSubN = mkLabel(sb, 'OpponentSubtitleGapLabel', racePanelN, '—', 22,
        RPE.opponentSubtitle.y, RPE.opponentSubtitle.w, RPE.opponentSubtitle.h, 168, 174, 201);
    style(sb, oppGapSubN, { bold: true });

    // OpponentIdentityCard (mirror of player, dimmed)
    const opponentIdentityCardN = mkIdentityCard('OpponentIdentityCard', racePanelN, RPE.opponentIdentityCard, true);

    sb.e[racePanelN]._children = [
        rf(raceVignetteN),
        rf(playerLevelChipN),
        rf(raceTimerRingN), rf(raceCountdownN), rf(raceHeroN),
        rf(playerTokenRowN),
        rf(oppGapSubN),
        rf(duelBarN),
        rf(oppHeroN),
        rf(opponentIdentityCardN),
        rf(opponentTokenRowN),
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
        TDE.status.y, TDE.status.w, TDE.status.h, 168, 174, 201);

    // ═══════════════════════════════════════════════════════════════
    // Session D Part 2 — ModePickerOverlay (shown on Run Squad tap)
    // ═══════════════════════════════════════════════════════════════
    // Full-screen scrim + mode + wager + track picker. Hidden by default.
    const modePickerN = sb.e.length;
    sb.node('ModePickerOverlay', tdN, [], [], v3(0, 0, 0));
    const mpUT = sb.ut(modePickerN, 720, 1280);
    const mpSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(modePickerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        // UX Phase 2d: fully opaque modal bg (was alpha=210 → saw bleed).
        // Color = Palette.bg.primary so the modal blends with the app UI.
        _color: cl(11, 14, 26, 255),
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

    // Lock-in redesign — "Configure Your Duel" 32pt gold bold tracked.
    const mpTitle = mkLabel(sb, 'ModePickerTitleLabel', modePickerN, 'Configure Your Duel', 32,
        MPE.title.y, MPE.title.w, MPE.title.h, 255, 255, 255);
    style(sb, mpTitle, { bold: true, color: GOLD(), spacing: 1 });

    // Thin gold divider sprite under title — anchors the header visually.
    const mpTitleDividerN = sb.e.length;
    sb.node('ModePickerTitleDivider', modePickerN, [], [], v3(MPE.titleDivider.x, MPE.titleDivider.y, 0));
    const mpTitleDividerUT = sb.ut(mpTitleDividerN, MPE.titleDivider.w, MPE.titleDivider.h);
    const mpTitleDividerSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(mpTitleDividerN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(255, 210, 74, 140),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[mpTitleDividerN]._components = [rf(mpTitleDividerUT), rf(mpTitleDividerSpr)];

    // Section headers — title-case 13pt no-tracking; less shouty than Phase 23.
    const mpSecMode = mkLabel(sb, 'PickerSectionLabel_Mode', modePickerN, 'Mode', 13,
        MPE.sectionMode.y, MPE.sectionMode.w, MPE.sectionMode.h, 140, 150, 170);
    const mpSecDuration = mkLabel(sb, 'PickerSectionLabel_Duration', modePickerN, 'Duration', 13,
        MPE.sectionDuration.y, MPE.sectionDuration.w, MPE.sectionDuration.h, 140, 150, 170);
    const mpSecTrack = mkLabel(sb, 'PickerSectionLabel_Track', modePickerN, 'Track', 13,
        MPE.sectionTrack.y, MPE.sectionTrack.w, MPE.sectionTrack.h, 140, 150, 170);
    const mpSecDifficulty = mkLabel(sb, 'PickerSectionLabel_Difficulty', modePickerN, 'Difficulty', 13,
        MPE.sectionDifficulty.y, MPE.sectionDifficulty.w, MPE.sectionDifficulty.h, 140, 150, 170);

    // 4 mode buttons in 2×2 grid (LAYOUT.templates.modeBtn).
    const mpModeIndices = [];
    for (let i = 0; i < MPT.modeBtn.count; i++) {
        const key = MPT.modeBtn.keys[i];
        const label = MPT.modeBtn.labels[i];
        const pos = MPT.modeBtn.positions[i];
        const mN = mkBtnXY(sb, `Mode_${key}`, modePickerN, label,
            pos.x, pos.y, MPT.modeBtn.w, MPT.modeBtn.h, 28, 34, 48);
        mpModeIndices.push(mN);
    }

    // 2026-04-27 — 6 match-duration window chips in a row. Keys + labels both
    // come from LAYOUT.templates.windowBtn (re-keyed: '30s'|'1m'|'5m'|'1h'|'24h'|'7d').
    const windowIndices = [];
    for (let w = 0; w < MPT.windowBtn.count; w++) {
        const wx = MPT.windowBtn.baseX + w * MPT.windowBtn.gapX;
        const wN = mkBtnXY(sb, `Window_${MPT.windowBtn.keys[w]}`, modePickerN,
            MPT.windowBtn.labels[w], wx, MPT.windowBtn.y,
            MPT.windowBtn.w, MPT.windowBtn.h, 28, 34, 48);
        windowIndices.push(wN);
    }

    // Paper / Real toggle at y=90.
    const pickerPaperBtn = mkBtnXY(sb, 'PickerPaperToggle', modePickerN, 'Paper',
        MPE.paperToggle.x, MPE.paperToggle.y, MPE.paperToggle.w, MPE.paperToggle.h,
        48, 198, 155);
    const pickerRealBtn = mkBtnXY(sb, 'PickerRealToggle', modePickerN, 'Real',
        MPE.realToggle.x, MPE.realToggle.y, MPE.realToggle.w, MPE.realToggle.h,
        28, 34, 48);

    // Difficulty row at y=40 (Easy/Medium/Hard). Visible when track=Paper
    // or after Real-track timeout fallback to bot.
    const difficultyDefaultColors = [[28, 34, 48], [48, 198, 155], [28, 34, 48]];
    const difficultyBtns = [];
    for (let d = 0; d < MPT.difficultyBtn.count; d++) {
        const dx = MPT.difficultyBtn.baseX + d * MPT.difficultyBtn.gapX;
        const [r, g, b] = difficultyDefaultColors[d];
        const dN = mkBtnXY(sb, MPT.difficultyBtn.names[d], modePickerN, MPT.difficultyBtn.labels[d],
            dx, MPT.difficultyBtn.y, MPT.difficultyBtn.w, MPT.difficultyBtn.h, r, g, b);
        difficultyBtns.push(dN);
    }
    const [pickerEasyBtn, pickerMediumBtn, pickerHardBtn] = difficultyBtns;

    // Lock-in summary card — gold-edged dark card above the CTA. AppUI
    // writes live mode/modifiers/stake strings into the 3 child labels.
    const MPSC = MPE.summaryCard;
    const summaryCardN = sb.e.length;
    sb.node('PickerSummaryCard', modePickerN, [], [], v3(MPSC.x, MPSC.y, 0));
    const summaryCardUT = sb.ut(summaryCardN, MPSC.w, MPSC.h);
    const summaryCardSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(summaryCardN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(30, 36, 56, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const summaryModeLbl = mkLabel(sb, 'PickerSummaryModeLabel', summaryCardN, '1v1 Duel', 22,
        36, 580, 26, 244, 245, 249);
    style(sb, summaryModeLbl, { bold: true });
    const summaryModifiersLbl = mkLabel(sb, 'PickerSummaryModifiersLabel', summaryCardN,
        '30s · Paper · Medium', 16, 6, 580, 22, 168, 174, 201);
    const summaryStakeLbl = mkLabel(sb, 'PickerSummaryStakeLabel', summaryCardN,
        'Stake: 0.05 SOL', 26, -32, 580, 34, 255, 210, 74);
    style(sb, summaryStakeLbl, { bold: true, mono: true });
    const summaryEdge = mkCardEdge(sb, summaryCardN, MPSC.w, MPSC.h, 255, 210, 74);
    sb.e[summaryCardN]._components = [rf(summaryCardUT), rf(summaryCardSpr)];
    sb.e[summaryCardN]._children = [
        rf(summaryModeLbl), rf(summaryModifiersLbl), rf(summaryStakeLbl), rf(summaryEdge),
    ];

    // Start + Cancel buttons + status footer.
    const pickerStartBtn = mkBtn(sb, 'PickerStartButton', modePickerN, 'Enter Match',
        MPE.startBtn.y, MPE.startBtn.w, MPE.startBtn.h, 56, 148, 252);
    const pickerCancelBtn = mkBtnXY(sb, 'PickerCancelButton', modePickerN, '✕',
        MPE.cancelBtn.x, MPE.cancelBtn.y, MPE.cancelBtn.w, MPE.cancelBtn.h, 55, 30, 30);
    const pickerStatus = mkLabel(sb, 'PickerStatusLabel', modePickerN, '', 12,
        MPE.statusLbl.y, MPE.statusLbl.w, MPE.statusLbl.h, 140, 150, 170);

    sb.e[modePickerN]._components = [rf(mpUT), rf(mpSpr), rf(mpScrimBtn)];
    sb.e[modePickerN]._children = [
        rf(mpTitle), rf(mpTitleDividerN),
        rf(mpSecMode),       ...mpModeIndices.map(rf),
        rf(mpSecDuration),   ...windowIndices.map(rf),
        rf(mpSecTrack),      rf(pickerPaperBtn), rf(pickerRealBtn),
        rf(mpSecDifficulty), rf(pickerEasyBtn), rf(pickerMediumBtn), rf(pickerHardBtn),
        rf(summaryCardN),
        rf(pickerStartBtn), rf(pickerCancelBtn),
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
        TDE.squadDropTitle.y, TDE.squadDropTitle.w, TDE.squadDropTitle.h, 100, 110, 130);
    style(sb, dropModalHeaderN, { spacing: 1 });  // Phase 15 (B5)
    const dropModalHintN = mkLabel(sb, 'SquadDropHintLabel', dropOverlayN, 'Tap a token to remove · Tap outside to close', 11,
        TDE.squadDropHint.y, TDE.squadDropHint.w, TDE.squadDropHint.h, 140, 150, 170);
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
        _color: cl(11, 14, 26, 255),
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
        TDE.presetsTitle.y, TDE.presetsTitle.w, TDE.presetsTitle.h, 218, 165, 32);
    style(sb, presetsTitle, { spacing: 1 });  // Phase 15 (B5)
    const presetsHint = mkLabel(sb, 'PresetsHintLabel', presetsOvN, 'Tap a preset to load · swipe or tap delete to remove', 11,
        TDE.presetsHint.y, TDE.presetsHint.w, TDE.presetsHint.h, 140, 150, 170);

    // 5 preset rows from templates.presetRow.
    const presetRowIndices = [];
    for (let i = 0; i < PR.count; i++) {
        const rN = sb.e.length;
        sb.node(`PresetRow_${i}`, presetsOvN, [], [], v3(0, PR.ys[i], 0));
        const rUT = sb.ut(rN, PR.w, PR.h);
        const rSpr = sb.spr(rN, 22, 28, 42);
        const rBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(rN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.02, _target: rf(rN), _id: gid(),
        });
        const nameL = mkLabel(sb, `PresetNameLabel_${i}`, rN, '—', 18, 0, PR.name.w, PR.name.h, 220, 230, 240);
        sb.e[nameL]._lpos = v3(PR.name.x, PR.name.y, 0);
        sb.e[sb.e[nameL]._components[1].__id__]._horizontalAlign = 0;
        const symbolsL = mkLabel(sb, `PresetSymbolsLabel_${i}`, rN, '', 13, 0, PR.symbols.w, PR.symbols.h, 140, 150, 170);
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
        TDE.presetsSaveButton.y, TDE.presetsSaveButton.w, TDE.presetsSaveButton.h, 218, 165, 32);
    style(sb, presetsSaveBtn, { bold: true });
    const presetsEmptyL = mkLabel(sb, 'PresetsEmptyLabel', presetsOvN, 'No saved presets yet — pick 3 tokens and tap Save', 13,
        TDE.presetsEmptyLabel.y, TDE.presetsEmptyLabel.w, TDE.presetsEmptyLabel.h, 130, 140, 160);
    sb.e[presetsEmptyL]._active = false;

    // PresetNameModal — small card with EditBox + Save/Cancel buttons.
    const PM = TDE.presetsModal;
    const presetsModalN = sb.e.length;
    sb.node('PresetNameModal', presetsOvN, [], [], v3(PM.x, PM.y, 0));
    const presetsModalUT = sb.ut(presetsModalN, PM.w, PM.h);
    const presetsModalSpr = sb.spr(presetsModalN, 28, 34, 52);
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
        const sPriceL  = sb.lbl(sPriceN, '', 14, 218, 165, 32);
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
        rf(tdTitle), rf(tdHeaderUnderline),                    // 2026-04-27 UI overhaul — violet glow line under title
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
        rf(squadPanelN),                                      // 2026-04-26 redesign — Sticky Squad Panel wrapper (renders BEHIND squad/wager nodes)
        // Global Pick / Manage Squad removed 2026-04-26 — slot-level Pick + + per-slot × replaces them.
        rf(tdSquadHeader), rf(tdSquad0), rf(tdSquad1), rf(tdSquad2),
        rf(tdStakeHeader), rf(tdStakeValueLabel), rf(tdStakeSlider),
        rf(tdStake001), rf(tdStake010), rf(tdStake100),
        rf(tdCommit), rf(tdStartGame), rf(tdClaim),
        rf(tdWagerValueBtn), rf(tdWagerStartGlow), rf(tdWagerStartBtn), rf(tdWagerHint), rf(tdWagerLockChip), rf(tdWagerBotChip), rf(tdWagerDropdown),
        rf(tdHero1), rf(tdHero2), rf(tdHero3),
        rf(h1N), rf(h2N), rf(h3N),
        rf(tdGameArea), rf(tdGameOver), rf(racePanelN),       // betting-duel Phase 3: live race screen
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
        TDETE.symbolLabel.y, TDETE.symbolLabel.w, TDETE.symbolLabel.h, 244, 245, 249);
    sb.e[detSymbol]._lpos = v3(TDETE.symbolLabel.x, TDETE.symbolLabel.y, 0);
    style(sb, detSymbol, { bold: true, spacing: 1 });
    const detName = mkLabel(sb, 'DetailNameLabel', tdetN, '', 13,
        TDETE.nameLabel.y, TDETE.nameLabel.w, TDETE.nameLabel.h, 168, 174, 201);
    sb.e[detName]._lpos = v3(TDETE.nameLabel.x, TDETE.nameLabel.y, 0);

    // MintChip — small pill at the right edge of the identity row.
    const detMintChip = mkBtnXY(sb, 'DetailMintChip', tdetN, 'mint…',
        TDETE.mintChip.x, TDETE.mintChip.y, TDETE.mintChip.w, TDETE.mintChip.h, 28, 34, 48);
    style(sb, detMintChip, { spacing: 1, fontSize: 12 });

    // ─── Slim premium CTA — teal halo + ripple via mkBtnHero ─────────
    const detPickHero = mkBtnHero(sb, 'DetailPickUnpickButton', tdetN, '+ Pick Token',
        0, TDETE.pickBtn.y, TDETE.pickBtn.w, TDETE.pickBtn.h, 48, 198, 155, { glowAlpha: 90, glowPad: 14 });
    const detPickGlow = detPickHero.glow;
    const detPickBtn  = detPickHero.btn;

    // ─── Section labels (uppercase mini, lo-tier) ────────────────────
    const detSafetyHdr = mkLabel(sb, 'SafetyHeaderLabel', tdetN, 'SAFETY', 11,
        TDETE.safetyHeader.y, TDETE.safetyHeader.w, TDETE.safetyHeader.h, 93, 100, 133);
    sb.e[detSafetyHdr]._lpos = v3(TDETE.safetyHeader.x, TDETE.safetyHeader.y, 0);
    const detSafetyHdrL = sb.e[detSafetyHdr]._components[1].__id__;
    sb.e[detSafetyHdrL]._horizontalAlign = 0;
    sb.e[detSafetyHdrL]._spacingX = 2;

    const detRangeHdr = mkLabel(sb, 'RangeHeaderLabel', tdetN, 'RANGE', 11,
        TDETE.rangeHeader.y, TDETE.rangeHeader.w, TDETE.rangeHeader.h, 93, 100, 133);
    sb.e[detRangeHdr]._lpos = v3(TDETE.rangeHeader.x, TDETE.rangeHeader.y, 0);
    const detRangeHdrL = sb.e[detRangeHdr]._components[1].__id__;
    sb.e[detRangeHdrL]._horizontalAlign = 0;
    sb.e[detRangeHdrL]._spacingX = 2;

    const detViewHdr = mkLabel(sb, 'ViewHeaderLabel', tdetN, 'VIEW', 11,
        TDETE.viewHeader.y, TDETE.viewHeader.w, TDETE.viewHeader.h, 93, 100, 133);
    sb.e[detViewHdr]._lpos = v3(TDETE.viewHeader.x, TDETE.viewHeader.y, 0);
    const detViewHdrL = sb.e[detViewHdr]._components[1].__id__;
    sb.e[detViewHdrL]._horizontalAlign = 0;
    sb.e[detViewHdrL]._spacingX = 2;

    const detUnitHdr = mkLabel(sb, 'UnitHeaderLabel', tdetN, 'UNIT', 11,
        TDETE.unitHeader.y, TDETE.unitHeader.w, TDETE.unitHeader.h, 93, 100, 133);
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
            sx, SC.y, SC.w, SC.h, 28, 34, 48);
        style(sb, sN, { fontSize: 13 });
        safetyIndices.push(sN);
    }

    // ─── Timeframe segmented control ─────────────────────────────────
    const TF = LAYOUT.TokenDetailPanel.templates.timeframeBtn;
    const tfIndices = [];
    for (let t = 0; t < TF.count; t++) {
        const tx = TF.baseX + t * TF.gapX;
        const tN = mkBtnXY(sb, `TF_${TF.defs[t].key}`, tdetN, TF.defs[t].label,
            tx, TF.y, TF.w, TF.h, 28, 34, 48);
        tfIndices.push(tN);
    }

    // ─── Denom toggles (paired Price/MCap | USD/SOL) ─────────────────
    const DB = LAYOUT.TokenDetailPanel.templates.denomBtn;
    const denomBtnIndices = [];
    for (const d of DB.defs) {
        const dN = mkBtnXY(sb, `Denom_${d.key}`, tdetN, d.label,
            d.x, DB.y, DB.w, DB.h, 28, 34, 48);
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
    const chartCardSpr = sb.spr(chartCardN, 18, 22, 36); // dark surface, alpha=255
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
        TDETE.chartLoadLabel.y, TDETE.chartLoadLabel.w, TDETE.chartLoadLabel.h, 140, 150, 170);

    sb.e[chartCardN]._children = [rf(chartCardEdge), rf(chartHeaderLbl), rf(chartN)];

    // ─── Token Stats label ───────────────────────────────────────────
    const detStatsHdr = mkLabel(sb, 'StatsHeaderLabel', tdetN, 'TOKEN STATS', 11,
        TDETE.statsHeader.y, TDETE.statsHeader.w, TDETE.statsHeader.h, 93, 100, 133);
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
        slate:   [ 93, 100, 133],
        dynamic: [168, 174, 201], // neutral default — AppUI recolors at runtime
    };
    const DSC = LAYOUT.TokenDetailPanel.templates.detailStatCard;
    const statIndices = [];
    for (const d of DSC.defs) {
        const cardN = sb.e.length;
        sb.node(`StatCard_${d.key}`, tdetN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, DSC.w, DSC.h);
        const cardSpr = sb.spr(cardN, 18, 22, 32);
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(DSC.header.x, DSC.header.y, 0));
        const lblUT = sb.ut(lblN, DSC.header.w, DSC.header.h);
        const lblL  = sb.lbl(lblN, d.label, 10, 100, 110, 130);
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
        TDETE.status.y, TDETE.status.w, TDETE.status.h, 140, 150, 170);

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
    const lbTitle = mkLabel(sb, 'LeaderboardTitleLabel', lbN, 'Leaderboard', 30,
        LP.title.y, LP.title.w, LP.title.h, 218, 165, 32);
    style(sb, lbTitle, { bold: true });

    // Subtitle ("1v1 Duel · This Week"). AppUI rewrites string per active mode/chip.
    const lbSubtitle = mkLabel(sb, 'LeaderboardSubtitleLabel', lbN, '1v1 Duel · This Week', 16,
        LP.subtitle.y, LP.subtitle.w, LP.subtitle.h, 168, 174, 201);

    // Segmented-control container (pill bg) behind the 4 mode tabs.
    const MTC = LP.modeTabsContainer;
    const lbModeTabsContainer = sb.e.length;
    sb.node('ModeTabsContainer', lbN, [], [], v3(MTC.x, MTC.y, 0));
    const lbModeTabsContainerUT = sb.ut(lbModeTabsContainer, MTC.w, MTC.h);
    const lbModeTabsContainerSpr = sb.spr(lbModeTabsContainer, 28, 34, 52);
    sb.e[lbModeTabsContainer]._components = [rf(lbModeTabsContainerUT), rf(lbModeTabsContainerSpr)];

    // 4 mode tabs (segmented control). Active tab = teal, others = container surface.
    const lbTabIndices = [];
    for (let i = 0; i < LPT.lbTab.count; i++) {
        const active = i === LPT.lbTab.activeIdx;
        const bg = active ? [48, 198, 155] : [28, 34, 52];
        const btn = mkBtnXY(sb, `LBTab_${LPT.lbTab.keys[i]}`, lbN, LPT.lbTab.labels[i],
            LPT.lbTab.xs[i], LPT.lbTab.y, LPT.lbTab.w, LPT.lbTab.h, bg[0], bg[1], bg[2]);
        // Tint the inner Label too: white when active, mid-grey when inactive.
        const labelChildRef = sb.e[btn]._children?.[2];
        if (labelChildRef) {
            const labelChild = sb.e[labelChildRef.__id__];
            const lblComp = labelChild?._components?.[1]?.__id__;
            if (lblComp != null) {
                sb.e[lblComp]._color = active ? cl(255, 255, 255, 255) : cl(168, 174, 201, 255);
            }
        }
        lbTabIndices.push(btn);
    }

    // Standalone "This Week" chip (node name LBTab_season — handler binds modeU8=4).
    const TWC = LP.thisWeekChip;
    const lbThisWeekChip = mkBtnXY(sb, 'LBTab_season', lbN, 'This Week',
        TWC.x, TWC.y, TWC.w, TWC.h, 28, 34, 52);
    {
        const labelChildRef = sb.e[lbThisWeekChip]._children?.[2];
        if (labelChildRef) {
            const labelChild = sb.e[labelChildRef.__id__];
            const lblComp = labelChild?._components?.[1]?.__id__;
            if (lblComp != null) sb.e[lblComp]._color = cl(168, 174, 201, 255);
        }
    }

    // Hero card for rank #1.
    const TPC = LP.topPlayerCard;
    const TPCC = TPC.children;
    const tpcN = sb.e.length;
    sb.node('TopPlayerCard', lbN, [], [], v3(TPC.x, TPC.y, 0));
    const tpcUT = sb.ut(tpcN, TPC.w, TPC.h);
    const tpcSpr = sb.spr(tpcN, 60, 48, 14);
    const tpcEdge = mkCardEdge(sb, tpcN, TPC.w, TPC.h, 255, 210, 74, 255);
    const tpcCrown = mkLabel(sb, 'CrownLabel', tpcN, '👑', 28,
        TPCC.crown.y, TPCC.crown.w, TPCC.crown.h, 255, 210, 74);
    sb.e[tpcCrown]._lpos = v3(TPCC.crown.x, TPCC.crown.y, 0);
    const tpcRank = mkLabel(sb, 'RankLabel', tpcN, '#1', 22,
        TPCC.rank.y, TPCC.rank.w, TPCC.rank.h, 255, 210, 74);
    sb.e[tpcRank]._lpos = v3(TPCC.rank.x, TPCC.rank.y, 0);
    style(sb, tpcRank, { bold: true });
    const tpcPlayer = mkLabel(sb, 'PlayerLabel', tpcN, '—', 18,
        TPCC.player.y, TPCC.player.w, TPCC.player.h, 244, 245, 249);
    sb.e[tpcPlayer]._lpos = v3(TPCC.player.x, TPCC.player.y, 0);
    sb.e[sb.e[tpcPlayer]._components[1].__id__]._horizontalAlign = 0;
    const tpcElapsed = mkLabel(sb, 'ElapsedLabel', tpcN, '', 12,
        TPCC.elapsed.y, TPCC.elapsed.w, TPCC.elapsed.h, 168, 174, 201);
    sb.e[tpcElapsed]._lpos = v3(TPCC.elapsed.x, TPCC.elapsed.y, 0);
    sb.e[sb.e[tpcElapsed]._components[1].__id__]._horizontalAlign = 0;
    const tpcScore = mkLabel(sb, 'ScoreLabel', tpcN, '—', 26,
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
        const rSpr = sb.spr(rN, 21, 25, 41);
        const rankN = mkLabel(sb, 'RankLabel', rN, `#${r + 1}`, 18,
            LR.rank.y, LR.rank.w, LR.rank.h, 168, 174, 201);
        sb.e[rankN]._lpos = v3(LR.rank.x, LR.rank.y, 0);
        const playerN = mkLabel(sb, 'PlayerLabel', rN, '—', 16,
            LR.player.y, LR.player.w, LR.player.h, 244, 245, 249);
        sb.e[playerN]._lpos = v3(LR.player.x, LR.player.y, 0);
        sb.e[sb.e[playerN]._components[1].__id__]._horizontalAlign = 0;
        const scoreN = mkLabel(sb, 'ScoreLabel', rN, '—', 18,
            LR.score.y, LR.score.w, LR.score.h, 20, 241, 149);
        sb.e[scoreN]._lpos = v3(LR.score.x, LR.score.y, 0);
        sb.e[sb.e[scoreN]._components[1].__id__]._horizontalAlign = 2;
        style(sb, scoreN, { bold: true });
        const elapsedN = mkLabel(sb, 'ElapsedLabel', rN, '', 11,
            LR.elapsed.y, LR.elapsed.w, LR.elapsed.h, 93, 100, 133);
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
        ESC.sub.y, ESC.sub.w, ESC.sub.h, 168, 174, 201);
    const esCta = mkBtnXY(sb, 'EmptyStartMatchButton', esN, 'Start a Match',
        ESC.cta.x, ESC.cta.y, ESC.cta.w, ESC.cta.h, 20, 241, 149);
    style(sb, esCta, { bold: true });
    sb.e[esN]._components = [rf(esUT)];
    sb.e[esN]._children = [rf(esIcon), rf(esTitle), rf(esSub), rf(esCta)];
    sb.e[esN]._active = false;

    const lbStatus = mkLabel(sb, 'LeaderboardStatusLabel', lbN, '', 14,
        LP.status.y, LP.status.w, LP.status.h, 140, 150, 170);

    // Personal rank footer card (sticky-bottom YOU).
    const PRC = LP.personalRankCard.children;
    const prcN = sb.e.length;
    sb.node('PersonalRankCard', lbN, [], [], v3(LP.personalRankCard.x, LP.personalRankCard.y, 0));
    const prcUT = sb.ut(prcN, LP.personalRankCard.w, LP.personalRankCard.h);
    const prcSpr = sb.spr(prcN, 30, 36, 56);
    const prcEdge = mkCardEdge(sb, prcN, LP.personalRankCard.w, LP.personalRankCard.h, 20, 241, 149, 220);
    const prcHeader = mkLabel(sb, 'HeaderLabel', prcN, 'YOU', 13,
        PRC.header.y, PRC.header.w, PRC.header.h, 20, 241, 149);
    sb.e[prcHeader]._lpos = v3(PRC.header.x, PRC.header.y, 0);
    sb.e[sb.e[prcHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, prcHeader, { bold: true });
    const prcRank = mkLabel(sb, 'RankLabel', prcN, 'Not ranked yet · win to climb', 18,
        PRC.rank.y, PRC.rank.w, PRC.rank.h, 244, 245, 249);
    sb.e[prcRank]._lpos = v3(PRC.rank.x, PRC.rank.y, 0);
    sb.e[sb.e[prcRank]._components[1].__id__]._horizontalAlign = 0;
    const prcStats = mkLabel(sb, 'StatsLabel', prcN, 'W–L —  ·  Level —  ·  P/L —', 13,
        PRC.stats.y, PRC.stats.w, PRC.stats.h, 168, 174, 201);
    sb.e[prcStats]._lpos = v3(PRC.stats.x, PRC.stats.y, 0);
    sb.e[sb.e[prcStats]._components[1].__id__]._horizontalAlign = 0;
    const prcCta = mkBtnXY(sb, 'PlayCTAButton', prcN, 'Play your first match',
        PRC.cta.x, PRC.cta.y, PRC.cta.w, PRC.cta.h, 13, 170, 104);
    sb.e[prcN]._components = [rf(prcUT), rf(prcSpr)];
    sb.e[prcN]._children = [rf(prcEdge), rf(prcHeader), rf(prcRank), rf(prcStats), rf(prcCta)];
    sb.e[prcN]._active = false;

    sb.e[lbN]._children = [
        rf(lbBackLink), rf(lbBackBtn), rf(lbTitle), rf(lbSubtitle),
        rf(lbModeTabsContainer),
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
    const dcTitle = mkLabel(sb, 'DailyChallengeTitleLabel', dcN, "Today's Challenges", 26,
        DCE.title.y, DCE.title.w, DCE.title.h, 218, 165, 32);
    style(sb, dcTitle, { bold: true });

    // Streak card from LAYOUT.DailyChallengePanel.elements.streakCard + internals.
    const streakCardN = sb.e.length;
    sb.node('DailyStreakCard', dcN, [], [], v3(DCE.streakCard.x, DCE.streakCard.y, 0));
    const streakCardUT = sb.ut(streakCardN, DCE.streakCard.w, DCE.streakCard.h);
    const streakCardSpr = sb.spr(streakCardN, 22, 28, 42);
    const streakHeader = mkLabel(sb, 'HeaderLabel', streakCardN, 'STREAK', 11,
        DCE.streakHeader.y, DCE.streakHeader.w, DCE.streakHeader.h, 140, 150, 170);
    sb.e[streakHeader]._lpos = v3(DCE.streakHeader.x, DCE.streakHeader.y, 0);
    sb.e[sb.e[streakHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, streakHeader, { spacing: 1 });  // Phase 15 (B5): tracked uppercase
    // 9c: streakDay h 46→38 so its bbox bottom y=-17 touches StreakBest top y=-17 (no overlap).
    const streakDay = mkLabel(sb, 'StreakDayLabel', streakCardN, 'Day 0', 36,
        0, DCE.streakDayLabel.w, DCE.streakDayLabel.h, 255, 255, 255);
    sb.e[streakDay]._lpos = v3(DCE.streakDayLabel.x, DCE.streakDayLabel.y, 0);
    style(sb, streakDay, { bold: true, mono: true });  // Phase 15 (B5): hero streak number
    const streakBest = mkLabel(sb, 'StreakBestLabel', streakCardN, 'Best: 0', 14,
        -28, DCE.streakBestLabel.w, DCE.streakBestLabel.h, 160, 170, 190);
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
        const rSpr = sb.spr(rN, 22, 28, 42);
        const descL = mkLabel(sb, `ChallengeDescriptionLabel_${i}`, rN, '—', 17, 0, CR.description.w, CR.description.h, 220, 230, 240);
        sb.e[descL]._lpos = v3(CR.description.x, CR.description.y, 0);
        sb.e[sb.e[descL]._components[1].__id__]._horizontalAlign = 0;
        const subL = mkLabel(sb, `ChallengeProgressLabel_${i}`, rN, '', 13, 0, CR.progress.w, CR.progress.h, 140, 150, 170);
        sb.e[subL]._lpos = v3(CR.progress.x, CR.progress.y, 0);
        sb.e[sb.e[subL]._components[1].__id__]._horizontalAlign = 0;
        const rewardL = mkLabel(sb, `ChallengeRewardLabel_${i}`, rN, '+0 XP', 15, 0, CR.reward.w, CR.reward.h, 218, 165, 32);
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
    const seasonSumSpr = sb.spr(seasonSumN, 22, 28, 42);
    const seasonHeader = mkLabel(sb, 'SeasonHeaderLabel', seasonSumN, 'THIS WEEK', 11,
        DCE.seasonHeader.y, DCE.seasonHeader.w, DCE.seasonHeader.h, 140, 150, 170);
    sb.e[seasonHeader]._lpos = v3(DCE.seasonHeader.x, DCE.seasonHeader.y, 0);
    sb.e[sb.e[seasonHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, seasonHeader, { spacing: 1 });  // Phase 15 (B5)
    const seasonRank = mkLabel(sb, 'SeasonRankLabel', seasonSumN, 'Rank: —  ·  Wins: 0', 17,
        DCE.seasonRank.y, DCE.seasonRank.w, DCE.seasonRank.h, 220, 230, 240);
    sb.e[seasonRank]._lpos = v3(DCE.seasonRank.x, DCE.seasonRank.y, 0);
    style(sb, seasonRank, { mono: true });  // Phase 15 (B5): live rank/wins
    const seasonPodium = mkLabel(sb, 'SeasonPodiumLabel', seasonSumN, 'Podium: —', 13,
        DCE.seasonPodium.y, DCE.seasonPodium.w, DCE.seasonPodium.h, 160, 170, 190);
    sb.e[seasonPodium]._lpos = v3(DCE.seasonPodium.x, DCE.seasonPodium.y, 0);
    const seasonPrize = mkLabel(sb, 'SeasonPrizeLabel', seasonSumN, '', 12,
        DCE.seasonPrize.y, DCE.seasonPrize.w, DCE.seasonPrize.h, 130, 140, 160);
    sb.e[seasonPrize]._lpos = v3(DCE.seasonPrize.x, DCE.seasonPrize.y, 0);
    // Phase 14 (B4): teal edge accent — weekly progress card.
    const seasonEdge = mkCardEdge(sb, seasonSumN, DCE.seasonCard.w, DCE.seasonCard.h, 20, 241, 149);
    sb.e[seasonSumN]._components = [rf(seasonSumUT), rf(seasonSumSpr)];
    sb.e[seasonSumN]._children = [rf(seasonHeader), rf(seasonRank), rf(seasonPodium), rf(seasonPrize), rf(seasonEdge)];

    const dcStatus = mkLabel(sb, 'DailyChallengeStatusLabel', dcN, '', 13,
        DCE.status.y, DCE.status.w, DCE.status.h, 140, 150, 170);

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
    // betting-duel polish: stretch the panel to fill the Canvas on any device
    // aspect ratio. Without a Widget, tall-screen devices shrink the panel to
    // a fraction of the viewport. Inner labels use absolute Y offsets so they
    // track the panel's center as it stretches.
    sb.widget(pfN);
    // betting-duel polish (FIXED_WIDTH spread): Y range stretched from
    // [-620, +620] → [-760, +720] to use the full 1602px viewport on device.
    // Chrome from LAYOUT.PortfolioPanel.elements (9c addition).
    const PFE = LAYOUT.PortfolioPanel.elements;
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
        PFE.title.y, PFE.title.w, PFE.title.h, 255, 255, 255);
    style(sb, pfTitle, { bold: true, color: GOLD() });
    const pfPubkeyLabel = mkLabel(sb, 'PortfolioPubkeyLabel', pfN, 'not connected', 16,
        PFE.pubkeyLabel.y, PFE.pubkeyLabel.w, PFE.pubkeyLabel.h, 140, 220, 180);
    // Dashboard redesign (foamy-sphinx): subtitle eyebrow under title.
    const pfSubtitle = mkLabel(sb, 'PortfolioSubtitleLabel', pfN, 'Your performance', 14,
        PFE.subtitle.y, PFE.subtitle.w, PFE.subtitle.h, 168, 174, 201);
    // Primary tabs — Stats / History / Trophies (full-width segmented control).
    const pfStatsTab    = mkBtnXY(sb, 'PortfolioStatsTab',    pfN, 'Stats',
        PFE.statsTab.x, PFE.statsTab.y, PFE.statsTab.w, PFE.statsTab.h, 48, 198, 155);
    const pfHistoryTab  = mkBtnXY(sb, 'PortfolioHistoryTab',  pfN, 'History',
        PFE.historyTab.x, PFE.historyTab.y, PFE.historyTab.w, PFE.historyTab.h, 28, 34, 48);
    const pfTrophiesTab = mkBtnXY(sb, 'PortfolioTrophiesTab', pfN, 'Trophies',
        PFE.trophiesTab.x, PFE.trophiesTab.y, PFE.trophiesTab.w, PFE.trophiesTab.h, 28, 34, 48);
    // MODE eyebrow + smaller secondary Paper/Real toggle.
    const pfModeLabel = mkLabel(sb, 'PortfolioModeLabel', pfN, 'MODE', 11,
        PFE.modeLabel.y, PFE.modeLabel.w, PFE.modeLabel.h, 140, 150, 170);
    style(sb, pfModeLabel, { spacing: 2 });
    const pfPaperTab = mkBtnXY(sb, 'PortfolioPaperTab', pfN, 'Paper',
        PFE.paperTab.x, PFE.paperTab.y, PFE.paperTab.w, PFE.paperTab.h, 48, 198, 155);
    const pfRealTab  = mkBtnXY(sb, 'PortfolioRealTab',  pfN, 'Real',
        PFE.realTab.x, PFE.realTab.y, PFE.realTab.w, PFE.realTab.h, 28, 34, 48);
    // ───── Hero P/L card (focal point) ─────
    // Keeps the legacy node name PFStatCard_pnl so AppUI's _pfStatValues['pnl']
    // and the runtime tint hooks resolve through getChildByName('Value').
    const PHC = LAYOUT.PortfolioPanel.templates.heroPnLCard;
    const heroCardN = sb.e.length;
    sb.node('PFStatCard_pnl', pfN, [], [], v3(PHC.x, PHC.y, 0));
    const heroCardUT = sb.ut(heroCardN, PHC.w, PHC.h);
    const heroCardSpr = sb.spr(heroCardN, 18, 22, 32);
    const heroHeaderN = sb.e.length;
    sb.node('Header', heroCardN, [], [], v3(PHC.header.x, PHC.header.y, 0));
    const heroHeaderUT = sb.ut(heroHeaderN, PHC.header.w, PHC.header.h);
    const heroHeaderL = sb.lbl(heroHeaderN, 'TOTAL PROFIT', 12, 168, 174, 201);
    sb.e[heroHeaderL]._spacingX = 2;
    sb.e[heroHeaderN]._components = [rf(heroHeaderUT), rf(heroHeaderL)];
    const heroValueN = sb.e.length;
    sb.node('Value', heroCardN, [], [], v3(PHC.value.x, PHC.value.y, 0));
    const heroValueUT = sb.ut(heroValueN, PHC.value.w, PHC.value.h);
    const heroValueL = sb.lbl(heroValueN, '—', 56, 244, 245, 249);
    sb.e[heroValueL]._isBold = true;
    sb.e[heroValueN]._components = [rf(heroValueUT), rf(heroValueL)];
    const heroSubN = sb.e.length;
    sb.node('Subtitle', heroCardN, [], [], v3(PHC.subtitle.x, PHC.subtitle.y, 0));
    const heroSubUT = sb.ut(heroSubN, PHC.subtitle.w, PHC.subtitle.h);
    const heroSubL = sb.lbl(heroSubN, 'Across all matches', 13, 140, 150, 170);
    sb.e[heroSubN]._components = [rf(heroSubUT), rf(heroSubL)];
    // Neutral edge by default; AppUI re-tints to green/red based on P/L sign.
    const heroEdge = mkCardEdge(sb, heroCardN, PHC.w, PHC.h, 140, 150, 170);
    sb.e[heroCardN]._components = [rf(heroCardUT), rf(heroCardSpr)];
    sb.e[heroCardN]._children = [rf(heroHeaderN), rf(heroValueN), rf(heroSubN), rf(heroEdge)];

    // ───── Group eyebrow headers ─────
    const pfGroupPerf = mkLabel(sb, 'PortfolioGroupHeaderPerformance', pfN, 'PERFORMANCE', 12,
        PFE.groupHeaderPerformance.y, PFE.groupHeaderPerformance.w, PFE.groupHeaderPerformance.h,
        168, 174, 201);
    sb.e[pfGroupPerf]._lpos = v3(PFE.groupHeaderPerformance.x, PFE.groupHeaderPerformance.y, 0);
    const pfGroupPerfL = sb.e[pfGroupPerf]._components[1].__id__;
    sb.e[pfGroupPerfL]._horizontalAlign = 0;
    sb.e[pfGroupPerfL]._spacingX = 2;
    const pfGroupAct = mkLabel(sb, 'PortfolioGroupHeaderActivity', pfN, 'ACTIVITY', 12,
        PFE.groupHeaderActivity.y, PFE.groupHeaderActivity.w, PFE.groupHeaderActivity.h,
        168, 174, 201);
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
        const cardSpr = sb.spr(cardN, 18, 22, 32);
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(PSC.header.x, PSC.header.y, 0));
        const lblUT = sb.ut(lblN, PSC.header.w, PSC.header.h);
        const lblL = sb.lbl(lblN, d.label, 11, 168, 174, 201);
        sb.e[lblL]._spacingX = 2;
        sb.e[lblN]._components = [rf(lblUT), rf(lblL)];
        const valN = sb.e.length;
        sb.node('Value', cardN, [], [], v3(PSC.value.x, PSC.value.y, 0));
        const valUT = sb.ut(valN, PSC.value.w, PSC.value.h);
        const valL = sb.lbl(valN, '—', 26, 244, 245, 249);
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
    const xpHeaderL = sb.lbl(xpHeaderN, 'LEVEL', 11, 168, 174, 201);
    sb.e[xpHeaderL]._spacingX = 2;
    sb.e[xpHeaderL]._horizontalAlign = 0;
    sb.e[xpHeaderN]._components = [rf(xpHeaderUT), rf(xpHeaderL)];
    // Big "L#" — right-aligned at top.
    const xpValN = sb.e.length;
    sb.node('Value', xpCardN, [], [], v3(PXC.value.x, PXC.value.y, 0));
    const xpValUT = sb.ut(xpValN, PXC.value.w, PXC.value.h);
    const xpValL = sb.lbl(xpValN, '—', 16, 244, 245, 249);
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
    const xpFooterL = sb.lbl(xpFooterN, 'Earn XP by winning matches', 11, 140, 150, 170);
    sb.e[xpFooterN]._components = [rf(xpFooterUT), rf(xpFooterL)];
    sb.e[xpCardN]._components = [rf(xpCardUT), rf(xpCardSpr)];
    sb.e[xpCardN]._children = [rf(xpHeaderN), rf(xpValN), rf(xpTrackN), rf(xpFillN), rf(xpFooterN)];

    // ───── Empty state (zero games / un-initialized real PDA) ─────
    const pfEmptyStateN = sb.e.length;
    sb.node('PortfolioEmptyState', pfN, [], [], v3(PFE.emptyState.x, PFE.emptyState.y, 0));
    const pfEmptyStateUT = sb.ut(pfEmptyStateN, PFE.emptyState.w, PFE.emptyState.h);
    const pfEmptyTitle = mkLabel(sb, 'PortfolioEmptyStateTitle', pfEmptyStateN, 'No matches yet',
        24, PFE.emptyStateTitle.y, PFE.emptyStateTitle.w, PFE.emptyStateTitle.h, 244, 245, 249);
    style(sb, pfEmptyTitle, { bold: true });
    const pfEmptySub = mkLabel(sb, 'PortfolioEmptyStateSubtitle', pfEmptyStateN,
        'Start playing to build your stats', 14,
        PFE.emptyStateSubtitle.y, PFE.emptyStateSubtitle.w, PFE.emptyStateSubtitle.h, 168, 174, 201);
    const pfEmptyCta = mkBtnXY(sb, 'PortfolioEmptyStateCta', pfEmptyStateN, 'Start Match',
        PFE.emptyStateCta.x, PFE.emptyStateCta.y, PFE.emptyStateCta.w, PFE.emptyStateCta.h,
        20, 241, 149);
    style(sb, pfEmptyCta, { bold: true });
    sb.e[pfEmptyStateN]._components = [rf(pfEmptyStateUT)];
    sb.e[pfEmptyStateN]._children = [rf(pfEmptyTitle), rf(pfEmptySub), rf(pfEmptyCta)];
    sb.e[pfEmptyStateN]._active = false;

    const pfHint = mkLabel(sb, 'PortfolioHintLabel', pfN, 'Real mode stats update after your first match', 12,
        PFE.hint.y, PFE.hint.w, PFE.hint.h, 140, 150, 170);
    const pfStatus = mkLabel(sb, 'PortfolioStatusLabel', pfN, '', 14,
        PFE.status.y, PFE.status.w, PFE.status.h, 140, 150, 170);

    // Part 9: MatchHistory view — hidden when Stats tab is active.
    // Container anchors label + scrollview + load-more button as a unit.
    const pfHistoryViewN = sb.e.length;
    sb.node('PortfolioHistoryView', pfN, [], [], v3(0, 0, 0));
    sb.ut(pfHistoryViewN, 720, 1280);
    const pfHistoryEmpty = mkLabel(sb, 'PortfolioHistoryEmptyLabel', pfHistoryViewN,
        'No matches yet — play a Real match to see history.',
        14, PFE.historyEmpty.y, PFE.historyEmpty.w, PFE.historyEmpty.h, 140, 150, 170);
    const pfHistorySV = mkScrollView(sb, 'PortfolioHistoryScroll', pfHistoryViewN,
        PFE.historyScroll.x, PFE.historyScroll.y, PFE.historyScroll.w, PFE.historyScroll.h);
    // 30-row pool from LAYOUT.PortfolioPanel.templates.matchHistoryRow.
    // AppUI toggles _active per row + writes 5 labels (Date/Mode/Wager/
    // Placement/Payout) as MatchHistoryRpc entries arrive (AppUI.ts:9310).
    const MHR = LAYOUT.PortfolioPanel.templates.matchHistoryRow;
    const pfHistoryRows = [];
    for (let i = 0; i < MHR.count; i++) {
        const ry = MHR.baseY + i * MHR.gapY;
        const rowN = sb.e.length;
        sb.node(`MatchHistoryRow_${i}`, pfHistorySV.content, [], [], v3(0, ry, 0));
        const rowUT = sb.ut(rowN, MHR.w, MHR.h);
        const rowSpr = sb.spr(rowN, 22, 28, 44);
        const dateL = mkLabel(sb, 'Date', rowN, '—', 12, 0, MHR.date.w, MHR.date.h,
            MHR.date.color[0], MHR.date.color[1], MHR.date.color[2]);
        sb.e[dateL]._lpos = v3(MHR.date.x, MHR.date.y, 0);
        const modeL = mkLabel(sb, 'Mode', rowN, '—', 12, 0, MHR.mode.w, MHR.mode.h,
            MHR.mode.color[0], MHR.mode.color[1], MHR.mode.color[2]);
        sb.e[modeL]._lpos = v3(MHR.mode.x, MHR.mode.y, 0);
        const wagerL = mkLabel(sb, 'Wager', rowN, '—', 12, 0, MHR.wager.w, MHR.wager.h,
            MHR.wager.color[0], MHR.wager.color[1], MHR.wager.color[2]);
        sb.e[wagerL]._lpos = v3(MHR.wager.x, MHR.wager.y, 0);
        const placeL = mkLabel(sb, 'Placement', rowN, '—', 12, 0, MHR.placement.w, MHR.placement.h,
            MHR.placement.color[0], MHR.placement.color[1], MHR.placement.color[2]);
        sb.e[placeL]._lpos = v3(MHR.placement.x, MHR.placement.y, 0);
        const payoutL = mkLabel(sb, 'Payout', rowN, '—', 14, 0, MHR.payout.w, MHR.payout.h,
            MHR.payout.color[0], MHR.payout.color[1], MHR.payout.color[2]);
        sb.e[payoutL]._lpos = v3(MHR.payout.x, MHR.payout.y, 0);
        sb.e[rowN]._components = [rf(rowUT), rf(rowSpr)];
        sb.e[rowN]._children = [rf(dateL), rf(modeL), rf(wagerL), rf(placeL), rf(payoutL)];
        sb.e[rowN]._active = false;
        pfHistoryRows.push(rowN);
    }
    sb.e[pfHistorySV.content]._children = pfHistoryRows.map(rf);
    const pfHistoryLoadMore = mkBtn(sb, 'PortfolioHistoryLoadMoreButton', pfHistoryViewN, 'Load more',
        PFE.historyLoadMore.y, PFE.historyLoadMore.w, PFE.historyLoadMore.h, 48, 70, 90);
    sb.e[pfHistoryLoadMore]._lpos = v3(PFE.historyLoadMore.x, PFE.historyLoadMore.y, 0);
    sb.e[pfHistoryLoadMore]._active = false;

    sb.e[pfHistoryViewN]._children = [rf(pfHistoryEmpty), rf(pfHistorySV.root), rf(pfHistoryLoadMore)];
    sb.e[pfHistoryViewN]._active = false;

    // Part 11 B: Trophies view — 3×2 grid of cNFT tiles from
    // LAYOUT.PortfolioPanel.templates.trophyTile.
    const pfTrophiesViewN = sb.e.length;
    sb.node('PortfolioTrophiesView', pfN, [], [], v3(PFE.trophiesView.x, PFE.trophiesView.y, 0));
    sb.ut(pfTrophiesViewN, PFE.trophiesView.w, PFE.trophiesView.h);
    const pfTrophiesEmpty = mkLabel(sb, 'PortfolioTrophiesEmptyLabel', pfTrophiesViewN,
        'No trophies yet — win a weekly season to earn your first',
        14, PFE.trophiesEmpty.y, PFE.trophiesEmpty.w, PFE.trophiesEmpty.h, 140, 150, 170);
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
            const tSpr = sb.spr(tN, 22, 28, 44);
            const emojiLbl = mkLabel(sb, 'Emoji', tN, '', 56,
                PTT.emoji.y, PTT.emoji.w, PTT.emoji.h, 255, 255, 255);
            const titleLbl = mkLabel(sb, 'Title', tN, 'Week #0', 14,
                PTT.title.y, PTT.title.w, PTT.title.h, 220, 200, 140);
            const winsLbl = mkLabel(sb, 'Wins', tN, '0 wins', 12,
                PTT.wins.y, PTT.wins.w, PTT.wins.h, 140, 150, 170);
            // Phase 14 (B4): gold edge accent — rank tile.
            const tEdge = mkCardEdge(sb, tN, PTT.w, PTT.h, 255, 210, 74);
            sb.e[tN]._components = [rf(tUT), rf(tSpr)];
            sb.e[tN]._children = [rf(emojiLbl), rf(titleLbl), rf(winsLbl), rf(tEdge)];
            sb.e[tN]._active = false;
            pfTrophyTileIndices.push(tN);
        }
    }
    sb.e[pfTrophiesViewN]._children = [rf(pfTrophiesEmpty), ...pfTrophyTileIndices.map(rf)];
    sb.e[pfTrophiesViewN]._active = false;

    sb.e[pfN]._children = [
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

    const mipBackLink = mkLabel(sb, 'BackLinkLabel', mipN, '← Back', 18,
        MIPE.backLink.y, MIPE.backLink.w, MIPE.backLink.h, 200, 210, 230);
    sb.e[mipBackLink]._lpos = v3(MIPE.backLink.x, MIPE.backLink.y, 0);
    const mipBackBtnN = mipInvisBtn('BackButton', mipN,
        MIPE.backBtn.x, MIPE.backBtn.y, MIPE.backBtn.w, MIPE.backBtn.h);

    const mipTitle = mkLabel(sb, 'MatchesInProgressTitleLabel', mipN, 'Matches In Progress', 30,
        MIPE.title.y, MIPE.title.w, MIPE.title.h, 255, 210, 74);
    style(sb, mipTitle, { bold: true });
    const mipSubtitle = mkLabel(sb, 'MatchesInProgressSubtitleLabel', mipN, 'All clear', 14,
        MIPE.subtitle.y, MIPE.subtitle.w, MIPE.subtitle.h, 168, 174, 201);

    // Empty-state cluster — toggled by AppUI when 0 active matches.
    const mipEmptyN = sb.e.length;
    sb.node('MIPEmptyState', mipN, [], [], v3(MIPE.emptyState.x, MIPE.emptyState.y, 0));
    sb.ut(mipEmptyN, MIPE.emptyState.w, MIPE.emptyState.h);
    const mipEmptyTitle = mkLabel(sb, 'MIPEmptyTitle', mipEmptyN, 'No matches running', 22,
        MIPE.emptyStateTitle.y - MIPE.emptyState.y, MIPE.emptyStateTitle.w, MIPE.emptyStateTitle.h, 244, 245, 249);
    const mipEmptySub = mkLabel(sb, 'MIPEmptySubtitle', mipEmptyN, 'Start a match and your live games will appear here.', 14,
        MIPE.emptyStateSubtitle.y - MIPE.emptyState.y, MIPE.emptyStateSubtitle.w, MIPE.emptyStateSubtitle.h, 168, 174, 201);
    const mipEmptyCta = mkBtn(sb, 'MIPEmptyCtaButton', mipEmptyN, 'Start a Match',
        MIPE.emptyStateCta.y - MIPE.emptyState.y, MIPE.emptyStateCta.w, MIPE.emptyStateCta.h, 48, 198, 155);
    sb.e[mipEmptyN]._children = [rf(mipEmptyTitle), rf(mipEmptySub), rf(mipEmptyCta)];
    sb.e[mipEmptyN]._active = false;

    // 6 fixed rows — direct children of mipN.
    const mipRows = [];
    for (let i = 0; i < MIPR.count; i++) {
        const ry = MIPR.baseY + i * MIPR.gapY;
        const rowN = sb.e.length;
        sb.node(`MIPRow_${i}`, mipN, [], [rowN+1], v3(0, ry, 0));
        sb.ut(rowN, MIPR.w, MIPR.h);

        // Thin teal accent on far left edge (only chrome).
        const edgeN = mipSolidSprite(`MIPCardEdge_${i}`, rowN,
            MIPR.edge.x, MIPR.edge.y, MIPR.edge.w, MIPR.edge.h,
            48, 198, 155, 255);

        // Full-row invisible tap target (back of stack so resume button wins clicks).
        const tapN = mipInvisBtn(`MIPTapTarget_${i}`, rowN,
            MIPR.tapTarget.x, MIPR.tapTarget.y, MIPR.tapTarget.w, MIPR.tapTarget.h);

        // VS label (left side, top): "VS BOT" / "VS @user".
        const vsLblN = mkLabel(sb, `MIPVsLabel_${i}`, rowN, '', 18,
            MIPR.vsLabel.y, MIPR.vsLabel.w, MIPR.vsLabel.h, 244, 245, 249);
        sb.e[vsLblN]._lpos = v3(MIPR.vsLabel.x, MIPR.vsLabel.y, 0);
        sb.e[sb.e[vsLblN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, vsLblN, { bold: true });

        // Time label (right side, top): "18h 42m left".
        const timeLblN = mkLabel(sb, `MIPTimeLabel_${i}`, rowN, '—', 14,
            MIPR.timeLabel.y, MIPR.timeLabel.w, MIPR.timeLabel.h, 168, 174, 201);
        sb.e[timeLblN]._lpos = v3(MIPR.timeLabel.x, MIPR.timeLabel.y, 0);
        sb.e[sb.e[timeLblN]._components[1].__id__]._horizontalAlign = 2;
        style(sb, timeLblN, { mono: true });

        // Stake chip (left, bottom): "PAPER" / "0.5 SOL".
        const stakeChipN = mkLabel(sb, `MIPStakeChip_${i}`, rowN, '', 12,
            MIPR.stakeChip.y, MIPR.stakeChip.w, MIPR.stakeChip.h, 255, 210, 74);
        sb.e[stakeChipN]._lpos = v3(MIPR.stakeChip.x, MIPR.stakeChip.y, 0);
        sb.e[sb.e[stakeChipN]._components[1].__id__]._horizontalAlign = 0;
        style(sb, stakeChipN, { bold: true, mono: true });

        // Win line (right of stake, bottom): status text.
        const winLineN = mkLabel(sb, `MIPWinLine_${i}`, rowN, '—', 12,
            MIPR.winLine.y, MIPR.winLine.w, MIPR.winLine.h, 168, 174, 201);
        sb.e[winLineN]._lpos = v3(MIPR.winLine.x, MIPR.winLine.y, 0);
        sb.e[sb.e[winLineN]._components[1].__id__]._horizontalAlign = 0;

        // Resume CTA (right, center).
        const resumeBtnN = mkBtnXY(sb, `MIPResumeBtn_${i}`, rowN, 'Resume',
            MIPR.resumeBtn.x, MIPR.resumeBtn.y,
            MIPR.resumeBtn.w, MIPR.resumeBtn.h,
            48, 198, 155);

        // Z-order: tap (back) → edge → labels → resume (front).
        sb.e[rowN]._children = [
            rf(tapN), rf(edgeN),
            rf(vsLblN), rf(timeLblN),
            rf(stakeChipN), rf(winLineN),
            rf(resumeBtnN),
        ];
        sb.e[rowN]._active = false;
        mipRows.push(rowN);
    }

    // "+N more" hint shown when active count > 6.
    const mipMoreLblN = mkLabel(sb, 'MIPMoreLabel', mipN, '', 12,
        MIPE.moreLabel.y, MIPE.moreLabel.w, MIPE.moreLabel.h, 168, 174, 201);
    sb.e[mipMoreLblN]._active = false;

    const mipStatus = mkLabel(sb, 'MatchesInProgressStatusLabel', mipN, '', 12,
        MIPE.status.y, MIPE.status.w, MIPE.status.h, 130, 140, 165);

    sb.e[mipN]._children = [
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
        WPE.rake.y, WPE.rake.w, WPE.rake.h, 160, 170, 190);
    const wpProgress = mkLabel(sb, 'WaitingProgressLabel', wpN, '0/2 players · 0:00 / 2:00', 18,
        WPE.progress.y, WPE.progress.w, WPE.progress.h, 180, 190, 210);
    style(sb, wpProgress, { mono: true });  // Phase 15 (B5): live timer + count
    const wpSpinner  = mkLabel(sb, 'WaitingSpinnerLabel', wpN, '·  ·  ·', 28,
        WPE.spinner.y, WPE.spinner.w, WPE.spinner.h, 48, 198, 155);
    const wpCancelBtn = mkBtn(sb, 'WaitingCancelButton', wpN, 'Cancel',
        WPE.cancelBtn.y, WPE.cancelBtn.w, WPE.cancelBtn.h, 55, 75, 95);
    const wpBotBtn    = mkBtn(sb, 'WaitingPlayBotButton', wpN, '▶ Play vs Bot',
        WPE.botBtn.y, WPE.botBtn.w, WPE.botBtn.h, 48, 198, 155);
    sb.e[wpBotBtn]._active = false; // revealed after timeout or immediately on paper
    // Force-settle: revealed after match active 5+ min with missing players.
    // UX Phase 2b: IconBadge bolt attached by AppUI. Phase 2c: bold.
    const wpForceBtn  = mkBtn(sb, 'WaitingForceSettleButton', wpN, 'Force Settle (AFK)',
        WPE.forceBtn.y, WPE.forceBtn.w, WPE.forceBtn.h, 202, 140, 60);
    style(sb, wpForceBtn, { bold: true });
    sb.e[wpForceBtn]._active = false;
    // Streak banner: hidden unless current_streak ≥ 3. UX Phase 2b: IconBadge flame attached by AppUI.
    const wpStreakBanner = mkLabel(sb, 'WaitingStreakBanner', wpN, 'Day 3 streak — keep the fire going', 16,
        WPE.streakBanner.y, WPE.streakBanner.w, WPE.streakBanner.h, 218, 165, 32);
    sb.e[wpStreakBanner]._active = false;
    const wpStatus = mkLabel(sb, 'WaitingStatusLabel', wpN, '', 12,
        WPE.status.y, WPE.status.w, WPE.status.h, 140, 150, 170);

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
    sb.node('PostMatchPanel', canvas, [], [], lobbyMount('PostMatchPanel'));
    // 2026-04-28 spatial pass — panel canvas grows 720×1280 → 720×1800 to
    // mirror RacePanel (Main.scene:103900). Without this, the dark wash
    // (#0B0E1A) stops at 1280 logical px and the underlying app/Home
    // gradient (#1A0B2E) bleeds through above the title on tall devices.
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

    // 2026-04-29 — uniform "← Back" header. PostMatch keeps its custom y=622
    // (above the 60pt h=80 "YOU WON" title) per LayoutSpec.PostMatchPanel.backBtn.y.
    // Rename: BackButton (label is BackLinkLabel) — but AppUI listens on the
    // PostMatchBackButton node by historic name, so we rename here for compat.
    const _pmBack = mkBackHeader(sb, pmN, { y: PME.backBtn.y });
    sb.e[_pmBack.btnN]._name = 'PostMatchBackButton';
    sb.e[_pmBack.linkN]._name = 'PostMatchBackLinkLabel';
    const pmBackBtn = _pmBack.btnN;
    // 2026-04-28 spatial pass — Back link dims to ~0.78 opacity so it doesn't
    // compete with "YOU WON" for attention. Apply UIOpacity to the visible
    // label, not the invisible hit-area button.
    const pmBackBtnOp = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(_pmBack.linkN), _enabled: true, __prefab: null,
        _opacity: 200,
    });
    sb.e[_pmBack.linkN]._components.push(rf(pmBackBtnOp));
    // Title — bold, color-coded (green on win, rose on loss) at runtime.
    // 2026-04-28 — 56pt → 60pt for slightly bigger reward-moment energy.
    const pmTitle = mkLabel(sb, 'PostMatchTitleLabel', pmN, 'YOU WON!', 60,
        PME.title.y, PME.title.w, PME.title.h, 255, 255, 255);
    style(sb, pmTitle, { bold: true });
    const pmTrack = mkLabel(sb, 'PostMatchTrackLabel', pmN, 'Paper · 1v1', 28,
        PME.track.y, PME.track.w, PME.track.h, 140, 150, 170);

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

    // 2026-04-28 spatial pass — payout 64pt → 72pt (+12.5% per spec).
    const pmPayout = mkLabel(sb, 'PostMatchPayoutLabel', pmN, '', 72,
        PME.payoutLabel.y, PME.payoutLabel.w, PME.payoutLabel.h, 48, 198, 155);
    // 2026-04-28 — subtitle now ONLY carries "Won by X.XX%" headline (one
    // line, 22pt). Per-token breakdown moves to PostMatchBreakdownLabel below.
    const pmSubtitle = mkLabel(sb, 'PostMatchSubtitleLabel', pmN, '', 22,
        PME.subtitle.y, PME.subtitle.w, PME.subtitle.h, 220, 226, 240);
    // NEW 2026-04-28 — per-token breakdown row, dimmed to opacity ~0.7 so it
    // reads as supporting context and stops competing with the +0.10 SOL hero.
    const pmBreakdown = mkLabel(sb, 'PostMatchBreakdownLabel', pmN, '', 18,
        PME.breakdown.y, PME.breakdown.w, PME.breakdown.h, 168, 174, 201);
    const pmBreakdownOp = sb.add({
        __type__: 'cc.UIOpacity', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(pmBreakdown), _enabled: true, __prefab: null,
        _opacity: 178,
    });
    sb.e[pmBreakdown]._components.push(rf(pmBreakdownOp));
    style(sb, pmBreakdown, { mono: true });
    const pmRake = mkLabel(sb, 'PostMatchRakeLabel', pmN, '', 24,
        PME.rake.y, PME.rake.w, PME.rake.h, 150, 160, 180);
    // Mono payout + rake for aligned digits through the ticker roll.
    style(sb, pmPayout, { mono: true, bold: true });
    style(sb, pmRake, { mono: true });

    // 4 stat cards from LAYOUT.PostMatchPanel.templates.pmCard.
    const pmCardIndices = [];
    for (const d of PMC.defs) {
        const cardN = sb.e.length;
        sb.node(`PMCard_${d.key}`, pmN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, PMC.w, PMC.h);
        const cardSpr = sb.spr(cardN, 18, 22, 32);
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(PMC.header.x, PMC.header.y, 0));
        const lblUT = sb.ut(lblN, PMC.header.w, PMC.header.h);
        const lblL = sb.lbl(lblN, d.label, 13, 130, 140, 165);
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
        const valSubL = sb.lbl(valSubN, '', PMC.valueSub.fontSize ?? 13, 168, 174, 201);
        style(sb, valSubN, { mono: true });
        sb.e[valSubN]._components = [rf(valSubUT), rf(valSubL)];
        // Edge accent — emitted neutral; AppUI tints per outcome (green/rose)
        // at show time. Tagged PMCardEdge_<key> so the binder can find it.
        const cardEdge = mkCardEdge(sb, cardN, PMC.w, PMC.h, 130, 140, 165);
        sb.e[cardEdge]._name = `PMCardEdge_${d.key}`;
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(lblN), rf(valN), rf(valSubN), rf(cardEdge)];
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

    // CTAs. SameSquad (renamed "▶ Play Again") gets the teal hero halo (replay-loop primary).
    // 2026-04-28 spatial pass — glow constrained to button bounds (glowPad 12 → 0
    // so halo no longer extends past button rect) and dimmed (alpha 80 → 56)
    // so it stops bleeding into the XP bar above.
    const { glow: pmSameSquadGlow, btn: pmSameSquadBtn } = mkBtnHero(sb,
        'PostMatchSameSquadButton', pmN, '▶ Play Again',
        PME.sameSquadBtn.x, PME.sameSquadBtn.y, PME.sameSquadBtn.w, PME.sameSquadBtn.h, 48, 198, 155,
        { glowPad: 0, glowAlpha: 56 });
    style(sb, pmSameSquadBtn, { bold: true });
    const pmAgainBtn = mkBtnXY(sb, 'PostMatchAgainButton', pmN, 'Pick New Squad',
        PME.againBtn.x, PME.againBtn.y, PME.againBtn.w, PME.againBtn.h, 56, 148, 252);
    style(sb, pmAgainBtn, { bold: true });

    // Share-to-X button — tertiary; only visible for real-track wins.
    const pmShareBtn = mkBtn(sb, 'PostMatchShareButton', pmN, 'Share · 𝕏',
        PME.shareButton.y, PME.shareButton.w, PME.shareButton.h, 29, 161, 242);
    sb.e[pmShareBtn]._lpos = v3(PME.shareButton.x, PME.shareButton.y, 0);

    const pmStatus = mkLabel(sb, 'PostMatchStatusLabel', pmN, '', 12,
        PME.status.y, PME.status.w, PME.status.h, 140, 150, 170);

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

    // Children order: bg-tint first (behind everything), then back btn, title row,
    // mascot glow, mascot, payout, subtitle, breakdown, rake, cards, XP bar,
    // CTAs, share, status, trophy.
    sb.e[pmN]._children = [
        rf(pmOutcomeBgN),
        rf(_pmBack.linkN), rf(pmBackBtn), rf(pmTitle), rf(pmTrack), rf(pmTrophy),
        rf(pmMascotGlowN), rf(pmMascotN),
        rf(pmPayout), rf(pmSubtitle), rf(pmBreakdown), rf(pmRake),
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

    // Phase 30 — subtle dark sheet behind all content cards. Sits at the front
    // of the children list so cards drawn afterward appear "lifted" on top.
    // Phase 31 — alpha 180 → 160 to drop visual noise behind the title row.
    const stSheetBg = mkColoredSprite('SettingsSheetBg', stN,
        SP.sheetBg.x, SP.sheetBg.y, SP.sheetBg.w, SP.sheetBg.h,
        8, 10, 20, 160);

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
    const stTitle = mkLabel(sb, 'SettingsTitleLabel', stN, 'Settings', 28,
        SP.title.y, SP.title.w, SP.title.h, 218, 165, 32);
    style(sb, stTitle, { bold: true });

    // WALLET → identity-anchor card. Phase 30 / Phase 31:
    //   - Compact 124px tall, lifted bg (28,36,58) so it reads as the
    //     visually heaviest card.
    //   - "Connected · MWA" 12px mid-text on the top row, next to the dot.
    //   - Pubkey row promoted to mono 22px BOLD hi-text.
    //   - 1px hairline divider between pubkey and balance.
    //   - Balance promoted to mono 20px BOLD bright teal — primary stat.
    //   - 4-stroke teal perimeter glow ties card to the connected accent.
    //   - AppUI._hydrateSettingsPanel attaches an idle pulse to the dot when
    //     a wallet is connected (kills the tween on disconnect).
    const WC = SP.walletCard.children;
    const stWalletCard = sb.e.length;
    sb.node('WalletCard', stN, [], [], v3(SP.walletCard.x, SP.walletCard.y, 0));
    const stWalletCardUT = sb.ut(stWalletCard, SP.walletCard.w, SP.walletCard.h);
    const stWalletCardSpr = sb.spr(stWalletCard, 28, 36, 58);

    const stWalletHeader = mkLabel(sb, 'HeaderLabel', stWalletCard, 'WALLET', 12,
        WC.header.y, WC.header.w, WC.header.h, 140, 150, 170);
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
        WC.walletName.y, WC.walletName.w, WC.walletName.h, 168, 174, 201);
    sb.e[stWalletName]._lpos = v3(WC.walletName.x, WC.walletName.y, 0);
    sb.e[sb.e[stWalletName]._components[1].__id__]._horizontalAlign = 0;

    // Prominent pubkey — mono 22px bold hi-text, left-aligned.
    const stWalletPubkey = mkLabel(sb, 'WalletPubkeyLabel', stWalletCard, '—', 22,
        WC.walletPubkey.y, WC.walletPubkey.w, WC.walletPubkey.h, 244, 245, 249);
    sb.e[stWalletPubkey]._lpos = v3(WC.walletPubkey.x, WC.walletPubkey.y, 0);
    sb.e[sb.e[stWalletPubkey]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stWalletPubkey, { mono: true, bold: true });

    const stCopyBtn = mkInvisBtnXY('CopyPubkeyButton', stWalletCard,
        WC.copyPubkeyBtn.x, WC.copyPubkeyBtn.y, WC.copyPubkeyBtn.w, WC.copyPubkeyBtn.h);

    const stWalletDivider = mkColoredSprite('WalletDivider', stWalletCard,
        WC.divider.x, WC.divider.y, WC.divider.w, WC.divider.h,
        255, 255, 255, 24);

    // Balance — primary stat. Mono 20px bold bright teal, left-aligned.
    const stWalletBal = mkLabel(sb, 'WalletBalanceLabel', stWalletCard, '', 20,
        WC.walletBalance.y, WC.walletBalance.w, WC.walletBalance.h, 20, 241, 149);
    sb.e[stWalletBal]._lpos = v3(WC.walletBalance.x, WC.walletBalance.y, 0);
    sb.e[sb.e[stWalletBal]._components[1].__id__]._horizontalAlign = 0;
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
        rf(stWalletPubkey), rf(stCopyBtn),
        rf(stWalletDivider), rf(stWalletBal),
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
    const stProfileCardSpr = sb.spr(stProfileCard, 24, 30, 48);
    const stProfileHeader = mkLabel(sb, 'HeaderLabel', stProfileCard, 'PROFILE', 14,
        PC.header.y, PC.header.w, PC.header.h, 140, 150, 170);
    sb.e[stProfileHeader]._lpos = v3(PC.header.x, PC.header.y, 0);
    sb.e[sb.e[stProfileHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stProfileHeader, { spacing: 1 });

    const stUsernameLabel = mkLabel(sb, 'UsernameLabel', stProfileCard, 'Username', 14,
        PC.usernameLabel.y, PC.usernameLabel.w, PC.usernameLabel.h, 168, 174, 201);
    sb.e[stUsernameLabel]._lpos = v3(PC.usernameLabel.x, PC.usernameLabel.y, 0);
    sb.e[sb.e[stUsernameLabel]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stUsernameLabel, { spacing: 1 });

    // ── Display-mode subtree (default visible). ────────────────────────────
    // Big username readout + small ghost pencil button on the right.
    const stUsernameDisplay = mkLabel(sb, 'UsernameDisplayLabel', stProfileCard,
        'Set username', 22,
        PC.usernameDisplay.y, PC.usernameDisplay.w, PC.usernameDisplay.h,
        244, 245, 249);
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
        0, PC.editUsernameBtn.w, PC.editUsernameBtn.h, 168, 174, 201);
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
    const stUsernameHelp = mkLabel(sb, 'UsernameHelpLabel', stProfileCard,
        '🏆  Displayed on leaderboard & matches', 12,
        PC.usernameHelp.y, PC.usernameHelp.w, PC.usernameHelp.h, 110, 120, 145);
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
    const stQpSpr = sb.spr(stQpCardN, 24, 30, 48);
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
        const spr = sb.spr(rowN, 28, 34, 48);
        const btn = sb.btn(rowN, 28, 34, 48);
        const keySp = rowSpec.children.keyLabel;
        const keyN = mkLabel(sb, `${name}KeyLabel`, rowN, keyText, 16,
            keySp.y, keySp.w, keySp.h, 140, 150, 170);
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
            chevSp.y, chevSp.w, chevSp.h, 140, 150, 170);
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
        trkSpc.y, trkSpc.w, trkSpc.h, 140, 150, 170);
    sb.e[stQpTrackKey]._lpos = v3(trkSpc.x, trkSpc.y, 0);
    sb.e[sb.e[stQpTrackKey]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stQpTrackKey, { spacing: 1 });

    const tt = QPC.qpTrackToggle;
    const stQpTrackToggle = sb.e.length;
    sb.node('QPTrackToggle', stQpCardN, [], [], v3(tt.x, tt.y, 0));
    const ttUT = sb.ut(stQpTrackToggle, tt.w, tt.h);
    const ttSpr = sb.spr(stQpTrackToggle, 22, 28, 42);
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
        ttRL.y, ttRL.w, ttRL.h, 160, 170, 190);
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
        const spr = sb.spr(popN, 18, 24, 36);
        const optIdxs = [];
        for (let p = 0; p < optTemplate.count; p++) {
            const oN = mkBtnXY(sb, `${name}_${optTemplate.keys[p]}`, popN, optTemplate.labels[p],
                0, optTemplate.ys[p], optTemplate.w, optTemplate.h, 28, 34, 48);
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
    const stAudioSpr = sb.spr(stAudioCardN, 22, 28, 44);
    const stAudioHeader = mkLabel(sb, 'HeaderLabel', stAudioCardN, 'PREFERENCES', 14,
        AC.header.y, AC.header.w, AC.header.h, 140, 150, 170);
    sb.e[stAudioHeader]._lpos = v3(AC.header.x, AC.header.y, 0);
    sb.e[sb.e[stAudioHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stAudioHeader, { spacing: 1 });

    const buildPrefToggleRow = (rowName, rowSpec, labelText, iconChildName) => {
        const rowN = sb.e.length;
        sb.node(rowName, stAudioCardN, [], [], v3(rowSpec.x, rowSpec.y, 0));
        const rowUT = sb.ut(rowN, rowSpec.w, rowSpec.h);
        const rowSpr = sb.spr(rowN, 28, 34, 48);
        const rowBtn = sb.btn(rowN, 28, 34, 48);

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
            kSp.x, kSp.y, kSp.w, kSp.h, 244, 245, 249, 255);

        // Legacy pillBg / pillLbl — deactivated nodes kept for verifier
        // allowedOverlaps + back-compat with any external lookups.
        const pSp = rowSpec.children.pillBg;
        const pillBgN = mkColoredSprite(`${rowName}PillBg`, rowN,
            pSp.x, pSp.y, pSp.w, pSp.h, 48, 198, 155, 0);
        sb.e[pillBgN]._active = false;

        const plSp = rowSpec.children.pillLbl;
        const pillLblN = mkLabel(sb, `${rowName}PillLabel`, rowN, '', 13,
            plSp.y, plSp.w, plSp.h, 11, 14, 26);
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
    const stAccountSpr = sb.spr(stAccountCardN, 20, 26, 40);
    const stAccountHeader = mkLabel(sb, 'HeaderLabel', stAccountCardN, 'ACCOUNT', 14,
        ACC.header.y, ACC.header.w, ACC.header.h, 140, 150, 170);
    sb.e[stAccountHeader]._lpos = v3(ACC.header.x, ACC.header.y, 0);
    sb.e[sb.e[stAccountHeader]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stAccountHeader, { spacing: 1 });

    const stAccountGeneral = mkLabel(sb, 'AccountGeneralGroupLabel', stAccountCardN, 'GENERAL', 12,
        ACC.generalGroupLabel.y, ACC.generalGroupLabel.w, ACC.generalGroupLabel.h, 93, 100, 133);
    sb.e[stAccountGeneral]._lpos = v3(ACC.generalGroupLabel.x, ACC.generalGroupLabel.y, 0);
    sb.e[sb.e[stAccountGeneral]._components[1].__id__]._horizontalAlign = 0;
    style(sb, stAccountGeneral, { spacing: 1 });

    const stAccountSession = mkLabel(sb, 'AccountSessionGroupLabel', stAccountCardN, 'SESSION', 12,
        ACC.sessionGroupLabel.y, ACC.sessionGroupLabel.w, ACC.sessionGroupLabel.h, 93, 100, 133);
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
        const rowSpr = sb.spr(rowN, 28, 34, 48);
        const rowBtn = sb.btn(rowN, 28, 34, 48);

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
            cSp.y, cSp.w, cSp.h, 140, 150, 170);
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
        140, 150, 170);
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
        SP.status.y, SP.status.w, SP.status.h, 140, 150, 170);

    sb.e[stN]._children = [
        // Phase 30 — sheet bg sits BEHIND every card by being added first.
        rf(stSheetBg),
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
            _color: cl(22, 28, 42, 245),
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
            TCC.hint.y, TCC.hint.w, TCC.hint.h, 140, 150, 170);
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
    const _specBack = mkBackHeader(sb, specN, { y: SPE.backBtn.y });
    sb.e[_specBack.btnN]._name = 'SpectatorBackButton';
    sb.e[_specBack.linkN]._name = 'SpectatorBackLinkLabel';
    const specBackBtn = _specBack.btnN;
    // UX Phase 2b: IconBadge eye attached by AppUI. Phase 2c: bold.
    // 9c: title w 460→300 to clear BackButton bbox right x=-180.
    const specTitle = mkLabel(sb, 'SpectatorTitleLabel', specN, 'Spectating', 28,
        SPE.title.y, SPE.title.w, SPE.title.h, 255, 255, 255);
    style(sb, specTitle, { bold: true });
    const specMatchLabel = mkLabel(sb, 'SpectatorMatchLabel', specN, 'match —', 13,
        SPE.matchLabel.y, SPE.matchLabel.w, SPE.matchLabel.h, 140, 150, 170);
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
        const rSpr = sb.spr(rN, 22, 28, 42);
        const pkLbl = mkLabel(sb, 'Pubkey', rN, '—', 14, 0, SPL.pubkey.w, SPL.pubkey.h, 220, 230, 240);
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
        SPE.eventListHeader.y, SPE.eventListHeader.w, SPE.eventListHeader.h, 140, 150, 170);
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
        SPE.joinBtn.x, SPE.joinBtn.y, SPE.joinBtn.w, SPE.joinBtn.h, 48, 198, 155);
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
    const _tourBack = mkBackHeader(sb, tourN, { y: TPE.backBtn.y });
    sb.e[_tourBack.btnN]._name = 'TournamentBackButton';
    sb.e[_tourBack.linkN]._name = 'TournamentBackLinkLabel';
    const tourBackBtn = _tourBack.btnN;
    // UX Phase 2b: IconBadge sword attached by AppUI. Phase 2c: bold.
    // 9c: title w 460→300 to clear BackButton bbox right x=-180.
    const tourTitle = mkLabel(sb, 'TournamentTitleLabel', tourN, 'Tournament', 28,
        TPE.title.y, TPE.title.w, TPE.title.h, 230, 210, 255);
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
        TPE.joinBtn.x, TPE.joinBtn.y, TPE.joinBtn.w, TPE.joinBtn.h, 140, 80, 200);
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

    // Header: back, title, refresh.
    // 2026-04-29 — uniform "← Back" header, mirrors MIP.
    const _fmBack = mkBackHeader(sb, fmN, { y: FME.backBtn.y });
    sb.e[_fmBack.btnN]._name = 'FindMatchBackButton';
    sb.e[_fmBack.linkN]._name = 'FindMatchBackLinkLabel';
    const fmBackBtn = _fmBack.btnN;
    const fmTitle = mkLabel(sb, 'FindMatchTitleLabel', fmN, 'Find a Match', 30,
        FME.title.y, FME.title.w, FME.title.h, 218, 165, 32);
    style(sb, fmTitle, { bold: true });
    const fmRefreshBtn = mkBtnXY(sb, 'FindMatchRefreshButton', fmN, '↻',
        FME.refreshBtn.x, FME.refreshBtn.y, FME.refreshBtn.w, FME.refreshBtn.h,
        38, 44, 64);
    const fmCountLabel = mkLabel(sb, 'FindMatchCountLabel', fmN, '— open lobbies', 14,
        FME.countLabel.y, FME.countLabel.w, FME.countLabel.h, 218, 165, 32);
    style(sb, fmCountLabel, { bold: true });

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
        _color: cl(28, 34, 48, 220),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    const fmLvXpChipLbl = mkLabel(sb, 'FindMatchLvXpChipLabel', fmLvXpChipN, 'Lv 1 · 0 XP', 14, 0,
        FME.lvxpChip.w - 16, FME.lvxpChip.h - 6, 218, 165, 32);
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
    const INACTIVE_TAB = [28, 34, 48];

    // 2026-04-27 FindMatch redesign — single unified FilterCard replaces the
    // prior 4 separate row containers (Tab/Mode/Window/Wager). Mode/Window/Wager
    // chip rows visually sit inside this card with two hairline dividers between
    // them. Tabs are now a stand-alone nav element with a sliding violet underline.
    const makeFilterCard = () => {
        const cN = sb.e.length;
        sb.node('FilterCard', fmN, [], [], v3(FME.filterCard.x, FME.filterCard.y, 0));
        const cUT = sb.ut(cN, FME.filterCard.w, FME.filterCard.h);
        const cSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(cN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            // 2026-04-28 polish — Phase A flatten: chips float on panel surface,
            // FilterCard fill+edge invisible (alpha 0), dividers hidden below.
            _color: cl(28, 34, 48, 0),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        const eN = mkCardEdge(sb, cN, FME.filterCard.w, FME.filterCard.h, 153, 69, 255, 0); // hidden in flatten
        sb.e[cN]._components = [rf(cUT), rf(cSpr)];
        sb.e[cN]._children = [rf(eN)];
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
            spec.y, spec.w, spec.h, 168, 174, 201);
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

    // 3 filter rows (Mode / Window / Wager) — teal active to read distinct from tabs.
    const fmModeIndices = buildFmRow(FMT.fmModeFilter, 'FilterMode', ACTIVE_FILTER_CHIP, INACTIVE_TAB);
    const fmWindowIndices = buildFmRow(FMT.fmWindowFilter, 'FilterWindow', ACTIVE_FILTER_CHIP, INACTIVE_TAB);
    const fmWagerIndices = buildFmRow(FMT.fmWagerFilter, 'FilterWager', ACTIVE_FILTER_CHIP, INACTIVE_TAB);

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
    // 2026-04-28 final pass — tab glow violet (matches active tab tint);
    // filter row glows keep their per-row palette identity.
    const fmTabGlows    = buildChipGlows(FMT.fmTab,           'FindMatchTab', [153, 69, 255]);
    const fmModeGlows   = buildChipGlows(FMT.fmModeFilter,    'FilterMode',   [20, 241, 149]);
    const fmWindowGlows = buildChipGlows(FMT.fmWindowFilter,  'FilterWindow', [40, 180, 140]);
    const fmWagerGlows  = buildChipGlows(FMT.fmWagerFilter,   'FilterWager',  [255, 180, 84]);

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
        const rSpr = sb.spr(rN, 22, 28, 42);
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

        const modeL = mkLabel(sb, `MatchCardModeLabel_${i}`, rN, '1v1', 18,
            MR.mode.y, MR.mode.w, MR.mode.h, 220, 230, 240);
        sb.e[modeL]._lpos = v3(MR.mode.x, MR.mode.y, 0);
        sb.e[sb.e[modeL]._components[1].__id__]._horizontalAlign = 0;
        sb.e[sb.e[modeL]._components[1].__id__]._isBold = true;
        // Bold gold wager hero — center-prominent. 2026-04-28 final pass: 20 → 26.
        const wagerL = mkLabel(sb, `MatchCardWagerLabel_${i}`, rN, '0.05 SOL', 26,
            MR.wager.y, MR.wager.w, MR.wager.h, 218, 165, 32);
        sb.e[wagerL]._lpos = v3(MR.wager.x, MR.wager.y, 0);
        style(sb, wagerL, { mono: true, bold: true });
        sb.e[sb.e[wagerL]._components[1].__id__]._horizontalAlign = 0;
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

        const winL = mkLabel(sb, `MatchCardWindowLabel_${i}`, rN, '⏱  30s race', 14,
            MR.window.y, MR.window.w, MR.window.h, 140, 220, 180);
        sb.e[winL]._lpos = v3(MR.window.x, MR.window.y, 0);
        sb.e[sb.e[winL]._components[1].__id__]._horizontalAlign = 0;
        const subL = mkLabel(sb, `MatchCardSubLabel_${i}`, rN, '1/2 players · 0:42 ago', 13,
            MR.sub.y, MR.sub.w, MR.sub.h, 160, 170, 190);
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
        FME.tailHintTitle.y, FME.tailHintTitle.w, FME.tailHintTitle.h, 168, 174, 201);
    sb.e[sb.e[fmTailHintTitle]._components[1].__id__]._isBold = true;
    sb.e[fmTailHintTitle]._active = false;
    const fmTailHintSubtitle = mkLabel(sb, 'FindMatchTailHintSubtitle', fmN,
        'Adjust filters or start your own duel', 14,
        FME.tailHintSubtitle.y, FME.tailHintSubtitle.w, FME.tailHintSubtitle.h, 110, 118, 140);
    sb.e[fmTailHintSubtitle]._active = false;
    // Reset Filters — ghost button (slightly dimmed bg + mid-gray label).
    const fmTailResetBtn = mkBtnXY(sb, 'FindMatchTailResetButton', fmN, 'Reset Filters',
        FME.tailResetBtn.x, FME.tailResetBtn.y, FME.tailResetBtn.w, FME.tailResetBtn.h,
        40, 46, 68);
    sb.e[fmTailResetBtn]._active = false;
    // Start a Duel — ghost button mirroring Reset for visual parity.
    const fmTailStartBtn = mkBtnXY(sb, 'FindMatchTailStartButton', fmN, 'Start a Duel',
        FME.tailStartBtn.x, FME.tailStartBtn.y, FME.tailStartBtn.w, FME.tailStartBtn.h,
        40, 46, 68);
    sb.e[fmTailStartBtn]._active = false;

    // Legacy empty state — kept for fallback. _active=false by default.
    const fmEmptyL = mkLabel(sb, 'FindMatchEmptyLabel', fmN, 'No open lobbies match these filters — host one or play a bot.', 14,
        FME.emptyLabel.y, FME.emptyLabel.w, FME.emptyLabel.h, 140, 150, 170);
    sb.e[fmEmptyL]._active = false;

    // Phase A2 — gamified empty-state cluster (mascot + dual CTAs).
    const fmEmptyMascotN = sb.e.length;
    sb.node('FindMatchEmptyMascot', fmN, [], [], v3(FME.emptyMascot.x, FME.emptyMascot.y, 0));
    const fmEmptyMascotUT = sb.ut(fmEmptyMascotN, FME.emptyMascot.w, FME.emptyMascot.h);
    sb.e[fmEmptyMascotN]._components = [rf(fmEmptyMascotUT)];
    sb.e[fmEmptyMascotN]._active = false;
    const fmEmptyTitle = mkLabel(sb, 'FindMatchEmptyTitle', fmN, 'No matches yet', 24,
        FME.emptyTitle.y, FME.emptyTitle.w, FME.emptyTitle.h, 218, 165, 32);
    style(sb, fmEmptyTitle, { bold: true });
    sb.e[fmEmptyTitle]._active = false;
    const fmEmptySubtitle = mkLabel(sb, 'FindMatchEmptySubtitle', fmN,
        'Be the first to host — others will join in seconds.', 14,
        FME.emptySubtitle.y, FME.emptySubtitle.w, FME.emptySubtitle.h, 168, 174, 201);
    sb.e[fmEmptySubtitle]._active = false;
    const fmEmptyHostBtn = mkBtnXY(sb, 'FindMatchEmptyHostButton', fmN, 'Host New Match',
        FME.emptyHostBtn.x, FME.emptyHostBtn.y, FME.emptyHostBtn.w, FME.emptyHostBtn.h,
        VAR('success').r, VAR('success').g, VAR('success').b);
    style(sb, fmEmptyHostBtn, { bold: true });
    sb.e[fmEmptyHostBtn]._active = false;
    const fmEmptyBotBtn = mkBtnXY(sb, 'FindMatchEmptyBotButton', fmN, 'Play a Bot',
        FME.emptyBotBtn.x, FME.emptyBotBtn.y, FME.emptyBotBtn.w, FME.emptyBotBtn.h,
        VAR('warn').r, VAR('warn').g, VAR('warn').b);
    style(sb, fmEmptyBotBtn, { bold: true });
    sb.e[fmEmptyBotBtn]._active = false;

    // Legacy Host CTA — superseded by FindMatchEmptyHostButton; kept for back-compat
    // binding. Hidden by default.
    const fmHostBtn = mkBtn(sb, 'FindMatchHostButton', fmN, 'Host New Match',
        FME.hostBtn.y, FME.hostBtn.w, FME.hostBtn.h,
        VAR('warn').r, VAR('warn').g, VAR('warn').b);
    style(sb, fmHostBtn, { bold: true });
    sb.e[fmHostBtn]._active = false;
    const fmStatus = mkLabel(sb, 'FindMatchStatusLabel', fmN, '', 12,
        FME.status.y, FME.status.w, FME.status.h, 140, 150, 170);

    // 2026-04-28 polish — Phase G: ambient particle drift container. Empty Node;
    // AppUI._showFindMatchPanel calls addParticleDrift(layer, 4) on first show.
    // Sits as the FIRST child so particles render BEHIND every other element.
    const fmAmbientLayerN = sb.e.length;
    sb.node('FindMatchAmbientLayer', fmN, [], [], v3(0, 0, 0));
    const fmAmbientLayerUT = sb.ut(fmAmbientLayerN, LAYOUT.FindMatchPanel.canvas.w, LAYOUT.FindMatchPanel.canvas.h);
    sb.e[fmAmbientLayerN]._components = [rf(fmAmbientLayerUT)];

    sb.e[fmN]._children = [
        // Ambient layer FIRST so 4 drifting violet/teal particles render behind everything.
        rf(fmAmbientLayerN),
        rf(_fmBack.linkN), rf(fmBackBtn), rf(fmTitle), rf(fmRefreshBtn), rf(fmCountLabel),
        rf(fmLivePulseDotN),
        rf(fmLvXpChipN),
        // 2026-04-28 final pass — FilterCard FIRST so all sub-elements render on top.
        rf(fmFilterCard),
        rf(fmFilterDivider1), rf(fmFilterDivider2), rf(fmFilterDivider3),
        rf(fmModeRowLabel), rf(fmWindowRowLabel), rf(fmWagerRowLabel),
        // Tab underline sits between FilterCard and the tab buttons.
        rf(fmTabUnderlineN),
        // Then chip glows — sit between the container and the chip itself.
        ...fmTabGlows.map(rf), ...fmModeGlows.map(rf), ...fmWindowGlows.map(rf), ...fmWagerGlows.map(rf),
        // Finally the chips themselves on top.
        rf(fmTabOpen), rf(fmTabLive),
        ...fmModeIndices.map(rf),
        ...fmWindowIndices.map(rf),
        ...fmWagerIndices.map(rf),
        rf(fmHideFullBtn),
        ...fmRowIndices.map(rf),
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
        JCE.title.y, JCE.title.w, JCE.title.h, 218, 165, 32);
    style(sb, jcTitle, { bold: true });
    const jcSubtitle = mkLabel(sb, 'JoinConfirmSubtitleLabel', jcCardN, 'Review the lobby — then Join.', 14,
        JCE.subtitle.y, JCE.subtitle.w, JCE.subtitle.h, 168, 174, 201);

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
        JCE.wagerHero.y, JCE.wagerHero.w, JCE.wagerHero.h, 218, 165, 32);
    style(sb, jcWagerHero, { bold: true, mono: true });

    // Window + capacity meta row.
    const jcWindowL = mkLabel(sb, 'JoinConfirmWindowLabel', jcCardN, '30s race', 16,
        JCE.windowLabel.y, JCE.windowLabel.w, JCE.windowLabel.h, 168, 174, 201);
    sb.e[jcWindowL]._lpos = v3(JCE.windowLabel.x, JCE.windowLabel.y, 0);
    const jcCapacityL = mkLabel(sb, 'JoinConfirmCapacityLabel', jcCardN, '1/2 players', 16,
        JCE.capacityLabel.y, JCE.capacityLabel.w, JCE.capacityLabel.h, 168, 174, 201);
    sb.e[jcCapacityL]._lpos = v3(JCE.capacityLabel.x, JCE.capacityLabel.y, 0);

    // Host + age row.
    const jcHostL = mkLabel(sb, 'JoinConfirmHostLabel', jcCardN, 'Host: 5Ksq…sDst', 14,
        JCE.hostLabel.y, JCE.hostLabel.w, JCE.hostLabel.h, 140, 150, 170);
    sb.e[jcHostL]._lpos = v3(JCE.hostLabel.x, JCE.hostLabel.y, 0);
    const jcAgeL = mkLabel(sb, 'JoinConfirmAgeLabel', jcCardN, '0:42 ago', 14,
        JCE.ageLabel.y, JCE.ageLabel.w, JCE.ageLabel.h, 140, 150, 170);
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
        VAR('success').r, VAR('success').g, VAR('success').b);
    style(sb, jcGoBtn, { bold: true });
    const jcHint = mkLabel(sb, 'JoinConfirmHintLabel', jcCardN, 'You\'ll pick 3 tokens next.', 12,
        JCE.hint.y, JCE.hint.w, JCE.hint.h, 140, 150, 170);

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
        COE.bigLabel.y, COE.bigLabel.w, COE.bigLabel.h, 218, 165, 32);
    const countdownSquadN = mkLabel(sb, 'CountdownSquadPreviewLabel', countdownN, 'Your squad', 24,
        COE.squadLabel.y, COE.squadLabel.w, COE.squadLabel.h, 180, 190, 210);
    const countdownHintN = mkLabel(sb, 'CountdownHintLabel', countdownN, 'Match starting…', 18,
        COE.hintLabel.y, COE.hintLabel.w, COE.hintLabel.h, 140, 150, 170);
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
        SOE.spinner.y, SOE.spinner.w, SOE.spinner.h, 218, 165, 32);
    const signingStatusN = mkLabel(sb, 'SigningStatusLabel', signingN, 'Awaiting wallet approval…', 24,
        SOE.statusLabel.y, SOE.statusLabel.w, SOE.statusLabel.h, 230, 230, 240);
    const signingHintN = mkLabel(sb, 'SigningHintLabel', signingN, 'Check your wallet app — sign to continue.', 16,
        SOE.hintLabel.y, SOE.hintLabel.w, SOE.hintLabel.h, 140, 150, 170);
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
        LOE.spinner.y, LOE.spinner.w, LOE.spinner.h, 218, 165, 32);
    const loadingStatusN  = mkLabel(sb, 'LoadingStatusLabel',  loadingN, 'Loading…', 24,
        LOE.statusLabel.y, LOE.statusLabel.w, LOE.statusLabel.h, 230, 230, 240);
    const loadingTipN     = mkLabel(sb, 'LoadingTipLabel',     loadingN, '', 16,
        LOE.tipLabel.y, LOE.tipLabel.w, LOE.tipLabel.h, 140, 150, 170);
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
        LUE.title.y, LUE.title.w, LUE.title.h, 218, 165, 32);
    style(sb, luTitle, { bold: true });
    // Big level number with count-up tween at runtime.
    const luBigLevel = mkLabel(sb, 'LevelUpBigLevel', luN, '5', 180,
        LUE.bigLevel.y, LUE.bigLevel.w, LUE.bigLevel.h, 255, 240, 200);
    style(sb, luBigLevel, { bold: true });
    // Caption (e.g. "Level 5 reached").
    const luCaption = mkLabel(sb, 'LevelUpCaptionLabel', luN, 'Level 5 reached', 26,
        LUE.caption.y, LUE.caption.w, LUE.caption.h, 220, 230, 240);
    // Rake discount callout (teal accent).
    const luRake = mkLabel(sb, 'LevelUpRakeLabel', luN, 'Your rake: 4.5% (was 5.0%)', 22,
        LUE.rake.y, LUE.rake.w, LUE.rake.h, 48, 198, 155);
    // Hint at the bottom.
    const luHint = mkLabel(sb, 'LevelUpHintLabel', luN, 'tap to continue', 14,
        LUE.hint.y, LUE.hint.w, LUE.hint.h, 140, 150, 170);
    sb.e[luN]._children = [rf(luTitle), rf(luBigLevel), rf(luCaption), rf(luRake), rf(luHint)];
    sb.e[luN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase N3 — NotificationPanel (right-side tray slide-in).
    // 2026-04-28 refactor: card narrowed 480→400 (≈55% canvas), backdrop
    // moved off the root onto a dedicated child node with UIOpacity so
    // AppUI can fade a real scrim (alpha 0→90) in parallel with the card
    // slide. Header now hosts title + Mark-all-read inline; close ✕ in
    // the top-right corner. A 1px divider separates header from list.
    // Group labels (Now / Today / Earlier) and an empty-state group
    // (icon + title + subtitle) added; AppUI shows/hides based on data.
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
        _color: cl(11, 14, 26, 255), // Palette.bg.primary
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });
    sb.e[npCardN]._components = [rf(npCardUT), rf(npCardSpr)];

    // Header row: title (left) · Mark-all-read (right) · close ✕ (top-right corner).
    const npHeader = mkLabel(sb, 'NotifHeaderLabel', npCardN, 'Notifications', 22,
        NPE.cardHeaderLabel.y, NPE.cardHeaderLabel.w, NPE.cardHeaderLabel.h, 218, 165, 32);
    sb.e[npHeader]._lpos = v3(NPE.cardHeaderLabel.x, NPE.cardHeaderLabel.y, 0);
    sb.e[sb.e[npHeader]._components[1].__id__]._horizontalAlign = 0; // left-align
    sb.e[sb.e[npHeader]._components[1].__id__]._isBold = true;
    const npCloseBtn = mkBtnXY(sb, 'NotifCloseButton', npCardN, '✕',
        NPE.cardCloseButton.x, NPE.cardCloseButton.y,
        NPE.cardCloseButton.w, NPE.cardCloseButton.h, 30, 36, 52);
    const npMarkAllBtn = mkBtnXY(sb, 'NotifMarkAllReadButton', npCardN, 'Mark all read',
        NPE.cardMarkAllReadButton.x, NPE.cardMarkAllReadButton.y,
        NPE.cardMarkAllReadButton.w, NPE.cardMarkAllReadButton.h, 38, 44, 64);
    // Selection-mode CTA — sibling of MarkAllRead in the new 50/50 row.
    // Label morphs in AppUI: "Mark as Read" → "Mark N Read - Confirm".
    const npMarkAsReadBtn = mkBtnXY(sb, 'NotifMarkAsReadButton', npCardN, 'Mark as Read',
        NPE.cardMarkAsReadButton.x, NPE.cardMarkAsReadButton.y,
        NPE.cardMarkAsReadButton.w, NPE.cardMarkAsReadButton.h, 38, 44, 64);

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

    // Group labels — created inactive; AppUI activates per group with text + Y.
    const groupSpecs = [
        { name: 'NotifGroupLabel_now',     spec: NPE.groupLabelNow,     text: 'Now' },
        { name: 'NotifGroupLabel_today',   spec: NPE.groupLabelToday,   text: 'Today' },
        { name: 'NotifGroupLabel_earlier', spec: NPE.groupLabelEarlier, text: 'Earlier' },
    ];
    const npGroupLabelIndices = [];
    for (const { name, spec, text } of groupSpecs) {
        const gN = mkLabel(sb, name, npListN, text, 12, spec.y, spec.w, spec.h, 168, 174, 201);
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
            const rSpr = sb.spr(rN, 22, 28, 42); // dark slate card
            const rBtn = sb.add({
                __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(rN), _enabled: true, __prefab: null,
                _interactable: true, _transition: 0,
                _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
                _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
                _duration: 0.1, _zoomScale: 1.02, _target: rf(rN), _id: gid(),
            });
            // Color stripe — left edge.
            const stripeN = sb.e.length;
            sb.node(`NotifRowStripe_${i}`, rN, [], [], v3(NR.stripe.x, NR.stripe.y, 0));
            const stripeUT = sb.ut(stripeN, NR.stripe.w, NR.stripe.h);
            const stripeSpr = sb.add({
                __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(stripeN), _enabled: true, __prefab: null,
                _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
                _color: cl(153, 69, 255, 255),
                _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
                _type: 1, _fillType: 0, _sizeMode: 0,
                _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
                _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
                _id: gid(),
            });
            sb.e[stripeN]._components = [rf(stripeUT), rf(stripeSpr)];
            // Icon container — to the right of stripe.
            const iconN = sb.e.length;
            sb.node(`NotifRowIcon_${i}`, rN, [], [], v3(NR.icon.x, NR.icon.y, 0));
            const iconUT = sb.ut(iconN, NR.icon.w, NR.icon.h);
            sb.e[iconN]._components = [rf(iconUT)];
            // Checkbox frame — between stripe and icon. Hidden by default;
            // AppUI._setNotifSelectionMode flips active state.
            const cbN = sb.e.length;
            sb.node(`NotifRowCheckbox_${i}`, rN, [], [], v3(NR.checkbox.x, NR.checkbox.y, 0));
            const cbUT = sb.ut(cbN, NR.checkbox.w, NR.checkbox.h);
            const cbSpr = sb.add({
                __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(cbN), _enabled: true, __prefab: null,
                _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
                _color: cl(168, 174, 201, 60),
                _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
                _type: 1, _fillType: 0, _sizeMode: 0,
                _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
                _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
                _id: gid(),
            });
            // Checkmark — teal inner sprite (matches match_settled accent).
            // AppUI sets active per-row when its id is in _notifSelectedIds.
            const cmN = sb.e.length;
            sb.node(`NotifRowCheckmark_${i}`, cbN, [], [], v3(0, 0, 0));
            const cmUT = sb.ut(cmN, 18, 18);
            const cmSpr = sb.add({
                __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(cmN), _enabled: true, __prefab: null,
                _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
                _color: cl(48, 198, 155, 255),
                _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
                _type: 1, _fillType: 0, _sizeMode: 0,
                _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
                _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
                _id: gid(),
            });
            sb.e[cmN]._components = [rf(cmUT), rf(cmSpr)];
            sb.e[cmN]._active = false;
            sb.e[cbN]._components = [rf(cbUT), rf(cbSpr)];
            sb.e[cbN]._children = [rf(cmN)];
            sb.e[cbN]._active = false;
            // Title — bold 16pt.
            const titleN = mkLabel(sb, `NotifRowTitleLabel_${i}`, rN, 'Title', 16, 18, NR.title.w, NR.title.h, 244, 245, 249);
            sb.e[titleN]._lpos = v3(NR.title.x, NR.title.y, 0);
            sb.e[sb.e[titleN]._components[1].__id__]._horizontalAlign = 0;
            sb.e[sb.e[titleN]._components[1].__id__]._isBold = true;
            // Body — 13pt, two lines.
            const bodyN = mkLabel(sb, `NotifRowBodyLabel_${i}`, rN, 'Body', 13, -10, NR.body.w, NR.body.h, 168, 174, 201);
            sb.e[bodyN]._lpos = v3(NR.body.x, NR.body.y, 0);
            sb.e[sb.e[bodyN]._components[1].__id__]._horizontalAlign = 0;
            sb.e[sb.e[bodyN]._components[1].__id__]._overflow = 2;
            // Time-ago — 11pt muted, bottom-right.
            const timeN = mkLabel(sb, `NotifRowTimeLabel_${i}`, rN, '2m ago', 11, -32, NR.time.w, NR.time.h, 130, 140, 160);
            sb.e[timeN]._lpos = v3(NR.time.x, NR.time.y, 0);
            // Unread dot — top-right, visible only when unread.
            const dotN = sb.e.length;
            sb.node(`NotifRowUnreadDot_${i}`, rN, [], [], v3(NR.dot.x, NR.dot.y, 0));
            const dotUT = sb.ut(dotN, NR.dot.w, NR.dot.h);
            const dotSpr = sb.add({
                __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(dotN), _enabled: true, __prefab: null,
                _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
                _color: cl(48, 198, 155, 255),
                _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
                _type: 1, _fillType: 0, _sizeMode: 0,
                _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
                _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
                _id: gid(),
            });
            sb.e[dotN]._components = [rf(dotUT), rf(dotSpr)];
            sb.e[rN]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
            sb.e[rN]._children = [rf(stripeN), rf(cbN), rf(iconN), rf(titleN), rf(bodyN), rf(timeN), rf(dotN)];
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
        244, 245, 249);
    style(sb, npEmptyTitleN, { bold: true });
    const npEmptySubL = mkLabel(sb, 'NotifEmptySubtitleLabel', npEmptyN,
        'Matches, wins, and updates will show here', 13,
        NPE.emptySubtitleLabel.y, NPE.emptySubtitleLabel.w, NPE.emptySubtitleLabel.h,
        168, 174, 201);
    sb.e[npEmptyN]._children = [rf(npEmptyIconN), rf(npEmptyTitleN), rf(npEmptySubL)];
    sb.e[npEmptyN]._active = false;

    sb.e[npCardN]._children = [
        rf(npHeader), rf(npCloseBtn), rf(npMarkAllBtn), rf(npMarkAsReadBtn),
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
            _color: cl(20, 24, 38, 245),
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
        const titleN = mkLabel(sb, `ToastTitleLabel_${i}`, slotN, 'Title', 18, 18, TS.title.w, TS.title.h, 244, 245, 249);
        sb.e[titleN]._lpos = v3(TS.title.x, TS.title.y, 0);
        sb.e[sb.e[titleN]._components[1].__id__]._horizontalAlign = 0;
        sb.e[sb.e[titleN]._components[1].__id__]._isBold = true;
        // Body — regular 13pt, two-line.
        const bodyN = mkLabel(sb, `ToastBodyLabel_${i}`, slotN, 'Body line', 13, -10, TS.body.w, TS.body.h, 168, 174, 201);
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

    sb.e[canvas]._children = [rf(camN), rf(bgN), rf(fxN), rf(mwaN), rf(lpN), rf(hpN), rf(tdN), rf(tdetN), rf(lbN), rf(dcN), rf(pfN), rf(mipN), rf(wpN), rf(pmN), rf(stN), rf(tutN), rf(specN), rf(tourN), rf(fmN), rf(jcN), rf(countdownN), rf(signingN), rf(loadingN), rf(luN), rf(npN), rf(toastOvN)];
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

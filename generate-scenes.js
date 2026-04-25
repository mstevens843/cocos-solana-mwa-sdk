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
const { Palette: P, ButtonVariants: BV } = Theme;
// rgb-tuple helpers — pull from a Theme variant.
const VAR = (name) => BV[name]?.normal ?? BV.primary.normal;

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

// UX Phase 2c: every button gets a Highlight child — a white sprite at ~14%
// alpha covering the top 45% of the button. Creates a subtle gloss/gradient
// feel without new assets. Children order [Highlight, Label] ensures the
// highlight renders ABOVE the base (parent sprite) but BELOW the text.
function mkBtn(sb, name, parent, text, y, w=500, h=75, br=60, bg=120, bb=200) {
    const bn=sb.e.length, hN=bn+1, ln=bn+2, bu=bn+3, sp=bn+4, bt=bn+5, hUt=bn+6, hSp=bn+7, lUt=bn+8, ll=bn+9;
    const fontSize = Math.max(26, Math.round(h*0.34));
    sb.node(name, parent, [hN, ln], [bu, sp, bt], v3(0, y, 0));
    sb.node('Highlight', bn, [], [hUt, hSp], v3(0, h * 0.275, 0));
    sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
    sb.ut(bn, w, h); sb.spr(bn, br, bg, bb); sb.btn(bn, br, bg, bb);
    sb.ut(hN, w - 4, h * 0.45); sb.spr(hN, 255, 255, 255);
    sb.e[hSp]._color = cl(255, 255, 255, 36); // ~14% alpha gloss
    sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
    return bn;
}

function mkBtnXY(sb, name, parent, text, x, y, w=500, h=75, br=60, bg=120, bb=200) {
    const bn=sb.e.length, hN=bn+1, ln=bn+2, bu=bn+3, sp=bn+4, bt=bn+5, hUt=bn+6, hSp=bn+7, lUt=bn+8, ll=bn+9;
    const fontSize = Math.max(22, Math.round(h*0.34));
    sb.node(name, parent, [hN, ln], [bu, sp, bt], v3(x, y, 0));
    sb.node('Highlight', bn, [], [hUt, hSp], v3(0, h * 0.275, 0));
    sb.node('Label', bn, [], [lUt, ll], v3(0, 0, 0));
    sb.ut(bn, w, h); sb.spr(bn, br, bg, bb); sb.btn(bn, br, bg, bb);
    sb.ut(hN, w - 4, h * 0.45); sb.spr(hN, 255, 255, 255);
    sb.e[hSp]._color = cl(255, 255, 255, 36); // ~14% alpha gloss
    sb.ut(ln, w, h); sb.lbl(ln, text, fontSize, 255, 255, 255);
    return bn;
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
    const textN = sb.e.length;
    sb.node('TEXT_LABEL', ebN, [], [], v3(-w/2 + 10, h/2 - 4, 0));
    const phN = sb.e.length;
    sb.node('PLACEHOLDER_LABEL', ebN, [], [], v3(-w/2 + 10, h/2 - 4, 0));

    // Text label comps (hidden until user types).
    const tut = sb.ut(textN, w - 20, h);
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

    const pUT = sb.ut(phN, w - 20, h);
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
function mkScrollView(sb, name, parent, x, y, w, h) {
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
        _color: cl(25, 25, 40, 255),
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
    // Session 12: near-black warm-undertone backdrop to match solpulse palette.
    sb.spr(bgN, 10, 14, 22, '57520716-48c8-4a19-8acf-41c9f8777fb0@f9941', 0);
    sb.widget(bgN);

    // MWAManager node
    const mwaN = sb.e.length;
    sb.node('MWAManager', canvas, [], [mwaN+1, mwaN+2, mwaN+3], v3(0,0,0));
    sb.ut(mwaN, 0, 0);
    sb.custom(mwaN, UUIDS.MWAManager);
    sb.custom(mwaN, UUIDS.DemoAppConfig);

    // ═══════════════════════════════════════════════════════════════
    // LANDING PANEL — simple: Connect Wallet + Reconnect (Unity-style)
    // ═══════════════════════════════════════════════════════════════
    const lpN = sb.e.length;
    sb.node('LandingPanel', canvas, [], [lpN+1], v3(0,0,0));
    sb.ut(lpN, 720, 1280);

    // Title + Subtitle — UX Phase 2c: bold + gold title.
    const title = mkLabel(sb, 'TitleLabel', lpN, 'Token Duel', 56, 420, 680, 90);
    style(sb, title, { bold: true, color: GOLD() });
    const sub = mkLabel(sb, 'SubtitleLabel', lpN, 'Portfolio Race on Solana', 30, 340, 680, 60, 204, 204, 204);

    // Connect Wallet — opens OS picker (no targetPackage)
    // UX overhaul: Solana-violet primary CTA (was cobalt blue).
    const connectBtn = mkBtn(sb, 'ConnectButton', lpN, 'Connect Wallet', 120, 680, 100, VAR('primary').r, VAR('primary').g, VAR('primary').b);
    style(sb, connectBtn, { bold: true });

    // Reconnect (hidden by default — shown when cached auth exists)
    const reconnBtn = mkBtn(sb, 'ReconnectButton', lpN, 'Reconnect (Cached)', 10, 680, 100, VAR('success').r, VAR('success').g, VAR('success').b);
    sb.e[reconnBtn]._active = false;

    // Status label
    const statusLbl = mkLabel(sb, 'StatusLabel', lpN, 'Tap Connect to link your wallet', 26, -100, 680, 90, 204, 204, 204);

    // Patch LandingPanel children
    sb.e[lpN]._children = [rf(title), rf(sub), rf(connectBtn), rf(reconnBtn), rf(statusLbl)];

    // ═══════════════════════════════════════════════════════════════
    // HOME PANEL — portrait layout, color-coded buttons
    // ═══════════════════════════════════════════════════════════════
    const hpN = sb.e.length;
    sb.node('HomePanel', canvas, [], [hpN+1], v3(0,0,0));
    sb.ut(hpN, 720, 1280);

    // Unity: pubkey=cyan(128,204,255), btns=blue(51,153,255), caps=slate(102,128,179),
    //        disconnect=orange(204,102,51), delete=red(204,51,51)
    // Home has no Reconnect button — user reconnects from Landing's "Reconnect (cached)"
    // button (shown after a previous successful connect, cache retained through disconnect).
    // betting-duel polish: spread content to fill the FIXED_WIDTH visible
    // height (1602 on-device vs 1280 design). Top band pushes up to +720,
    // button column widens gaps (was 90px stride → now 100px).
    const pubkey = mkLabel(sb, 'PubkeyLabel', hpN, 'Not connected', 26, 700, 680, 40, 128, 204, 255);

    // Stage 4K — streak flame on Home. Container sits top-right of PubkeyLabel
    // with a procedural flame icon + Nx count. AppUI._updateStreakFlame toggles
    // visibility based on UserStats.currentStreak (0 = hidden, ≥3 = pulse,
    // ≥5 = gold tint).
    const streakFlameN = sb.e.length;
    sb.node('StreakFlameContainer', hpN, [], [streakFlameN + 1], v3(280, 748, 0));
    sb.ut(streakFlameN, 100, 36);
    sb.e[streakFlameN]._active = false;
    const streakIconN = sb.e.length;
    sb.node('StreakFlameIcon', streakFlameN, [], [streakIconN + 1, streakIconN + 2], v3(-28, 0, 0));
    sb.ut(streakIconN, 28, 28);
    sb.lbl(streakIconN, '', 22, 255, 160, 70); // empty label; AppUI attaches IconLibrary.flame at runtime
    const streakCountN = sb.e.length;
    sb.node('StreakCountLabel', streakFlameN, [], [streakCountN + 1, streakCountN + 2], v3(22, 0, 0));
    sb.ut(streakCountN, 60, 30);
    const streakCountL = sb.lbl(streakCountN, '0×', 20, 255, 160, 70);
    sb.e[streakCountL]._isBold = true;
    style(sb, streakCountN, { mono: true });
    sb.e[streakFlameN]._children = [rf(streakIconN), rf(streakCountN)];

    // Part 13: rake tier chip. Hidden until wallet connects; AppUI refreshes
    // after UserStats load so the user sees their current fee tier up-front.
    const homeRakeChip = mkLabel(sb, 'HomeRakeChip', hpN, 'Your rake: —', 14, 744, 700, 22, 180, 190, 210);
    sb.e[homeRakeChip]._active = false;

    // Live match ticker / tournament badge (mutually exclusive).
    const matchTicker = mkBtnXY(sb, 'HomeMatchTicker', hpN, '…', 0, 660, 700, 36, 22, 28, 44);
    sb.e[matchTicker]._active = false;

    // UX Phase 2b: emoji → IconBadge (attached at runtime by AppUI).
    const homeTournamentBadge = mkBtnXY(sb, 'HomeTournamentBadge', hpN, 'Tournament in —', 0, 660, 700, 36, 140, 80, 180);
    sb.e[homeTournamentBadge]._active = false;

    // Daily streak strip. Clickable — opens DailyChallengePanel.
    const streakStrip = mkBtnXY(sb, 'DailyStreakStrip', hpN, 'Day 1 · 0/3 challenges · Season —', 0, 600, 700, 48, 34, 38, 56);

    // Quick Play — dominant amber CTA. UX overhaul: Theme.accent.amber + bold.
    const quickPlay = mkBtn(sb, 'QuickPlayButton', hpN, 'Quick Play · paper match in one tap', 500, 680, 108, VAR('warn').r, VAR('warn').g, VAR('warn').b);
    style(sb, quickPlay, { bold: true });

    // Button column spread: stride 100px (was 90) so 7 buttons breathe in the
    // expanded viewport. Y span now 380 → -380.
    // UX overhaul: tier-1 (Play/Sign*) use Solana violet, secondary (Caps) uses ghost,
    // destructive (Disconnect/Delete) keep their orange/red but routed through Theme.
    const playDuel = mkBtn(sb, 'PlayTokenDuelButton', hpN, 'Play Token Duel',  380, 680, 86, VAR('primary').r, VAR('primary').g, VAR('primary').b);
    style(sb, playDuel, { bold: true });
    const signMsg  = mkBtn(sb, 'SignMessageButton',    hpN, 'Sign Message',     270, 680, 86, VAR('secondary').r, VAR('secondary').g, VAR('secondary').b);
    const signTx   = mkBtn(sb, 'SignTxButton',         hpN, 'Sign Transaction', 160, 680, 86, VAR('secondary').r, VAR('secondary').g, VAR('secondary').b);
    const signSend = mkBtn(sb, 'SignSendButton',       hpN, 'Sign & Send',       50, 680, 86, VAR('secondary').r, VAR('secondary').g, VAR('secondary').b);
    const caps     = mkBtn(sb, 'CapabilitiesButton',   hpN, 'Get Capabilities', -60, 680, 86, VAR('ghost').r, VAR('ghost').g, VAR('ghost').b);
    const disconn  = mkBtn(sb, 'DisconnectButton',     hpN, 'Disconnect',      -170, 680, 86, 204, 102, 51);
    const del      = mkBtn(sb, 'DeleteButton',         hpN, 'Delete Account',  -280, 680, 86, VAR('danger').r, VAR('danger').g, VAR('danger').b);
    const homeStatus = mkLabel(sb, 'HomeStatusLabel',  hpN, 'Connected — choose an action', 18, -700, 680, 32, 168, 174, 201);

    // Gear icon → SettingsPanel (top-right). UX Phase 2b: label cleared, AppUI attaches IconBadge cog.
    const homeSettingsBtn = mkBtnXY(sb, 'OpenSettingsButton', hpN, '', 300, 700, 64, 64, 38, 44, 64);

    // Phase A — Flag icon (top-left) → FindMatchPanel. Empty label; AppUI attaches IconBadge flag.
    const homeFindMatchBtn = mkBtnXY(sb, 'OpenFindMatchButton', hpN, '', -300, 700, 64, 64, 38, 44, 64);

    // Phase N3 — Notification bell + unread badge. AppUI attaches IconLibrary.bell.
    const homeNotifBell = mkBtnXY(sb, 'NotificationBellButton', hpN, '', 220, 700, 64, 64, 38, 44, 64);
    const homeNotifBadgeN = sb.e.length;
    sb.node('NotificationBellBadge', hpN, [], [], v3(244, 722, 0));
    const homeNotifBadgeUT = sb.ut(homeNotifBadgeN, 24, 24);
    const homeNotifBadgeSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(homeNotifBadgeN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(236, 88, 122, 255), // rose / urgent red
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
    sb.e[homeNotifBadgeN]._active = false; // hidden when unread=0

    // ── Mascot container (Phase 2A) ─────────────────────────────────────
    // Empty Node — the MascotController component is added at runtime by
    // AppUI.start() (so we don't need an editor-minted UUID for the .ts file
    // to be referenced from this node-side scene generator). The controller
    // builds its own Graphics children (body / wand / eyes / sparkles) at
    // onLoad. Sits below the bottom button row, above HomeStatusLabel.
    const mascotN = sb.e.length;
    // UX Phase 2b: shrunk to 160×200 and nudged up to y=-440 so small-viewport
    // devices don't clip into HomeStatusLabel (y=-700).
    sb.node('MascotContainer', hpN, [], [], v3(0, -440, 0));
    const mascotUT = sb.ut(mascotN, 160, 200);
    sb.e[mascotN]._components = [rf(mascotUT)];

    sb.e[hpN]._children = [
        rf(pubkey), rf(homeRakeChip), rf(matchTicker), rf(homeTournamentBadge),
        rf(streakStrip), rf(quickPlay), rf(playDuel),
        rf(signMsg), rf(signTx), rf(signSend), rf(caps), rf(disconn), rf(del),
        rf(mascotN), rf(homeStatus), rf(homeSettingsBtn), rf(homeFindMatchBtn),
        rf(homeNotifBell), rf(homeNotifBadgeN),
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
    sb.node('TokenDuelPanel', canvas, [], [tdN+1], v3(0,0,0));
    sb.ut(tdN, 720, 1280);

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
    const tdBackLink = mkLabel(sb, 'BackLinkLabel', tdN, '← Back', 18, 720, 110, 28, 160, 170, 190);
    sb.e[tdBackLink]._lpos = v3(-280, 720, 0);
    const tdBackLinkL = sb.e[tdBackLink]._components[1].__id__;
    sb.e[tdBackLinkL]._horizontalAlign = 0; // left-aligned
    // Invisible hit-area Button covers the label region so taps still fire the back handler.
    const tdBackBtn = sb.e.length;
    sb.node('BackButton', tdN, [], [], v3(-280, 720, 0));
    const tdBackBtnUT = sb.ut(tdBackBtn, 140, 36);
    const tdBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(tdBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(tdBackBtn), _id: gid(),
    });
    sb.e[tdBackBtn]._components = [rf(tdBackBtnUT), rf(tdBackBtnBtn)];

    // Title — UX Phase 2c: bold.
    const tdTitle = mkLabel(sb, 'TitleLabel', tdN, 'Token Duel', 32, 700, 280, 44, 218, 165, 32);
    style(sb, tdTitle, { bold: true });

    // Session 14 C: Leaderboard + Portfolio entry buttons.
    // Compact icons in the top bar between back link and title area.
    // UX Phase 2b: solo-emoji chrome buttons cleared; AppUI attaches IconBadges.
    // UX Phase 2d: row moved up to y=735 so it doesn't overlap TitleLabel at y=700.
    const tdLeaderboardBtn = mkBtnXY(sb, 'OpenLeaderboardButton', tdN, '', -180, 735, 48, 40, 28, 34, 48);
    const tdPortfolioBtn   = mkBtnXY(sb, 'OpenPortfolioButton',   tdN, '', -128, 735, 48, 40, 28, 34, 48);
    const tdSettingsBtn    = mkBtnXY(sb, 'OpenSettingsButton',    tdN, '', -76,  735, 48, 40, 28, 34, 48);
    const tdPresetsBtn     = mkBtnXY(sb, 'OpenSquadPresetsButton', tdN, '', -24,  735, 48, 40, 28, 34, 48);
    const tdSuggestBtn     = mkBtnXY(sb, 'SuggestSquadButton',     tdN, '',  28,  735, 48, 40, 28, 34, 48);
    const tdHelpBtn        = mkBtnXY(sb, 'HelpButton',              tdN, '?',   80,  735, 48, 40, 28, 34, 48);

    // Balance chip — muted emerald, top-right.
    const tdBalance = mkLabel(sb, 'BalanceChipLabel', tdN, '◼ 0.0000 SOL', 17, 700, 180, 32, 140, 220, 180);
    sb.e[tdBalance]._lpos = v3(230, 700, 0);
    const tdBalanceL = sb.e[tdBalance]._components[1].__id__;
    sb.e[tdBalanceL]._horizontalAlign = 2; // right-aligned
    // Stage 5N — mono the balance chip so the SOL value stays stable when it updates.
    style(sb, tdBalance, { mono: true });

    // Search input — flat chrome bg, no clear button (we'll restyle it as a subtle × inside).
    const tdSearch = mkEditBox(sb, 'SearchEditBox', tdN, 'Search token by symbol or mint…', 0, 640, 620, 46, 17);
    const tdSearchClear = mkBtnXY(sb, 'SearchClearButton', tdN, '×', 285, 640, 40, 40, 45, 55, 72);
    sb.e[tdSearchClear]._active = false;

    // Header-chrome row: dropdown · watchlist star · live indicator — single horizontal band.
    const tabY = 590;
    // UX Phase 2b: emoji stripped, AppUI dynamically attaches tab-specific IconBadge.
    const tdTabDropdown = mkBtnXY(sb, 'FeedTabDropdownButton', tdN, 'New Pairs  ▾', -200, tabY, 240, 40, 28, 34, 48);
    // Session 14 A3: widened from 140→170 so "+ N to Watchlist" never truncates.
    // UX Phase 2b: AppUI toggles IconBadge star/starOutline per watchlist state.
    const tdWatchStar   = mkBtnXY(sb, 'WatchlistStarButton',   tdN, 'Watchlist',    10, tabY, 170, 38, 28, 34, 48);
    const tdWatchCancel = mkBtnXY(sb, 'CancelWatchlistButton', tdN, '✕', 115, tabY, 36, 36, 55, 30, 30);
    sb.e[tdWatchCancel]._active = false;
    const tdLiveLbl     = mkLabel(sb, 'LiveIndicatorLabel', tdN, '●  LIVE', 14, tabY, 110, 40, 48, 198, 155);
    sb.e[tdLiveLbl]._lpos = v3(260, tabY, 0);

    // Dropdown popover — stacked vertically, 6 options. Hidden by default.
    const popN = sb.e.length;
    sb.node('FeedTabDropdownPopover', tdN, [], [], v3(-200, tabY - 165, 0));
    const popUT = sb.ut(popN, 240, 304);
    const popSpr = sb.spr(popN, 18, 24, 36);
    const popOptionNames = ['new', 'trending', 'gainers', 'volume', 'smart', 'watchlist'];
    // UX Phase 2b: emoji stripped; AppUI attaches per-row IconBadges (bolt/flame/chart/chart/brain/star).
    const popOptionLabels = ['New Pairs', 'Trending', 'Top Gainers', 'Top Volume', 'Smart Money', 'Watchlist'];
    const popOptYs = [126, 76, 26, -24, -74, -124];
    const popOptIndices = [];
    for (let p = 0; p < 6; p++) {
        const optN = mkBtnXY(sb, `FeedTabOption_${popOptionNames[p]}`, popN, popOptionLabels[p], 0, popOptYs[p], 224, 40, 28, 34, 48);
        popOptIndices.push(optN);
    }
    sb.e[popN]._components = [rf(popUT), rf(popSpr)];
    sb.e[popN]._children = popOptIndices.map(rf);
    sb.e[popN]._active = false;

    // Session 14 A1: widened chips + gaps + MinLiq dropdown inset so nothing
    // crowds. Columns button pulled in from x=285 → x=250 away from the edge.
    const chipY = 550;
    const chipH = 28;
    const chipGap = 8;
    const sortChipNames  = ['newest',   'liq_desc', 'liq_asc'];
    const sortChipLabels = ['Newest',   'Liq↓',     'Liq↑'];
    const sortChipW = 72;
    const sortStartX = -268;
    const chipIndices = [];
    for (let c = 0; c < 3; c++) {
        const cx = sortStartX + c * (sortChipW + chipGap);
        const cN = mkBtnXY(sb, `FilterChip_${sortChipNames[c]}`, tdN, sortChipLabels[c], cx, chipY, sortChipW, chipH, 28, 34, 48);
        chipIndices.push(cN);
    }
    // MinLiq dropdown — wider at 110w so "$10K+ ▾" fits comfortably.
    const tdMinLiqBtn = mkBtnXY(sb, 'MinLiqDropdownButton', tdN, 'All  ▾', -35, chipY, 110, chipH, 28, 34, 48);
    // UX Phase 2b: IconBadge cog attached by AppUI.
    const tdColumnsBtn = mkBtnXY(sb, 'ColumnsButton', tdN, 'Columns', 250, chipY, 110, chipH, 28, 34, 48);

    // MinLiq popover — 4 options stacked. Opens DOWN-LEFT of MinLiqDropdownButton.
    // Hidden by default.
    const minLiqPopN = sb.e.length;
    sb.node('MinLiqDropdownPopover', tdN, [], [], v3(-60, chipY - 96, 0));
    const minLiqPopUT = sb.ut(minLiqPopN, 120, 180);
    const minLiqPopSpr = sb.spr(minLiqPopN, 18, 24, 36);
    const minLiqOptNames  = ['all', '1k', '5k', '10k'];
    const minLiqOptLabels = ['All', '$1K+', '$5K+', '$10K+'];
    const minLiqOptYs = [72, 24, -24, -72];
    const minLiqOptIndices = [];
    for (let m = 0; m < 4; m++) {
        const oN = mkBtnXY(sb, `MinLiqOption_${minLiqOptNames[m]}`, minLiqPopN, minLiqOptLabels[m], 0, minLiqOptYs[m], 108, 38, 28, 34, 48);
        minLiqOptIndices.push(oN);
    }
    sb.e[minLiqPopN]._components = [rf(minLiqPopUT), rf(minLiqPopSpr)];
    sb.e[minLiqPopN]._children = minLiqOptIndices.map(rf);
    sb.e[minLiqPopN]._active = false;

    // Session 13 A3: Columns popover — opens DOWN-LEFT of the Columns button
    // so it doesn't clip off the right edge. 10 toggle rows; each shows a
    // ✓ prefix when active. Wired at runtime by AppUI.
    const colPopN = sb.e.length;
    sb.node('ColumnsPopover', tdN, [], [], v3(215, chipY - 208, 0));
    const colPopUT = sb.ut(colPopN, 170, 360);
    const colPopSpr = sb.spr(colPopN, 18, 24, 36);
    const colPopLabels = ['Score', 'Liq', 'Vol', '24h', 'Age', 'MC', 'FDV', 'Price', 'Holders', 'DEX'];
    const colPopKeys   = ['score', 'liq', 'vol', 'change', 'age', 'mc', 'fdv', 'price', 'holders', 'source'];
    const colPopStartY = 160;
    const colPopRowH = 32;
    const colPopIndices = [];
    for (let k = 0; k < colPopLabels.length; k++) {
        const cY = colPopStartY - k * colPopRowH;
        const cN = mkBtnXY(sb, `ColToggle_${colPopKeys[k]}`, colPopN, `✓  ${colPopLabels[k]}`, 0, cY, 154, 30, 28, 34, 48);
        colPopIndices.push(cN);
    }
    // Footer "Max 6 columns" hint
    const colPopHintN = mkLabel(sb, 'ColMaxHintLabel', colPopN, 'Max 6 columns', 10, colPopStartY - colPopLabels.length * colPopRowH - 4, 160, 20, 100, 110, 130);
    sb.e[colPopN]._components = [rf(colPopUT), rf(colPopSpr)];
    sb.e[colPopN]._children = [...colPopIndices.map(rf), rf(colPopHintN)];
    sb.e[colPopN]._active = false;

    // Session 12: Column headers row — sticky, directly above the feed.
    // Matches row column x-positions exactly so numbers align under labels.
    const headerY = 505;
    const headerGroupN = sb.e.length;
    sb.node('FeedColumnHeaders', tdN, [], [], v3(0, headerY, 0));
    sb.ut(headerGroupN, 700, 24);
    const hdrDefs = [
        { name: 'ColHeader_Token',  text: 'TOKEN',  x: -262, w: 160, align: 0 },
        { name: 'ColHeader_Score',  text: 'SCORE',  x: -90,  w: 40,  align: 1 },
        { name: 'ColHeader_Liq',    text: 'LIQ',    x: -40,  w: 60,  align: 1 },
        { name: 'ColHeader_Vol',    text: 'VOL',    x: 30,   w: 60,  align: 1 },
        { name: 'ColHeader_Change', text: '24H',    x: 100,  w: 60,  align: 1 },
        { name: 'ColHeader_Price',  text: 'PRICE',  x: 180,  w: 80,  align: 1 },
        { name: 'ColHeader_Age',    text: 'AGE',    x: 285,  w: 40,  align: 1 },
    ];
    const hdrIndices = [];
    for (const d of hdrDefs) {
        const hN = mkLabel(sb, d.name, headerGroupN, d.text, 11, 0, d.w, 22, 100, 110, 130);
        sb.e[hN]._lpos = v3(d.x, 0, 0);
        const hL = sb.e[hN]._components[1].__id__;
        sb.e[hL]._horizontalAlign = d.align;
        sb.e[hL]._spacingX = 1; // letter-spacing
        hdrIndices.push(hN);
    }
    sb.e[headerGroupN]._children = hdrIndices.map(rf);

    // Session 12: Feed ScrollView — **660px tall** (was 400). Positioned so
    // the bottom edge sits at y=-260 and top at y=+400, with the scrollview
    // centered at y=+70. This gives ~65% more visible rows (≈10 at rest vs 6).
    const FEED_ROW_LIMIT = 20;
    const rowHeight = 66;
    const rowGap = 4;
    const rowStride = rowHeight + rowGap;
    const rowW = 680;
    const feedWinH = 820;
    const { root: tdFeedSV, content: tdFeedContent, contentUT: tdFeedContentUT } = mkScrollView(sb, 'FeedScrollView', tdN, 0, 30, 700, feedWinH);
    // Size content to fit the full 20-row pool so the ScrollView can scroll.
    sb.e[tdFeedContentUT]._contentSize = sz(rowW, FEED_ROW_LIMIT * rowStride);

    // Session 13 row layout (tightened to match header column positions):
    //   [SelEdge] [Checkbox] [Logo] [$TICKER / name]   [Score][Liq][Vol][24h][Price][Age][LiveDot]
    //                                (bottom line: name · 4ch…4ch    |    DEX)
    // SelectedEdge + Checkbox default hidden; toggled at runtime.
    const feedRowIndices = [];
    const rowHalfW = rowW / 2; // 340
    const topY = 12;
    const botY = -14;
    for (let i = 0; i < FEED_ROW_LIMIT; i++) {
        const ry = -(rowHeight / 2) - i * rowStride;
        const rn = sb.e.length;
        sb.node(`FeedRow_${i}`, tdFeedContent, [], [], v3(0, ry, 0));
        const rUT  = sb.ut(rn, rowW, rowHeight);
        const rSpr = sb.spr(rn, 14, 18, 28);
        const rBtn = sb.btn(rn, 14, 18, 28);

        // Session 13 A5: SelectedEdge — 3×rowHeight emerald strip, left edge.
        const selEdgeN = sb.e.length;
        sb.node('SelectedEdge', rn, [], [], v3(-rowHalfW + 2, 0, 0));
        const selEdgeUT = sb.ut(selEdgeN, 3, rowHeight - 6);
        const selEdgeSpr = sb.spr(selEdgeN, 48, 198, 155);
        sb.e[selEdgeN]._components = [rf(selEdgeUT), rf(selEdgeSpr)];
        sb.e[selEdgeN]._active = false;

        // Session 13 A6: CheckboxSprite — 24×24 square at far left; hidden
        // outside watchlist-mode. Checked state colored emerald at runtime.
        // betting-duel polish: black ✓ overlay inside the square when checked.
        const chkN = sb.e.length;
        sb.node('CheckboxSprite', rn, [], [], v3(-rowHalfW + 20, 0, 0));
        const chkUT = sb.ut(chkN, 22, 22);
        const chkSpr = sb.spr(chkN, 45, 52, 70);
        const chkIconN = sb.e.length;
        sb.node('CheckmarkIcon', chkN, [], [], v3(0, 1, 0));
        const chkIconUT = sb.ut(chkIconN, 22, 22);
        const chkIconL  = sb.lbl(chkIconN, '✓', 18, 0, 0, 0);
        sb.e[chkIconL]._isBold = true;
        sb.e[chkIconN]._components = [rf(chkIconUT), rf(chkIconL)];
        sb.e[chkIconN]._active = false;
        sb.e[chkN]._components = [rf(chkUT), rf(chkSpr)];
        sb.e[chkN]._children = [rf(chkIconN)];
        sb.e[chkN]._active = false;

        // Logo — 28×28 at left edge (after checkbox column). When watchlist
        // mode is active, AppUI can nudge this right by 20px at runtime.
        const logoN = sb.e.length;
        sb.node('LogoSprite', rn, [], [], v3(-rowHalfW + 30, 0, 0));
        const logoUT = sb.ut(logoN, 28, 28);
        const logoSpr = sb.spr(logoN, 255, 255, 255);
        sb.e[logoN]._components = [rf(logoUT), rf(logoSpr)];

        // SymbolLabel — top line, bold, left-aligned. Aligned to ColHeader_Token.
        const symN = sb.e.length;
        sb.node('SymbolLabel', rn, [], [], v3(-180, topY, 0));
        const symUT = sb.ut(symN, 160, 22);
        const symL  = sb.lbl(symN, '—', 18, 255, 255, 255);
        sb.e[symL]._horizontalAlign = 0;
        sb.e[symL]._isBold = true;
        sb.e[symN]._components = [rf(symUT), rf(symL)];

        // NameLabel — bottom line, 11pt muted.
        const nameN = sb.e.length;
        sb.node('NameLabel', rn, [], [], v3(-180, botY, 0));
        const nameUT = sb.ut(nameN, 200, 18);
        const nameL  = sb.lbl(nameN, '', 11, 120, 130, 145);
        sb.e[nameL]._horizontalAlign = 0;
        sb.e[nameN]._components = [rf(nameUT), rf(nameL)];

        // ScoreLabel — aligned to ColHeader_Score (x=-90).
        const scoreN = sb.e.length;
        sb.node('ScoreLabel', rn, [], [], v3(-90, topY, 0));
        const scoreUT = sb.ut(scoreN, 40, 22);
        const scoreL  = sb.lbl(scoreN, '—', 14, 220, 220, 230);
        sb.e[scoreL]._isBold = true;
        sb.e[scoreN]._components = [rf(scoreUT), rf(scoreL)];

        // LiqLabel — aligned to ColHeader_Liq (x=-40).
        const liqN = sb.e.length;
        sb.node('LiqLabel', rn, [], [], v3(-40, topY, 0));
        const liqUT = sb.ut(liqN, 60, 22);
        const liqL  = sb.lbl(liqN, '—', 13, 120, 220, 200);
        sb.e[liqN]._components = [rf(liqUT), rf(liqL)];

        // VolLabel — aligned to ColHeader_Vol (x=30).
        const volN = sb.e.length;
        sb.node('VolLabel', rn, [], [], v3(30, topY, 0));
        const volUT = sb.ut(volN, 60, 22);
        const volL  = sb.lbl(volN, '—', 13, 180, 180, 170);
        sb.e[volN]._components = [rf(volUT), rf(volL)];

        // ChangeLabel — aligned to ColHeader_Change (x=100).
        const changeN = sb.e.length;
        sb.node('ChangeLabel', rn, [], [], v3(100, topY, 0));
        const changeUT = sb.ut(changeN, 60, 22);
        const changeL  = sb.lbl(changeN, '', 14, 200, 200, 200);
        sb.e[changeN]._components = [rf(changeUT), rf(changeL)];

        // DeltaLabel — back-compat alias; hidden.
        const deltaN = sb.e.length;
        sb.node('DeltaLabel', rn, [], [], v3(100, topY, 0));
        const deltaUT = sb.ut(deltaN, 60, 22);
        const deltaL  = sb.lbl(deltaN, '', 14, 200, 200, 200);
        sb.e[deltaN]._components = [rf(deltaUT), rf(deltaL)];
        sb.e[deltaN]._active = false;

        // PriceLabel — aligned to ColHeader_Price (x=180).
        const priceN = sb.e.length;
        sb.node('PriceLabel', rn, [], [], v3(180, topY, 0));
        const priceUT = sb.ut(priceN, 80, 22);
        const priceL  = sb.lbl(priceN, '', 14, 218, 165, 32);
        sb.e[priceN]._components = [rf(priceUT), rf(priceL)];

        // AgeLabel — Session 13 A2: moved from bottom-line to TOP-LINE at far
        // right. Aligned to new ColHeader_Age (x=285).
        const ageN = sb.e.length;
        sb.node('AgeLabel', rn, [], [], v3(285, topY, 0));
        const ageUT = sb.ut(ageN, 40, 22);
        const ageL  = sb.lbl(ageN, '—', 12, 140, 200, 150);
        sb.e[ageN]._components = [rf(ageUT), rf(ageL)];

        // DexLabel — bottom line, muted. (Bottom row is subtitle + dex.)
        const dexN = sb.e.length;
        sb.node('DexLabel', rn, [], [], v3(80, botY, 0));
        const dexUT = sb.ut(dexN, 200, 18);
        const dexL  = sb.lbl(dexN, '', 11, 140, 140, 155);
        sb.e[dexN]._components = [rf(dexUT), rf(dexL)];

        // LiveDot — right of AgeLabel (bottom line so it doesn't clash).
        const liveN = sb.e.length;
        sb.node('LiveDot', rn, [], [], v3(315, botY, 0));
        const liveUT = sb.ut(liveN, 8, 8);
        const liveSpr = sb.spr(liveN, 90, 200, 120);
        sb.e[liveN]._components = [rf(liveUT), rf(liveSpr)];
        sb.e[liveN]._active = false;

        sb.e[rn]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
        sb.e[rn]._children = [
            rf(selEdgeN), rf(chkN),
            rf(logoN), rf(symN), rf(nameN),
            rf(scoreN), rf(liqN), rf(volN), rf(changeN), rf(deltaN),
            rf(priceN), rf(ageN), rf(dexN), rf(liveN),
        ];
        sb.e[rn]._active = false;
        feedRowIndices.push(rn);
    }
    // Session 10: without this, content._children stays [] and Cocos's
    // getChildByName walks an empty list -> every FeedRow_N lookup returns
    // null -> _feedRowNodes is empty -> Birdeye calls ship limit=0 and 400.
    // `sb.node(name, parent, ...)` only writes _parent on the child; the
    // back-reference on the parent has to be written explicitly.
    sb.e[tdFeedContent]._children = feedRowIndices.map(rf);

    // Session 14 B1: Action-button row replaces hero-tile / squad-slot chaos.
    // 3 buttons at y=-295: + Pick | Drop | ▶ Run Squad
    const actionRowY = -440;
    const tdSquadPick = mkBtnXY(sb, 'SquadPickButton', tdN, '+ Pick',          -220, actionRowY, 200, 48, 48, 198, 155);
    style(sb, tdSquadPick, { bold: true });
    const tdSquadDrop = mkBtnXY(sb, 'SquadDropButton', tdN, 'Manage Squad',      0, actionRowY, 200, 48, 28, 34, 48);
    const tdSquadRun  = mkBtnXY(sb, 'SquadRunButton',  tdN, '▶ Run Squad',     220, actionRowY, 200, 48, 56, 148, 252);
    style(sb, tdSquadRun, { bold: true });

    // Session 14 B1: compact squad chips — small pills below the action row
    // showing current picks. Replace the bulky 200×64 SquadSlot buttons.
    const squadHeaderY = -510;
    const squadY = -550;
    const tdSquadHeader = mkLabel(sb, 'SquadHeaderLabel', tdN, 'YOUR SQUAD', 11, squadHeaderY, 420, 18, 100, 110, 130);
    const tdSquadHeaderL = sb.e[tdSquadHeader]._components[1].__id__;
    sb.e[tdSquadHeaderL]._spacingX = 1;
    // betting-duel polish — each SquadSlot is now a composite: Button bg +
    // LogoSprite (round 36×36 left) + SymbolLabel (symbol, bold) +
    // DeltaLabel (24h % under the symbol, colored). The back-compat `Label`
    // child is retained so legacy code paths don't crash; AppUI prefers the
    // new SymbolLabel when present.
    const squadSlotW = 180, squadSlotH = 54;
    const squadSlotXs = [-200, 0, 200];
    function mkSquadSlot(slotIdx) {
        const x = squadSlotXs[slotIdx];
        const bn = sb.e.length, ln = bn + 1, bu = bn + 2, sp = bn + 3, bt = bn + 4, lu = bn + 5, ll = bn + 6;
        sb.node(`SquadSlot_${slotIdx}`, tdN, [ln], [bu, sp, bt], v3(x, squadY, 0));
        // Back-compat Label (hidden; symbol lives in SymbolLabel child now).
        sb.node('Label', bn, [], [lu, ll], v3(0, 0, 0));
        sb.ut(bn, squadSlotW, squadSlotH); sb.spr(bn, 26, 32, 48); sb.btn(bn, 26, 32, 48);
        sb.ut(ln, squadSlotW, squadSlotH); sb.lbl(ln, '', 1, 0, 0, 0, 0);
        sb.e[ln]._active = false;
        // Logo — 36×36 circle sprite at left.
        const logoN = sb.e.length;
        sb.node('LogoSprite', bn, [], [], v3(-squadSlotW/2 + 26, 0, 0));
        const logoUT = sb.ut(logoN, 36, 36);
        const logoSpr = sb.spr(logoN, 255, 255, 255);
        sb.e[logoN]._components = [rf(logoUT), rf(logoSpr)];
        // SymbolLabel — top line, bold.
        const symN = sb.e.length;
        sb.node('SymbolLabel', bn, [], [], v3(12, 8, 0));
        const symUT = sb.ut(symN, squadSlotW - 60, 22);
        const symL = sb.lbl(symN, '+', 18, 230, 230, 235);
        sb.e[symL]._isBold = true;
        sb.e[symL]._horizontalAlign = 0;
        sb.e[symN]._components = [rf(symUT), rf(symL)];
        // DeltaLabel — bottom line, 24h % colored.
        const dltN = sb.e.length;
        sb.node('DeltaLabel', bn, [], [], v3(12, -12, 0));
        const dltUT = sb.ut(dltN, squadSlotW - 60, 16);
        const dltL = sb.lbl(dltN, '', 12, 160, 170, 190);
        sb.e[dltL]._horizontalAlign = 0;
        sb.e[dltN]._components = [rf(dltUT), rf(dltL)];
        sb.e[bn]._children = [rf(ln), rf(logoN), rf(symN), rf(dltN)];
        return bn;
    }
    const tdSquad0 = mkSquadSlot(0);
    const tdSquad1 = mkSquadSlot(1);
    const tdSquad2 = mkSquadSlot(2);
    // Hidden until squad has a token in that slot.
    sb.e[tdSquad0]._active = false;
    sb.e[tdSquad1]._active = false;
    sb.e[tdSquad2]._active = false;

    // Session 12: stake cluster merged into a single value line ("Stake 0.010 SOL")
    // instead of separate header + value, then slider, then chips.
    const stakeValueY = -420;
    const stakeSliderY = -455;
    const stakeChipY = -515;
    // StakeHeaderLabel retained as a tiny uppercase section label above the value.
    const tdStakeHeader = mkLabel(sb, 'StakeHeaderLabel', tdN, 'STAKE AMOUNT', 11, -395, 280, 18, 100, 110, 130);
    const tdStakeHeaderL = sb.e[tdStakeHeader]._components[1].__id__;
    sb.e[tdStakeHeaderL]._spacingX = 1;
    const tdStakeValueLabel = mkLabel(sb, 'StakeValueLabel', tdN, '0.010 SOL', 20, stakeValueY, 300, 28, 218, 165, 32);
    const tdStakeSlider = mkSlider(sb, 'StakeSlider', tdN, 0, stakeSliderY, 560, 14, 0.1);

    // Snap-to chips — single emerald accent for active only (applied at runtime); idle is chrome bg.
    const tdStake001  = mkBtnXY(sb, 'StakeChip_001', tdN, '0.001', -220, stakeChipY, 160, 40, 28, 34, 48);
    const tdStake010  = mkBtnXY(sb, 'StakeChip_010', tdN, '0.01',     0, stakeChipY, 160, 40, 28, 34, 48);
    const tdStake100  = mkBtnXY(sb, 'StakeChip_100', tdN, '0.1',    220, stakeChipY, 160, 40, 28, 34, 48);

    // Commit button — prominent blue CTA, bottom-aligned within the button cluster.
    const commitBtnY = -580;
    const tdCommit = mkBtn(sb, 'StakeCommitButton', tdN, 'Stake + Commit', commitBtnY, 620, 56, 56, 148, 252);
    style(sb, tdCommit, { bold: true });

    // Start Game (revealed after commit) and Claim Payout (revealed on game-over) share the same slot.
    const tdStartGame = mkBtn(sb, 'StartGameButton', tdN, 'Start Game', commitBtnY, 620, 56, 218, 165, 32);
    style(sb, tdStartGame, { bold: true });
    sb.e[tdStartGame]._active = false;
    const tdClaim = mkBtn(sb, 'ClaimPayoutButton', tdN, 'Claim Payout', commitBtnY, 620, 56, 150, 85, 210);
    style(sb, tdClaim, { bold: true });
    sb.e[tdClaim]._active = false;

    // betting-duel polish — WagerControlRow sits under the squad slots.
    // Two buttons: tier selector (left, opens dropdown upward) + start match
    // (right). Replaces the force-hidden StakeCommitButton. Legacy stake UI
    // stays in the scene but is force-hidden by AppUI._hideLegacyBettingDuelNodes.
    const wagerRowY = -640;
    // UX Phase 2b: AppUI attaches IconBadge coin. Phase 2c: bold for emphasis.
    const tdWagerValueBtn = mkBtnXY(sb, 'WagerValueButton', tdN, '0.05 SOL  ▾', -180, wagerRowY, 300, 56, 34, 44, 68);
    style(sb, tdWagerValueBtn, { bold: true });
    const tdWagerStartBtn = mkBtnXY(sb, 'WagerStartButton', tdN, '▶ Start Match',   180, wagerRowY, 320, 56, 56, 148, 252);
    style(sb, tdWagerStartBtn, { bold: true });
    // Tiny hint under the row.
    const tdWagerHint = mkLabel(sb, 'WagerHintLabel', tdN, 'Pick 3 tokens, then tap Start', 11, wagerRowY - 44, 600, 16, 120, 130, 150);
    sb.e[sb.e[tdWagerHint]._components[1].__id__]._spacingX = 1;

    // WagerDropdown — 8 tier rows, opens upward from WagerValueButton.
    // Initially hidden. Anchor bottom=(0.5,0) so _lpos.y is the dropdown's
    // bottom edge; we position that just above the WagerValueButton.
    const tdWagerDropdown = sb.e.length;
    const dropdownW = 360;
    const dropdownRowH = 42;
    const dropdownRowCount = 8;
    const dropdownPadding = 12;
    const dropdownH = dropdownRowCount * dropdownRowH + dropdownPadding * 2;
    // Bottom sits just above the WagerValueButton (top of value btn = wagerRowY + 56/2 = -447).
    const dropdownBottomY = wagerRowY + 28 + 6;
    sb.node('WagerDropdown', tdN, [], [], v3(-180, dropdownBottomY, 0));
    const dropdownUT = sb.ut(tdWagerDropdown, dropdownW, dropdownH);
    sb.e[dropdownUT]._anchorPoint = v2(0.5, 0);  // anchor bottom-center so grows upward
    const dropdownSpr = sb.spr(tdWagerDropdown, 18, 22, 32);
    sb.e[tdWagerDropdown]._components = [rf(dropdownUT), rf(dropdownSpr)];
    sb.e[tdWagerDropdown]._active = false;
    // Display order: ascending $$ then INTRO last (user preference).
    // AppUI._onWagerRowTap translates dropdown row → on-chain tier index via
    // WAGER_DISPLAY_TO_TIER in ModeDefs.ts ([0,1,2,3,4,6,7,5]).
    const wagerLabels = ['0.01 SOL', '0.05 SOL', '0.1 SOL', '0.25 SOL', '0.5 SOL', '1 SOL', '5 SOL', '0.001 · INTRO'];
    const wagerDropdownRows = [];
    for (let i = 0; i < dropdownRowCount; i++) {
        // Row y: top of dropdown content is dropdownH - padding (since anchor bottom).
        // Rows cascade top-down from there.
        const rowLocalY = dropdownH - dropdownPadding - (i + 0.5) * dropdownRowH;
        const rowN = mkBtnXY(sb, `WagerDropdownRow_${i}`, tdWagerDropdown, wagerLabels[i], 0, rowLocalY, dropdownW - 20, dropdownRowH - 4, 28, 34, 48);
        wagerDropdownRows.push(rowN);
    }
    // Stage 5O — INTRO chip gets the rare-state gold tint + label accent so
    // the free-practice tier reads as a bonus item, not a leftover option.
    const introRowN = wagerDropdownRows[wagerDropdownRows.length - 1];
    if (introRowN != null) {
        // Tint the row's sprite + button to a muted gold.
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
        // Gold label text.
        style(sb, introRowN, { color: GOLD() });
    }
    sb.e[tdWagerDropdown]._children = wagerDropdownRows.map(rf);

    // Session 14 A6: Hero tiles DELETED. They were cosmetic-only (game never
    // read _pickedHeroSymbol for gameplay) and caused a visible "SOL" overlap
    // on the middle squad slot when the wallet had SOL holdings. Stub indices
    // still exist so the children-list patch below doesn't shift.
    const tdHero1 = mkBtnXY(sb, 'HeroTile1Button_deleted', tdN, '', -999, -999, 1, 1, 0, 0, 0);
    const tdHero2 = mkBtnXY(sb, 'HeroTile2Button_deleted', tdN, '', -999, -999, 1, 1, 0, 0, 0);
    const tdHero3 = mkBtnXY(sb, 'HeroTile3Button_deleted', tdN, '', -999, -999, 1, 1, 0, 0, 0);
    sb.e[tdHero1]._active = false;
    sb.e[tdHero2]._active = false;
    sb.e[tdHero3]._active = false;

    // Legacy Holding labels — kept hidden as safety net; AppUI tolerates absence.
    const h1N = mkLabel(sb, 'Holding1Label', tdN, '--', 28, squadY, 200, 50, 255, 255, 255);
    const h2N = mkLabel(sb, 'Holding2Label', tdN, '--', 28, squadY, 200, 50, 255, 255, 255);
    const h3N = mkLabel(sb, 'Holding3Label', tdN, '--', 28, squadY, 200, 50, 255, 255, 255);
    sb.e[h1N]._active = false;
    sb.e[h2N]._active = false;
    sb.e[h3N]._active = false;

    // GameArea — hidden container for the tower, active block, and HUD.
    const tdGameArea = sb.e.length;
    sb.node('GameArea', tdN, [], [tdGameArea+1], v3(0, 0, 0));
    sb.ut(tdGameArea, 720, 1000);
    sb.e[tdGameArea]._active = false;

    // HUD
    const tdHeight = sb.e.length;
    sb.node('HeightLabel', tdGameArea, [], [tdHeight+1, tdHeight+2], v3(-220, 440, 0));
    sb.ut(tdHeight, 220, 60);
    sb.lbl(tdHeight, 'Height: 0', 30, 255, 255, 255);

    const tdBadge = sb.e.length;
    sb.node('TokenBadgeLabel', tdGameArea, [], [tdBadge+1, tdBadge+2], v3(220, 440, 0));
    sb.ut(tdBadge, 260, 60);
    sb.lbl(tdBadge, 'SOL', 30, 218, 165, 32);

    // BlockTemplate — hidden sprite; game reads its spriteFrame (KNOWN_ISSUES #8).
    const tdBlockTpl = sb.e.length;
    sb.node('BlockTemplate', tdGameArea, [], [tdBlockTpl+1, tdBlockTpl+2], v3(0, -600, 0));
    sb.ut(tdBlockTpl, 100, 60);
    sb.spr(tdBlockTpl, 100, 100, 100);
    sb.e[tdBlockTpl]._active = false;

    sb.e[tdGameArea]._children = [rf(tdHeight), rf(tdBadge), rf(tdBlockTpl)];

    // Game-over overlay
    const tdGameOver = sb.e.length;
    sb.node('GameOverLabel', tdN, [], [tdGameOver+1, tdGameOver+2], v3(0, 0, 0));
    sb.ut(tdGameOver, 680, 180);
    sb.lbl(tdGameOver, 'Game Over — Height: 0\n(Tier: Forfeit)', 44, 218, 165, 32);
    sb.e[tdGameOver]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // betting-duel Phase 3 — RacePanel
    // Fullscreen overlay shown during Active match. AppUI pipes
    // PortfolioRace tick snapshots to this via _onRaceTick(). Pre-
    // allocates 5 token cards; AppUI activates only as many as the
    // current squad size (1, 3, or 5 — Phase 5 wires the selector).
    // ═══════════════════════════════════════════════════════════════
    const racePanelN = sb.e.length;
    // UX Phase 2d: RacePanel oversize to 720×1800 so it fully covers the device
    // viewport on FIXED_WIDTH (up to ~1700 tall on modern Androids). Previously
    // 720×1280 showed TokenDuelPanel chrome at top/bottom of the race screen
    // because device viewport exceeds design height by ~320px.
    // Children stay centered on panel origin; only the background sprite +
    // UITransform grow.
    sb.node('RacePanel', tdN, [], [racePanelN+1, racePanelN+2], v3(0, 0, 0));
    sb.ut(racePanelN, 720, 1800);
    sb.spr(racePanelN, 8, 12, 20);                // near-black scrim — covers feed/HUD below
    sb.e[racePanelN]._active = false;

    // Stage-1A polish: radial timer ring (draining arc). Graphics node drawn
    // by AppUI._drawTimerRing on each tick. Digital mm:ss sits centered inside.
    const raceTimerRingN = sb.e.length;
    sb.node('RaceTimerRing', racePanelN, [], [raceTimerRingN + 1, raceTimerRingN + 2], v3(0, 480, 0));
    sb.ut(raceTimerRingN, 140, 140);
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
    sb.node('RaceTimerPulse', raceTimerRingN, [], [raceTimerPulseN + 1, raceTimerPulseN + 2], v3(0, 0, 0));
    sb.ut(raceTimerPulseN, 110, 110);
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
    const raceCountdownN = mkLabel(sb, 'RaceCountdownLabel',  racePanelN, '0:30',              26, 480, 110, 36, 240, 245, 255);
    const raceHeroN      = mkLabel(sb, 'RaceHeroDeltaLabel',  racePanelN, '+0.00%',            96, 340, 680, 140, 255, 255, 255);
    const raceHeroSubN   = mkLabel(sb, 'RaceHeroSubtitleLabel', racePanelN, 'Portfolio change', 24, 250, 600, 40, 140, 150, 170);
    // Stage 5N — monospace the number columns so roll-tweens don't "dance".
    style(sb, raceCountdownN, { mono: true });
    style(sb, raceHeroN, { mono: true });

    // Token cards — 5 slots, layout from y=50 down. AppUI toggles _active per slot.
    const raceCardIndices = [];
    const raceCardYs = [50, -80, -210, -340, -470];
    for (let i = 0; i < 5; i++) {
        const cardN = sb.e.length;
        sb.node(`RaceTokenCard_${i}`, racePanelN, [], [cardN+1, cardN+2], v3(0, raceCardYs[i], 0));
        sb.ut(cardN, 640, 110);
        sb.spr(cardN, 22, 28, 42);
        sb.e[cardN]._active = i < 3;   // default: 3 shown until squad-size axis lands

        // Symbol (left)
        const symN = sb.e.length;
        sb.node(`TokenSymbolLabel_${i}`, cardN, [], [symN+1, symN+2], v3(-250, 0, 0));
        sb.ut(symN, 140, 44);
        sb.lbl(symN, 'SYM', 30, 255, 255, 255);

        // Entry price (center-top)
        const entryN = sb.e.length;
        sb.node(`TokenEntryLabel_${i}`, cardN, [], [entryN+1, entryN+2], v3(-40, 18, 0));
        sb.ut(entryN, 220, 28);
        sb.lbl(entryN, 'entry —', 20, 120, 130, 150);

        // Current price (center-bottom)
        const curN = sb.e.length;
        sb.node(`TokenCurrentLabel_${i}`, cardN, [], [curN+1, curN+2], v3(-40, -18, 0));
        sb.ut(curN, 220, 28);
        sb.lbl(curN, '—', 22, 230, 230, 240);

        // Delta (right) — big, colored live
        const deltaN = sb.e.length;
        sb.node(`TokenDeltaLabel_${i}`, cardN, [], [deltaN+1, deltaN+2], v3(220, 0, 0));
        sb.ut(deltaN, 180, 60);
        sb.lbl(deltaN, '0.00%', 34, 200, 200, 210);

        // Stage 5N — monospace the number columns.
        style(sb, entryN, { mono: true });
        style(sb, curN, { mono: true });
        style(sb, deltaN, { mono: true });

        sb.e[cardN]._children = [rf(symN), rf(entryN), rf(curN), rf(deltaN)];
        raceCardIndices.push(cardN);
    }

    // Opponent card — same visual weight as a player token card.
    // 640×110 matches RaceTokenCard_X so the bot feels like a real contender,
    // not a half-height afterthought.
    const raceOppCard = sb.e.length;
    sb.node('RaceOpponentCard', racePanelN, [], [raceOppCard+1, raceOppCard+2], v3(0, -400, 0));
    sb.ut(raceOppCard, 640, 110);
    sb.spr(raceOppCard, 38, 28, 46);
    sb.e[raceOppCard]._active = false;
    // Avatar — UX Phase 2b: empty label; AppUI attaches IconLibrary robot at runtime.
    const raceOppAvatarN = sb.e.length;
    sb.node('OpponentAvatarLabel', raceOppCard, [], [raceOppAvatarN+1, raceOppAvatarN+2], v3(-280, 0, 0));
    sb.ut(raceOppAvatarN, 60, 60);
    sb.lbl(raceOppAvatarN, '', 40, 255, 255, 255);
    // Name — "Bot" label under/next to avatar.
    const raceOppNameN = sb.e.length;
    sb.node('OpponentNameLabel', raceOppCard, [], [raceOppNameN+1, raceOppNameN+2], v3(-180, 20, 0));
    sb.ut(raceOppNameN, 140, 24);
    const raceOppNameL = sb.lbl(raceOppNameN, 'Bot', 20, 230, 230, 240);
    sb.e[raceOppNameL]._isBold = true;
    // Bot squad symbols — shown beneath the name so user sees what the bot picked.
    const raceOppSymsN = sb.e.length;
    sb.node('OpponentSymbolsLabel', raceOppCard, [], [raceOppSymsN+1, raceOppSymsN+2], v3(-180, -14, 0));
    sb.ut(raceOppSymsN, 260, 24);
    sb.lbl(raceOppSymsN, '— · — · —', 16, 170, 180, 200);
    // Delta — big, colored live (right side).
    const raceOppDeltaN = sb.e.length;
    sb.node('OpponentDeltaLabel', raceOppCard, [], [raceOppDeltaN+1, raceOppDeltaN+2], v3(220, 8, 0));
    sb.ut(raceOppDeltaN, 180, 48);
    sb.lbl(raceOppDeltaN, '0.00%', 32, 200, 200, 210);
    // Gap — small subtitle under delta ("+0.8pp ahead" / "-1.2pp behind").
    const raceOppGapN = sb.e.length;
    sb.node('OpponentGapLabel', raceOppCard, [], [raceOppGapN+1, raceOppGapN+2], v3(220, -22, 0));
    sb.ut(raceOppGapN, 200, 22);
    sb.lbl(raceOppGapN, '—', 14, 140, 150, 170);
    // Stage 5N — monospace the opponent number columns.
    style(sb, raceOppDeltaN, { mono: true });
    style(sb, raceOppGapN, { mono: true });
    sb.e[raceOppCard]._children = [rf(raceOppAvatarN), rf(raceOppNameN), rf(raceOppSymsN), rf(raceOppDeltaN), rf(raceOppGapN)];

    // 4p/8p multi-bot leaderboard strip. Used in place of the big opponent
    // card when mode.requiredPlayers > 2. Pre-allocates 7 compact rows
    // (4p → rows 0/1/2 active; 8p → 0-6 active). BR10 truncates to top-7.
    const raceOppStripN = sb.e.length;
    sb.node('RaceOpponentStrip', racePanelN, [], [raceOppStripN + 1], v3(0, -406, 0));
    sb.ut(raceOppStripN, 640, 260);
    sb.e[raceOppStripN]._active = false;
    const raceOppRowIndices = [];
    const OPP_ROW_COUNT = 7;
    const OPP_ROW_STRIDE = 34;
    const OPP_ROW_TOP_Y = 102; // relative to strip center → first row at strip.y + 102 = -304
    for (let i = 0; i < OPP_ROW_COUNT; i++) {
        const ry = OPP_ROW_TOP_Y - i * OPP_ROW_STRIDE;
        const rowN = sb.e.length;
        sb.node(`RaceOpponentRow_${i}`, raceOppStripN, [], [rowN + 1, rowN + 2], v3(0, ry, 0));
        sb.ut(rowN, 640, 30);
        sb.spr(rowN, 26, 32, 46);
        // Avatar — UX Phase 2b: empty label; AppUI attaches small IconLibrary robot.
        const avN = sb.e.length;
        sb.node('AvatarLabel', rowN, [], [avN + 1, avN + 2], v3(-280, 0, 0));
        sb.ut(avN, 28, 24);
        sb.lbl(avN, '', 18, 255, 255, 255);
        // Name — "Bot N".
        const nmN = sb.e.length;
        sb.node('NameLabel', rowN, [], [nmN + 1, nmN + 2], v3(-215, 0, 0));
        sb.ut(nmN, 70, 22);
        const nmL = sb.lbl(nmN, `Bot ${i + 1}`, 13, 220, 225, 240);
        sb.e[nmL]._isBold = true;
        // Symbols — bot's 3 picks.
        const smN = sb.e.length;
        sb.node('SymbolsLabel', rowN, [], [smN + 1, smN + 2], v3(-70, 0, 0));
        sb.ut(smN, 240, 22);
        sb.lbl(smN, '— · — · —', 12, 160, 170, 190);
        // Delta — big, colored live.
        const dtN = sb.e.length;
        sb.node('DeltaLabel', rowN, [], [dtN + 1, dtN + 2], v3(170, 0, 0));
        sb.ut(dtN, 100, 26);
        const dtL = sb.lbl(dtN, '0.00%', 17, 210, 210, 220);
        sb.e[dtL]._isBold = true;
        // Gap pp — tiny subtitle.
        const gpN = sb.e.length;
        sb.node('GapLabel', rowN, [], [gpN + 1, gpN + 2], v3(265, 0, 0));
        sb.ut(gpN, 90, 20);
        sb.lbl(gpN, '', 11, 140, 150, 170);
        // Stage 5N — monospace the strip's number columns.
        style(sb, dtN, { mono: true });
        style(sb, gpN, { mono: true });
        sb.e[rowN]._children = [rf(avN), rf(nmN), rf(smN), rf(dtN), rf(gpN)];
        raceOppRowIndices.push(rowN);
    }
    sb.e[raceOppStripN]._children = raceOppRowIndices.map(rf);

    // Forfeit / early-exit button (bottom). Moved up from -615 to give room.
    const raceCancelN = mkBtnXY(sb, 'RaceCancelButton', racePanelN, 'Forfeit', 0, -560, 200, 48, 55, 30, 30);

    // Stage-1C polish: screen-edge vignette. Full-screen Graphics overlay
    // that AppUI._updateVignette tints emerald (profit) / coral (loss) with
    // alpha driven by |portfolio delta|. Also used by Stage-1D zero-cross
    // flash (alpha spike) and Stage-1F last-5s dim (alpha intensify).
    const raceVignetteN = sb.e.length;
    sb.node('ScreenVignette', racePanelN, [], [raceVignetteN + 1, raceVignetteN + 2], v3(0, 0, 0));
    const raceVignetteUT = sb.ut(raceVignetteN, 720, 1280);
    sb.e[raceVignetteUT]._anchorPoint = v2(0.5, 0.5);
    sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(raceVignetteN), _enabled: true, __prefab: null,
        _lineWidth: 140, _miterLimit: 10,
        _strokeColor: cl(48, 198, 155, 0),
        _fillColor: cl(255, 255, 255, 0),
        _id: gid(),
    });

    sb.e[racePanelN]._children = [
        rf(raceVignetteN),
        rf(raceTimerRingN), rf(raceCountdownN), rf(raceHeroN), rf(raceHeroSubN),
        ...raceCardIndices.map(rf),
        rf(raceOppCard),
        rf(raceOppStripN),
        rf(raceCancelN),
    ];

    // Session 12: StatusLabel — muted strip at the very bottom.
    // BackButton moved to top-left as a link (tdBackBtn above); nothing else
    // needs a full-width back slab.
    const tdStatus = mkLabel(sb, 'StatusLabel', tdN, '', 15, -740, 660, 22, 140, 150, 170);

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
    const mpTitle = mkLabel(sb, 'ModePickerTitleLabel', modePickerN, 'Choose Match', 26, 500, 500, 38, 255, 255, 255);
    const mpHint = mkLabel(sb, 'ModePickerHintLabel', modePickerN, 'Tap outside to cancel', 12, 460, 600, 18, 140, 150, 170);
    // Part 9: compressed y's to make room for a TimeWindow chip row.
    // Modes at 410/330, wagers at 230, windows at 150, paper/real at 90, start at 20.
    const modeDefs = [
        { key: 'oneVone', label: '1v1 Duel',     x: -150, y: 410 },
        { key: '4p',      label: '4p Pot',       x:  150, y: 410 },
        { key: '8p',      label: '8p Pot',       x: -150, y: 330 },
        { key: 'br10',    label: 'Battle Royale',x:  150, y: 330 },
    ];
    const mpModeIndices = [];
    for (const d of modeDefs) {
        const mN = mkBtnXY(sb, `Mode_${d.key}`, modePickerN, d.label, d.x, d.y, 260, 56, 28, 34, 48);
        mpModeIndices.push(mN);
    }
    // betting-duel polish: wager lives on TokenDuelPanel (WagerValueButton
    // dropdown). ModePicker shows a read-only summary of the selected tier
    // so the user sees what they're confirming. AppUI._refreshModePickerUi
    // writes the live value into PickerWagerReadout.
    const pickerWagerReadout = mkLabel(sb, 'PickerWagerReadout', modePickerN,
        'Wager: 0.05 SOL · tap Start to confirm', 14, 230, 600, 24, 220, 230, 240);
    const wagerIndices = [pickerWagerReadout];
    // Part 9 / betting-duel Phase 5: match-duration chip row at y=150.
    // 4 buttons, 140 wide, 8px gaps. Keys stay ('1h'|'1d'|'3d'|'7d') for
    // node-name stability; labels show the new duration semantics.
    const windowLabels = ['30s', '1m', '5m', '1h'];
    const windowKeys   = ['1h', '1d', '3d', '7d'];
    const windowIndices = [];
    const windowW = 140;
    const windowGap = 8;
    const windowStartX = -((windowLabels.length - 1) * (windowW + windowGap)) / 2;
    for (let w = 0; w < windowLabels.length; w++) {
        const wx = windowStartX + w * (windowW + windowGap);
        const wN = mkBtnXY(sb, `Window_${windowKeys[w]}`, modePickerN, windowLabels[w], wx, 150, windowW, 40, 28, 34, 48);
        windowIndices.push(wN);
    }
    // Paper / Real toggle at y=90.
    const pickerPaperBtn = mkBtnXY(sb, 'PickerPaperToggle', modePickerN, 'Paper', -80, 90, 150, 44, 48, 198, 155);
    const pickerRealBtn  = mkBtnXY(sb, 'PickerRealToggle',  modePickerN, 'Real',   80, 90, 150, 44, 28, 34, 48);

    // Phase E — Bot difficulty toggle at y=40 (Easy/Medium/Hard). Visible
    // only when track=Paper or after Real-track timeout fallback to bot.
    // AppUI._refreshModePickerUi tints the active chip.
    const pickerEasyBtn   = mkBtnXY(sb, 'PickerDifficultyEasy',   modePickerN, 'Easy',   -160, 40, 130, 40, 28, 34, 48);
    const pickerMediumBtn = mkBtnXY(sb, 'PickerDifficultyMedium', modePickerN, 'Medium',    0, 40, 130, 40, 48, 198, 155);
    const pickerHardBtn   = mkBtnXY(sb, 'PickerDifficultyHard',   modePickerN, 'Hard',    160, 40, 130, 40, 28, 34, 48);

    // Start + Cancel buttons. Bumped Start down y=20 → y=-30 to fit difficulty row.
    const pickerStartBtn  = mkBtn(sb, 'PickerStartButton',  modePickerN, 'Start Matching', -30, 420, 60, 56, 148, 252);
    const pickerCancelBtn = mkBtnXY(sb, 'PickerCancelButton', modePickerN, '✕', 300, 500, 40, 40, 55, 30, 30);
    const pickerStatus = mkLabel(sb, 'PickerStatusLabel', modePickerN, '', 12, -100, 600, 20, 140, 150, 170);

    sb.e[modePickerN]._components = [rf(mpUT), rf(mpSpr), rf(mpScrimBtn)];
    sb.e[modePickerN]._children = [
        rf(mpTitle), rf(mpHint),
        ...mpModeIndices.map(rf),
        ...wagerIndices.map(rf),
        ...windowIndices.map(rf),
        rf(pickerPaperBtn), rf(pickerRealBtn),
        rf(pickerEasyBtn), rf(pickerMediumBtn), rf(pickerHardBtn),
        rf(pickerStartBtn), rf(pickerCancelBtn),
        rf(pickerStatus),
    ];
    sb.e[modePickerN]._active = false;

    // Session 14 B3: SquadDropOverlay — modal that appears when user taps Drop.
    // Contains a darkened scrim (taps scrim to dismiss) + 3 DropPill nodes
    // showing current squad members, tap a pill to drop from squad.
    const dropOverlayN = sb.e.length;
    sb.node('SquadDropOverlay', tdN, [], [], v3(0, 0, 0));
    const dropOvUT = sb.ut(dropOverlayN, 720, 1280);
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
    const dropModalHeaderN = mkLabel(sb, 'SquadDropTitleLabel', dropOverlayN, 'DROP FROM SQUAD', 14, 200, 400, 22, 100, 110, 130);
    const dropModalHintN = mkLabel(sb, 'SquadDropHintLabel', dropOverlayN, 'Tap a token to remove · Tap outside to close', 11, 150, 460, 18, 140, 150, 170);
    const dropPillYs = [60, 0, -60];
    const dropPillIndices = [];
    for (let d = 0; d < 3; d++) {
        const pN = mkBtnXY(sb, `DropPill_${d}`, dropOverlayN, '—', 0, dropPillYs[d], 420, 48, 38, 44, 64);
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
    const presetsOvN = sb.e.length;
    sb.node('SquadPresetsOverlay', tdN, [], [], v3(0, 0, 0));
    const presetsOvUT = sb.ut(presetsOvN, 720, 1280);
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
    // Scrim button — covers the full overlay, tap-outside-to-close. Rendered
    // FIRST so child rows/buttons sit on top and receive taps instead of scrim.
    const presetsScrimBtn = mkBtnXY(sb, 'PresetsScrim', presetsOvN, '', 0, 0, 720, 1280, 0, 0, 0);
    // Zero-alpha button bg so the scrim sprite color stays dominant.
    sb.e[sb.e[presetsScrimBtn]._components[1].__id__]._color = cl(0, 0, 0, 0);
    const presetsTitle = mkLabel(sb, 'PresetsTitleLabel', presetsOvN, 'SQUAD PRESETS', 24, 460, 500, 34, 218, 165, 32);
    // UX Phase 2b: prose rewritten without emoji.
    const presetsHint = mkLabel(sb, 'PresetsHintLabel', presetsOvN, 'Tap a preset to load · swipe or tap delete to remove', 11, 425, 520, 18, 140, 150, 170);

    // 5 preset rows — each 600×56 dark card with name + symbols + delete button.
    const presetRowYs = [360, 290, 220, 150, 80];
    const presetRowIndices = [];
    for (let i = 0; i < 5; i++) {
        const rN = sb.e.length;
        sb.node(`PresetRow_${i}`, presetsOvN, [], [], v3(0, presetRowYs[i], 0));
        const rUT = sb.ut(rN, 600, 56);
        const rSpr = sb.spr(rN, 22, 28, 42);
        const rBtn = sb.add({
            __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(rN), _enabled: true, __prefab: null,
            _interactable: true, _transition: 0,
            _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
            _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
            _duration: 0.1, _zoomScale: 1.02, _target: rf(rN), _id: gid(),
        });
        const nameL = mkLabel(sb, `PresetNameLabel_${i}`, rN, '—', 18, 0, 360, 26, 220, 230, 240);
        sb.e[nameL]._lpos = v3(-270, 10, 0);
        sb.e[sb.e[nameL]._components[1].__id__]._horizontalAlign = 0;
        const symbolsL = mkLabel(sb, `PresetSymbolsLabel_${i}`, rN, '', 13, 0, 360, 20, 140, 150, 170);
        sb.e[symbolsL]._lpos = v3(-270, -12, 0);
        sb.e[sb.e[symbolsL]._components[1].__id__]._horizontalAlign = 0;
        // UX Phase 2b: empty label; AppUI attaches IconBadge trash.
        const delBtn = mkBtnXY(sb, `PresetDeleteButton_${i}`, rN, '', 260, 0, 48, 44, 55, 30, 30);
        sb.e[rN]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
        sb.e[rN]._children = [rf(nameL), rf(symbolsL), rf(delBtn)];
        sb.e[rN]._active = false; // AppUI enables when render finds saved preset
        presetRowIndices.push(rN);
    }
    // Save button — opens the PresetNameModal. Disabled (grayed) when squad not full.
    // UX Phase 2b: IconBadge save attached by AppUI. Phase 2c: bold.
    const presetsSaveBtn = mkBtn(sb, 'PresetSaveButton', presetsOvN, 'Save current squad', -100, 420, 56, 218, 165, 32);
    style(sb, presetsSaveBtn, { bold: true });
    const presetsEmptyL = mkLabel(sb, 'PresetsEmptyLabel', presetsOvN, 'No saved presets yet — pick 3 tokens and tap Save', 13, -20, 600, 22, 130, 140, 160);
    sb.e[presetsEmptyL]._active = false;

    // PresetNameModal — small card with EditBox + Save/Cancel buttons.
    const presetsModalN = sb.e.length;
    sb.node('PresetNameModal', presetsOvN, [], [], v3(0, -30, 0));
    const presetsModalUT = sb.ut(presetsModalN, 460, 200);
    const presetsModalSpr = sb.spr(presetsModalN, 28, 34, 52);
    const presetsModalTitle = mkLabel(sb, 'PresetModalTitleLabel', presetsModalN, 'Name your preset', 16, 70, 420, 24, 200, 210, 230);
    const presetNameEB = mkEditBox(sb, 'PresetNameEditBox', presetsModalN, 'e.g. "Meme Monday"', 0, 20, 400, 44, 17);
    const presetModalSave = mkBtnXY(sb, 'PresetSaveConfirmButton', presetsModalN, 'Save', -100, -50, 180, 44, 48, 198, 155);
    const presetModalCancel = mkBtnXY(sb, 'PresetSaveCancelButton', presetsModalN, 'Cancel', 100, -50, 180, 44, 62, 72, 92);
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

    // Session 14 A4: invisible full-panel BackdropButton for tap-outside-close.
    const tdBackdrop = sb.e.length;
    sb.node('BackdropButton', tdN, [], [], v3(0, 0, 0));
    const tdBackdropUT = sb.ut(tdBackdrop, 720, 1280);
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

    // Session 11: SearchSuggestionPopover — 5 pre-instantiated rows. Rendered
    // LAST in children order so it overlays the feed when visible. Hidden by
    // default; AppUI toggles _active via the SearchEditBox text events.
    const suggestN = sb.e.length;
    sb.node('SearchSuggestionPopover', tdN, [], [], v3(-30, 360, 0));
    const suggUT = sb.ut(suggestN, 560, 300);
    const suggSpr = sb.spr(suggestN, 25, 28, 44);
    const suggestChildIdx = [];
    const suggRowH = 54;
    const suggTopY = 115;
    for (let s = 0; s < 5; s++) {
        const sY = suggTopY - s * suggRowH;
        const sN = sb.e.length;
        sb.node(`Suggest_${s}`, suggestN, [], [], v3(0, sY, 0));
        const sUT = sb.ut(sN, 540, suggRowH - 4);
        const sSpr = sb.spr(sN, 38, 40, 58);
        const sBtn = sb.btn(sN, 38, 40, 58);

        const sLogoN = sb.e.length;
        sb.node('LogoSprite', sN, [], [], v3(-240, 0, 0));
        const sLogoUT = sb.ut(sLogoN, 28, 28);
        const sLogoSpr = sb.spr(sLogoN, 255, 255, 255);
        sb.e[sLogoN]._components = [rf(sLogoUT), rf(sLogoSpr)];

        const sSymN = sb.e.length;
        sb.node('SymbolLabel', sN, [], [], v3(-130, 8, 0));
        const sSymUT = sb.ut(sSymN, 170, 22);
        const sSymL  = sb.lbl(sSymN, '—', 18, 255, 255, 255);
        sb.e[sSymL]._horizontalAlign = 0;
        sb.e[sSymL]._isBold = true;
        sb.e[sSymN]._components = [rf(sSymUT), rf(sSymL)];

        const sMintN = sb.e.length;
        sb.node('MintLabel', sN, [], [], v3(-130, -12, 0));
        const sMintUT = sb.ut(sMintN, 220, 18);
        const sMintL  = sb.lbl(sMintN, '', 12, 130, 130, 145);
        sb.e[sMintL]._horizontalAlign = 0;
        sb.e[sMintN]._components = [rf(sMintUT), rf(sMintL)];

        const sPriceN = sb.e.length;
        sb.node('PriceLabel', sN, [], [], v3(150, 8, 0));
        const sPriceUT = sb.ut(sPriceN, 90, 22);
        const sPriceL  = sb.lbl(sPriceN, '', 14, 218, 165, 32);
        sb.e[sPriceN]._components = [rf(sPriceUT), rf(sPriceL)];

        const sVolN = sb.e.length;
        sb.node('VolLabel', sN, [], [], v3(240, 8, 0));
        const sVolUT = sb.ut(sVolN, 60, 22);
        const sVolL  = sb.lbl(sVolN, '', 12, 170, 170, 180);
        sb.e[sVolN]._components = [rf(sVolUT), rf(sVolL)];

        const sChangeN = sb.e.length;
        sb.node('ChangeLabel', sN, [], [], v3(200, -12, 0));
        const sChangeUT = sb.ut(sChangeN, 100, 18);
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
        rf(tdTitle), rf(tdLeaderboardBtn), rf(tdPortfolioBtn), rf(tdSettingsBtn),
        rf(tdPresetsBtn), rf(tdSuggestBtn), rf(tdHelpBtn),
        rf(tdBalance),
        rf(tdSearch), rf(tdSearchClear),
        rf(tdTabDropdown), rf(tdWatchStar), rf(tdWatchCancel), rf(tdLiveLbl),
        ...chipIndices.map(rf), rf(tdMinLiqBtn), rf(tdColumnsBtn),
        rf(headerGroupN),
        rf(tdFeedSV),
        rf(tdSquadPick), rf(tdSquadDrop), rf(tdSquadRun),     // Session 14 B1
        rf(tdSquadHeader), rf(tdSquad0), rf(tdSquad1), rf(tdSquad2),
        rf(tdStakeHeader), rf(tdStakeValueLabel), rf(tdStakeSlider),
        rf(tdStake001), rf(tdStake010), rf(tdStake100),
        rf(tdCommit), rf(tdStartGame), rf(tdClaim),
        rf(tdWagerValueBtn), rf(tdWagerStartBtn), rf(tdWagerHint), rf(tdWagerDropdown),
        rf(tdHero1), rf(tdHero2), rf(tdHero3),
        rf(h1N), rf(h2N), rf(h3N),
        rf(tdGameArea), rf(tdGameOver), rf(racePanelN),       // betting-duel Phase 3: live race screen
        rf(tdBackdrop),                                       // below popovers for tap-outside-close
        rf(popN), rf(minLiqPopN), rf(colPopN), rf(suggestN),
        rf(dropOverlayN),
        rf(modePickerN),                                      // Session D Part 2 (top-most overlay)
        rf(tdStatus),
    ];
    sb.e[tdN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session 13 — TOKEN DETAIL PANEL (chart + stats)
    // Sibling of TokenDuelPanel. Shown when user taps a feed row.
    // Layout:
    //   +625  ← Back link (top-left, reusing chrome style)
    //   +600  $TICKER symbol (gold, bold)
    //   +572  Name · 4chars…4chars copy chip
    //   +525  Pick/Unpick big CTA
    //   +465  Safety chips row (Mint / Auth / LP / Top10)
    //   +415  Timeframe row (1m / 5m / 15m / 1H / 4H / 1D)
    //   +378  Denom row (Price / MCap  |  USD / SOL)
    //    +40  Chart area (660×640 frame with cc.Graphics)
    //   -340  Stats grid (3×2 cards: PRICE, LIQ, MCAP, VOL 24H, 24H%, HOLDERS)
    //   -620  Status line
    // ═══════════════════════════════════════════════════════════════
    const tdetN = sb.e.length;
    sb.node('TokenDetailPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(tdetN, 720, 1280);

    // Back link (mirrors TokenDuelPanel's pattern).
    const detBackLink = mkLabel(sb, 'BackLinkLabel', tdetN, '← Back', 18, 618, 110, 28, 160, 170, 190);
    sb.e[detBackLink]._lpos = v3(-280, 618, 0);
    const detBackLinkL = sb.e[detBackLink]._components[1].__id__;
    sb.e[detBackLinkL]._horizontalAlign = 0;
    const detBackBtn = sb.e.length;
    sb.node('BackButton', tdetN, [], [], v3(-280, 618, 0));
    const detBackBtnUT = sb.ut(detBackBtn, 140, 36);
    const detBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(detBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(detBackBtn), _id: gid(),
    });
    sb.e[detBackBtn]._components = [rf(detBackBtnUT), rf(detBackBtnBtn)];

    // Symbol + name + mint.
    const detSymbol = mkLabel(sb, 'DetailSymbolLabel', tdetN, '$—', 26, 600, 380, 36, 255, 255, 255);
    const detSymbolL = sb.e[detSymbol]._components[1].__id__;
    sb.e[detSymbolL]._horizontalAlign = 0;
    sb.e[detSymbolL]._isBold = true;
    sb.e[detSymbol]._lpos = v3(-140, 600, 0);

    const detName = mkLabel(sb, 'DetailNameLabel', tdetN, '', 13, 572, 400, 22, 140, 145, 165);
    const detNameL = sb.e[detName]._components[1].__id__;
    sb.e[detNameL]._horizontalAlign = 0;
    sb.e[detName]._lpos = v3(-140, 572, 0);

    const detMintChip = mkBtnXY(sb, 'DetailMintChip', tdetN, 'mint…', 200, 572, 200, 28, 28, 34, 48);

    // Pick/Unpick CTA.
    const detPickBtn = mkBtn(sb, 'DetailPickUnpickButton', tdetN, '+ Pick', 525, 620, 48, 48, 198, 155);

    // Safety chips row.
    const safetyY = 465;
    const safetyDefs = [
        { key: 'mint',  label: '◎ Mint' },
        { key: 'auth',  label: '◎ Auth' },
        { key: 'lp',    label: '◎ LP' },
        { key: 'top10', label: '◎ Top10' },
    ];
    const safetyIndices = [];
    for (let s = 0; s < safetyDefs.length; s++) {
        const sx = -240 + s * 155;
        const sN = mkBtnXY(sb, `SafetyChip_${safetyDefs[s].key}`, tdetN, safetyDefs[s].label, sx, safetyY, 140, 32, 28, 34, 48);
        safetyIndices.push(sN);
    }

    // Timeframe row.
    const tfY = 415;
    const tfDefs = [
        { key: '1m',  label: '1m'  },
        { key: '5m',  label: '5m'  },
        { key: '15m', label: '15m' },
        { key: '1H',  label: '1H'  },
        { key: '4H',  label: '4H'  },
        { key: '1D',  label: '1D'  },
    ];
    const tfIndices = [];
    for (let t = 0; t < tfDefs.length; t++) {
        const tx = -275 + t * 90;
        const tN = mkBtnXY(sb, `TF_${tfDefs[t].key}`, tdetN, tfDefs[t].label, tx, tfY, 80, 32, 28, 34, 48);
        tfIndices.push(tN);
    }

    // Denom row: Price/MCap | USD/SOL (with a visual divider).
    const denomY = 378;
    const denomPriceBtn = mkBtnXY(sb, 'Denom_price', tdetN, 'Price', -210, denomY, 90, 28, 28, 34, 48);
    const denomMcapBtn  = mkBtnXY(sb, 'Denom_mcap',  tdetN, 'MCap',  -110, denomY, 90, 28, 28, 34, 48);
    const denomUsdBtn   = mkBtnXY(sb, 'Denom_usd',   tdetN, 'USD',    110, denomY, 90, 28, 28, 34, 48);
    const denomSolBtn   = mkBtnXY(sb, 'Denom_sol',   tdetN, 'SOL',    210, denomY, 90, 28, 28, 34, 48);

    // Chart area — cc.Graphics renders candles here.
    const chartN = sb.e.length;
    sb.node('ChartArea', tdetN, [], [], v3(0, 40, 0));
    const chartUT = sb.ut(chartN, 680, 640);
    const chartSpr = sb.spr(chartN, 14, 18, 28);
    const chartGfx = sb.add({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(chartN), _enabled: true, __prefab: null,
        _materials: [], _visFlags: 0,
        _srcBlendFactor: 2, _dstBlendFactor: 4,
        _lineWidth: 1, _strokeColor: cl(48, 198, 155, 255), _fillColor: cl(48, 198, 155, 255),
        _lineJoin: 2, _lineCap: 0, _miterLimit: 10,
        _id: gid(),
    });
    sb.e[chartN]._components = [rf(chartUT), rf(chartSpr), rf(chartGfx)];

    // Chart placeholder label (shown while loading).
    const chartLoadLbl = mkLabel(sb, 'ChartStatusLabel', chartN, 'Loading chart…', 14, 0, 300, 22, 140, 150, 170);

    // Stats grid: 6 cards in 3×2 arrangement (y=-340 / y=-420).
    const statsTopY = -340;
    const statsBotY = -420;
    const statDefs = [
        { key: 'price',   label: 'PRICE',    x: -225, y: statsTopY },
        { key: 'liq',     label: 'LIQ',      x: 0,    y: statsTopY },
        { key: 'mcap',    label: 'MCAP',     x: 225,  y: statsTopY },
        { key: 'vol24h',  label: 'VOL 24H',  x: -225, y: statsBotY },
        { key: 'change',  label: '24H',      x: 0,    y: statsBotY },
        { key: 'holders', label: 'HOLDERS',  x: 225,  y: statsBotY },
    ];
    const statIndices = [];
    for (const d of statDefs) {
        const cardN = sb.e.length;
        sb.node(`StatCard_${d.key}`, tdetN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, 210, 70);
        const cardSpr = sb.spr(cardN, 18, 22, 32);
        // Label header (top of card).
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(0, 16, 0));
        const lblUT = sb.ut(lblN, 200, 22);
        const lblL  = sb.lbl(lblN, d.label, 10, 100, 110, 130);
        sb.e[lblL]._spacingX = 1;
        sb.e[lblN]._components = [rf(lblUT), rf(lblL)];
        // Value (bottom of card).
        const valN = sb.e.length;
        sb.node('Value', cardN, [], [], v3(0, -14, 0));
        const valUT = sb.ut(valN, 200, 28);
        const valL  = sb.lbl(valN, '—', 20, 255, 255, 255);
        sb.e[valL]._isBold = true;
        sb.e[valN]._components = [rf(valUT), rf(valL)];
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(lblN), rf(valN)];
        statIndices.push(cardN);
    }

    const detStatus = mkLabel(sb, 'DetailStatusLabel', tdetN, '', 13, -625, 660, 22, 140, 150, 170);

    sb.e[tdetN]._children = [
        rf(detBackLink), rf(detBackBtn),
        rf(detSymbol), rf(detName), rf(detMintChip),
        rf(detPickBtn),
        ...safetyIndices.map(rf),
        ...tfIndices.map(rf),
        rf(denomPriceBtn), rf(denomMcapBtn), rf(denomUsdBtn), rf(denomSolBtn),
        rf(chartN),
        ...statIndices.map(rf),
        rf(detStatus),
    ];
    sb.e[tdetN]._active = false; // hidden until a row is opened

    // ═══════════════════════════════════════════════════════════════
    // Session 14 C2 — LEADERBOARD PANEL (full-screen list of top 10)
    // ═══════════════════════════════════════════════════════════════
    const lbN = sb.e.length;
    sb.node('LeaderboardPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(lbN, 720, 1280);
    // betting-duel polish: widen Y spread from [-620,+618] → [-740,+720]
    // so leaderboard uses the full visible viewport on device (1602px) not
    // just design (1280px).
    const lbBackLink = mkLabel(sb, 'BackLinkLabel', lbN, '← Back', 18, 720, 110, 28, 160, 170, 190);
    sb.e[lbBackLink]._lpos = v3(-280, 720, 0);
    const lbBackLinkL = sb.e[lbBackLink]._components[1].__id__;
    sb.e[lbBackLinkL]._horizontalAlign = 0;
    const lbBackBtn = sb.e.length;
    sb.node('BackButton', lbN, [], [], v3(-280, 720, 0));
    const lbBackBtnUT = sb.ut(lbBackBtn, 140, 36);
    const lbBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(lbBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(lbBackBtn), _id: gid(),
    });
    sb.e[lbBackBtn]._components = [rf(lbBackBtnUT), rf(lbBackBtnBtn)];
    // UX Phase 2b: IconBadge trophy on LeaderboardTitleLabel attached by AppUI. Phase 2c: bold.
    const lbTitle = mkLabel(sb, 'LeaderboardTitleLabel', lbN, 'Leaderboard', 30, 680, 400, 44, 218, 165, 32);
    style(sb, lbTitle, { bold: true });
    const lbTabDefs = [
        { key: '1v1',    label: '1v1',          x: -292 },
        { key: '4p',     label: '4p',           x: -146 },
        { key: '8p',     label: '8p',           x:    0 },
        { key: 'br10',   label: 'BR10',         x:  146 },
        { key: 'season', label: 'This Week', x:  292 },
    ];
    const lbTabIndices = [];
    for (const t of lbTabDefs) {
        const active = t.key === '1v1';
        const bg = active ? [48, 198, 155] : [38, 44, 64];
        const btn = mkBtnXY(sb, `LBTab_${t.key}`, lbN, t.label, t.x, 600, 130, 44, bg[0], bg[1], bg[2]);
        lbTabIndices.push(btn);
    }
    // 10 rank rows at y=+540 down, 64px stride — more breathing room.
    const lbRowIndices = [];
    const lbStartY = 540;
    const lbRowStride = 64;
    for (let r = 0; r < 10; r++) {
        const ry = lbStartY - r * lbRowStride;
        const rN = sb.e.length;
        sb.node(`LBRow_${r}`, lbN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, 660, 54);
        const rSpr = sb.spr(rN, 18, 22, 32);
        const rankN = mkLabel(sb, 'RankLabel', rN, `${r + 1}.`, 18, 0, 50, 30, 200, 200, 210);
        sb.e[rankN]._lpos = v3(-300, 0, 0);
        const playerN = mkLabel(sb, 'PlayerLabel', rN, '—', 16, 0, 280, 28, 200, 210, 230);
        sb.e[playerN]._lpos = v3(-110, 6, 0);
        const playerL = sb.e[playerN]._components[1].__id__;
        sb.e[playerL]._horizontalAlign = 0;
        const heightN = mkLabel(sb, 'HeightLabel', rN, '—', 16, 0, 120, 28, 218, 165, 32);
        sb.e[heightN]._lpos = v3(180, 6, 0);
        const elapsedN = mkLabel(sb, 'ElapsedLabel', rN, '', 11, 0, 280, 18, 130, 140, 160);
        sb.e[elapsedN]._lpos = v3(-110, -14, 0);
        const elapsedL = sb.e[elapsedN]._components[1].__id__;
        sb.e[elapsedL]._horizontalAlign = 0;
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(rankN), rf(playerN), rf(heightN), rf(elapsedN)];
        sb.e[rN]._active = false;
        lbRowIndices.push(rN);
    }
    const lbStatus = mkLabel(sb, 'LeaderboardStatusLabel', lbN, '', 14, -740, 600, 22, 140, 150, 170);

    // Session D Part 8: personal rank footer card below the 10 rows.
    // Since the on-chain leaderboard only stores top-10, this card gives every
    // user a self-locating signal: "you're #3" or "not yet ranked".
    const prcY = lbStartY - 10 * lbRowStride - 30; // ~-150 below last row
    const prcN = sb.e.length;
    sb.node('PersonalRankCard', lbN, [], [], v3(0, prcY, 0));
    const prcUT = sb.ut(prcN, 660, 100);
    const prcSpr = sb.spr(prcN, 28, 36, 52);
    // UX Phase 2b: IconBadge user attached by AppUI.
    const prcHeader = mkLabel(sb, 'HeaderLabel', prcN, 'YOU', 13, 32, 120, 18, 140, 220, 180);
    sb.e[prcHeader]._lpos = v3(-290, 32, 0);
    sb.e[sb.e[prcHeader]._components[1].__id__]._horizontalAlign = 0;
    const prcRank = mkLabel(sb, 'RankLabel', prcN, 'Not ranked yet', 16, 6, 600, 24, 220, 230, 240);
    sb.e[prcRank]._lpos = v3(0, 6, 0);
    const prcStats = mkLabel(sb, 'StatsLabel', prcN, 'W–L —  ·  Level —  ·  P/L —', 12, -22, 600, 20, 160, 170, 190);
    sb.e[prcStats]._lpos = v3(0, -22, 0);
    sb.e[prcN]._components = [rf(prcUT), rf(prcSpr)];
    sb.e[prcN]._children = [rf(prcHeader), rf(prcRank), rf(prcStats)];
    sb.e[prcN]._active = false; // AppUI enables once a pubkey is connected

    sb.e[lbN]._children = [rf(lbBackLink), rf(lbBackBtn), rf(lbTitle), ...lbTabIndices.map(rf), ...lbRowIndices.map(rf), rf(prcN), rf(lbStatus)];
    sb.e[lbN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 10 Bundle 3 / pt2 — DAILY CHALLENGE PANEL
    // Streak card + 3 challenge rows + season podium card. AppUI hydrates
    // from UserStats + DailyChallenge + Season RPCs.
    // ═══════════════════════════════════════════════════════════════
    const dcN = sb.e.length;
    sb.node('DailyChallengePanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(dcN, 720, 1280);
    sb.spr(dcN, 10, 14, 22);
    const dcBackLink = mkLabel(sb, 'BackLinkLabel', dcN, '← Back', 18, 618, 110, 28, 160, 170, 190);
    sb.e[dcBackLink]._lpos = v3(-280, 618, 0);
    sb.e[sb.e[dcBackLink]._components[1].__id__]._horizontalAlign = 0;
    const dcBackBtn = sb.e.length;
    sb.node('BackButton', dcN, [], [], v3(-280, 618, 0));
    const dcBackBtnUT = sb.ut(dcBackBtn, 140, 36);
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
    const dcTitle = mkLabel(sb, 'DailyChallengeTitleLabel', dcN, "Today's Challenges", 26, 600, 600, 40, 218, 165, 32);
    style(sb, dcTitle, { bold: true });

    // Streak card (y=440, 600×100).
    const streakCardN = sb.e.length;
    sb.node('DailyStreakCard', dcN, [], [], v3(0, 440, 0));
    const streakCardUT = sb.ut(streakCardN, 600, 100);
    const streakCardSpr = sb.spr(streakCardN, 22, 28, 42);
    const streakHeader = mkLabel(sb, 'HeaderLabel', streakCardN, 'STREAK', 11, 34, 200, 16, 140, 150, 170);
    sb.e[streakHeader]._lpos = v3(-260, 34, 0);
    sb.e[sb.e[streakHeader]._components[1].__id__]._horizontalAlign = 0;
    const streakDay = mkLabel(sb, 'StreakDayLabel', streakCardN, 'Day 0', 36, 0, 560, 46, 255, 255, 255);
    sb.e[streakDay]._lpos = v3(0, 2, 0);
    const streakBest = mkLabel(sb, 'StreakBestLabel', streakCardN, 'Best: 0', 14, -28, 560, 22, 160, 170, 190);
    sb.e[streakBest]._lpos = v3(0, -28, 0);
    sb.e[streakCardN]._components = [rf(streakCardUT), rf(streakCardSpr)];
    sb.e[streakCardN]._children = [rf(streakHeader), rf(streakDay), rf(streakBest)];

    // 3 challenge rows (y=280/180/80, 600×80).
    const challengeRowYs = [280, 180, 80];
    const challengeRowIndices = [];
    for (let i = 0; i < 3; i++) {
        const rN = sb.e.length;
        sb.node(`ChallengeRow_${i}`, dcN, [], [], v3(0, challengeRowYs[i], 0));
        const rUT = sb.ut(rN, 600, 80);
        const rSpr = sb.spr(rN, 22, 28, 42);
        const descL = mkLabel(sb, `ChallengeDescriptionLabel_${i}`, rN, '—', 17, 0, 360, 28, 220, 230, 240);
        sb.e[descL]._lpos = v3(-250, 14, 0);
        sb.e[sb.e[descL]._components[1].__id__]._horizontalAlign = 0;
        const subL = mkLabel(sb, `ChallengeProgressLabel_${i}`, rN, '', 13, 0, 360, 20, 140, 150, 170);
        sb.e[subL]._lpos = v3(-250, -14, 0);
        sb.e[sb.e[subL]._components[1].__id__]._horizontalAlign = 0;
        const rewardL = mkLabel(sb, `ChallengeRewardLabel_${i}`, rN, '+0 XP', 15, 0, 120, 22, 218, 165, 32);
        sb.e[rewardL]._lpos = v3(150, 0, 0);
        const checkL = mkLabel(sb, `ChallengeCheckmark_${i}`, rN, '·', 28, 0, 48, 36, 90, 100, 120);
        sb.e[checkL]._lpos = v3(260, 0, 0);
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(descL), rf(subL), rf(rewardL), rf(checkL)];
        challengeRowIndices.push(rN);
    }

    // Season summary card (y=-60, 600×120).
    const seasonSumN = sb.e.length;
    sb.node('SeasonSummaryCard', dcN, [], [], v3(0, -60, 0));
    const seasonSumUT = sb.ut(seasonSumN, 600, 120);
    const seasonSumSpr = sb.spr(seasonSumN, 22, 28, 42);
    const seasonHeader = mkLabel(sb, 'SeasonHeaderLabel', seasonSumN, 'THIS WEEK', 11, 42, 200, 16, 140, 150, 170);
    sb.e[seasonHeader]._lpos = v3(-260, 42, 0);
    sb.e[sb.e[seasonHeader]._components[1].__id__]._horizontalAlign = 0;
    const seasonRank = mkLabel(sb, 'SeasonRankLabel', seasonSumN, 'Rank: —  ·  Wins: 0', 17, 14, 560, 26, 220, 230, 240);
    sb.e[seasonRank]._lpos = v3(0, 14, 0);
    const seasonPodium = mkLabel(sb, 'SeasonPodiumLabel', seasonSumN, 'Podium: —', 13, -18, 560, 22, 160, 170, 190);
    sb.e[seasonPodium]._lpos = v3(0, -18, 0);
    const seasonPrize = mkLabel(sb, 'SeasonPrizeLabel', seasonSumN, '', 12, -42, 560, 18, 130, 140, 160);
    sb.e[seasonPrize]._lpos = v3(0, -42, 0);
    sb.e[seasonSumN]._components = [rf(seasonSumUT), rf(seasonSumSpr)];
    sb.e[seasonSumN]._children = [rf(seasonHeader), rf(seasonRank), rf(seasonPodium), rf(seasonPrize)];

    const dcStatus = mkLabel(sb, 'DailyChallengeStatusLabel', dcN, '', 13, -540, 600, 20, 140, 150, 170);

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
    sb.node('PortfolioPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(pfN, 720, 1280);
    // betting-duel polish: stretch the panel to fill the Canvas on any device
    // aspect ratio. Without a Widget, tall-screen devices shrink the panel to
    // a fraction of the viewport. Inner labels use absolute Y offsets so they
    // track the panel's center as it stretches.
    sb.widget(pfN);
    // betting-duel polish (FIXED_WIDTH spread): Y range stretched from
    // [-620, +620] → [-760, +720] to use the full 1602px viewport on device.
    const pfBackLink = mkLabel(sb, 'BackLinkLabel', pfN, '← Back', 18, 720, 110, 28, 160, 170, 190);
    sb.e[pfBackLink]._lpos = v3(-280, 720, 0);
    const pfBackLinkL = sb.e[pfBackLink]._components[1].__id__;
    sb.e[pfBackLinkL]._horizontalAlign = 0;
    const pfBackBtn = sb.e.length;
    sb.node('BackButton', pfN, [], [], v3(-280, 720, 0));
    const pfBackBtnUT = sb.ut(pfBackBtn, 140, 36);
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
    const pfTitle = mkLabel(sb, 'PortfolioTitleLabel', pfN, 'Portfolio', 30, 680, 400, 44, 255, 255, 255);
    style(sb, pfTitle, { bold: true, color: GOLD() });
    const pfPubkeyLabel = mkLabel(sb, 'PortfolioPubkeyLabel', pfN, 'not connected', 16, 630, 460, 24, 140, 220, 180);
    // Stats / History / Trophies switch.
    const pfStatsTab    = mkBtnXY(sb, 'PortfolioStatsTab',    pfN, 'Stats',     -180, 580, 170, 44, 48, 198, 155);
    const pfHistoryTab  = mkBtnXY(sb, 'PortfolioHistoryTab',  pfN, 'History',      0, 580, 170, 44, 28, 34, 48);
    // UX Phase 2b: IconBadge trophy attached by AppUI.
    const pfTrophiesTab = mkBtnXY(sb, 'PortfolioTrophiesTab', pfN, 'Trophies',180, 580, 170, 44, 28, 34, 48);
    // Paper / Real sub-tabs (for the Stats view).
    const pfPaperTab = mkBtnXY(sb, 'PortfolioPaperTab', pfN, 'Paper',  -90, 520, 170, 44, 48, 198, 155);
    const pfRealTab  = mkBtnXY(sb, 'PortfolioRealTab',  pfN, 'Real',    90, 520, 170, 44, 28, 34, 48);
    // 6 stat cards 3×2 — spread to use vertical space (was y=380/290 gap 90 → y=420/300 gap 120).
    const pfStatDefs = [
        { key: 'games',   label: 'GAMES',    x: -225, y: 420 },
        { key: 'wins',    label: 'WINS',     x: 0,    y: 420 },
        { key: 'losses',  label: 'LOSSES',   x: 225,  y: 420 },
        { key: 'winrate', label: 'WIN %',    x: -225, y: 300 },
        { key: 'pnl',     label: 'P/L SOL',  x: 0,    y: 300 },
        { key: 'xp',      label: 'XP',       x: 225,  y: 300 },
    ];
    const pfStatIndices = [];
    for (const d of pfStatDefs) {
        const cardN = sb.e.length;
        sb.node(`PFStatCard_${d.key}`, pfN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, 220, 96);
        const cardSpr = sb.spr(cardN, 18, 22, 32);
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(0, 26, 0));
        const lblUT = sb.ut(lblN, 210, 22);
        const lblL = sb.lbl(lblN, d.label, 11, 100, 110, 130);
        sb.e[lblL]._spacingX = 1;
        sb.e[lblN]._components = [rf(lblUT), rf(lblL)];
        const valN = sb.e.length;
        sb.node('Value', cardN, [], [], v3(0, -18, 0));
        const valUT = sb.ut(valN, 210, 36);
        const valL = sb.lbl(valN, '—', 26, 255, 255, 255);
        sb.e[valL]._isBold = true;
        sb.e[valN]._components = [rf(valUT), rf(valL)];
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(lblN), rf(valN)];
        pfStatIndices.push(cardN);
    }
    const pfHint = mkLabel(sb, 'PortfolioHintLabel', pfN, 'Real stats come online after Session D (on-chain UserStats PDA).', 12, 160, 620, 20, 140, 150, 170);
    const pfStatus = mkLabel(sb, 'PortfolioStatusLabel', pfN, '', 14, -740, 640, 22, 140, 150, 170);

    // Part 9: MatchHistory view — hidden when Stats tab is active.
    // Container anchors label + scrollview + load-more button as a unit.
    const pfHistoryViewN = sb.e.length;
    sb.node('PortfolioHistoryView', pfN, [], [], v3(0, 0, 0));
    sb.ut(pfHistoryViewN, 720, 1280);
    const pfHistoryEmpty = mkLabel(sb, 'PortfolioHistoryEmptyLabel', pfHistoryViewN,
        'No matches yet — play a Real match to see history.',
        14, 0, 0, 22, 140, 150, 170);
    const pfHistorySV = mkScrollView(sb, 'PortfolioHistoryScroll', pfHistoryViewN, 0, 40, 660, 780);
    // Pre-instantiate 30 MatchHistoryRow nodes as a pool. AppUI toggles active
    // + updates their labels as entries arrive from MatchHistoryRpc.
    const pfHistoryRows = [];
    const rowH = 72;
    for (let i = 0; i < 30; i++) {
        const rowN = sb.e.length;
        const ry = -i * rowH - rowH / 2; // top-down cascade beneath content anchor (0.5, 1)
        sb.node(`MatchHistoryRow_${i}`, pfHistorySV.content, [], [], v3(0, ry, 0));
        const rowUT = sb.ut(rowN, 600, rowH - 8);
        const rowSpr = sb.spr(rowN, 22, 28, 44);
        // 5 labels per row: date · mode/window badge · wager · placement · payout
        const dateL = mkLabel(sb, 'Date',      rowN, '—', 12, 0, 560, 18, 160, 170, 190);
        sb.e[dateL]._lpos = v3(-270, 16, 0);
        const modeL = mkLabel(sb, 'Mode',      rowN, '—', 12, 0, 560, 18, 255, 255, 255);
        sb.e[modeL]._lpos = v3(-90, 16, 0);
        const wagerL = mkLabel(sb, 'Wager',    rowN, '—', 12, 0, 560, 18, 200, 210, 220);
        sb.e[wagerL]._lpos = v3(90, 16, 0);
        const placeL = mkLabel(sb, 'Placement',rowN, '—', 12, 0, 560, 18, 255, 255, 255);
        sb.e[placeL]._lpos = v3(-90, -14, 0);
        const payoutL = mkLabel(sb, 'Payout',  rowN, '—', 14, 0, 560, 20, 48, 198, 155);
        sb.e[payoutL]._lpos = v3(200, -14, 0);
        sb.e[rowN]._components = [rf(rowUT), rf(rowSpr)];
        sb.e[rowN]._children = [rf(dateL), rf(modeL), rf(wagerL), rf(placeL), rf(payoutL)];
        sb.e[rowN]._active = false;
        pfHistoryRows.push(rowN);
    }
    // Attach pool to content.
    sb.e[pfHistorySV.content]._children = pfHistoryRows.map(rf);
    const pfHistoryLoadMore = mkBtn(sb, 'PortfolioHistoryLoadMoreButton', pfHistoryViewN, 'Load more', -260, 400, 48, 48, 70, 90);
    sb.e[pfHistoryLoadMore]._lpos = v3(0, -260, 0);
    sb.e[pfHistoryLoadMore]._active = false;

    sb.e[pfHistoryViewN]._children = [rf(pfHistoryEmpty), rf(pfHistorySV.root), rf(pfHistoryLoadMore)];
    sb.e[pfHistoryViewN]._active = false;

    // Part 11 B: Trophies view — 3×2 grid of 200×200 cNFT tiles.
    // Hidden until user taps PortfolioTrophiesTab.
    const pfTrophiesViewN = sb.e.length;
    sb.node('PortfolioTrophiesView', pfN, [], [], v3(0, 0, 0));
    sb.ut(pfTrophiesViewN, 720, 1280);
    const pfTrophiesEmpty = mkLabel(sb, 'PortfolioTrophiesEmptyLabel', pfTrophiesViewN,
        'No trophies yet — win a weekly season to earn your first',
        14, 0, 540, 24, 140, 150, 170);
    const pfTrophyTileIndices = [];
    const tileW = 200, tileH = 200, tileGap = 20;
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
            const i = row * 3 + col;
            const tx = (col - 1) * (tileW + tileGap);
            const ty = 220 - row * (tileH + tileGap);
            const tN = sb.e.length;
            sb.node(`TrophyTile_${i}`, pfTrophiesViewN, [], [], v3(tx, ty, 0));
            const tUT = sb.ut(tN, tileW, tileH);
            const tSpr = sb.spr(tN, 22, 28, 44);
            // UX Phase 2b: empty label; AppUI attaches IconLibrary via rankIcon per tile.
            const emojiLbl = mkLabel(sb, 'Emoji', tN, '', 56, 50, tileW, 70, 255, 255, 255);
            const titleLbl = mkLabel(sb, 'Title', tN, 'Week #0', 14, -10, tileW, 20, 220, 200, 140);
            const winsLbl = mkLabel(sb, 'Wins', tN, '0 wins', 12, -40, tileW, 18, 140, 150, 170);
            sb.e[tN]._components = [rf(tUT), rf(tSpr)];
            sb.e[tN]._children = [rf(emojiLbl), rf(titleLbl), rf(winsLbl)];
            sb.e[tN]._active = false;
            pfTrophyTileIndices.push(tN);
        }
    }
    sb.e[pfTrophiesViewN]._children = [rf(pfTrophiesEmpty), ...pfTrophyTileIndices.map(rf)];
    sb.e[pfTrophiesViewN]._active = false;

    sb.e[pfN]._children = [
        rf(pfBackLink), rf(pfBackBtn),
        rf(pfTitle), rf(pfPubkeyLabel),
        rf(pfStatsTab), rf(pfHistoryTab), rf(pfTrophiesTab),
        rf(pfPaperTab), rf(pfRealTab),
        ...pfStatIndices.map(rf),
        rf(pfHistoryViewN), rf(pfTrophiesViewN),
        rf(pfHint), rf(pfStatus),
    ];
    sb.e[pfN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session D Part 3 — WAITING PANEL
    // Shown during real-mode matchmaking + as a brief transition for paper.
    // ═══════════════════════════════════════════════════════════════
    const wpN = sb.e.length;
    sb.node('WaitingPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(wpN, 720, 1280);
    sb.spr(wpN, 10, 14, 22);

    const wpTitle = mkLabel(sb, 'WaitingTitleLabel', wpN, 'Finding opponent…', 28, 300, 600, 40, 255, 255, 255);
    const wpMode = mkLabel(sb, 'WaitingModeLabel', wpN, '1v1 · 0.05 SOL · Real', 16, 250, 600, 24, 140, 220, 180);
    // Part 13: rake preview. AppUI populates with "Rake: X.X% · pot: Y.Y SOL" on show.
    const wpRake = mkLabel(sb, 'WaitingRakeLabel', wpN, '', 13, 220, 600, 22, 160, 170, 190);
    const wpProgress = mkLabel(sb, 'WaitingProgressLabel', wpN, '0/2 players · 0:00 / 2:00', 18, 180, 600, 28, 180, 190, 210);
    const wpSpinner = mkLabel(sb, 'WaitingSpinnerLabel', wpN, '·  ·  ·', 28, 80, 300, 40, 48, 198, 155);
    const wpCancelBtn = mkBtn(sb, 'WaitingCancelButton', wpN, 'Cancel', -100, 380, 56, 55, 75, 95);
    const wpBotBtn = mkBtn(sb, 'WaitingPlayBotButton', wpN, '▶ Play vs Bot', -180, 380, 56, 48, 198, 155);
    sb.e[wpBotBtn]._active = false; // revealed after timeout or immediately on paper
    // Part 9: Force-settle button — only revealed after the match has been
    // Active for 5+ minutes with fewer than required_players submissions.
    // Any signer can call force_settle on-chain; AFK players forfeit to 0.
    // UX Phase 2b: IconBadge bolt attached by AppUI. Phase 2c: bold.
    const wpForceBtn = mkBtn(sb, 'WaitingForceSettleButton', wpN, 'Force Settle (AFK)', -260, 420, 56, 202, 140, 60);
    style(sb, wpForceBtn, { bold: true });
    sb.e[wpForceBtn]._active = false;
    // Part 11 D3: streak bonus banner. Hidden unless stats.current_streak ≥ 3.
    // Display-only (no payout multiplier yet — that's Part 12).
    // UX Phase 2b: IconBadge flame attached by AppUI.
    const wpStreakBanner = mkLabel(sb, 'WaitingStreakBanner', wpN, 'Day 3 streak — keep the fire going', 16, 480, 620, 36, 218, 165, 32);
    sb.e[wpStreakBanner]._active = false;
    const wpStatus = mkLabel(sb, 'WaitingStatusLabel', wpN, '', 12, -600, 640, 20, 140, 150, 170);

    sb.e[wpN]._children = [rf(wpTitle), rf(wpMode), rf(wpRake), rf(wpProgress), rf(wpSpinner), rf(wpStreakBanner), rf(wpCancelBtn), rf(wpBotBtn), rf(wpForceBtn), rf(wpStatus)];
    sb.e[wpN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session D Part 3 — POST-MATCH PANEL
    // Shown after settle (paper or real). Title + 4 stat cards + Back.
    // ═══════════════════════════════════════════════════════════════
    const pmN = sb.e.length;
    sb.node('PostMatchPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(pmN, 720, 1280);
    sb.spr(pmN, 10, 14, 22);

    // betting-duel polish: Y range spread from [-620, +600] → [-740, +720].
    const pmBackBtn = mkBtn(sb, 'PostMatchBackButton', pmN, '← Back', 700, 160, 44, 55, 65, 85);
    sb.e[pmBackBtn]._lpos = v3(-260, 700, 0);
    const pmTitle = mkLabel(sb, 'PostMatchTitleLabel', pmN, 'Match Result', 34, 620, 620, 52, 255, 255, 255);
    style(sb, pmTitle, { bold: true, color: GOLD() });
    const pmTrack = mkLabel(sb, 'PostMatchTrackLabel', pmN, 'Paper · 1v1', 14, 560, 600, 22, 140, 150, 170);
    // Payout — moved up so trophy no longer sits on top of it.
    const pmPayout = mkLabel(sb, 'PostMatchPayoutLabel', pmN, '', 44, 470, 620, 64, 48, 198, 155);
    const pmSubtitle = mkLabel(sb, 'PostMatchSubtitleLabel', pmN, '', 14, 400, 600, 22, 180, 190, 210);
    const pmRake = mkLabel(sb, 'PostMatchRakeLabel', pmN, '', 12, 376, 600, 20, 150, 160, 180);
    // Stage 5N — mono payout + rake for aligned digits through the ticker roll.
    style(sb, pmPayout, { mono: true });
    style(sb, pmRake, { mono: true });

    // 4 stat cards 2×2: YOUR · OPP · XP · LEVEL — shifted down to give trophy
    // its own slot above (y=-80) and CTA buttons more room below.
    const pmCardDefs = [
        { key: 'you', label: 'YOUR DELTA', x: -160, y: 220 },
        { key: 'opp', label: 'BEST OPP',   x:  160, y: 220 },
        { key: 'xp',  label: 'XP EARNED',  x: -160, y: 100 },
        { key: 'lvl', label: 'LEVEL',      x:  160, y: 100 },
    ];
    const pmCardIndices = [];
    for (const d of pmCardDefs) {
        const cardN = sb.e.length;
        sb.node(`PMCard_${d.key}`, pmN, [], [], v3(d.x, d.y, 0));
        const cardUT = sb.ut(cardN, 300, 92);
        const cardSpr = sb.spr(cardN, 18, 22, 32);
        const lblN = sb.e.length;
        sb.node('Label', cardN, [], [], v3(0, 24, 0));
        const lblUT = sb.ut(lblN, 280, 22);
        const lblL = sb.lbl(lblN, d.label, 11, 100, 110, 130);
        sb.e[lblL]._spacingX = 1;
        sb.e[lblN]._components = [rf(lblUT), rf(lblL)];
        const valN = sb.e.length;
        sb.node('Value', cardN, [], [], v3(0, -18, 0));
        const valUT = sb.ut(valN, 280, 36);
        const valL = sb.lbl(valN, '—', 26, 255, 255, 255);
        sb.e[valL]._isBold = true;
        // Stage 5N — mono PMCard values so numbers stay column-aligned.
        style(sb, valN, { mono: true });
        sb.e[valN]._components = [rf(valUT), rf(valL)];
        sb.e[cardN]._components = [rf(cardUT), rf(cardSpr)];
        sb.e[cardN]._children = [rf(lblN), rf(valN)];
        pmCardIndices.push(cardN);
    }

    // CTAs at y=-260 (was -180). Dropped with the stat grid spread.
    const pmSameSquadBtn = mkBtnXY(sb, 'PostMatchSameSquadButton', pmN, '▶ Same Squad', -170, -260, 320, 60, 48, 198, 155);
    style(sb, pmSameSquadBtn, { bold: true });
    const pmAgainBtn = mkBtnXY(sb, 'PostMatchAgainButton', pmN, 'Pick New Squad', 170, -260, 320, 60, 56, 148, 252);
    style(sb, pmAgainBtn, { bold: true });

    // Share-to-X button — top-left, away from the Payout/Trophy cluster.
    const pmShareBtn = mkBtn(sb, 'PostMatchShareButton', pmN, 'Share · 𝕏', -350, 520, 56, 29, 161, 242);
    sb.e[pmShareBtn]._lpos = v3(-260, 520, 0);

    const pmStatus = mkLabel(sb, 'PostMatchStatusLabel', pmN, '', 12, -740, 640, 20, 140, 150, 170);

    // Trophy — moved to y=-80 (between stat cards at y=100 and CTAs at y=-260)
    // so it no longer overlaps the Payout label at y=470.
    // UX Phase 2b: empty label; AppUI attaches procedural trophy/medal via rankIcon at show time.
    const pmTrophy = mkLabel(sb, 'TrophyLabel', pmN, '', 72, -80, 200, 100, 255, 255, 255);
    sb.e[pmTrophy]._active = false;

    // Session D Part 8: confetti particles around the trophy on 1st-place.
    // UX Phase 2b: 12 empty Node shells (no Label); AppUI attaches IconLibrary shapes
    // per-slot (sparkle/star/starBurst/circle/triangle) with palette-accent tints.
    const pmConfettiIndices = [];
    for (let c = 0; c < 12; c++) {
        const confN = sb.e.length;
        sb.node(`Confetti_${c}`, pmTrophy, [], [], v3(0, 0, 0));
        const confUT = sb.ut(confN, 60, 60);
        sb.e[confN]._components = [rf(confUT)];
        sb.e[confN]._active = false;
        pmConfettiIndices.push(confN);
    }
    // Confetti children hang off TrophyLabel so they share its transform origin.
    sb.e[pmTrophy]._children = pmConfettiIndices.map(rf);

    // UX Phase 2b: PostMatchMascotContainer — second MascotController lives here so
    // the celebrate/lose animation fires on the panel the user is looking at.
    const pmMascotN = sb.e.length;
    sb.node('PostMatchMascotContainer', pmN, [], [], v3(250, 180, 0));
    const pmMascotUT = sb.ut(pmMascotN, 140, 180);
    sb.e[pmMascotN]._components = [rf(pmMascotUT)];

    sb.e[pmN]._children = [rf(pmBackBtn), rf(pmTitle), rf(pmTrack), rf(pmPayout), rf(pmSubtitle), rf(pmRake), rf(pmTrophy), ...pmCardIndices.map(rf), rf(pmSameSquadBtn), rf(pmAgainBtn), rf(pmShareBtn), rf(pmStatus), rf(pmMascotN)];
    sb.e[pmN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Session D Part 8 — SETTINGS PANEL
    // Accessible from HomePanel (⚙) and TokenDuelPanel (⚙) top-right.
    // Sections: WALLET info · PROFILE (local username) · ACTIONS (reconnect/disconnect/delete)
    // ═══════════════════════════════════════════════════════════════
    const stN = sb.e.length;
    sb.node('SettingsPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(stN, 720, 1280);
    sb.spr(stN, 10, 14, 22);

    const stBackLink = mkLabel(sb, 'BackLinkLabel', stN, '← Back', 18, 618, 110, 28, 160, 170, 190);
    sb.e[stBackLink]._lpos = v3(-280, 618, 0);
    sb.e[sb.e[stBackLink]._components[1].__id__]._horizontalAlign = 0;
    const stBackBtn = sb.e.length;
    sb.node('BackButton', stN, [], [], v3(-280, 618, 0));
    const stBackBtnUT = sb.ut(stBackBtn, 140, 36);
    const stBackBtnBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(stBackBtn), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1.02, _target: rf(stBackBtn), _id: gid(),
    });
    sb.e[stBackBtn]._components = [rf(stBackBtnUT), rf(stBackBtnBtn)];
    // UX Phase 2b: IconBadge cog attached by AppUI. Phase 2c: bold.
    const stTitle = mkLabel(sb, 'SettingsTitleLabel', stN, 'Settings', 28, 600, 400, 40, 218, 165, 32);
    style(sb, stTitle, { bold: true });

    // WALLET section card (y=440, 660×130).
    const stWalletCard = sb.e.length;
    sb.node('WalletCard', stN, [], [], v3(0, 440, 0));
    const stWalletCardUT = sb.ut(stWalletCard, 660, 130);
    const stWalletCardSpr = sb.spr(stWalletCard, 22, 28, 42);
    const stWalletHeader = mkLabel(sb, 'HeaderLabel', stWalletCard, 'WALLET', 11, 44, 200, 16, 140, 150, 170);
    sb.e[stWalletHeader]._lpos = v3(-290, 44, 0);
    sb.e[sb.e[stWalletHeader]._components[1].__id__]._horizontalAlign = 0;
    const stWalletName = mkLabel(sb, 'WalletNameLabel', stWalletCard, 'Not connected', 18, 14, 600, 28, 220, 230, 240);
    const stWalletPubkey = mkLabel(sb, 'WalletPubkeyLabel', stWalletCard, '—', 13, -20, 600, 22, 160, 170, 190);
    const stWalletBal = mkLabel(sb, 'WalletBalanceLabel', stWalletCard, '', 12, -44, 600, 18, 140, 220, 180);
    sb.e[stWalletCard]._components = [rf(stWalletCardUT), rf(stWalletCardSpr)];
    sb.e[stWalletCard]._children = [rf(stWalletHeader), rf(stWalletName), rf(stWalletPubkey), rf(stWalletBal)];

    // PROFILE section card (y=280, 660×150, username EditBox).
    const stProfileCard = sb.e.length;
    sb.node('ProfileCard', stN, [], [], v3(0, 280, 0));
    const stProfileCardUT = sb.ut(stProfileCard, 660, 150);
    const stProfileCardSpr = sb.spr(stProfileCard, 22, 28, 42);
    const stProfileHeader = mkLabel(sb, 'HeaderLabel', stProfileCard, 'PROFILE', 11, 54, 200, 16, 140, 150, 170);
    sb.e[stProfileHeader]._lpos = v3(-290, 54, 0);
    sb.e[sb.e[stProfileHeader]._components[1].__id__]._horizontalAlign = 0;
    const stUsername = mkEditBox(sb, 'UsernameEditBox', stProfileCard, 'Username (stored locally)', 0, 16, 600, 44, 17);
    const stUsernameSaved = mkLabel(sb, 'UsernameSaveLabel', stProfileCard, '', 12, -26, 600, 18, 48, 198, 155);
    const stUsernameHelp = mkLabel(sb, 'UsernameHelpLabel', stProfileCard, 'Displayed on your PostMatch + Portfolio screens.', 11, -50, 600, 16, 130, 140, 160);
    sb.e[stProfileCard]._components = [rf(stProfileCardUT), rf(stProfileCardSpr)];
    sb.e[stProfileCard]._children = [rf(stProfileHeader), rf(stUsername), rf(stUsernameSaved), rf(stUsernameHelp)];

    // Part 10 pt2: QUICK PLAY DEFAULTS card (y=80, 660×200).
    // 4 radio rows (mode / window / wager / track). Active tint (48,198,155),
    // inactive (28,34,48) — mirrors _refreshModePickerUi.
    const stQpCardN = sb.e.length;
    sb.node('QuickPlayDefaultsCard', stN, [], [], v3(0, 80, 0));
    const stQpUT = sb.ut(stQpCardN, 660, 200);
    const stQpSpr = sb.spr(stQpCardN, 22, 28, 42);
    const stQpHeader = mkLabel(sb, 'HeaderLabel', stQpCardN, 'QUICK PLAY DEFAULTS', 11, 82, 400, 16, 140, 150, 170);
    sb.e[stQpHeader]._lpos = v3(-290, 82, 0);
    sb.e[sb.e[stQpHeader]._components[1].__id__]._horizontalAlign = 0;
    // Mode row (y=+50): 4 buttons 140×34.
    const qpModeKeys = [['1v1','1v1'],['4p','4p'],['8p','8p'],['br10','BR10']];
    const qpModeXs = [-240, -80, 80, 240];
    const qpModeBtns = [];
    for (let i = 0; i < 4; i++) {
        const [key, lbl] = qpModeKeys[i];
        const active = key === '1v1';
        const bg = active ? [48, 198, 155] : [28, 34, 48];
        qpModeBtns.push(mkBtnXY(sb, `QPMode_${key}`, stQpCardN, lbl, qpModeXs[i], 50, 140, 34, bg[0], bg[1], bg[2]));
    }
    // Window row (y=+14): 4 buttons 140×32.
    const qpWindowKeys = [['1h','1h'],['1d','1d'],['3d','3d'],['7d','7d']];
    const qpWindowBtns = [];
    for (let i = 0; i < 4; i++) {
        const [key, lbl] = qpWindowKeys[i];
        const active = key === '1d';
        const bg = active ? [48, 198, 155] : [28, 34, 48];
        qpWindowBtns.push(mkBtnXY(sb, `QPWindow_${key}`, stQpCardN, lbl, qpModeXs[i], 14, 140, 32, bg[0], bg[1], bg[2]));
    }
    // Wager row (y=-22): 5 chips 112×32 at x=-240/-120/0/120/240.
    const qpWagerDefs = [['001','0.01'],['005','0.05'],['01','0.1'],['025','0.25'],['05','0.5']];
    const qpWagerXs = [-240, -120, 0, 120, 240];
    const qpWagerBtns = [];
    for (let i = 0; i < 5; i++) {
        const [key, lbl] = qpWagerDefs[i];
        const active = key === '01';
        const bg = active ? [48, 198, 155] : [28, 34, 48];
        qpWagerBtns.push(mkBtnXY(sb, `QPWager_${key}`, stQpCardN, lbl, qpWagerXs[i], -22, 112, 32, bg[0], bg[1], bg[2]));
    }
    // Track row (y=-62): 2 buttons 150×34.
    const qpTrackPaper = mkBtnXY(sb, 'QPTrack_paper', stQpCardN, 'Paper', -80, -62, 150, 34, 48, 198, 155);
    const qpTrackReal  = mkBtnXY(sb, 'QPTrack_real',  stQpCardN, 'Real',   80, -62, 150, 34, 28, 34, 48);
    sb.e[stQpCardN]._components = [rf(stQpUT), rf(stQpSpr)];
    sb.e[stQpCardN]._children = [
        rf(stQpHeader),
        ...qpModeBtns.map(rf),
        ...qpWindowBtns.map(rf),
        ...qpWagerBtns.map(rf),
        rf(qpTrackPaper), rf(qpTrackReal),
    ];

    // Part 11 C: AudioSettingsCard at y=-80, 660×70. Two toggle buttons.
    // Labels flip between "ON"/"OFF" at runtime via _refreshAudioCard().
    const stAudioCardN = sb.e.length;
    sb.node('AudioSettingsCard', stN, [], [], v3(0, -80, 0));
    const stAudioUT = sb.ut(stAudioCardN, 660, 70);
    const stAudioSpr = sb.spr(stAudioCardN, 22, 28, 42);
    const stAudioHeader = mkLabel(sb, 'HeaderLabel', stAudioCardN, 'AUDIO + HAPTICS', 11, 20, 400, 16, 140, 150, 170);
    sb.e[stAudioHeader]._lpos = v3(-290, 20, 0);
    sb.e[sb.e[stAudioHeader]._components[1].__id__]._horizontalAlign = 0;
    // UX Phase 2b: state-driven IconBadges (speaker/speakerMuted, vibration/hand) attached by AppUI.
    const stSoundToggle   = mkBtnXY(sb, 'SoundToggleButton',   stAudioCardN, 'Sound: ON',   -150, -10, 260, 38, 48, 198, 155);
    const stHapticsToggle = mkBtnXY(sb, 'HapticsToggleButton', stAudioCardN, 'Haptics: ON',  150, -10, 260, 38, 48, 198, 155);
    sb.e[stAudioCardN]._components = [rf(stAudioUT), rf(stAudioSpr)];
    sb.e[stAudioCardN]._children = [rf(stAudioHeader), rf(stSoundToggle), rf(stHapticsToggle)];

    // Part 13 D: public fee-schedule link. Opens `/fees` page on backend
    // in external browser so judges can see the level-tiered rake breakdown.
    // UX Phase 2b: IconBadge chart attached by AppUI.
    const stFeesBtn = mkBtn(sb, 'FeesLinkButton', stN, 'Fee schedule', -360, 560, 52, 48, 108, 180);

    // ACTIONS section — shifted further down to make room for the QP card
    // above + FeesLinkButton. (Pre-pt2: y=120 / y=40 / y=-40.)
    const stReconnectBtn = mkBtn(sb, 'ReconnectSettingsButton', stN, 'Reconnect', -440, 660, 48, 48, 108, 180);
    const stDisconnectBtn = mkBtn(sb, 'DisconnectSettingsButton', stN, 'Disconnect', -500, 660, 48, 62, 72, 92);
    const stDeleteBtn = mkBtn(sb, 'DeleteAccountSettingsButton', stN, 'Delete Account', -560, 660, 48, 180, 60, 60);

    const stStatus = mkLabel(sb, 'SettingsStatusLabel', stN, '', 12, -610, 640, 20, 140, 150, 170);

    sb.e[stN]._children = [
        rf(stBackLink), rf(stBackBtn), rf(stTitle),
        rf(stWalletCard), rf(stProfileCard),
        rf(stQpCardN),
        rf(stAudioCardN),
        rf(stFeesBtn),
        rf(stReconnectBtn), rf(stDisconnectBtn), rf(stDeleteBtn),
        rf(stStatus),
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
    const tutBubbleDefs = [
        { name: 'TutorialBubble_0', y: 400, text: 'Pick 3 tokens you think will pump\nthe most over the match window.' },
        { name: 'TutorialBubble_1', y: 160, text: 'Stake some SOL. Matchups pit your\nsquad\'s % change vs your opponent\'s.' },
        { name: 'TutorialBubble_2', y: -80, text: 'Watch your portfolio tick live.\nBiggest % gain (or smallest loss) wins.' },
        { name: 'TutorialBubble_3', y: -320, text: 'First match is on the house —\ntap a token, pick a squad, Run Squad.' },
    ];
    const tutBubbleIndices = [];
    for (const d of tutBubbleDefs) {
        const bN = sb.e.length;
        sb.node(d.name, tutN, [], [], v3(0, d.y, 0));
        const bUT = sb.ut(bN, 440, 140);
        const bSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(bN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(28, 34, 48, 240),
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        const bL = mkLabel(sb, 'Text', bN, d.text, 16, 0, 420, 120, 255, 255, 255);
        sb.e[bN]._components = [rf(bUT), rf(bSpr)];
        sb.e[bN]._children = [rf(bL)];
        sb.e[bN]._active = false;
        tutBubbleIndices.push(bN);
    }
    const tutIndex = mkLabel(sb, 'TutorialBubbleIndex', tutN, '1 / 4', 14, -440, 200, 20, 140, 150, 170);
    const tutHint = mkLabel(sb, 'TutorialHintLabel', tutN, 'Tap anywhere to continue', 12, -490, 300, 18, 180, 190, 210);
    sb.e[tutN]._components = [rf(tutUT), rf(tutSpr), rf(tutBtn)];
    sb.e[tutN]._children = [...tutBubbleIndices.map(rf), rf(tutIndex), rf(tutHint)];
    sb.e[tutN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 12 Bundle D — SPECTATOR PANEL
    // Read-only live view of an in-progress (or Waiting) match. Accessed by
    // tapping a HomeMatchTicker entry. Shows per-player heights + live drop
    // event feed + optional "Join this match" button when Waiting.
    // ═══════════════════════════════════════════════════════════════
    const specN = sb.e.length;
    sb.node('SpectatorPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(specN, 720, 1280);
    sb.spr(specN, 10, 14, 22);

    const specBackBtn = mkBtn(sb, 'SpectatorBackButton', specN, '← Back', 600, 160, 44, 55, 65, 85);
    sb.e[specBackBtn]._lpos = v3(-260, 600, 0);
    // UX Phase 2b: IconBadge eye attached by AppUI. Phase 2c: bold.
    const specTitle = mkLabel(sb, 'SpectatorTitleLabel', specN, 'Spectating', 28, 600, 460, 40, 255, 255, 255);
    style(sb, specTitle, { bold: true });
    const specMatchLabel = mkLabel(sb, 'SpectatorMatchLabel', specN, 'match —', 13, 558, 500, 20, 140, 150, 170);
    const specStatusLabel = mkLabel(sb, 'SpectatorStatusLabel', specN, 'Connecting…', 14, 520, 500, 22, 140, 220, 180);

    // Player list: 10 pooled rows (one per potential player — matches MATCH_MAX_PLAYERS).
    const specPlayerListN = sb.e.length;
    sb.node('SpectatorPlayerList', specN, [], [], v3(0, 240, 0));
    sb.ut(specPlayerListN, 620, 380);
    const specPlayerRowIdx = [];
    for (let i = 0; i < 10; i++) {
        const rN = sb.e.length;
        const ry = 170 - i * 38;
        sb.node(`SpectatorPlayerRow_${i}`, specPlayerListN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, 600, 34);
        const rSpr = sb.spr(rN, 22, 28, 42);
        const pkLbl = mkLabel(sb, 'Pubkey', rN, '—', 14, 0, 280, 22, 220, 230, 240);
        sb.e[pkLbl]._lpos = v3(-240, 0, 0);
        const hLbl = mkLabel(sb, 'Height', rN, 'H:—', 14, 0, 200, 22, 48, 198, 155);
        sb.e[hLbl]._lpos = v3(220, 0, 0);
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(pkLbl), rf(hLbl)];
        sb.e[rN]._active = false;
        specPlayerRowIdx.push(rN);
    }
    sb.e[specPlayerListN]._children = specPlayerRowIdx.map(rf);

    // Event feed: 10 rows, most-recent-on-top.
    const specEventListN = sb.e.length;
    sb.node('SpectatorEventList', specN, [], [], v3(0, -170, 0));
    sb.ut(specEventListN, 620, 260);
    const specEventHeaderL = mkLabel(sb, 'HeaderLabel', specEventListN, 'LIVE EVENTS', 11, 110, 300, 18, 140, 150, 170);
    sb.e[specEventHeaderL]._lpos = v3(-270, 110, 0);
    sb.e[sb.e[specEventHeaderL]._components[1].__id__]._horizontalAlign = 0;
    const specEventRowIdx = [];
    for (let i = 0; i < 10; i++) {
        const rN = sb.e.length;
        const ry = 80 - i * 20;
        sb.node(`SpectatorEventRow_${i}`, specEventListN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, 600, 18);
        const rL = mkLabel(sb, 'Text', rN, '—', 13, 0, 600, 18, 180, 190, 210);
        sb.e[rN]._components = [rf(rUT)];
        sb.e[rN]._children = [rf(rL)];
        sb.e[rN]._active = false;
        specEventRowIdx.push(rN);
    }
    sb.e[specEventListN]._children = [rf(specEventHeaderL), ...specEventRowIdx.map(rf)];

    // Join button — shown by AppUI only when match.status == Waiting + free slot.
    const specJoinBtn = mkBtn(sb, 'SpectatorJoinButton', specN, '▶ Join this match', -440, 620, 56, 48, 198, 155);
    style(sb, specJoinBtn, { bold: true });
    sb.e[specJoinBtn]._active = false;

    sb.e[specN]._children = [
        rf(specBackBtn), rf(specTitle), rf(specMatchLabel), rf(specStatusLabel),
        rf(specPlayerListN), rf(specEventListN), rf(specJoinBtn),
    ];
    sb.e[specN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Part 14 — TOURNAMENT PANEL
    // 10-slot roster with live heights + medals (🥇🥈🥉) on settle.
    // Entered via HomeTournamentBadge tap. Reuses SpectatorRpc for live
    // subscribe (poll every 3s + backend WS).
    // ═══════════════════════════════════════════════════════════════
    const tourN = sb.e.length;
    sb.node('TournamentPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(tourN, 720, 1280);
    sb.spr(tourN, 18, 12, 26); // slight purple tint vs spectator's slate

    const tourBackBtn = mkBtn(sb, 'TournamentBackButton', tourN, '← Back', 600, 160, 44, 55, 65, 85);
    sb.e[tourBackBtn]._lpos = v3(-260, 600, 0);
    // UX Phase 2b: IconBadge sword attached by AppUI. Phase 2c: bold.
    const tourTitle = mkLabel(sb, 'TournamentTitleLabel', tourN, 'Tournament', 28, 600, 460, 40, 230, 210, 255);
    style(sb, tourTitle, { bold: true });
    const tourMatchLabel = mkLabel(sb, 'TournamentMatchLabel', tourN, 'match —', 13, 558, 500, 20, 160, 150, 200);
    const tourStatusLabel = mkLabel(sb, 'TournamentStatusLabel', tourN, 'Connecting…', 14, 520, 500, 22, 220, 200, 240);
    const tourPrizeLabel = mkLabel(sb, 'TournamentPrizePoolLabel', tourN, 'Prize pool: — · top-3 payout', 14, 485, 600, 22, 140, 220, 180);

    // 10-slot roster. Each slot has Pubkey (left), Height (right), Medal (far right).
    const tourRosterN = sb.e.length;
    sb.node('TournamentRoster', tourN, [], [], v3(0, 150, 0));
    sb.ut(tourRosterN, 640, 440);
    const tourSlotIdx = [];
    for (let i = 0; i < 10; i++) {
        const rN = sb.e.length;
        const ry = 200 - i * 42;
        sb.node(`TournamentSlot_${i}`, tourRosterN, [], [], v3(0, ry, 0));
        const rUT = sb.ut(rN, 620, 36);
        const rSpr = sb.spr(rN, 28, 22, 44);
        const pkLbl = mkLabel(sb, 'Pubkey', rN, '—', 14, 0, 300, 22, 220, 220, 240);
        sb.e[pkLbl]._lpos = v3(-240, 0, 0);
        const hLbl = mkLabel(sb, 'Height', rN, 'H:—', 14, 0, 180, 22, 140, 220, 180);
        sb.e[hLbl]._lpos = v3(180, 0, 0);
        const medalLbl = mkLabel(sb, 'Medal', rN, '', 20, 0, 80, 28, 255, 220, 120);
        sb.e[medalLbl]._lpos = v3(280, 0, 0);
        sb.e[rN]._components = [rf(rUT), rf(rSpr)];
        sb.e[rN]._children = [rf(pkLbl), rf(hLbl), rf(medalLbl)];
        sb.e[rN]._active = false;
        tourSlotIdx.push(rN);
    }
    sb.e[tourRosterN]._children = tourSlotIdx.map(rf);

    // Join button — shown only when status=Waiting AND a slot is free AND player not already in.
    // UX Phase 2b: IconBadge sword attached by AppUI. Phase 2c: bold.
    const tourJoinBtn = mkBtn(sb, 'TournamentJoinButton', tourN, 'Join tournament', -460, 620, 58, 140, 80, 200);
    style(sb, tourJoinBtn, { bold: true });
    sb.e[tourJoinBtn]._active = false;

    sb.e[tourN]._children = [
        rf(tourBackBtn), rf(tourTitle), rf(tourMatchLabel), rf(tourStatusLabel), rf(tourPrizeLabel),
        rf(tourRosterN), rf(tourJoinBtn),
    ];
    sb.e[tourN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase A — FIND MATCH PANEL (top-level lobby browser)
    // Filters: mode (5 chips) / window (5 chips) / wager bucket (5 chips)
    //          + HideFull toggle. Up to 8 visible match rows + empty state.
    //          Host New Match CTA at bottom opens ModePickerOverlay in
    //          host mode (forceCreate=true).
    // ═══════════════════════════════════════════════════════════════
    const fmN = sb.e.length;
    sb.node('FindMatchPanel', canvas, [], [], v3(0, 0, 0));
    sb.ut(fmN, 720, 1280);
    sb.spr(fmN, 10, 14, 22);

    // Header: back, title, refresh.
    const fmBackBtn = mkBtn(sb, 'FindMatchBackButton', fmN, '← Back', 700, 160, 44, 55, 65, 85);
    sb.e[fmBackBtn]._lpos = v3(-260, 700, 0);
    const fmTitle = mkLabel(sb, 'FindMatchTitleLabel', fmN, 'Find a Match', 30, 700, 460, 42, 218, 165, 32);
    style(sb, fmTitle, { bold: true });
    const fmRefreshBtn = mkBtnXY(sb, 'FindMatchRefreshButton', fmN, '↻', 280, 700, 56, 56, 38, 44, 64);
    const fmCountLabel = mkLabel(sb, 'FindMatchCountLabel', fmN, '— open lobbies', 12, 660, 600, 18, 140, 150, 170);

    // Phase H2 — Mode tab row (Open Lobbies / Live Now). Bumps the filters
    // down by 50px to fit at y=640. Selected tab tinted teal by AppUI.
    const fmTabOpen = mkBtnXY(sb, 'FindMatchTabOpen', fmN, 'Open Lobbies', -100, 640, 200, 38, 48, 198, 155);
    const fmTabLive = mkBtnXY(sb, 'FindMatchTabLive', fmN, 'Live Now',      100, 640, 200, 38, 28, 34, 48);

    // Filter rows.
    // Row 1 — Mode chips at y=600. 5 chips at ~125px each (5*125 + 4*8 = 657 < 720).
    const fmModeKeys = ['all', 'oneVone', '4p', '8p', 'br10'];
    const fmModeLabels = ['All', '1v1', '4p', '8p', 'BR'];
    const fmModeIndices = [];
    {
        const w = 125, gap = 8;
        const startX = -((fmModeKeys.length - 1) * (w + gap)) / 2;
        for (let i = 0; i < fmModeKeys.length; i++) {
            const x = startX + i * (w + gap);
            const bN = mkBtnXY(sb, `FilterMode_${fmModeKeys[i]}`, fmN, fmModeLabels[i], x, 600, w, 38, 28, 34, 48);
            fmModeIndices.push(bN);
        }
    }
    // Row 2 — Window chips at y=550. Same layout.
    const fmWindowKeys = ['all', '1h', '1d', '3d', '7d'];
    const fmWindowLabels = ['All', '30s', '1m', '5m', '1h'];
    const fmWindowIndices = [];
    {
        const w = 125, gap = 8;
        const startX = -((fmWindowKeys.length - 1) * (w + gap)) / 2;
        for (let i = 0; i < fmWindowKeys.length; i++) {
            const x = startX + i * (w + gap);
            const bN = mkBtnXY(sb, `FilterWindow_${fmWindowKeys[i]}`, fmN, fmWindowLabels[i], x, 550, w, 38, 28, 34, 48);
            fmWindowIndices.push(bN);
        }
    }
    // Row 3 — Wager bucket chips at y=500. Bucketed for less visual noise:
    //   All / Low (0.001 + 0.01) / Mid (0.05 + 0.1) / High (0.25 + 0.5) / Whale (1 + 5)
    const fmWagerKeys = ['all', 'low', 'mid', 'high', 'whale'];
    const fmWagerLabels = ['All', 'Low', 'Mid', 'High', 'Whale'];
    const fmWagerIndices = [];
    {
        const w = 125, gap = 8;
        const startX = -((fmWagerKeys.length - 1) * (w + gap)) / 2;
        for (let i = 0; i < fmWagerKeys.length; i++) {
            const x = startX + i * (w + gap);
            const bN = mkBtnXY(sb, `FilterWager_${fmWagerKeys[i]}`, fmN, fmWagerLabels[i], x, 500, w, 38, 28, 34, 48);
            fmWagerIndices.push(bN);
        }
    }
    // Hide-full toggle (small chip, right side at y=450).
    const fmHideFullBtn = mkBtnXY(sb, 'FilterHideFullToggle', fmN, 'Hide full ✓', 0, 450, 220, 36, 48, 198, 155);

    // 8 reusable MatchCardRow_0..7 templates. Each row 660×80, rendered y=380..-280 (8 * 88 stride).
    const fmRowIndices = [];
    {
        const rowW = 660, rowH = 80;
        const stride = 88;
        const topY = 380;
        for (let i = 0; i < 8; i++) {
            const rN = sb.e.length;
            const ry = topY - i * stride;
            sb.node(`MatchCardRow_${i}`, fmN, [], [], v3(0, ry, 0));
            const rUT = sb.ut(rN, rowW, rowH);
            const rSpr = sb.spr(rN, 22, 28, 42);
            const rBtn = sb.add({
                __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(rN), _enabled: true, __prefab: null,
                _interactable: true, _transition: 0,
                _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
                _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
                _duration: 0.1, _zoomScale: 1.02, _target: rf(rN), _id: gid(),
            });
            // Mode (left).
            const modeL = mkLabel(sb, `MatchCardModeLabel_${i}`, rN, '1v1', 18, 0, 120, 24, 220, 230, 240);
            sb.e[modeL]._lpos = v3(-280, 18, 0);
            sb.e[sb.e[modeL]._components[1].__id__]._horizontalAlign = 0;
            // Wager (left-mid).
            const wagerL = mkLabel(sb, `MatchCardWagerLabel_${i}`, rN, '0.05 SOL', 16, 0, 160, 22, 218, 165, 32);
            sb.e[wagerL]._lpos = v3(-160, 18, 0);
            sb.e[sb.e[wagerL]._components[1].__id__]._horizontalAlign = 0;
            // Window (right-mid).
            const winL = mkLabel(sb, `MatchCardWindowLabel_${i}`, rN, '30s race', 14, 0, 160, 20, 140, 220, 180);
            sb.e[winL]._lpos = v3(40, 18, 0);
            sb.e[sb.e[winL]._components[1].__id__]._horizontalAlign = 0;
            // Players + age (subtitle line).
            const subL = mkLabel(sb, `MatchCardSubLabel_${i}`, rN, '1/2 players · 0:42 ago', 13, 0, 540, 18, 160, 170, 190);
            sb.e[subL]._lpos = v3(-280, -16, 0);
            sb.e[sb.e[subL]._components[1].__id__]._horizontalAlign = 0;
            // Join button (far right).
            const joinL = mkBtnXY(sb, `MatchCardJoinButton_${i}`, rN, 'Join', 250, 0, 130, 50, 56, 148, 252);
            sb.e[rN]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
            sb.e[rN]._children = [rf(modeL), rf(wagerL), rf(winL), rf(subL), rf(joinL)];
            sb.e[rN]._active = false; // AppUI activates filled rows
            fmRowIndices.push(rN);
        }
    }

    // Empty state — shown when no rows pass the filter.
    const fmEmptyL = mkLabel(sb, 'FindMatchEmptyLabel', fmN, 'No open lobbies match these filters — host one or play a bot.', 14, -340, 660, 22, 140, 150, 170);
    sb.e[fmEmptyL]._active = false;

    // Host CTA at bottom.
    const fmHostBtn = mkBtn(sb, 'FindMatchHostButton', fmN, 'Host New Match', -440, 540, 64, VAR('warn').r, VAR('warn').g, VAR('warn').b);
    style(sb, fmHostBtn, { bold: true });
    const fmStatus = mkLabel(sb, 'FindMatchStatusLabel', fmN, '', 12, -700, 660, 20, 140, 150, 170);

    sb.e[fmN]._children = [
        rf(fmBackBtn), rf(fmTitle), rf(fmRefreshBtn), rf(fmCountLabel),
        rf(fmTabOpen), rf(fmTabLive),
        ...fmModeIndices.map(rf),
        ...fmWindowIndices.map(rf),
        ...fmWagerIndices.map(rf),
        rf(fmHideFullBtn),
        ...fmRowIndices.map(rf),
        rf(fmEmptyL), rf(fmHostBtn), rf(fmStatus),
    ];
    sb.e[fmN]._active = false;

    // AppUI component on Canvas
    const appUI = sb.custom(canvas, UUIDS.AppUI);

    // Patch Canvas children
    // ═══════════════════════════════════════════════════════════════
    // betting-duel Block 3 — CountdownOverlay (3 · 2 · 1 · GO!)
    // Shown briefly between ModePicker-Start and RacePanel activation to
    // build tension. AppUI drives the animation with a tween chain.
    // ═══════════════════════════════════════════════════════════════
    const countdownN = sb.e.length;
    sb.node('CountdownOverlay', canvas, [], [countdownN+1, countdownN+2], v3(0, 0, 0));
    sb.ut(countdownN, 720, 1280);
    sb.spr(countdownN, 8, 12, 20);
    sb.e[countdownN]._active = false;
    const countdownBigN = mkLabel(sb, 'CountdownBigLabel', countdownN, '3', 160, 40, 400, 240, 218, 165, 32);
    const countdownSquadN = mkLabel(sb, 'CountdownSquadPreviewLabel', countdownN, 'Your squad', 24, -140, 620, 36, 180, 190, 210);
    const countdownHintN = mkLabel(sb, 'CountdownHintLabel', countdownN, 'Match starting…', 18, -210, 600, 24, 140, 150, 170);
    sb.e[countdownN]._children = [rf(countdownBigN), rf(countdownSquadN), rf(countdownHintN)];

    // ═══════════════════════════════════════════════════════════════
    // betting-duel Block 8 — SigningOverlay (wallet wait spinner)
    // ═══════════════════════════════════════════════════════════════
    const signingN = sb.e.length;
    sb.node('SigningOverlay', canvas, [], [signingN+1, signingN+2], v3(0, 0, 0));
    sb.ut(signingN, 720, 1280);
    sb.spr(signingN, 4, 6, 12);
    sb.e[signingN]._active = false;
    const signingSpinnerN = mkLabel(sb, 'SigningSpinnerLabel', signingN, '⟳', 80, 80, 200, 120, 218, 165, 32);
    const signingStatusN = mkLabel(sb, 'SigningStatusLabel', signingN, 'Awaiting wallet approval…', 24, -40, 680, 36, 230, 230, 240);
    const signingHintN = mkLabel(sb, 'SigningHintLabel', signingN, 'Check your wallet app — sign to continue.', 16, -90, 620, 24, 140, 150, 170);
    sb.e[signingN]._children = [rf(signingSpinnerN), rf(signingStatusN), rf(signingHintN)];

    // ═══════════════════════════════════════════════════════════════
    // Phase H4 — LevelUpOverlay (full-screen XP celebration cinematic)
    // Triggered from AppUI._onGameOver / _showPostMatchPanel when newLevel > previousLevel.
    // Shows: scrim · "LEVEL UP" · big level number · rake-discount callout.
    // Auto-dismisses after 2.8s; also tap-to-dismiss anywhere.
    // ═══════════════════════════════════════════════════════════════
    const luN = sb.e.length;
    sb.node('LevelUpOverlay', canvas, [], [], v3(0, 0, 0));
    const luUT = sb.ut(luN, 720, 1280);
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
    const luTitle = mkLabel(sb, 'LevelUpTitleLabel', luN, 'LEVEL UP', 64, 200, 600, 100, 218, 165, 32);
    style(sb, luTitle, { bold: true });
    // Big level number with count-up tween at runtime.
    const luBigLevel = mkLabel(sb, 'LevelUpBigLevel', luN, '5', 180, 30, 600, 240, 255, 240, 200);
    style(sb, luBigLevel, { bold: true });
    // Caption (e.g. "Level 5 reached").
    const luCaption = mkLabel(sb, 'LevelUpCaptionLabel', luN, 'Level 5 reached', 26, -190, 600, 36, 220, 230, 240);
    // Rake discount callout (color = teal accent).
    const luRake = mkLabel(sb, 'LevelUpRakeLabel', luN, 'Your rake: 4.5% (was 5.0%)', 22, -260, 600, 32, 48, 198, 155);
    // Hint at the bottom.
    const luHint = mkLabel(sb, 'LevelUpHintLabel', luN, 'tap to continue', 14, -560, 400, 22, 140, 150, 170);
    sb.e[luN]._children = [rf(luTitle), rf(luBigLevel), rf(luCaption), rf(luRake), rf(luHint)];
    sb.e[luN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase N3 — NotificationPanel (slide-in feed from the right edge).
    // Backdrop button tap-outside-to-dismiss · 480×1280 card on right ·
    // header (Notifications · Mark all read · ✕) · 8-row pool below ·
    // empty state label centered when no rows visible.
    // ═══════════════════════════════════════════════════════════════
    const npN = sb.e.length;
    sb.node('NotificationPanel', canvas, [], [], v3(0, 0, 0));
    const npUT = sb.ut(npN, 720, 1280);
    // Full-panel backdrop sprite — tap-outside-to-dismiss surface, semi-transparent.
    const npBackdropBtn = sb.add({
        __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(npN), _enabled: true, __prefab: null,
        _interactable: true, _transition: 0,
        _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
        _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
        _duration: 0.1, _zoomScale: 1, _target: rf(npN), _id: gid(),
    });
    const npBackdropSpr = sb.add({
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
        node: rf(npN), _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: cl(0, 0, 0, 140),
        _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
        _type: 1, _fillType: 0, _sizeMode: 0,
        _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: gid(),
    });

    // Card container — 480×1280 anchored to right edge (x=120 means +120 from canvas center, so its right edge sits at the right wall).
    const npCardN = sb.e.length;
    sb.node('NotifPanelCard', npN, [], [], v3(120, 0, 0));
    const npCardUT = sb.ut(npCardN, 480, 1280);
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

    // Header.
    const npHeader = mkLabel(sb, 'NotifHeaderLabel', npCardN, 'Notifications', 26, 580, 360, 36, 218, 165, 32);
    style(sb, npHeader, { bold: true });
    const npCloseBtn = mkBtnXY(sb, 'NotifCloseButton', npCardN, '✕', 200, 580, 48, 48, 30, 36, 52);
    const npMarkAllBtn = mkBtnXY(sb, 'NotifMarkAllReadButton', npCardN, 'Mark all read', -100, 530, 200, 36, 38, 44, 64);

    // 8 row pool. Rows stack top→bottom inside a "list area" Node positioned
    // below the header. We don't use a ScrollView here — 8 rows fit comfortably
    // in the 1000px below header on most viewports. Future polish: wrap in a
    // ScrollView with anchor 0.5/1 if rows ever exceed the visible area.
    const npListN = sb.e.length;
    sb.node('NotifListContainer', npCardN, [], [], v3(0, -60, 0));
    const npListUT = sb.ut(npListN, 460, 980);
    sb.e[npListN]._components = [rf(npListUT)];

    const npRowIndices = [];
    {
        const rowW = 460, rowH = 92, gap = 8;
        const topY = 480; // first row's y (relative to listN center 0,-60)
        for (let i = 0; i < 8; i++) {
            const rN = sb.e.length;
            const ry = topY - i * (rowH + gap);
            sb.node(`NotifRow_${i}`, npListN, [], [], v3(0, ry, 0));
            const rUT = sb.ut(rN, rowW, rowH);
            const rSpr = sb.spr(rN, 22, 28, 42); // dark slate card
            const rBtn = sb.add({
                __type__: 'cc.Button', _name: '', _objFlags: 0, __editorExtras__: {},
                node: rf(rN), _enabled: true, __prefab: null,
                _interactable: true, _transition: 0,
                _normalColor: cl(255, 255, 255, 0), _hoverColor: cl(255, 255, 255, 0),
                _pressedColor: cl(255, 255, 255, 0), _disabledColor: cl(100, 100, 100, 0),
                _duration: 0.1, _zoomScale: 1.02, _target: rf(rN), _id: gid(),
            });
            // Color stripe — 6×rowH on the left edge.
            const stripeN = sb.e.length;
            sb.node(`NotifRowStripe_${i}`, rN, [], [], v3(-227, 0, 0));
            const stripeUT = sb.ut(stripeN, 6, rowH);
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
            // Icon container — 40×40 to the right of stripe.
            const iconN = sb.e.length;
            sb.node(`NotifRowIcon_${i}`, rN, [], [], v3(-185, 0, 0));
            const iconUT = sb.ut(iconN, 40, 40);
            sb.e[iconN]._components = [rf(iconUT)];
            // Title — bold 16pt.
            const titleN = mkLabel(sb, `NotifRowTitleLabel_${i}`, rN, 'Title', 16, 18, 280, 22, 244, 245, 249);
            sb.e[titleN]._lpos = v3(-15, 18, 0);
            sb.e[sb.e[titleN]._components[1].__id__]._horizontalAlign = 0;
            sb.e[sb.e[titleN]._components[1].__id__]._isBold = true;
            // Body — 13pt, two lines.
            const bodyN = mkLabel(sb, `NotifRowBodyLabel_${i}`, rN, 'Body', 13, -10, 280, 32, 168, 174, 201);
            sb.e[bodyN]._lpos = v3(-15, -8, 0);
            sb.e[sb.e[bodyN]._components[1].__id__]._horizontalAlign = 0;
            sb.e[sb.e[bodyN]._components[1].__id__]._overflow = 2;
            // Time-ago — 11pt muted, bottom-right corner.
            const timeN = mkLabel(sb, `NotifRowTimeLabel_${i}`, rN, '2m ago', 11, -32, 100, 16, 130, 140, 160);
            sb.e[timeN]._lpos = v3(170, -32, 0);
            // Unread dot — 8x8 teal circle, top-right, visible only when unread.
            const dotN = sb.e.length;
            sb.node(`NotifRowUnreadDot_${i}`, rN, [], [], v3(210, 32, 0));
            const dotUT = sb.ut(dotN, 8, 8);
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
            sb.e[rN]._children = [rf(stripeN), rf(iconN), rf(titleN), rf(bodyN), rf(timeN), rf(dotN)];
            sb.e[rN]._active = false;
            npRowIndices.push(rN);
        }
    }
    sb.e[npListN]._children = npRowIndices.map(rf);

    // Empty state — visible when no rows are active.
    const npEmptyL = mkLabel(sb, 'NotifEmptyLabel', npCardN, 'You\'re all caught up!', 16, 0, 360, 28, 168, 174, 201);
    sb.e[npEmptyL]._active = false;

    sb.e[npCardN]._children = [
        rf(npHeader), rf(npCloseBtn), rf(npMarkAllBtn),
        rf(npListN), rf(npEmptyL),
    ];
    sb.e[npN]._components = [rf(npUT), rf(npBackdropSpr), rf(npBackdropBtn)];
    sb.e[npN]._children = [rf(npCardN)];
    sb.e[npN]._active = false;

    // ═══════════════════════════════════════════════════════════════
    // Phase N2 — NotificationToastOverlay (top-of-screen premium card).
    // 720×360 transparent container with 3 stacked toast slots (y=600/490/380).
    // Each slot is a 640×96 card with: color stripe · icon · title · body ·
    // dismiss · progress bar. AppUI's NotificationToastQueue paints + animates.
    // ═══════════════════════════════════════════════════════════════
    const toastOvN = sb.e.length;
    sb.node('NotificationToastOverlay', canvas, [], [], v3(0, 0, 0));
    sb.ut(toastOvN, 720, 360);
    // No backdrop sprite — fully transparent so taps fall through to anything below.
    const toastSlotIndices = [];
    const SLOT_YS = [600, 490, 380];
    for (let i = 0; i < 3; i++) {
        const slotN = sb.e.length;
        sb.node(`NotificationToastSlot_${i}`, toastOvN, [], [], v3(0, SLOT_YS[i], 0));
        const slotUT = sb.ut(slotN, 640, 96);
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
        // Color stripe — 8×96 left edge. AppUI tints per kind.
        const stripeN = sb.e.length;
        sb.node(`ToastColorStripe_${i}`, slotN, [], [], v3(-316, 0, 0));
        const stripeUT = sb.ut(stripeN, 8, 96);
        const stripeSpr = sb.add({
            __type__: 'cc.Sprite', _name: '', _objFlags: 0, __editorExtras__: {},
            node: rf(stripeN), _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: cl(153, 69, 255, 255), // default = violet (Solana brand); AppUI overwrites
            _spriteFrame: { __uuid__: UUID_WHITE_SPRITE },
            _type: 1, _fillType: 0, _sizeMode: 0,
            _fillCenter: v2(0, 0), _fillStart: 0, _fillRange: 0,
            _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
            _id: gid(),
        });
        sb.e[stripeN]._components = [rf(stripeUT), rf(stripeSpr)];
        // Icon container — empty Node; IconLibrary.attach injects a Graphics + Label sibling.
        const iconN = sb.e.length;
        sb.node(`ToastIconContainer_${i}`, slotN, [], [], v3(-260, 0, 0));
        const iconUT = sb.ut(iconN, 56, 56);
        sb.e[iconN]._components = [rf(iconUT)];
        // Title — bold 18pt, single line.
        const titleN = mkLabel(sb, `ToastTitleLabel_${i}`, slotN, 'Title', 18, 18, 380, 26, 244, 245, 249);
        sb.e[titleN]._lpos = v3(-160, 18, 0);
        sb.e[sb.e[titleN]._components[1].__id__]._horizontalAlign = 0;
        sb.e[sb.e[titleN]._components[1].__id__]._isBold = true;
        // Body — regular 13pt, two-line.
        const bodyN = mkLabel(sb, `ToastBodyLabel_${i}`, slotN, 'Body line', 13, -10, 380, 38, 168, 174, 201);
        sb.e[bodyN]._lpos = v3(-160, -8, 0);
        sb.e[sb.e[bodyN]._components[1].__id__]._horizontalAlign = 0;
        sb.e[sb.e[bodyN]._components[1].__id__]._overflow = 2; // ENABLE_RESIZE_HEIGHT
        // Dismiss button — full right-edge tap area with × glyph.
        const dismissN = mkBtnXY(sb, `ToastDismissButton_${i}`, slotN, '✕', 290, 0, 50, 96, 30, 36, 52);
        // Progress bar — 632×4 at the bottom, scaleX shrinks 1→0 over duration.
        const progN = sb.e.length;
        sb.node(`ToastProgressBar_${i}`, slotN, [], [], v3(0, -46, 0));
        const progUT = sb.ut(progN, 632, 4);
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

    sb.e[canvas]._children = [rf(camN), rf(bgN), rf(mwaN), rf(lpN), rf(hpN), rf(tdN), rf(tdetN), rf(lbN), rf(dcN), rf(pfN), rf(wpN), rf(pmN), rf(stN), rf(tutN), rf(specN), rf(tourN), rf(fmN), rf(countdownN), rf(signingN), rf(luN), rf(npN), rf(toastOvN)];
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

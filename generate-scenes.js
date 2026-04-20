#!/usr/bin/env node
/**
 * Single Scene Generator — Landing + Home panels in one scene.
 * No scene transitions. Panels show/hide based on connection state.
 */
const fs = require('fs');
const path = require('path');

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
    lbl(n,t,fs=30,r=255,g=255,b=255){return this.add({__type__:'cc.Label',_name:'',_objFlags:0,__editorExtras__:{},node:rf(n),_enabled:true,__prefab:null,_string:t,_horizontalAlign:1,_verticalAlign:1,_actualFontSize:fs,_fontSize:fs,_fontFamily:'Arial',_lineHeight:fs+10,_overflow:0,_enableWrapText:true,_font:null,_isSystemFontUsed:true,_spacingX:0,_isItalic:false,_isBold:false,_isUnderline:false,_underlineHeight:2,_cacheMode:0,_color:cl(r,g,b),_isBatchable:false,_id:gid()});}
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

function mkBtn(sb, name, parent, text, y, w=500, h=75, br=60, bg=120, bb=200) {
    const bn=sb.e.length, ln=bn+1, bu=bn+2, sp=bn+3, bt=bn+4, lu=bn+5, ll=bn+6;
    const fontSize = Math.max(26, Math.round(h*0.34));
    sb.node(name, parent, [ln], [bu,sp,bt], v3(0,y,0));
    sb.node('Label', bn, [], [lu,ll], v3(0,0,0));
    sb.ut(bn,w,h); sb.spr(bn,br,bg,bb); sb.btn(bn,br,bg,bb);
    sb.ut(ln,w,h); sb.lbl(ln,text,fontSize,255,255,255);
    return bn;
}

function mkBtnXY(sb, name, parent, text, x, y, w=500, h=75, br=60, bg=120, bb=200) {
    const bn=sb.e.length, ln=bn+1, bu=bn+2, sp=bn+3, bt=bn+4, lu=bn+5, ll=bn+6;
    const fontSize = Math.max(22, Math.round(h*0.34));
    sb.node(name, parent, [ln], [bu,sp,bt], v3(x,y,0));
    sb.node('Label', bn, [], [lu,ll], v3(0,0,0));
    sb.ut(bn,w,h); sb.spr(bn,br,bg,bb); sb.btn(bn,br,bg,bb);
    sb.ut(ln,w,h); sb.lbl(ln,text,fontSize,255,255,255);
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
    sb.spr(bgN, 13, 13, 31, '57520716-48c8-4a19-8acf-41c9f8777fb0@f9941', 0);
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

    // Title + Subtitle
    const title = mkLabel(sb, 'TitleLabel', lpN, 'MWA Example App', 56, 420, 680, 90);
    const sub = mkLabel(sb, 'SubtitleLabel', lpN, 'Solana Mobile Wallet Adapter Demo', 30, 340, 680, 60, 204, 204, 204);

    // Connect Wallet — opens OS picker (no targetPackage)
    const connectBtn = mkBtn(sb, 'ConnectButton', lpN, 'Connect Wallet', 120, 680, 100, 51, 153, 255);

    // Reconnect (hidden by default — shown when cached auth exists)
    const reconnBtn = mkBtn(sb, 'ReconnectButton', lpN, 'Reconnect (Cached)', 10, 680, 100, 77, 179, 102);
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
    const pubkey = mkLabel(sb, 'PubkeyLabel', hpN, 'Not connected', 26, 470, 680, 50, 128, 204, 255);
    // Token Duel primary CTA — gold to pop above the SDK action buttons.
    const playDuel = mkBtn(sb, 'PlayTokenDuelButton', hpN, 'Play Token Duel',  370, 680, 100, 218, 165, 32);
    const signMsg  = mkBtn(sb, 'SignMessageButton', hpN, 'Sign Message',      260, 680, 90, 51, 153, 255);
    const signTx   = mkBtn(sb, 'SignTxButton', hpN, 'Sign Transaction',     160, 680, 90, 51, 153, 255);
    const signSend = mkBtn(sb, 'SignSendButton', hpN, 'Sign & Send',         60, 680, 90, 51, 153, 255);
    const caps     = mkBtn(sb, 'CapabilitiesButton', hpN, 'Get Capabilities', -40, 680, 90, 102, 128, 179);
    const disconn  = mkBtn(sb, 'DisconnectButton', hpN, 'Disconnect',        -140, 680, 90, 204, 102, 51);
    const del      = mkBtn(sb, 'DeleteButton', hpN, 'Delete Account',       -240, 680, 90, 204, 51, 51);
    const homeStatus = mkLabel(sb, 'HomeStatusLabel', hpN, 'Connected — choose an action', 26, -380, 680, 90, 204, 204, 204);

    sb.e[hpN]._children = [rf(pubkey), rf(playDuel), rf(signMsg), rf(signTx), rf(signSend), rf(caps), rf(disconn), rf(del), rf(homeStatus)];

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

    const tdTitle  = mkLabel(sb, 'TitleLabel', tdN, 'Token Duel', 44, 600, 380, 60, 218, 165, 32);

    // Balance chip — top-right. Label only for v1 (no icon sprite yet).
    const tdBalance = mkLabel(sb, 'BalanceChipLabel', tdN, '◼ 0.0000 SOL', 22, 600, 260, 40, 180, 230, 180);
    sb.e[tdBalance]._lpos = v3(220, 600, 0);

    // Search input (Session 3 / A1) — cc.EditBox. 540×52 so the clear button
    // (Session 4 B3) can sit at the right edge inside the title row.
    const tdSearch = mkEditBox(sb, 'SearchEditBox', tdN, 'Search token by symbol or mint…', -30, 540, 540, 52, 24);
    // Search clear button (× — hidden until the EditBox has text).
    const tdSearchClear = mkBtnXY(sb, 'SearchClearButton', tdN, '×', 280, 540, 52, 52, 204, 102, 51);
    sb.e[tdSearchClear]._active = false;

    // Feed tabs — 4 buttons (Trending / Gainers / New / Top 10). y=475.
    // Session 6: tightened from 158→150 wide + pulled xs in 15 units each so
    // right edge sits at ±315 (vs 360 design half-width) → 45-unit margin,
    // accommodating the Cocos 1.05× press-zoom on rounded-corner displays.
    const tabY = 475;
    const tabW = 150;
    const tabH = 44;
    const tabXs = [-240, -80, 80, 240];
    const tdTabTrending = mkBtnXY(sb, 'FeedTabTrending', tdN, 'Trending', tabXs[0], tabY, tabW, tabH, 51, 153, 255);
    const tdTabGainers  = mkBtnXY(sb, 'FeedTabGainers',  tdN, 'Gainers',  tabXs[1], tabY, tabW, tabH, 90, 90, 110);
    const tdTabNew      = mkBtnXY(sb, 'FeedTabNew',      tdN, 'New',      tabXs[2], tabY, tabW, tabH, 90, 90, 110);
    const tdTabTop10    = mkBtnXY(sb, 'FeedTabTop10',    tdN, '🏆 Top 10', tabXs[3], tabY, tabW, tabH, 90, 90, 110);

    // Feed ScrollView (Session 3 / A2). Window: 680×420, centered around y=240.
    const FEED_ROW_LIMIT = 20;
    const rowHeight = 60;
    const rowGap = 4;
    const rowStride = rowHeight + rowGap;
    const rowW = 660;
    const feedWinH = 420;
    const { root: tdFeedSV, content: tdFeedContent, contentUT: tdFeedContentUT } = mkScrollView(sb, 'FeedScrollView', tdN, 0, 240, 680, feedWinH);
    // Size content to fit the full 20-row pool so the ScrollView can scroll.
    sb.e[tdFeedContentUT]._contentSize = sz(rowW, FEED_ROW_LIMIT * rowStride);

    // Pre-instantiate 20 FeedRow nodes as children of `content`. Rows start
    // at the top of the content, stacking downward. AppUI toggles `.active`
    // and fills the labels + sprite tint at render time.
    const feedRowIndices = [];
    for (let i = 0; i < FEED_ROW_LIMIT; i++) {
        const ry = -(rowHeight / 2) - i * rowStride; // content anchor is (0.5,1); negative y = downward
        const rn = sb.e.length;
        sb.node(`FeedRow_${i}`, tdFeedContent, [], [], v3(0, ry, 0));

        // Components on the row Node: UITransform + Sprite (backdrop) + Button (tap).
        const rUT  = sb.ut(rn, rowW, rowHeight);
        const rSpr = sb.spr(rn, 40, 40, 60);
        const rBtn = sb.btn(rn, 40, 40, 60);

        // LogoSprite child (Session 3 / A5): left side, 40×40, async-loaded.
        const logoN = sb.e.length;
        sb.node('LogoSprite', rn, [], [], v3(-rowW/2 + 30, 0, 0));
        const logoUT = sb.ut(logoN, 40, 40);
        const logoSpr = sb.spr(logoN, 255, 255, 255);
        sb.e[logoN]._components = [rf(logoUT), rf(logoSpr)];

        // SymbolLabel (left, after logo).
        const symN = sb.e.length;
        sb.node('SymbolLabel', rn, [], [], v3(-60, 0, 0));
        const symUT = sb.ut(symN, 360, rowHeight);
        const symL  = sb.lbl(symN, '—', 26, 255, 255, 255);
        sb.e[symN]._components = [rf(symUT), rf(symL)];

        // DeltaLabel (right).
        const dN = sb.e.length;
        sb.node('DeltaLabel', rn, [], [], v3(rowW/2 - 90, 0, 0));
        const dUT = sb.ut(dN, 160, rowHeight);
        const dL  = sb.lbl(dN, '', 24, 200, 200, 200);
        sb.e[dN]._components = [rf(dUT), rf(dL)];

        sb.e[rn]._components = [rf(rUT), rf(rSpr), rf(rBtn)];
        sb.e[rn]._children   = [rf(logoN), rf(symN), rf(dN)];
        sb.e[rn]._active = false; // hidden until feed populates
        feedRowIndices.push(rn);
    }

    // Squad row — 3 slot buttons below the feed. y = 240 - feedWinH/2 - 50 ≈ -20.
    const squadY = 30;
    const tdSquadHeader = mkLabel(sb, 'SquadHeaderLabel', tdN, 'Your Squad (tap to clear)', 20, 80, 420, 26, 180, 180, 180);
    const tdSquad0 = mkBtnXY(sb, 'SquadSlot_0', tdN, '+', -220, squadY, 200, 70, 80, 80, 120);
    const tdSquad1 = mkBtnXY(sb, 'SquadSlot_1', tdN, '+',    0, squadY, 200, 70, 80, 80, 120);
    const tdSquad2 = mkBtnXY(sb, 'SquadSlot_2', tdN, '+',  220, squadY, 200, 70, 80, 80, 120);

    // Stake slider (Session 3 / A3) — continuous 0.001–0.1 SOL, default 0.01.
    // Slider progress 0..1 maps to [MIN..MAX] in AppUI.
    const stakeLabelY = -50;
    const stakeSliderY = -85;
    const stakeValueY = -120;
    const tdStakeHeader = mkLabel(sb, 'StakeHeaderLabel', tdN, 'Stake', 20, stakeLabelY, 200, 26, 180, 180, 180);
    const tdStakeSlider = mkSlider(sb, 'StakeSlider', tdN, 0, stakeSliderY, 540, 14, 0.1);
    const tdStakeValueLabel = mkLabel(sb, 'StakeValueLabel', tdN, '0.01 SOL', 22, stakeValueY, 300, 30, 218, 165, 32);

    // Snap-to chips remain for fast picks (0.001 / 0.01 / 0.1 SOL).
    const stakeChipY = -160;
    const tdStake001  = mkBtnXY(sb, 'StakeChip_001', tdN, '0.001', -220, stakeChipY, 160, 42, 77, 179, 102);
    const tdStake010  = mkBtnXY(sb, 'StakeChip_010', tdN, '0.01',     0, stakeChipY, 160, 42, 51, 153, 255);
    const tdStake100  = mkBtnXY(sb, 'StakeChip_100', tdN, '0.1',    220, stakeChipY, 160, 42, 204, 102, 204);

    // Stake & commit button (renamed from SignStakeButton). Single-tap signAndSend.
    const commitBtnY = -230;
    const tdCommit = mkBtn(sb, 'StakeCommitButton', tdN, 'Stake + Commit', commitBtnY, 640, 70, 51, 153, 255);

    // Start Game (revealed after commit) and Claim Payout (revealed on game-over) share the same slot.
    const tdStartGame = mkBtn(sb, 'StartGameButton', tdN, 'Start Game', commitBtnY, 640, 70, 218, 165, 32);
    sb.e[tdStartGame]._active = false;
    const tdClaim = mkBtn(sb, 'ClaimPayoutButton', tdN, 'Claim Payout', commitBtnY, 640, 70, 150, 85, 210);
    sb.e[tdClaim]._active = false;

    // Hero-pick tiles — kept in the scene at a new y (they overlay the squad row when shown).
    // Only surfaced when wallet supports sign_messages AND squad is not the source of truth yet.
    // Post-Session-2 cleanup: hero pick can become "which of your 3 squad tokens is your hero"
    // once TokenDuelGame reads holdings from squad. For now, the buttons sit hidden.
    const tdHero1 = mkBtnXY(sb, 'HeroTile1Button', tdN, '--', -220, squadY, 200, 70, 218, 165, 32);
    const tdHero2 = mkBtnXY(sb, 'HeroTile2Button', tdN, '--',    0, squadY, 200, 70, 218, 165, 32);
    const tdHero3 = mkBtnXY(sb, 'HeroTile3Button', tdN, '--',  220, squadY, 200, 70, 218, 165, 32);
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

    // BackButton at y=-380 so it clears the StakeCommitButton (y=-230, h=70 → bottom edge y=-265).
    // StatusLabel moves to y=-500 so it sits below BackButton (y=-380, h=80 → bottom edge y=-420).
    const tdBack   = mkBtn(sb, 'BackButton', tdN, '← Back to Menu', -380, 680, 80, 204, 102, 51);
    const tdStatus = mkLabel(sb, 'StatusLabel', tdN, '', 22, -500, 680, 60, 204, 204, 204);

    // Patch TokenDuelPanel children (order matters only for hit-testing — later
    // children render on top. Game overlay + claim/start go last so they cover
    // feed rows when active).
    sb.e[tdN]._children = [
        rf(tdTitle), rf(tdBalance), rf(tdSearch), rf(tdSearchClear),
        rf(tdTabTrending), rf(tdTabGainers), rf(tdTabNew), rf(tdTabTop10),
        rf(tdFeedSV),
        rf(tdSquadHeader), rf(tdSquad0), rf(tdSquad1), rf(tdSquad2),
        rf(tdStakeHeader), rf(tdStakeSlider), rf(tdStakeValueLabel),
        rf(tdStake001), rf(tdStake010), rf(tdStake100),
        rf(tdCommit), rf(tdStartGame), rf(tdClaim),
        rf(tdHero1), rf(tdHero2), rf(tdHero3),
        rf(h1N), rf(h2N), rf(h3N),
        rf(tdGameArea), rf(tdGameOver),
        rf(tdBack), rf(tdStatus),
    ];
    sb.e[tdN]._active = false;

    // AppUI component on Canvas
    const appUI = sb.custom(canvas, UUIDS.AppUI);

    // Patch Canvas children
    sb.e[canvas]._children = [rf(camN), rf(bgN), rf(mwaN), rf(lpN), rf(hpN), rf(tdN)];
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

/**
 * Sound.ts - Part 11 Bundle C.
 *
 * Lightweight wrapper over Cocos 3.8 `AudioSource` for short one-shot SFX.
 * Files live in `assets/token-duel/audio/`:
 *   - tap.mp3       UI button click
 *   - stack.mp3     successful block drop
 *   - miss.mp3      game-over miss
 *   - victory.mp3   1st place
 *   - level_up.mp3  XP level gained
 *
 * Asset sourcing + loudness spec: see `docs/AUDIO_ASSETS.md`.
 *
 * Degrades gracefully: if an asset isn't bundled, play() logs and no-ops.
 * User volume + on/off persist in localStorage:
 *   - tokenduel:sound.volume  (0..100, default 70)
 *   - tokenduel:sound.enabled ('true' | 'false', default 'true')
 */

import { AudioClip, AudioSource, Node as CCNode, resources } from 'cc';

const TAG = '[Sound]';

export type SoundKey = 'tap' | 'stack' | 'miss' | 'victory' | 'level_up';

const LS_VOL = 'tokenduel:sound.volume';
const LS_ON = 'tokenduel:sound.enabled';

/**
 * Path relative to the `resources/` bundle. AudioClips must live at
 * `assets/resources/audio/<key>` for `resources.load` to resolve them.
 * If you ship assets elsewhere, update ASSET_PATH accordingly.
 */
const ASSET_PATH = 'audio';

let _initialized = false;
let _node: CCNode | null = null;
let _source: AudioSource | null = null;
const _clips: Map<SoundKey, AudioClip> = new Map();
let _volume: number = 0.7;   // 0..1
let _enabled: boolean = true;
/** DB Stage 10 - pubkey for cross-device preferences sync. Null = guest. */
let _syncPubkey: string | null = null;

function _syncPref(patch: { soundEnabled?: boolean; soundVolume?: number }): void {
    if (!_syncPubkey) return;
    const pubkey = _syncPubkey;
    void (async () => {
        try {
            const { putPreferences } = await import('./PreferencesRpc');
            await putPreferences(pubkey, patch);
        } catch (e) {
            console.log(`${TAG} _syncPref | NET_ERR ${e}`);
        }
    })();
}

function ls(): Storage | null {
    try {
        const s = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
        return s && typeof s.getItem === 'function' ? s : null;
    } catch (_) { return null; }
}

function loadSettings(): void {
    const store = ls();
    if (!store) return;
    const rawVol = store.getItem(LS_VOL);
    if (rawVol !== null) {
        const v = parseInt(rawVol, 10);
        if (Number.isFinite(v) && v >= 0 && v <= 100) _volume = v / 100;
    }
    const rawOn = store.getItem(LS_ON);
    if (rawOn !== null) _enabled = rawOn === 'true';
}

/** Initialize Sound subsystem. Idempotent - safe to call from AppUI.onLoad. */
export function initSound(parent: CCNode): void {
    if (_initialized) return;
    _initialized = true;
    loadSettings();

    _node = new CCNode('SoundHost');
    parent.addChild(_node);
    _source = _node.addComponent(AudioSource);
    _source.loop = false;
    _source.volume = _volume;
    _source.playOnAwake = false;

    // Lazy-load all five clips. Missing files fail silently per clip.
    const keys: SoundKey[] = ['tap', 'stack', 'miss', 'victory', 'level_up'];
    for (const k of keys) {
        resources.load(`${ASSET_PATH}/${k}`, AudioClip, (err, clip) => {
            if (err || !clip) {
                console.log(`${TAG} load | MISSING ${k}.mp3 (${err?.message ?? 'no clip'}) - play('${k}') will no-op`);
                return;
            }
            _clips.set(k, clip);
            console.log(`${TAG} load | OK ${k}.mp3 duration=${clip.getDuration().toFixed(2)}s`);
        });
    }
    console.log(`${TAG} initSound | enabled=${_enabled} volume=${(_volume * 100).toFixed(0)}%`);
}

export function playSound(key: SoundKey): void {
    if (!_enabled || !_source) return;
    const clip = _clips.get(key);
    if (!clip) return; // asset not loaded (or missing)
    try {
        _source.volume = _volume;
        _source.playOneShot(clip, _volume);
    } catch (e) {
        console.log(`${TAG} play | ERROR ${key} ${e}`);
    }
}

export function setVolume(pct: number): void {
    if (!Number.isFinite(pct)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    _volume = clamped / 100;
    if (_source) _source.volume = _volume;
    try { ls()?.setItem(LS_VOL, String(clamped)); } catch (_) { /* ignore */ }
    console.log(`${TAG} setVolume | volume=${clamped}%`);
    _syncPref({ soundVolume: clamped });
}

export function getVolume(): number { return Math.round(_volume * 100); }

export function setEnabled(on: boolean): void {
    _enabled = on;
    try { ls()?.setItem(LS_ON, on ? 'true' : 'false'); } catch (_) { /* ignore */ }
    console.log(`${TAG} setEnabled | enabled=${on}`);
    _syncPref({ soundEnabled: on });
}

export function isEnabled(): boolean { return _enabled; }

/** DB Stage 10 - bind audio settings to a pubkey for cross-device sync. Pass null to detach. */
export function setSoundSyncPubkey(pubkey: string | null): void {
    _syncPubkey = pubkey || null;
}

/** Apply hydrated preferences from backend on connect. Writes to localStorage + live state. */
export function applySoundPreferences(prefs: { soundEnabled?: boolean; soundVolume?: number }): void {
    if (typeof prefs.soundVolume === 'number' && Number.isFinite(prefs.soundVolume)) {
        const clamped = Math.max(0, Math.min(100, Math.round(prefs.soundVolume)));
        _volume = clamped / 100;
        if (_source) _source.volume = _volume;
        try { ls()?.setItem(LS_VOL, String(clamped)); } catch (_) { /* ignore */ }
    }
    if (typeof prefs.soundEnabled === 'boolean') {
        _enabled = prefs.soundEnabled;
        try { ls()?.setItem(LS_ON, prefs.soundEnabled ? 'true' : 'false'); } catch (_) { /* ignore */ }
    }
}

/**
 * Haptics.ts — Part 11 Bundle C.
 *
 * Thin wrapper over Android's native haptic feedback API. On non-Android
 * platforms (editor preview, web) every call no-ops so game code can sprinkle
 * Haptics.fire() calls freely without platform guards.
 *
 * Native side lives in `native/AppActivity.java`:
 *   public static void performHapticFeedback(int type)
 * where type maps to:
 *   0 = SOFT    (UI tap)            → HapticFeedbackConstants.VIRTUAL_KEY
 *   1 = MEDIUM  (block land)        → HapticFeedbackConstants.CONFIRM
 *   2 = HEAVY   (miss / victory)    → HapticFeedbackConstants.REJECT
 *
 * User setting: persists on/off in `localStorage['tokenduel:haptics']`
 * (default ON). Settings panel exposes a toggle in its AudioSettingsCard.
 */

const TAG = '[Haptics]';
const LS_KEY = 'tokenduel:haptics';

export enum HapticType {
    SOFT = 0,
    MEDIUM = 1,
    HEAVY = 2,
}

let _enabled: boolean | null = null; // lazy-loaded from storage on first access
/** DB Stage 10 — pubkey for cross-device preferences sync. Null = guest. */
let _syncPubkey: string | null = null;

function _syncPref(on: boolean): void {
    if (!_syncPubkey) return;
    const pubkey = _syncPubkey;
    void (async () => {
        try {
            const { putPreferences } = await import('./PreferencesRpc');
            await putPreferences(pubkey, { hapticsEnabled: on });
        } catch (e) {
            console.log(`${TAG} _syncPref | NET_ERR ${e}`);
        }
    })();
}

function readEnabled(): boolean {
    if (_enabled !== null) return _enabled;
    try {
        const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
        if (ls && typeof ls.getItem === 'function') {
            const v = ls.getItem(LS_KEY);
            _enabled = v === null || v === undefined ? true : v === 'true';
            return _enabled!;
        }
    } catch (_) { /* fall through to default */ }
    _enabled = true;
    return _enabled;
}

function writeEnabled(on: boolean): void {
    _enabled = on;
    try {
        const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
        ls?.setItem?.(LS_KEY, on ? 'true' : 'false');
    } catch (_) { /* ignore */ }
}

export class Haptics {
    static isEnabled(): boolean { return readEnabled(); }

    static setEnabled(on: boolean): void {
        writeEnabled(on);
        console.log(`${TAG} setEnabled | enabled=${on}`);
        _syncPref(on);
    }

    /** DB Stage 10 — bind haptics setting to a pubkey for cross-device sync. */
    static setSyncPubkey(pubkey: string | null): void {
        _syncPubkey = pubkey || null;
    }

    /** Apply hydrated preference from backend on connect. */
    static applyPreference(prefs: { hapticsEnabled?: boolean }): void {
        if (typeof prefs.hapticsEnabled === 'boolean') {
            writeEnabled(prefs.hapticsEnabled);
        }
    }

    /** Fire a haptic feedback pulse. No-op if disabled or on non-Android platforms. */
    static fire(type: HapticType): void {
        if (!readEnabled()) return;
        try {
            const jsb = (globalThis as any).jsb;
            // The Java class name must match the package + class in native/AppActivity.java.
            // Token Duel builds under com.solanamwa.tokenduel per AndroidManifest.xml. If
            // the package changes, update this signature + the Java file in lockstep.
            jsb?.reflection?.callStaticMethod?.(
                'com/solanamwa/tokenduel/AppActivity',
                'performHapticFeedback',
                '(I)V',
                type,
            );
        } catch (e) {
            // Editor / web — no-op. Don't even log to keep dev console clean.
        }
    }
}

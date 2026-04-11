/**
 * AndroidToast.ts — Native Android toast notifications.
 *
 * Uses Cocos Creator's native.reflection to call Android Toast API directly.
 * Falls back to console.log on non-Android platforms (editor, web, iOS).
 *
 * Port of Unity's AndroidToast.cs / Godot's android_toast.gd.
 */

import { native, sys } from 'cc';

const TAG = '[Toast]';

/**
 * Show a native Android toast message.
 * Falls back to console.log on non-Android platforms.
 *
 * @param message - The text to display
 * @param longDuration - If true, shows for ~3.5s instead of ~2s
 */
export function showToast(message: string, longDuration: boolean = false): void {
    if (sys.os !== sys.OS.ANDROID || !sys.isNative) {
        console.log(`${TAG} show | message="${message}" platform=${sys.os} (fallback to console)`);
        return;
    }

    try {
        // Toast.LENGTH_SHORT = 0, Toast.LENGTH_LONG = 1
        const duration = longDuration ? 1 : 0;

        // Call static method: Toast.makeText(context, message, duration).show()
        // We use the Cocos activity as context via the AppActivity class
        native.reflection.callStaticMethod(
            'com/cocos/game/mwa/AndroidToastHelper',
            'show',
            '(Ljava/lang/String;I)V',
            message,
            duration
        );

        console.log(`${TAG} show | message="${message}" duration=${longDuration ? 'LONG' : 'SHORT'} platform=android`);
    } catch (e) {
        console.log(`${TAG} show | FAIL message="${message}" error=${e} (falling back to console)`);
    }
}

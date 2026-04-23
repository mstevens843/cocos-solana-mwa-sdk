# Native Java Patches

The Android `native/` directory is **gitignored** — Cocos regenerates it on
every fresh clone + project import. That means the `AppActivity.java`
patches we maintain (immersive-mode from Session 5, haptics from Part 11)
live outside git and are lost on `rm -rf native/`.

This doc is the source of truth for those patches. After every fresh
Cocos-Creator import of the project, re-apply everything below.

## File: `native/engine/android/src/com/solanamwa/tokenduel/AppActivity.java`

Full expected contents (merge the diffs if Cocos ships a new default):

```java
package com.solanamwa.tokenduel;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import com.cocos.lib.CocosActivity;

public class AppActivity extends CocosActivity {

    private static AppActivity sInstance;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sInstance = this;
        applyImmersiveMode();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
    }

    /** Session 5: hide status + navigation bars so the game is true full-screen. */
    private void applyImmersiveMode() {
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    /**
     * Part 11 Bundle C: called from Haptics.ts via jsb.reflection.
     *
     *   type = 0  SOFT   (UI tap)         → HapticFeedbackConstants.VIRTUAL_KEY
     *   type = 1  MEDIUM (block land)     → HapticFeedbackConstants.CONFIRM
     *   type = 2  HEAVY  (miss / victory) → HapticFeedbackConstants.REJECT
     *
     * STATIC method — JSB's callStaticMethod binding only works on static,
     * so the activity instance is stashed in sInstance at onCreate.
     */
    public static void performHapticFeedback(int type) {
        Activity a = sInstance;
        if (a == null) return;
        View v = a.getWindow().getDecorView();
        int fb;
        switch (type) {
            case 0: fb = HapticFeedbackConstants.VIRTUAL_KEY; break;
            case 1: fb = HapticFeedbackConstants.CONFIRM; break;
            case 2: fb = HapticFeedbackConstants.REJECT; break;
            default: fb = HapticFeedbackConstants.VIRTUAL_KEY;
        }
        try {
            v.performHapticFeedback(fb);
        } catch (Throwable t) {
            // HapticFeedbackConstants.CONFIRM + REJECT are API 30+; some older
            // devices reject them. Fall back to VIRTUAL_KEY silently.
            try { v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); }
            catch (Throwable t2) { /* nothing to do */ }
        }
    }
}
```

## Build dependencies

`HapticFeedbackConstants.CONFIRM` + `.REJECT` require **API level 30**
(Android 11). The try/catch above degrades to `VIRTUAL_KEY` on older
devices so the app doesn't crash.

Add to `native/engine/android/app/build.gradle` if not already present:

```gradle
android {
    compileSdkVersion 33
    defaultConfig {
        minSdkVersion 26     // Cocos 3.8 min; haptics work from API 26
        targetSdkVersion 33  // required for HapticFeedbackConstants.CONFIRM/REJECT
    }
}
```

## Post-import checklist

After every Cocos `Rebuild All` that nukes `native/`:

1. Re-open `native/engine/android/src/com/solanamwa/tokenduel/AppActivity.java`
2. Replace its contents with the block above
3. Verify `gradle.properties` has `android.useAndroidX=true` + `android.enableJetifier=true`
4. Rebuild: `rm -rf library/ temp/ build/android/proj/build/` → Cocos build → `adb install -r`

## Verification

On-device:
- Tap any button → short haptic tick
- Drop a block successfully → firmer pulse
- Miss + game-over → sharp rejection buzz

If nothing vibrates: `adb logcat | grep -i hapt` should show
`performHapticFeedback` being called. If it isn't, double-check the Java
class path in `Haptics.ts` matches `com/solanamwa/tokenduel/AppActivity`
(slashes, not dots).

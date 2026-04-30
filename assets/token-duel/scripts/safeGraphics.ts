/**
 * safeGraphics.ts — engine-safe Graphics attachment + boot-phase watcher.
 *
 * # The bug we're guarding against
 *
 * Cocos 3.8 native (Android, libcocos.so) has a render-pipeline bug where
 * `node.addComponent(Graphics)` on dynamically-created Nodes during onLoad /
 * start / update phases SIGSEGVs in `js_cc_UIModelProxy_activeSubModels`
 * (jsb_2d_auto.cpp:2923, fault addr 0x28) when the next DRAW walks the
 * half-attached render entity. Dies as `Fatal signal 11 (SIGSEGV), code 1`.
 *
 * The fix is to defer the attach to `Director.EVENT_AFTER_DRAW`, which fires
 * at the end of the just-completed draw walk — the entity tree is stable
 * then, and the next DRAW walks it cleanly.
 *
 * Empirically validated 2026-04-29: scheduleOnce(0) is NOT sufficient
 * (it fires in next-tick UPDATE before that tick's DRAW). director.once(
 * EVENT_AFTER_DRAW) is the correct boundary.
 *
 * # Usage
 *
 *   import { safeAddGraphics, installGraphicsCreationWatcher } from './safeGraphics';
 *
 *   // Replace ALL `node.addComponent(Graphics)` during boot with:
 *   safeAddGraphics(node, (g) => {
 *       g.fillColor = ...;
 *       g.circle(0, 0, r);
 *       g.fill();
 *   });
 *
 *   // In your boot path (e.g. AppUI.start), install the watcher once:
 *   installGraphicsCreationWatcher();
 *
 * The watcher logs every Graphics creation during the first 8 ticks with the
 * draw-phase context. If a SIGSEGV happens, the last `[SafeGraphics]
 * addComponent` log line before the crash names the offending Node — no
 * bisection needed.
 */

import { Director, Graphics, Node, director } from 'cc';

const TAG = '[SafeGraphics]';

let _firstDrawCompleted = false;
let _inAfterDrawWindow = false;
let _tickNum = 0;
let _watcherInstalled = false;

// Engine survives ~18 Graphics added per AFTER_DRAW tick on test device; > ~20
// dereferences a half-attached entity at offset 0x28 in
// js_cc_UIModelProxy_activeSubModels. MascotController contributes 12 in tick 1
// AFTER_DRAW unbudgeted, so cap the queue at 6 to keep total <= 18 in tick 1.
const PER_TICK_BUDGET = 6;
const _queue: Array<() => void> = [];
let _pumpScheduled = false;

function _schedulePump(): void {
    if (_pumpScheduled) return;
    _pumpScheduled = true;
    director.once(Director.EVENT_AFTER_DRAW, () => {
        _pumpScheduled = false;
        for (let i = 0; i < PER_TICK_BUDGET && _queue.length > 0; i++) {
            const work = _queue.shift();
            if (!work) break;
            try {
                work();
            } catch (e) {
                console.error(`${TAG} queued work threw: ${e}`);
            }
        }
        if (_queue.length > 0) _schedulePump();
    });
}

/**
 * Schedule `work` to run inside an AFTER_DRAW window, budgeted at
 * PER_TICK_BUDGET work units per tick. Use for any boot-time render-entity
 * construction (Graphics, Sprite-strip-and-replace, child-node-with-Graphics).
 *
 * Each call queues exactly one work unit. If you have N Graphics to add, make
 * N calls — the queue spreads them across ticks under the budget.
 */
export function enqueuePostDraw(work: () => void): void {
    _queue.push(work);
    _schedulePump();
}

/**
 * Add a Graphics component to `node` in the engine-safe (post-DRAW) window
 * and run `draw(g)` once it lands. Survives `node.destroy()` between schedule
 * and execute (no-ops if the node went away).
 *
 * Pass `opts.immediate = true` to attach synchronously when you know boot is
 * past (≥10 ticks in). Default is always-defer, which is safe everywhere.
 */
export function safeAddGraphics(
    node: Node | null,
    draw: (g: Graphics) => void,
    opts: { immediate?: boolean; tag?: string } = {},
): void {
    if (!node) return;
    const { immediate = false, tag = '' } = opts;
    const run = (): void => {
        if (!node.isValid) return;
        const g = node.addComponent(Graphics);
        try {
            draw(g);
        } catch (e) {
            console.error(`${TAG} draw threw on "${node.name}"${tag ? ` (${tag})` : ''}: ${e}`);
        }
    };
    if (immediate && _firstDrawCompleted) {
        run();
    } else {
        enqueuePostDraw(run);
    }
}

/**
 * Boot-phase watcher: monkey-patches `Node.prototype.addComponent` to log
 * every Graphics creation during the first `maxTicks` ticks with the current
 * draw-phase context.
 *
 * If the engine SIGSEGVs, the last `[SafeGraphics] addComponent | tick=N
 * phase=...` log line before the crash identifies the offending Node and
 * call site (via `console.trace`). The watcher auto-uninstalls after maxTicks
 * to keep zero runtime cost post-boot.
 *
 * Idempotent — call once at boot. Safe to call from AppUI.start.
 */
export function installGraphicsCreationWatcher(opts: { maxTicks?: number; warnOnUnsafe?: boolean; throwOnUnsafe?: boolean } = {}): void {
    if (_watcherInstalled) return;
    _watcherInstalled = true;

    // 2026-04-30 Fix 11 — in dev (Cocos Editor preview / DEBUG APK), throw on
    // any tick<3 unsafe Graphics attach so the offending site fails loudly
    // instead of probabilistically SIGSEGV-ing later. Production builds keep
    // warn-only behavior — never crash a shipped APK over a render-entity
    // bug. EDITOR/DEBUG are Cocos build constants:
    // https://docs.cocos.com/creator/3.8/manual/en/scripting/build-constants.html
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const isDev = !!((globalThis as any).EDITOR || (globalThis as any).DEBUG);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    // Bonus dev-only headroom: keep the watcher running for 30 ticks instead
    // of 8 so polish iterations that newly add Graphics post-boot also get
    // caught immediately. Zero cost in prod (still 8).
    const maxTicks = opts.maxTicks ?? (isDev ? 30 : 8);
    const warnOnUnsafe = opts.warnOnUnsafe ?? true;
    const throwOnUnsafe = opts.throwOnUnsafe ?? isDev;

    director.on(Director.EVENT_AFTER_DRAW, () => {
        _tickNum++;
        _firstDrawCompleted = true;
        _inAfterDrawWindow = true;
        // Window closes at next event-loop turn (after AFTER_DRAW handlers fire).
        Promise.resolve().then(() => { _inAfterDrawWindow = false; });
    });

    // Monkey-patch addComponent to instrument Graphics creations during boot.
    // Cast through any to avoid wrestling with Cocos's overloaded TS types.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const proto = Node.prototype as any;
    if (proto.__sg_orig_addComponent) return;
    const orig = proto.addComponent as (...args: any[]) => any;
    proto.__sg_orig_addComponent = orig;
    proto.addComponent = function (this: Node, ...args: any[]): any {
        const result = orig.apply(this, args);

        // Auto-uninstall once we're past the boot window — restores native
        // method to keep runtime cost zero.
        if (_tickNum > maxTicks) {
            proto.addComponent = proto.__sg_orig_addComponent;
            proto.__sg_orig_addComponent = undefined;
            return result;
        }

        if (result instanceof Graphics) {
            const phase = _inAfterDrawWindow ? 'AFTER_DRAW(safe)' : 'UPDATE_OR_DRAW(unsafe)';
            const arg0 = args[0];
            const argLabel = typeof arg0 === 'function' ? (arg0.name || '?') : String(arg0);
            console.log(`${TAG} addComponent | tick=${_tickNum} phase=${phase} type=${argLabel} on="${this.name}"`);
            if (!_inAfterDrawWindow && _tickNum < 3) {
                const msg = `${TAG} Graphics added on "${this.name}" at tick=${_tickNum} OUTSIDE AFTER_DRAW — likely engine SIGSEGV (0x28) trigger. Wrap in safeAddGraphics() or enqueuePostDraw() from assets/token-duel/scripts/safeGraphics.ts.`;
                if (throwOnUnsafe) {
                    // Dev (EDITOR || DEBUG): hard-fail at the offending site
                    // so the bug is impossible to ignore. Throwing here also
                    // gives the dev a precise stack trace at the addComponent
                    // call, no bisection needed.
                    throw new Error(msg);
                }
                if (warnOnUnsafe) {
                    console.warn(`⚠️  ${msg}`);
                    try { console.trace(`${TAG} call site:`); } catch (_) { /* native may not support trace */ }
                }
            }
        }
        return result;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    console.log(`${TAG} watcher installed — logging Graphics creations for first ${maxTicks} ticks (auto-uninstalls after)`);
}

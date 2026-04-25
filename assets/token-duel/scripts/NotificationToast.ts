/**
 * NotificationToast.ts — Phase N2 toast queue.
 *
 * Manages 3 pre-instantiated NotificationToastSlot_0..2 Nodes from the
 * scene. Each slot animates in (slide-down + fade), runs a 3.5s progress
 * bar, then auto-dismisses (slide-up + fade) and frees itself. Overflow
 * queues internally FIFO and drains as slots free up.
 *
 * Tap on body → mark notification as read + invoke onTap (set by AppUI per
 * kind for deep-linking). Tap on ✕ → dismiss without onTap.
 *
 * Visuals are kind-coded:
 *   - Color stripe = Theme palette (violet/teal/amber/gold/rose).
 *   - Icon = IconLibrary.attach('sword'/'bolt'/'check'/'coin'/'clock'/etc).
 *   - Subtle haptic + soft sound on appear.
 */

import { Color, Label, Node, Sprite, Tween, Vec3, UIOpacity, tween, Button } from 'cc';

import { IconLibrary, IconName } from './IconLibrary';
import { Notification, NotificationKind, NotificationStore } from './Notifications';
import { Haptics, HapticType } from './Haptics';
import { playSound, SoundKey } from './Sound';

const TAG = '[NotificationToast]';

/** Per-kind visual + audio config. */
const KIND_CONFIG: Record<NotificationKind, {
    /** RGB stripe color. */
    rgb: [number, number, number];
    icon: IconName;
    sound?: SoundKey;
    haptic: HapticType;
}> = {
    match_filled:        { rgb: [153, 69, 255],  icon: 'sword',  sound: 'tap',       haptic: HapticType.MEDIUM },
    match_started:       { rgb: [153, 69, 255],  icon: 'bolt',   sound: 'tap',       haptic: HapticType.MEDIUM },
    match_settled:       { rgb: [48, 198, 155],  icon: 'check',  sound: 'level_up',  haptic: HapticType.MEDIUM },
    payout:              { rgb: [255, 210, 74],  icon: 'coin',   sound: 'victory',   haptic: HapticType.HEAVY  },
    match_expired:       { rgb: [255, 180, 84],  icon: 'clock',  sound: 'tap',       haptic: HapticType.SOFT   },
    lobby_cancelled:     { rgb: [255, 180, 84],  icon: 'clock',  sound: 'tap',       haptic: HapticType.SOFT   },
    level_up:            { rgb: [255, 210, 74],  icon: 'star',   sound: 'level_up',  haptic: HapticType.HEAVY  },
    streak_milestone:    { rgb: [255, 180, 84],  icon: 'flame',  sound: 'level_up',  haptic: HapticType.MEDIUM },
    tournament_starting: { rgb: [255, 210, 74],  icon: 'trophy', sound: 'tap',       haptic: HapticType.MEDIUM },
    tournament_full:     { rgb: [255, 210, 74],  icon: 'crown',  sound: 'level_up',  haptic: HapticType.HEAVY  },
    challenge_done:      { rgb: [48, 198, 155],  icon: 'check',  sound: 'tap',       haptic: HapticType.MEDIUM },
};

/** Optional per-notification tap handler — supplied by AppUI when emitting. */
export type ToastTapHandler = (n: Notification) => void;

interface SlotState {
    node: Node;
    /** UIOpacity for fade tweens; auto-attached by ensureUIOpacity if absent. */
    opacity: UIOpacity;
    busy: boolean;
    /** Bound notification while busy=true. */
    notification: Notification | null;
    /** Active timer for auto-dismiss. */
    timer: any;
    progressNode: Node | null;
    titleLabel: Label | null;
    bodyLabel: Label | null;
    stripeSprite: Sprite | null;
    iconContainer: Node | null;
    bodyTapButton: Button | null;
    dismissButton: Button | null;
}

const DURATION_MS = 3500;
const ENTER_MS = 220;
const EXIT_MS = 160;
const ENTER_OFFSET_PX = 30; // start above resting Y by this many px, slide down

export class NotificationToastQueue {
    private _slots: SlotState[] = [];
    private _queue: Array<{ n: Notification; onTap?: ToastTapHandler }> = [];
    /** AppUI subscribes notifications → ensures we surface every store-add. */
    private _unsubStore: (() => void) | null = null;
    private _onTapResolver: ((n: Notification) => ToastTapHandler | undefined) | null = null;

    /** Initialize from the 3 slot Nodes (NotificationToastSlot_0..2). */
    bind(slotNodes: Node[]): void {
        this._slots = slotNodes.map((node, i) => this._buildSlot(node, i));
        console.log(`${TAG} bind | slots=${this._slots.length}`);
    }

    /**
     * Allow AppUI to register a per-kind onTap resolver. The toast queue
     * has no direct access to AppUI's panel-switch APIs; this delegate
     * provides them by returning a function appropriate for the kind.
     */
    setTapResolver(resolver: (n: Notification) => ToastTapHandler | undefined): void {
        this._onTapResolver = resolver;
    }

    /**
     * Auto-subscribe to a NotificationStore so every `add()` flows here.
     * Pass `quietToast=true` on the store entry to skip the toast surface
     * (notification still lands in the panel feed). De-dupes by notification id.
     */
    attachStore(store: NotificationStore = NotificationStore.instance): void {
        this._unsubStore?.();
        // We track ids we've already toasted so re-renders from subscribe()
        // don't double-fire. Limited set since recent ids age out fast.
        const seen = new Set<string>();
        this._unsubStore = store.subscribe((snapshot) => {
            for (const n of snapshot) {
                if (n.dismissedAt !== null) continue;
                if (seen.has(n.id)) continue;
                seen.add(n.id);
                if (n.quietToast) continue;
                this.enqueue(n);
            }
            // Keep the seen-set bounded — only the most-recent 200 ids matter.
            if (seen.size > 200) {
                const trimmed = snapshot.slice(0, 200).map((x) => x.id);
                seen.clear();
                for (const id of trimmed) seen.add(id);
            }
        });
    }

    detachStore(): void {
        this._unsubStore?.();
        this._unsubStore = null;
    }

    /** Push a notification onto the toast surface. Drops if no slots are bound. */
    enqueue(n: Notification): void {
        if (this._slots.length === 0) {
            console.log(`${TAG} enqueue | NO_SLOTS_BOUND id=${n.id.slice(0, 8)}`);
            return;
        }
        const onTap = this._onTapResolver?.(n);
        const free = this._slots.find((s) => !s.busy);
        if (free) {
            this._showInSlot(free, n, onTap);
        } else {
            this._queue.push({ n, onTap });
            console.log(`${TAG} enqueue | QUEUED id=${n.id.slice(0, 8)} kind=${n.kind} queue_len=${this._queue.length}`);
        }
    }

    // ─── internals ───────────────────────────────────────────────────

    private _buildSlot(node: Node, idx: number): SlotState {
        let opacity = node.getComponent(UIOpacity);
        if (!opacity) opacity = node.addComponent(UIOpacity);
        const stripeNode = node.getChildByName(`ToastColorStripe_${idx}`);
        const iconNode = node.getChildByName(`ToastIconContainer_${idx}`);
        const titleNode = node.getChildByName(`ToastTitleLabel_${idx}`);
        const bodyNode = node.getChildByName(`ToastBodyLabel_${idx}`);
        const progressNode = node.getChildByName(`ToastProgressBar_${idx}`);
        const dismissNode = node.getChildByName(`ToastDismissButton_${idx}`);
        // The slot itself has no Button component in the scene — wire one to the
        // body text by reusing the title's underlying node? Actually simpler:
        // attach a Button to the slot node itself so any non-dismiss tap fires
        // the body handler.
        let bodyTapButton = node.getComponent(Button);
        if (!bodyTapButton) bodyTapButton = node.addComponent(Button);
        bodyTapButton.transition = Button.Transition.NONE;
        const dismissButton = dismissNode?.getComponent(Button) ?? null;

        const state: SlotState = {
            node,
            opacity,
            busy: false,
            notification: null,
            timer: null,
            progressNode,
            titleLabel: titleNode?.getComponent(Label) ?? null,
            bodyLabel: bodyNode?.getComponent(Label) ?? null,
            stripeSprite: stripeNode?.getComponent(Sprite) ?? null,
            iconContainer: iconNode,
            bodyTapButton,
            dismissButton,
        };

        bodyTapButton.node.on(Button.EventType.CLICK, () => this._onTapSlot(state), this);
        dismissButton?.node.on(Button.EventType.CLICK, () => this._dismissSlot(state, /*invokeTap*/ false), this);
        return state;
    }

    private _showInSlot(s: SlotState, n: Notification, onTap?: ToastTapHandler): void {
        s.busy = true;
        s.notification = n;
        const cfg = KIND_CONFIG[n.kind] ?? KIND_CONFIG.match_started;

        // Title + body.
        if (s.titleLabel) s.titleLabel.string = n.title;
        if (s.bodyLabel) s.bodyLabel.string = n.body;

        // Color stripe.
        if (s.stripeSprite) {
            s.stripeSprite.color = new Color(cfg.rgb[0], cfg.rgb[1], cfg.rgb[2], 255);
        }

        // Icon.
        if (s.iconContainer) {
            try {
                IconLibrary.attach(s.iconContainer, cfg.icon, { size: 40 });
            } catch (e) {
                console.log(`${TAG} _showInSlot | icon attach failed kind=${n.kind} ${e}`);
            }
        }

        // Show + entrance animation.
        s.node.active = true;
        const restingY = s.node.position.y;
        Tween.stopAllByTarget(s.node);
        Tween.stopAllByTarget(s.opacity);
        s.opacity.opacity = 0;
        s.node.setPosition(s.node.position.x, restingY + ENTER_OFFSET_PX, 0);
        tween(s.node)
            .to(ENTER_MS / 1000, { position: new Vec3(s.node.position.x, restingY, 0) }, { easing: 'backOut' })
            .start();
        tween(s.opacity)
            .to(ENTER_MS / 1000, { opacity: 255 }, { easing: 'cubicOut' })
            .start();

        // Progress bar — shrink scaleX 1→0 over DURATION_MS.
        if (s.progressNode) {
            Tween.stopAllByTarget(s.progressNode);
            s.progressNode.setScale(1, 1, 1);
            tween(s.progressNode)
                .to(DURATION_MS / 1000, { scale: new Vec3(0, 1, 1) }, { easing: 'linear' })
                .start();
        }

        // Auto-dismiss timer.
        if (s.timer) clearTimeout(s.timer);
        s.timer = setTimeout(() => this._dismissSlot(s, /*invokeTap*/ false), DURATION_MS);

        // Haptic + sound.
        try { Haptics.fire(cfg.haptic); } catch (_) { /* ignore */ }
        if (cfg.sound) { try { playSound(cfg.sound); } catch (_) { /* ignore */ } }

        // Stash the onTap handler on the slot via closure on bodyTapButton.
        // We use the slot's notification field to look it up at click time.
        (s as any).__onTap = onTap;

        console.log(`${TAG} _showInSlot | id=${n.id.slice(0, 8)} kind=${n.kind} restingY=${restingY}`);
    }

    private _onTapSlot(s: SlotState): void {
        if (!s.busy || !s.notification) return;
        const onTap = (s as any).__onTap as ToastTapHandler | undefined;
        const n = s.notification;
        // Mark read first so a subsequent navigation can use unread-state cleanly.
        try { NotificationStore.instance.markRead(n.id); } catch (_) { /* ignore */ }
        try { onTap?.(n); } catch (e) { console.log(`${TAG} onTap | ERROR ${e}`); }
        this._dismissSlot(s, /*invokeTap*/ true);
    }

    private _dismissSlot(s: SlotState, invokeTap: boolean): void {
        if (!s.busy) return;
        if (s.timer) { clearTimeout(s.timer); s.timer = null; }
        s.busy = false;
        const n = s.notification;
        s.notification = null;
        (s as any).__onTap = undefined;
        const restingY = s.node.position.y;
        // Exit: slide up + fade out.
        Tween.stopAllByTarget(s.node);
        Tween.stopAllByTarget(s.opacity);
        tween(s.node)
            .to(EXIT_MS / 1000, { position: new Vec3(s.node.position.x, restingY + ENTER_OFFSET_PX, 0) }, { easing: 'cubicIn' })
            .start();
        tween(s.opacity)
            .to(EXIT_MS / 1000, { opacity: 0 }, { easing: 'cubicIn' })
            .call(() => {
                // Settle node back to resting y for next show.
                s.node.setPosition(s.node.position.x, restingY, 0);
                s.node.active = false;
                this._drainQueue();
            })
            .start();
        if (n) console.log(`${TAG} _dismissSlot | id=${n.id.slice(0, 8)} kind=${n.kind} invokeTap=${invokeTap}`);
    }

    private _drainQueue(): void {
        if (this._queue.length === 0) return;
        const free = this._slots.find((s) => !s.busy);
        if (!free) return;
        const next = this._queue.shift();
        if (!next) return;
        this._showInSlot(free, next.n, next.onTap);
    }
}

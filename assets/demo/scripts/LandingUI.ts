/**
 * LandingUI.ts - Landing page: "Connect Wallet" and "Reconnect (Cached)" buttons.
 *
 * Port of:
 *   - Godot: main.gd (73 lines)
 *   - Unity: LandingUI.cs
 *
 * On successful authorization, transitions to the Home scene.
 * Reconnect button is only visible if a cached auth exists.
 *
 * NOTE: Uses find() to locate UI nodes by name instead of @property.
 * This eliminates manual inspector wiring - just add this component to Canvas.
 */

import { _decorator, Component, Label, Button, director, find } from 'cc';
import { MWAManager } from '../../solana-mwa/scripts/MWAManager';
import { MWA_AUTHORIZED, MWA_AUTH_FAILED, MWA_STATUS } from '../../solana-mwa/scripts/MWAEvents';
import { showToast } from './AndroidToast';

const { ccclass } = _decorator;
const TAG = '[LandingUI]';

@ccclass('LandingUI')
export class LandingUI extends Component {

    private _connectButton: Button = null!;
    private _reconnectButton: Button = null!;
    private _statusLabel: Label = null!;

    onLoad(): void {
        console.log(`${TAG} onLoad | START`);

        // Find UI nodes by name in the scene hierarchy
        const connectNode = this.node.getChildByName('ConnectButton');
        const reconnectNode = this.node.getChildByName('ReconnectButton');
        const statusNode = this.node.getChildByName('StatusLabel');

        if (!connectNode || !reconnectNode || !statusNode) {
            console.log(`${TAG} onLoad | FAIL missing nodes: connect=${!!connectNode} reconnect=${!!reconnectNode} status=${!!statusNode}`);
            return;
        }

        this._connectButton = connectNode.getComponent(Button)!;
        this._reconnectButton = reconnectNode.getComponent(Button)!;
        this._statusLabel = statusNode.getComponent(Label)!;

        console.log(`${TAG} onLoad | nodes found: connect=${!!this._connectButton} reconnect=${!!this._reconnectButton} status=${!!this._statusLabel}`);

        // Wire button click handlers
        this._connectButton.node.on(Button.EventType.CLICK, this._onConnectPressed, this);
        this._reconnectButton.node.on(Button.EventType.CLICK, this._onReconnectPressed, this);
        console.log(`${TAG} onLoad | buttons wired`);

        // Set initial UI state
        this._statusLabel.string = 'Tap Connect to link your wallet';
        this._reconnectButton.node.active = false;

        console.log(`${TAG} onLoad | DONE (MWAManager events deferred to start())`);
    }

    /**
     * start() runs AFTER all onLoad() calls complete across all nodes.
     * This ensures MWAManager.instance is initialized before we register events.
     * (Parent onLoad fires before children in Cocos Creator - so LandingUI.onLoad
     * runs before MWAManager.onLoad when MWAManager is a child of Canvas.)
     */
    start(): void {
        console.log(`${TAG} start | START - connecting MWAManager events`);

        const mwa = MWAManager.instance;
        if (mwa) {
            mwa.node.on(MWA_AUTHORIZED, this._onAuthorized, this);
            mwa.node.on(MWA_AUTH_FAILED, this._onAuthFailed, this);
            mwa.node.on(MWA_STATUS, this._onStatusUpdated, this);
            console.log(`${TAG} start | MWAManager events connected`);

            // Check for cached auth - show/hide reconnect button
            const hasCached = mwa.cache?.hasCachedAuth() ?? false;
            this._reconnectButton.node.active = hasCached;

            if (hasCached) {
                const cached = mwa.cache.getLatest();
                const cachedPubkey = cached?.pubkey ?? '';
                console.log(`${TAG} start | cached_auth=true cached_pubkey=${cachedPubkey.substring(0, 8)}...`);
                showToast(`Cached session found: ${cachedPubkey.substring(0, 8)}...`);
            } else {
                console.log(`${TAG} start | cached_auth=false reconnect_visible=false`);
            }
        } else {
            console.log(`${TAG} start | FAIL MWAManager.instance is STILL null - this should not happen`);
        }

        console.log(`${TAG} start | DONE`);
    }

    onDestroy(): void {
        console.log(`${TAG} onDestroy | START`);

        if (this._connectButton) this._connectButton.node.off(Button.EventType.CLICK, this._onConnectPressed, this);
        if (this._reconnectButton) this._reconnectButton.node.off(Button.EventType.CLICK, this._onReconnectPressed, this);

        const mwa = MWAManager.instance;
        if (mwa) {
            mwa.node.off(MWA_AUTHORIZED, this._onAuthorized, this);
            mwa.node.off(MWA_AUTH_FAILED, this._onAuthFailed, this);
            mwa.node.off(MWA_STATUS, this._onStatusUpdated, this);
        }

        console.log(`${TAG} onDestroy | DONE`);
    }

    // ─── Button Handlers ─────────────────────────────────────────────

    private async _onConnectPressed(): Promise<void> {
        console.log(`${TAG} onConnectPressed | START`);
        this._setButtonsEnabled(false);
        this._statusLabel.string = 'Opening wallet...';

        console.log(`${TAG} onConnectPressed | calling MWAManager.authorize()`);
        const result = await MWAManager.instance?.authorize() ?? null;

        console.log(`${TAG} onConnectPressed | DONE success=${result != null}`);

        if (result) {
            // Direct transition fallback (in case MWA_AUTHORIZED event was missed)
            console.log(`${TAG} onConnectPressed | authorize succeeded - transitioning to Home`);
            director.loadScene('Home');
        } else {
            this._setButtonsEnabled(true);
        }
    }

    private async _onReconnectPressed(): Promise<void> {
        console.log(`${TAG} onReconnectPressed | START`);
        this._setButtonsEnabled(false);
        this._statusLabel.string = 'Reconnecting...';

        console.log(`${TAG} onReconnectPressed | calling MWAManager.reauthorize()`);
        const result = await MWAManager.instance?.reauthorize() ?? null;

        console.log(`${TAG} onReconnectPressed | DONE success=${result != null}`);

        if (!result) {
            this._setButtonsEnabled(true);
        }
    }

    // ─── Event Handlers ──────────────────────────────────────────────

    private _onAuthorized(pubkey: string): void {
        // Scene transition is handled directly in _onConnectPressed.
        // This handler only updates UI - does NOT call loadScene to avoid double-transition loop.
        console.log(`${TAG} onAuthorized | pubkey=${pubkey} (event received, scene transition handled by caller)`);
        showToast(`Connected: ${pubkey.substring(0, 4)}...${pubkey.substring(pubkey.length - 4)}`);
    }

    private _onAuthFailed(error: string): void {
        console.log(`${TAG} onAuthFailed | error=${error}`);
        this._statusLabel.string = `Failed: ${error}`;
        this._setButtonsEnabled(true);
    }

    private _onStatusUpdated(message: string): void {
        console.log(`${TAG} onStatusUpdated | ${message}`);
        this._statusLabel.string = message;
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    private _setButtonsEnabled(enabled: boolean): void {
        console.log(`${TAG} _setButtonsEnabled | enabled=${enabled}`);
        if (this._connectButton) this._connectButton.interactable = enabled;
        if (this._reconnectButton) this._reconnectButton.interactable = enabled;
    }
}

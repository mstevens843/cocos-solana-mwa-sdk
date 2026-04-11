/**
 * AppUI.ts — Single unified UI controller for Landing + Home panels.
 *
 * Replaces LandingUI + HomeUI to avoid scene transition bugs.
 * Both panels exist in one scene — show/hide based on connection state.
 */

import { _decorator, Component, Label, Button, Node } from 'cc';
import { MWAManager } from '../../solana-mwa/scripts/MWAManager';
import { SolanaRpc } from '../../solana-mwa/scripts/SolanaRpc';
import { buildMemoTransaction } from '../../solana-mwa/scripts/TransactionBuilder';
import { MWA_AUTHORIZED, MWA_AUTH_FAILED, MWA_DISCONNECTED, MWA_STATUS } from '../../solana-mwa/scripts/MWAEvents';
import { getAppIdentity } from '../../solana-mwa/scripts/AppIdentity';
import { showToast } from './AndroidToast';

const { ccclass } = _decorator;
const TAG = '[AppUI]';

@ccclass('AppUI')
export class AppUI extends Component {

    // Panels
    private _landingPanel: Node = null!;
    private _homePanel: Node = null!;

    // Landing elements
    private _connectButton: Button = null!;
    private _reconnectButton: Button = null!;
    private _landingStatus: Label = null!;

    // Home elements
    private _pubkeyLabel: Label = null!;
    private _homeStatus: Label = null!;
    private _allHomeButtons: Button[] = [];

    // RPC
    private _rpc!: SolanaRpc;

    start(): void {
        console.log(`${TAG} start | START`);

        // Find panels
        this._landingPanel = this.node.getChildByName('LandingPanel')!;
        this._homePanel = this.node.getChildByName('HomePanel')!;

        if (!this._landingPanel || !this._homePanel) {
            console.log(`${TAG} start | FAIL panels not found landing=${!!this._landingPanel} home=${!!this._homePanel}`);
            return;
        }

        // Landing elements
        this._connectButton = this._landingPanel.getChildByName('ConnectButton')?.getComponent(Button)!;
        this._reconnectButton = this._landingPanel.getChildByName('ReconnectButton')?.getComponent(Button)!;
        this._landingStatus = this._landingPanel.getChildByName('StatusLabel')?.getComponent(Label)!;

        // Home elements
        this._pubkeyLabel = this._homePanel.getChildByName('PubkeyLabel')?.getComponent(Label)!;
        this._homeStatus = this._homePanel.getChildByName('HomeStatusLabel')?.getComponent(Label)!;

        // Wire landing buttons
        this._connectButton?.node.on(Button.EventType.CLICK, this._onConnect, this);
        this._reconnectButton?.node.on(Button.EventType.CLICK, this._onReconnect, this);

        // Wire home buttons
        const homeBtnNames = [
            'SignMessageButton', /* 'SignTxButton', */ 'SignSendButton',
            'CapabilitiesButton', 'ReconnectHomeButton', 'DisconnectButton', 'DeleteButton',
        ];
        const homeHandlers = [
            this._onSignMessage, /* this._onSignTx, */ this._onSignAndSend,
            this._onCapabilities, this._onReconnectHome, this._onDisconnect, this._onDelete,
        ];
        for (let i = 0; i < homeBtnNames.length; i++) {
            const node = this._homePanel.getChildByName(homeBtnNames[i]);
            if (node) {
                const btn = node.getComponent(Button);
                if (btn) {
                    this._allHomeButtons.push(btn);
                    btn.node.on(Button.EventType.CLICK, homeHandlers[i], this);
                }
            }
        }

        // MWAManager events
        const mwa = MWAManager.instance;
        if (mwa) {
            mwa.node.on(MWA_STATUS, this._onStatus, this);
            mwa.node.on(MWA_DISCONNECTED, this._showLanding, this);
        }

        // Init RPC
        const identity = getAppIdentity();
        this._rpc = new SolanaRpc(
            identity.cluster === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'
        );

        // Show landing initially
        this._showLanding();

        // Check cached auth
        if (mwa?.cache?.hasCachedAuth()) {
            this._reconnectButton.node.active = true;
            showToast('Cached session found');
        }

        console.log(`${TAG} start | DONE`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PANEL SWITCHING
    // ═══════════════════════════════════════════════════════════════════

    private _showLanding(): void {
        console.log(`${TAG} _showLanding | switching to landing panel`);
        this._landingPanel.active = true;
        this._homePanel.active = false;
        if (this._landingStatus) this._landingStatus.string = 'Tap Connect to link your wallet';
        if (this._reconnectButton) this._reconnectButton.node.active = MWAManager.instance?.cache?.hasCachedAuth() ?? false;
        this._setLandingEnabled(true);
    }

    private _showHome(): void {
        console.log(`${TAG} _showHome | switching to home panel`);
        this._landingPanel.active = false;
        this._homePanel.active = true;
        const pubkey = MWAManager.instance?.connectedPubkey ?? '';
        if (this._pubkeyLabel) {
            this._pubkeyLabel.string = pubkey.length > 8
                ? pubkey.substring(0, 4) + '...' + pubkey.substring(pubkey.length - 4)
                : pubkey || 'Not connected';
        }
        if (this._homeStatus) this._homeStatus.string = 'Connected — choose an action';
        this._setHomeEnabled(true);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  LANDING HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    private async _onConnect(): Promise<void> {
        console.log(`${TAG} onConnect | START`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Opening wallet...';

        const result = await MWAManager.instance?.authorize();
        if (result) {
            console.log(`${TAG} onConnect | SUCCESS — switching to home`);
            showToast(`Connected: ${result.pubkey.substring(0, 4)}...${result.pubkey.substring(result.pubkey.length - 4)}`);
            showToast('Auth cached');
            this._showHome();
        } else {
            console.log(`${TAG} onConnect | FAIL`);
            showToast('Authorization failed');
            this._setLandingEnabled(true);
        }
    }

    private async _onReconnect(): Promise<void> {
        console.log(`${TAG} onReconnect | START`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Reconnecting...';

        const result = await MWAManager.instance?.reauthorize();
        if (result) {
            showToast('Reconnected');
            this._showHome();
        } else {
            showToast('Reconnect failed');
            this._setLandingEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  HOME HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    private async _onSignMessage(): Promise<void> {
        console.log(`${TAG} onSignMessage | START`);
        this._setHomeEnabled(false);
        const sig = await MWAManager.instance!.signMessage('Hello from Cocos MWA SDK!');
        if (this._homeStatus) this._homeStatus.string = sig ? `Signed: ${sig.substring(0, 20)}...` : 'Sign failed';
        if (sig) showToast(`Message Signed!`);
        else showToast('Sign message failed');
        this._setHomeEnabled(true);
    }

    // TODO: discuss Sign Tx vs Sign & Send distinction — MWA v2 has no sign-only endpoint
    // private async _onSignTx(): Promise<void> {
    //     console.log(`${TAG} onSignTx | START`);
    //     this._setHomeEnabled(false);
    //     const bh = await this._rpc.getLatestBlockhash();
    //     if (!bh) { if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash'; this._setHomeEnabled(true); return; }
    //     const tx = buildMemoTransaction(MWAManager.instance!.connectedPubkey, 'Cocos MWA test', bh.blockhash);
    //     const sigs = await MWAManager.instance!.signAndSendTransactions([tx]);
    //     if (this._homeStatus) this._homeStatus.string = sigs.length > 0 ? `Tx sent: ${sigs[0].substring(0, 20)}...` : 'Sign tx failed';
    //     this._setHomeEnabled(true);
    // }

    private async _onSignAndSend(): Promise<void> {
        console.log(`${TAG} onSignAndSend | START`);
        this._setHomeEnabled(false);
        if (this._homeStatus) this._homeStatus.string = 'Fetching blockhash...';
        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) { if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash'; this._setHomeEnabled(true); return; }
        const tx = buildMemoTransaction(MWAManager.instance!.connectedPubkey, 'Hello from Cocos Creator MWA SDK!', bh.blockhash);
        if (this._homeStatus) this._homeStatus.string = 'Signing & sending...';
        const sig = await MWAManager.instance!.signAndSendTransaction(tx);
        if (this._homeStatus) this._homeStatus.string = sig ? `Sent! ${sig.substring(0, 24)}...` : 'Send failed';
        if (sig) showToast(`Transaction Sent!`, true);
        else showToast('Sign & send failed');
        this._setHomeEnabled(true);
    }

    private async _onCapabilities(): Promise<void> {
        console.log(`${TAG} onCapabilities | START`);
        this._setHomeEnabled(false);
        const caps = await MWAManager.instance!.getCapabilities();
        if (this._homeStatus) this._homeStatus.string = caps
            ? `max_txs: ${caps.maxTransactionsPerRequest}\nmax_msgs: ${caps.maxMessagesPerRequest}`
            : 'Failed';
        if (caps) showToast(`Capabilities: max_txs=${caps.maxTransactionsPerRequest}`);
        else showToast('Get capabilities failed');
        this._setHomeEnabled(true);
    }

    private async _onReconnectHome(): Promise<void> {
        console.log(`${TAG} onReconnectHome | START`);
        this._setHomeEnabled(false);
        const result = await MWAManager.instance!.reauthorize();
        if (this._homeStatus) this._homeStatus.string = result ? 'Reconnected' : 'Reconnect failed';
        if (result) showToast('Reconnected');
        else showToast('Reconnect failed');
        this._setHomeEnabled(true);
    }

    private async _onDisconnect(): Promise<void> {
        console.log(`${TAG} onDisconnect | START`);
        await MWAManager.instance!.deauthorize();
        showToast('Disconnected');
        // _showLanding is triggered by MWA_DISCONNECTED event listener (no direct call needed)
    }

    private async _onDelete(): Promise<void> {
        console.log(`${TAG} onDelete | START`);
        this._setHomeEnabled(false);
        await MWAManager.instance!.deleteAccount();
        if (!MWAManager.instance?.isConnected) {
            showToast('Account deleted');
            // _showLanding is triggered by MWA_DISCONNECTED event listener (no direct call needed)
        } else {
            this._setHomeEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STATUS + HELPERS
    // ═══════════════════════════════════════════════════════════════════

    private _onStatus(message: string): void {
        // Update whichever status label is visible
        if (this._landingPanel.active && this._landingStatus) this._landingStatus.string = message;
        if (this._homePanel.active && this._homeStatus) this._homeStatus.string = message;
    }

    private _setLandingEnabled(enabled: boolean): void {
        if (this._connectButton) this._connectButton.interactable = enabled;
        if (this._reconnectButton) this._reconnectButton.interactable = enabled;
    }

    private _setHomeEnabled(enabled: boolean): void {
        for (const btn of this._allHomeButtons) btn.interactable = enabled;
    }
}

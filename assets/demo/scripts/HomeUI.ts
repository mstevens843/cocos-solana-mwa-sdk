/**
 * HomeUI.ts — Home page: connected wallet pubkey and action buttons.
 *
 * Port of:
 *   - Godot: home.gd (144 lines)
 *   - Unity: HomeUI.cs
 *
 * NOTE: Uses getChildByName() to locate UI nodes instead of @property.
 * This eliminates manual inspector wiring — just add this component to Canvas.
 */

import { _decorator, Component, Label, Button, director } from 'cc';
import { MWAManager } from '../../solana-mwa/scripts/MWAManager';
import { SolanaRpc } from '../../solana-mwa/scripts/SolanaRpc';
import { buildMemoTransaction } from '../../solana-mwa/scripts/TransactionBuilder';
import { MWA_DISCONNECTED, MWA_STATUS } from '../../solana-mwa/scripts/MWAEvents';
import { getAppIdentity } from '../../solana-mwa/scripts/AppIdentity';
import { showToast } from './AndroidToast';

const { ccclass } = _decorator;
const TAG = '[HomeUI]';

@ccclass('HomeUI')
export class HomeUI extends Component {

    private _pubkeyLabel: Label = null!;
    private _statusLabel: Label = null!;
    private _allButtons: Button[] = [];
    private _rpc!: SolanaRpc;

    onLoad(): void {
        console.log(`${TAG} onLoad | START`);

        const mwa = MWAManager.instance;
        if (!mwa) {
            console.log(`${TAG} onLoad | FAIL MWAManager.instance is null — returning to Landing`);
            director.loadScene('Landing');
            return;
        }

        // Initialize RPC client
        const identity = getAppIdentity();
        const rpcUrl = identity.cluster === 'mainnet-beta'
            ? 'https://api.mainnet-beta.solana.com'
            : identity.cluster === 'testnet'
                ? 'https://api.testnet.solana.com'
                : 'https://api.devnet.solana.com';
        this._rpc = new SolanaRpc(rpcUrl);

        // Find UI nodes by name
        const pubkeyNode = this.node.getChildByName('PubkeyLabel');
        const statusNode = this.node.getChildByName('StatusLabel');

        this._pubkeyLabel = pubkeyNode?.getComponent(Label)!;
        this._statusLabel = statusNode?.getComponent(Label)!;

        // Display connected pubkey
        const pubkey = mwa.connectedPubkey;
        console.log(`${TAG} onLoad | connected_pubkey=${pubkey} is_connected=${mwa.isConnected}`);

        if (this._pubkeyLabel) {
            if (pubkey && pubkey.length > 8) {
                this._pubkeyLabel.string = pubkey.substring(0, 4) + '...' + pubkey.substring(pubkey.length - 4);
            } else {
                this._pubkeyLabel.string = pubkey || 'Not connected';
            }
        }

        // Find and wire all buttons
        const buttonNames = [
            'SignMessageButton', 'SignTxButton', 'SignSendButton',
            'CapabilitiesButton', 'ReconnectButton', 'DisconnectButton', 'DeleteButton',
        ];
        const handlers = [
            this._onSignMessage, this._onSignTransaction, this._onSignAndSend,
            this._onGetCapabilities, this._onReconnect, this._onDisconnect, this._onDeleteAccount,
        ];

        for (let i = 0; i < buttonNames.length; i++) {
            const node = this.node.getChildByName(buttonNames[i]);
            if (node) {
                const btn = node.getComponent(Button);
                if (btn) {
                    this._allButtons.push(btn);
                    btn.node.on(Button.EventType.CLICK, handlers[i], this);
                    console.log(`${TAG} onLoad | wired button=${buttonNames[i]}`);
                }
            } else {
                console.log(`${TAG} onLoad | WARN button not found: ${buttonNames[i]}`);
            }
        }

        // Listen for MWAManager events
        mwa.node.on(MWA_DISCONNECTED, this._onDisconnected, this);
        mwa.node.on(MWA_STATUS, this._onStatusUpdated, this);

        if (this._statusLabel) this._statusLabel.string = 'Connected — choose an action';
        console.log(`${TAG} onLoad | DONE buttons_wired=${this._allButtons.length}`);
    }

    onDestroy(): void {
        console.log(`${TAG} onDestroy | START`);
        for (const btn of this._allButtons) {
            btn.node.off(Button.EventType.CLICK);
        }
        const mwa = MWAManager.instance;
        if (mwa) {
            mwa.node.off(MWA_DISCONNECTED, this._onDisconnected, this);
            mwa.node.off(MWA_STATUS, this._onStatusUpdated, this);
        }
        console.log(`${TAG} onDestroy | DONE`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  BUTTON HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    private async _onSignMessage(): Promise<void> {
        console.log(`${TAG} onSignMessage | START`);
        this._setButtonsEnabled(false);

        const sig = await MWAManager.instance!.signMessage('Hello from Cocos MWA Example App!');
        if (sig) {
            console.log(`${TAG} onSignMessage | SUCCESS sig=${sig.substring(0, 20)}...`);
            this._statusLabel.string = `Signed: ${sig.substring(0, 20)}...`;
            showToast(`Signed: ${sig.substring(0, 16)}...`);
        } else {
            console.log(`${TAG} onSignMessage | FAIL empty signature`);
            this._statusLabel.string = 'Sign message failed';
        }
        this._setButtonsEnabled(true);
    }

    private async _onSignTransaction(): Promise<void> {
        console.log(`${TAG} onSignTransaction | START`);
        this._setButtonsEnabled(false);

        const blockhashResult = await this._rpc.getLatestBlockhash();
        if (!blockhashResult) {
            this._statusLabel.string = 'Failed to get recent blockhash';
            this._setButtonsEnabled(true);
            return;
        }

        const pubkey = MWAManager.instance!.connectedPubkey;
        const tx = buildMemoTransaction(pubkey, 'Cocos MWA: Sign Transaction test', blockhashResult.blockhash);
        if (tx.length === 0) {
            this._statusLabel.string = 'Failed to build transaction';
            this._setButtonsEnabled(true);
            return;
        }

        console.log(`${TAG} onSignTransaction | tx_bytes=${tx.length} — signing & sending`);
        const sigs = await MWAManager.instance!.signAndSendTransactions([tx]);
        if (sigs.length > 0 && sigs[0]) {
            console.log(`${TAG} onSignTransaction | SUCCESS sig=${sigs[0].substring(0, 20)}...`);
            this._statusLabel.string = `Tx signed & sent!\nSig: ${sigs[0].substring(0, 20)}...`;
            showToast(`Transaction sent: ${sigs[0].substring(0, 16)}...`);
        } else {
            this._statusLabel.string = 'Sign transaction failed';
        }
        this._setButtonsEnabled(true);
    }

    private async _onSignAndSend(): Promise<void> {
        console.log(`${TAG} onSignAndSend | START`);
        this._setButtonsEnabled(false);
        this._statusLabel.string = 'Fetching blockhash...';

        const blockhashResult = await this._rpc.getLatestBlockhash();
        if (!blockhashResult) {
            this._statusLabel.string = 'Failed to get recent blockhash';
            this._setButtonsEnabled(true);
            return;
        }

        const pubkey = MWAManager.instance!.connectedPubkey;
        const tx = buildMemoTransaction(pubkey, 'Hello from Cocos Creator MWA SDK!', blockhashResult.blockhash);
        if (tx.length === 0) {
            this._statusLabel.string = 'Failed to build transaction';
            this._setButtonsEnabled(true);
            return;
        }

        this._statusLabel.string = 'Signing & sending...';
        const sig = await MWAManager.instance!.signAndSendTransaction(tx);
        if (sig) {
            console.log(`${TAG} onSignAndSend | SUCCESS sig=${sig.substring(0, 20)}...`);
            this._statusLabel.string = `Sent! Sig:\n${sig.substring(0, 24)}...`;
            showToast(`Transaction sent: ${sig.substring(0, 16)}...`, true);
        } else {
            this._statusLabel.string = 'Sign & send failed';
        }
        this._setButtonsEnabled(true);
    }

    private async _onGetCapabilities(): Promise<void> {
        console.log(`${TAG} onGetCapabilities | START`);
        this._setButtonsEnabled(false);

        const caps = await MWAManager.instance!.getCapabilities();
        if (caps) {
            this._statusLabel.string =
                `Capabilities:\n  max_txs: ${caps.maxTransactionsPerRequest}\n  max_msgs: ${caps.maxMessagesPerRequest}\n  versions: [${caps.supportedTransactionVersions.join(', ')}]`;
            showToast(`Caps: max_txs=${caps.maxTransactionsPerRequest} max_msgs=${caps.maxMessagesPerRequest}`);
        } else {
            this._statusLabel.string = 'Failed to get capabilities';
        }
        this._setButtonsEnabled(true);
    }

    private async _onReconnect(): Promise<void> {
        console.log(`${TAG} onReconnect | START`);
        this._setButtonsEnabled(false);

        const result = await MWAManager.instance!.reauthorize();
        this._statusLabel.string = result ? 'Reconnected successfully' : 'Reconnect failed';
        this._setButtonsEnabled(true);
    }

    private async _onDisconnect(): Promise<void> {
        console.log(`${TAG} onDisconnect | START`);
        await MWAManager.instance!.deauthorize();
    }

    private async _onDeleteAccount(): Promise<void> {
        console.log(`${TAG} onDeleteAccount | START`);
        this._setButtonsEnabled(false);
        await MWAManager.instance!.deleteAccount();
        if (MWAManager.instance?.isConnected) {
            this._setButtonsEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════

    private _onDisconnected(): void {
        console.log(`${TAG} onDisconnected | transitioning to Landing`);
        showToast('Wallet disconnected');
        director.loadScene('Landing');
    }

    private _onStatusUpdated(message: string): void {
        if (this._statusLabel) this._statusLabel.string = message;
    }

    private _setButtonsEnabled(enabled: boolean): void {
        for (const btn of this._allButtons) {
            btn.interactable = enabled;
        }
    }
}

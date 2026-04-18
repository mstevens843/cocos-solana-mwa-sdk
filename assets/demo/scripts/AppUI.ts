/**
 * AppUI.ts — Unified UI controller for Landing + Home panels.
 *
 * Landing: single "Connect Wallet" button → OS picker selects wallet.
 * Home: Sign Message, Sign Tx, Sign & Send, Capabilities, Reconnect, Disconnect, Delete.
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

        // ── Landing elements ──
        this._connectButton = this._landingPanel.getChildByName('ConnectButton')?.getComponent(Button)!;
        this._reconnectButton = this._landingPanel.getChildByName('ReconnectButton')?.getComponent(Button)!;
        this._landingStatus = this._landingPanel.getChildByName('StatusLabel')?.getComponent(Label)!;
        console.log(`${TAG} start | ConnectButton=${!!this._connectButton} ReconnectButton=${!!this._reconnectButton} StatusLabel=${!!this._landingStatus}`);

        this._connectButton?.node.on(Button.EventType.CLICK, this._onConnect, this);
        this._reconnectButton?.node.on(Button.EventType.CLICK, this._onReconnect, this);

        // ── Wire home buttons ──
        const homeBtnNames = [
            'SignMessageButton', 'SignTxButton', 'SignSendButton',
            'CapabilitiesButton', 'DisconnectButton', 'DeleteButton',
        ];
        const homeHandlers = [
            this._onSignMessage, this._onSignTransaction, this._onSignAndSend,
            this._onCapabilities, this._onDisconnect, this._onDelete,
        ];

        this._pubkeyLabel = this._homePanel.getChildByName('PubkeyLabel')?.getComponent(Label)!;
        this._homeStatus = this._homePanel.getChildByName('HomeStatusLabel')?.getComponent(Label)!;

        // Belt-and-suspenders: hide stale ReconnectHomeButton if the scene
        // JSON wasn't regenerated after generate-scenes.js removed it.
        const staleReconnect = this._homePanel.getChildByName('ReconnectHomeButton');
        if (staleReconnect) {
            staleReconnect.active = false;
            console.log(`${TAG} start | hid stale ReconnectHomeButton from scene (scene not yet regenerated)`);
        }

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

        // Pass 10: extensible auth-cache cold-start auto-sign-in. If the
        // user was signed in (not disconnected) when the app was last
        // killed, restore their session silently and land on Home. Any
        // other state (fresh install, explicit disconnect, deleted account)
        // falls through to the Landing panel. See KNOWN_ISSUES.md #15.
        if (mwa?.cache?.hasAutoLoginAuth()) {
            console.log(`${TAG} start | AUTO_SIGN_IN_CANDIDATE cache.hasAutoLoginAuth=true — attempting reauthorize`);
            this._attemptAutoSignIn();
        } else {
            console.log(`${TAG} start | AUTO_SIGN_IN_SKIP cache.hasAutoLoginAuth=false — showing Landing`);
            this._showLanding();
        }

        console.log(`${TAG} start | DONE`);
    }

    /**
     * Restore a signed-in session from the extensible auth cache on cold
     * start. Runs asynchronously so `start()` can return immediately.
     * On success: show Home with a toast acknowledging the cache hit.
     * On failure: fall through to the Landing panel — the cache entry was
     * present but `reauthorize()` couldn't validate it (cleared keys,
     * expired token, etc.). The user can still tap Reconnect from Landing
     * if they want to retry manually.
     */
    private async _attemptAutoSignIn(): Promise<void> {
        const mwa = MWAManager.instance;
        if (!mwa) {
            this._showLanding();
            return;
        }
        try {
            const result = await mwa.reauthorize();
            if (result) {
                console.log(`${TAG} _attemptAutoSignIn | SUCCESS pubkey=${result.pubkey} — showing Home`);
                showToast('Extensible auth cache — session restored', true);
                this._showHome();
            } else {
                console.log(`${TAG} _attemptAutoSignIn | FAIL reauthorize returned null — showing Landing`);
                this._showLanding();
            }
        } catch (e: any) {
            console.log(`${TAG} _attemptAutoSignIn | EXCEPTION err=${e?.message || e} — showing Landing`);
            this._showLanding();
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PANEL SWITCHING
    // ═══════════════════════════════════════════════════════════════════

    private _showLanding(): void {
        const hasCached = MWAManager.instance?.cache?.hasCachedAuth() ?? false;
        console.log(`${TAG} _showLanding | hasCached=${hasCached}`);
        this._landingPanel.active = true;
        this._homePanel.active = false;
        if (this._landingStatus) this._landingStatus.string = 'Tap Connect to link your wallet';
        if (this._reconnectButton) this._reconnectButton.node.active = hasCached;
        this._setLandingEnabled(true);
    }

    private _showHome(): void {
        console.log(`${TAG} _showHome | switching to home panel`);
        this._landingPanel.active = false;
        this._homePanel.active = true;
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey ?? '';
        if (this._pubkeyLabel) {
            const short = pubkey.length > 8
                ? pubkey.substring(0, 4) + '...' + pubkey.substring(pubkey.length - 4)
                : pubkey || 'Not connected';
            const walletName = mwa?.walletDisplayName() ?? '';
            this._pubkeyLabel.string = walletName ? `${short} (${walletName})` : short;
        }
        if (this._homeStatus) this._homeStatus.string = 'Connected \u2014 choose an action';
        this._setHomeEnabled(true);

        // Hide Sign Message button on wallets that don't implement sign_messages
        // (Phantom, Solflare). See MWAManager.supportsSignMessages() and
        // KNOWN_ISSUES.md #11 for the evidence.
        const signMsgBtnNode = this._homePanel.getChildByName('SignMessageButton');
        if (signMsgBtnNode) {
            const supported = mwa?.supportsSignMessages() ?? true;
            signMsgBtnNode.active = supported;
            if (!supported) {
                console.log(`${TAG} _showHome | hiding SignMessageButton — wallet doesn't declare sign_messages support (pkg="${mwa?.connectedWalletPackage || '(unknown)'}")`);
            }
        }
        console.log(`${TAG} _showHome | DONE pubkey=${this._pubkeyLabel?.string}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  LANDING HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    private async _onConnect(): Promise<void> {
        console.log(`${TAG} onConnect | START — opening OS wallet picker`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Opening wallet...';

        const result = await MWAManager.instance?.authorize();
        if (result) {
            // Pass 10: `authorize()` delegates to `authorizeSiws()` when a
            // SIWS identity is configured (DemoAppConfig enables this). The
            // returned shape may include `signInResult` — if it does, the
            // wallet produced a CAIP-122 proof-of-ownership signature (native
            // from Backpack; fallback from Jupiter / Seed Vault). Phantom and
            // Solflare degrade to a plain authorize session without SIWS
            // (sign_messages fallback times out at 15 s — KNOWN_ISSUES #11).
            const siwsResult = (result as any).signInResult;
            const hasSiws = siwsResult && siwsResult.signature && siwsResult.signature.length > 0;
            console.log(`${TAG} onConnect | SUCCESS pubkey=${result.pubkey} authToken_len=${result.authToken?.length ?? 0} siws=${hasSiws ? 'yes' : 'no'} siws_sig_len=${siwsResult?.signature?.length ?? 0}`);
            const shortPk = `${result.pubkey.substring(0, 4)}...${result.pubkey.substring(result.pubkey.length - 4)}`;
            if (hasSiws) {
                showToast(`Signed in with Solana: ${shortPk}`, true);
            } else {
                showToast(`Connected: ${shortPk}`);
                showToast('Auth cached');
            }
            this._showHome();
        } else {
            console.log(`${TAG} onConnect | FAIL result=null`);
            showToast('Authorization failed');
            if (this._landingStatus) this._landingStatus.string = 'Authorization failed';
            this._setLandingEnabled(true);
        }
    }

    private async _onReconnect(): Promise<void> {
        console.log(`${TAG} onReconnect | START`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Reconnecting...';

        const result = await MWAManager.instance?.reauthorize();
        if (result) {
            console.log(`${TAG} onReconnect | SUCCESS pubkey=${result.pubkey}`);
            showToast('Reconnected');
            this._showHome();
        } else {
            console.log(`${TAG} onReconnect | FAIL result=null`);
            showToast('Reconnect failed');
            if (this._landingStatus) this._landingStatus.string = 'Reconnect failed';
            this._setLandingEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  HOME HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    private async _onSignMessage(): Promise<void> {
        console.log(`${TAG} onSignMessage | START`);
        this._setHomeEnabled(false);
        const mwa = MWAManager.instance!;
        const sig = await mwa.signMessage('Hello from Cocos MWA SDK!');
        console.log(`${TAG} onSignMessage | RESULT sig_len=${sig?.length ?? 0} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (this._homeStatus) this._homeStatus.string = sig ? `Signed: ${sig.substring(0, 20)}...` : 'Sign failed';
        if (sig) {
            showToast('Message Signed!');
        } else if (mwa.lastError?.code === 'UNSUPPORTED') {
            // Wallet declared no sign_messages support, or static map flagged it. See KNOWN_ISSUES.md #11.
            showToast("This wallet doesn't support sign_messages — try Backpack or Jupiter", true);
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            // Wallet didn't respond — usually means it silently doesn't implement the method. See KNOWN_ISSUES.md #11.
            showToast("Wallet didn't respond — may not support this operation. Try Backpack or Jupiter", true);
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            // Wallet closed WebSocket without reply — Solflare-class crash or unsupported method. See KNOWN_ISSUES.md #6/#11.
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13: user picked a different wallet in the OS picker than the
            // one that issued the cached authToken. See KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
        } else {
            showToast('Sign message failed');
        }
        this._setHomeEnabled(true);
    }

    private async _onSignTransaction(): Promise<void> {
        console.log(`${TAG} onSignTransaction | START`);
        this._setHomeEnabled(false);
        if (this._homeStatus) this._homeStatus.string = 'Fetching blockhash...';
        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onSignTransaction | FAIL blockhash=null`);
            if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash';
            this._setHomeEnabled(true);
            return;
        }
        const tx = buildMemoTransaction(MWAManager.instance!.connectedPubkey, 'Hello from Cocos Creator MWA SDK!', bh.blockhash);
        console.log(`${TAG} onSignTransaction | built_tx_bytes=${tx.length}`);
        if (this._homeStatus) this._homeStatus.string = 'Approve in wallet...';
        const mwa = MWAManager.instance!;
        const signed = await mwa.signTransaction(tx);
        console.log(`${TAG} onSignTransaction | RESULT signed_bytes=${signed.length} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (this._homeStatus) this._homeStatus.string = signed.length > 0
            ? 'Transaction signed successfully!'
            : 'Sign transaction failed';
        if (signed.length > 0) {
            showToast('Transaction Signed!');
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13 — KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
        } else {
            showToast('Sign transaction failed');
        }
        this._setHomeEnabled(true);
    }

    private async _onSignAndSend(): Promise<void> {
        console.log(`${TAG} onSignAndSend | START`);
        this._setHomeEnabled(false);
        if (this._homeStatus) this._homeStatus.string = 'Fetching blockhash...';
        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onSignAndSend | FAIL blockhash=null`);
            if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash';
            this._setHomeEnabled(true);
            return;
        }
        const mwa = MWAManager.instance!;
        const tx = buildMemoTransaction(mwa.connectedPubkey, 'Hello from Cocos Creator MWA SDK!', bh.blockhash);
        console.log(`${TAG} onSignAndSend | built_tx_bytes=${tx.length}`);
        if (this._homeStatus) this._homeStatus.string = 'Signing & sending...';
        const sig = await mwa.signAndSendTransaction(tx);
        console.log(`${TAG} onSignAndSend | RESULT sig=${sig || '(empty)'} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (this._homeStatus) this._homeStatus.string = sig ? `Sent! ${sig.substring(0, 24)}...` : 'Send failed';
        if (sig) {
            showToast('Transaction Sent!', true);
        } else if (mwa.lastError?.code === 'INSUFFICIENT_FUNDS_FOR_RENT') {
            // Fee-payer is below rent-exempt minimum + fee + priority-fee buffer.
            // Seed Vault's wrapper injects priority-fee instructions which raises
            // the required balance. See KNOWN_ISSUES.md #13.
            showToast('Fee-payer account underfunded — send ≥0.001 SOL and retry', true);
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting or a different wallet", true);
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            // Wallet crashed during signing (Solflare-class bug). See KNOWN_ISSUES.md #6.
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
        } else if (mwa.lastError?.code === 'RPC_BROADCAST_FAILED') {
            showToast('Sign succeeded but RPC broadcast was rejected', true);
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13 — KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
        } else {
            showToast('Sign & send failed');
        }
        this._setHomeEnabled(true);
    }

    private async _onCapabilities(): Promise<void> {
        console.log(`${TAG} onCapabilities | START`);
        this._setHomeEnabled(false);
        const caps = await MWAManager.instance!.getCapabilities();
        console.log(`${TAG} onCapabilities | RESULT success=${caps != null}`);
        if (this._homeStatus) this._homeStatus.string = caps
            ? `max_txs: ${caps.maxTransactionsPerRequest}\nmax_msgs: ${caps.maxMessagesPerRequest}`
            : 'Failed';
        if (caps) showToast(`Capabilities: max_txs=${caps.maxTransactionsPerRequest}`);
        else showToast('Get capabilities failed');
        this._setHomeEnabled(true);
    }

    private async _onDisconnect(): Promise<void> {
        console.log(`${TAG} onDisconnect | START`);
        await MWAManager.instance!.deauthorize();
        console.log(`${TAG} onDisconnect | DONE`);
        showToast('Disconnected');
    }

    private async _onDelete(): Promise<void> {
        const mwa = MWAManager.instance!;
        console.log(`${TAG} onDelete | START pubkey=${mwa.connectedPubkey}`);
        this._setHomeEnabled(false);
        await mwa.deleteAccount();
        console.log(`${TAG} onDelete | DONE isConnected=${mwa.isConnected} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (!mwa.isConnected) {
            showToast('Account deleted');
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting or a different wallet", true);
            this._setHomeEnabled(true);
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            // Wallet crashed during sign confirmation — see KNOWN_ISSUES.md #6/#11.
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
            this._setHomeEnabled(true);
        } else if (mwa.lastError?.code === 'RPC_BLOCKHASH_FAILED') {
            showToast('Delete failed — could not reach Solana RPC', true);
            this._setHomeEnabled(true);
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13 — user picked a different wallet in the OS picker than
            // the one that issued the cached authToken. KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
            this._setHomeEnabled(true);
        } else {
            this._setHomeEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STATUS + HELPERS
    // ═══════════════════════════════════════════════════════════════════

    private _onStatus(message: string): void {
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

/**
 * AppUI.ts — Single unified UI controller for Landing + Home panels.
 *
 * Replaces LandingUI + HomeUI to avoid scene transition bugs.
 * Both panels exist in one scene — show/hide based on connection state.
 *
 * Landing panel has:
 *   - TabBar (visible on Seeker/Saga only) with Seed Vault + Wallets tabs
 *   - SeedVaultPanel: Connect via Seed Vault (existing flow)
 *   - WalletListPanel: Phantom, Backpack, Solflare, Espresso Cash buttons
 *   - On non-Seeker: tabs hidden, wallet list shown directly
 */

import { _decorator, Component, Label, Button, Node, Sprite, Color } from 'cc';
import { MWAManager } from '../../solana-mwa/scripts/MWAManager';
import { SolanaRpc } from '../../solana-mwa/scripts/SolanaRpc';
import { buildMemoTransaction } from '../../solana-mwa/scripts/TransactionBuilder';
import { MWA_AUTHORIZED, MWA_AUTH_FAILED, MWA_DISCONNECTED, MWA_STATUS } from '../../solana-mwa/scripts/MWAEvents';
import { getAppIdentity } from '../../solana-mwa/scripts/AppIdentity';
import { WalletInfo, DeviceInfo } from '../../solana-mwa/scripts/MWATypes';
import { showToast } from './AndroidToast';

const { ccclass } = _decorator;
const TAG = '[AppUI]';

/** Wallet button config — maps scene node names to Android package names. */
const WALLET_BUTTONS = [
    { nodeName: 'PhantomButton',  pkg: 'app.phantom' },
    { nodeName: 'BackpackButton', pkg: 'app.backpack' },
    { nodeName: 'SolflareButton', pkg: 'com.solflare.mobile' },
    { nodeName: 'EspressoButton', pkg: 'com.pleasecrypto.flutter' },
    { nodeName: 'JupiterButton',  pkg: 'ag.jup.app' },
];

@ccclass('AppUI')
export class AppUI extends Component {

    // Panels
    private _landingPanel: Node = null!;
    private _homePanel: Node = null!;

    // Tab bar (Seeker/Saga only)
    private _tabBar: Node = null!;
    private _seedVaultTab: Button = null!;
    private _walletTab: Button = null!;

    // Sub-panels within Landing
    private _seedVaultPanel: Node = null!;
    private _walletListPanel: Node = null!;

    // Seed Vault panel elements
    private _connectButton: Button = null!;
    private _connectViaWalletButton: Button = null!;
    private _reconnectButton: Button = null!;
    private _landingStatus: Label = null!;

    // Wallet list elements
    private _walletButtons: Map<string, Button> = new Map();
    private _walletStatusLabel: Label = null!;

    // Home elements
    private _pubkeyLabel: Label = null!;
    private _homeStatus: Label = null!;
    private _allHomeButtons: Button[] = [];

    // RPC
    private _rpc!: SolanaRpc;

    // Wallet adapter state
    private _wallets: WalletInfo[] = [];
    private _deviceInfo: DeviceInfo = { isSeeker: false, isSaga: false, isSolanaMobile: false, manufacturer: '', model: '' };
    private _adapterReady: boolean = false;

    start(): void {
        console.log(`${TAG} start | START`);

        // Find panels
        this._landingPanel = this.node.getChildByName('LandingPanel')!;
        this._homePanel = this.node.getChildByName('HomePanel')!;

        if (!this._landingPanel || !this._homePanel) {
            console.log(`${TAG} start | FAIL panels not found landing=${!!this._landingPanel} home=${!!this._homePanel}`);
            return;
        }

        // ── Tab bar ──
        this._tabBar = this._landingPanel.getChildByName('TabBar')!;
        console.log(`${TAG} start | TabBar found=${!!this._tabBar}`);
        if (this._tabBar) {
            this._seedVaultTab = this._tabBar.getChildByName('SeedVaultTab')?.getComponent(Button)!;
            this._walletTab = this._tabBar.getChildByName('WalletTab')?.getComponent(Button)!;
            console.log(`${TAG} start | SeedVaultTab found=${!!this._seedVaultTab} WalletTab found=${!!this._walletTab}`);
            this._seedVaultTab?.node.on(Button.EventType.CLICK, this._onSeedVaultTab, this);
            this._walletTab?.node.on(Button.EventType.CLICK, this._onWalletTab, this);
        }

        // ── Sub-panels ──
        this._seedVaultPanel = this._landingPanel.getChildByName('SeedVaultPanel')!;
        this._walletListPanel = this._landingPanel.getChildByName('WalletListPanel')!;
        console.log(`${TAG} start | SeedVaultPanel found=${!!this._seedVaultPanel} WalletListPanel found=${!!this._walletListPanel}`);

        // ── Seed Vault panel elements ──
        if (this._seedVaultPanel) {
            this._connectButton = this._seedVaultPanel.getChildByName('ConnectButton')?.getComponent(Button)!;
            this._connectViaWalletButton = this._seedVaultPanel.getChildByName('ConnectViaWalletButton')?.getComponent(Button)!;
            this._reconnectButton = this._seedVaultPanel.getChildByName('ReconnectButton')?.getComponent(Button)!;
            this._landingStatus = this._seedVaultPanel.getChildByName('StatusLabel')?.getComponent(Label)!;
            console.log(`${TAG} start | SeedVault elements: ConnectButton=${!!this._connectButton} ConnectViaWalletButton=${!!this._connectViaWalletButton} ReconnectButton=${!!this._reconnectButton} StatusLabel=${!!this._landingStatus}`);

            this._connectButton?.node.on(Button.EventType.CLICK, this._onConnect, this);
            this._connectViaWalletButton?.node.on(Button.EventType.CLICK, this._onConnectViaWallet, this);
            this._reconnectButton?.node.on(Button.EventType.CLICK, this._onReconnect, this);
        }

        // ── Wallet list elements ──
        if (this._walletListPanel) {
            this._walletStatusLabel = this._walletListPanel.getChildByName('WalletStatusLabel')?.getComponent(Label)!;
            console.log(`${TAG} start | WalletStatusLabel found=${!!this._walletStatusLabel}`);

            for (const cfg of WALLET_BUTTONS) {
                const node = this._walletListPanel.getChildByName(cfg.nodeName);
                const btn = node?.getComponent(Button);
                console.log(`${TAG} start | wallet button ${cfg.nodeName} (${cfg.pkg}): node_found=${!!node} btn_found=${!!btn}`);
                if (node && btn) {
                    this._walletButtons.set(cfg.pkg, btn);
                    btn.node.on(Button.EventType.CLICK, () => this._onWalletTapped(cfg.pkg), this);
                }
            }
            console.log(`${TAG} start | wallet buttons wired: ${this._walletButtons.size}/4`);
        }

        // ── Wire home buttons ──
        const homeBtnNames = [
            'SignMessageButton', 'SignTxButton', 'SignSendButton',
            'CapabilitiesButton', 'ReconnectHomeButton', 'DisconnectButton', 'DeleteButton',
        ];
        const homeHandlers = [
            this._onSignMessage, this._onSignTransaction, this._onSignAndSend,
            this._onCapabilities, this._onReconnectHome, this._onDisconnect, this._onDelete,
        ];

        // Home elements
        this._pubkeyLabel = this._homePanel.getChildByName('PubkeyLabel')?.getComponent(Label)!;
        this._homeStatus = this._homePanel.getChildByName('HomeStatusLabel')?.getComponent(Label)!;

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

        // Check cached auth for Seed Vault reconnect button
        if (mwa?.cache?.hasCachedAuth()) {
            if (this._reconnectButton) this._reconnectButton.node.active = true;
            showToast('Cached session found');
        }

        // Init wallet adapter (async — detect device + wallets)
        this._initWalletAdapter();

        console.log(`${TAG} start | DONE`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  WALLET ADAPTER INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════

    private async _initWalletAdapter(): Promise<void> {
        console.log(`${TAG} _initWalletAdapter | START`);
        const mwa = MWAManager.instance;
        if (!mwa) {
            console.log(`${TAG} _initWalletAdapter | SKIP no MWAManager instance`);
            return;
        }

        // Detect device and wallets in parallel
        const [deviceInfo, wallets] = await Promise.all([
            mwa.detectDevice(),
            mwa.detectWallets(),
        ]);

        this._deviceInfo = deviceInfo;
        this._wallets = wallets;

        console.log(`${TAG} _initWalletAdapter | DEVICE manufacturer="${deviceInfo.manufacturer}" model="${deviceInfo.model}" isSeeker=${deviceInfo.isSeeker} isSaga=${deviceInfo.isSaga} isSolanaMobile=${deviceInfo.isSolanaMobile}`);
        console.log(`${TAG} _initWalletAdapter | WALLETS total=${wallets.length} installed=${wallets.filter(w => w.installed).length}`);
        for (const w of wallets) {
            console.log(`${TAG} _initWalletAdapter |   ${w.name} (${w.packageName}) installed=${w.installed}`);
        }

        // Re-run _showLanding now that adapter is ready — it handles all layout logic
        this._showLanding();

        // Update wallet button states (installed vs not-installed)
        this._updateWalletButtons();

        this._adapterReady = true;
        console.log(`${TAG} _initWalletAdapter | DONE adapterReady=true`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  TAB SWITCHING
    // ═══════════════════════════════════════════════════════════════════

    private _onSeedVaultTab(): void {
        console.log(`${TAG} _onSeedVaultTab`);
        this._showSeedVaultTab();
    }

    private _onWalletTab(): void {
        console.log(`${TAG} _onWalletTab`);
        this._showWalletTab();

        // Re-detect wallets each time user switches to this tab
        // (catches wallets installed after app launch)
        this._refreshWallets();
    }

    private _showSeedVaultTab(): void {
        console.log(`${TAG} _showSeedVaultTab | SeedVaultPanel=visible WalletListPanel=hidden`);
        if (this._seedVaultPanel) this._seedVaultPanel.active = true;
        if (this._walletListPanel) this._walletListPanel.active = false;
        this._updateTabColors(true);
    }

    private _showWalletTab(): void {
        console.log(`${TAG} _showWalletTab | SeedVaultPanel=hidden WalletListPanel=visible`);
        if (this._seedVaultPanel) this._seedVaultPanel.active = false;
        if (this._walletListPanel) this._walletListPanel.active = true;
        this._updateTabColors(false);
    }

    private _updateTabColors(seedVaultActive: boolean): void {
        // Active tab = bright color, inactive = dim grey
        if (this._seedVaultTab) {
            const spr = this._seedVaultTab.node.getComponent(Sprite);
            if (spr) spr.color = seedVaultActive ? new Color(0, 210, 136) : new Color(80, 80, 80);
        }
        if (this._walletTab) {
            const spr = this._walletTab.node.getComponent(Sprite);
            if (spr) spr.color = seedVaultActive ? new Color(80, 80, 80) : new Color(100, 140, 220);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  WALLET LIST
    // ═══════════════════════════════════════════════════════════════════

    private async _refreshWallets(): Promise<void> {
        console.log(`${TAG} _refreshWallets | START`);
        const mwa = MWAManager.instance;
        if (!mwa) {
            console.log(`${TAG} _refreshWallets | SKIP no MWAManager`);
            return;
        }
        this._wallets = await mwa.detectWallets();
        console.log(`${TAG} _refreshWallets | DONE total=${this._wallets.length} installed=${this._wallets.filter(w => w.installed).length}`);
        this._updateWalletButtons();
    }

    private _updateWalletButtons(): void {
        console.log(`${TAG} _updateWalletButtons | START wallet_count=${this._wallets.length} button_count=${this._walletButtons.size}`);

        for (const wallet of this._wallets) {
            const btn = this._walletButtons.get(wallet.packageName);
            if (!btn) {
                console.log(`${TAG} _updateWalletButtons | WARN no button mapped for ${wallet.name} (${wallet.packageName})`);
                continue;
            }

            const label = btn.node.getChildByName('Label')?.getComponent(Label);
            const spr = btn.node.getComponent(Sprite);

            if (wallet.installed) {
                btn.interactable = true;
                if (label) label.string = wallet.name;
                if (spr) {
                    const nc = btn.normalColor;
                    spr.color = new Color(nc.r, nc.g, nc.b, 255);
                }
                console.log(`${TAG} _updateWalletButtons | ${wallet.name} → INSTALLED label="${wallet.name}" color=full`);
            } else {
                btn.interactable = true; // still tappable (opens store)
                if (label) label.string = `${wallet.name}  [Install]`;
                if (spr) {
                    const nc = btn.normalColor;
                    spr.color = new Color(
                        Math.floor(nc.r * 0.4),
                        Math.floor(nc.g * 0.4),
                        Math.floor(nc.b * 0.4),
                        160
                    );
                }
                console.log(`${TAG} _updateWalletButtons | ${wallet.name} → NOT_INSTALLED label="${wallet.name}  [Install]" color=dimmed`);
            }
        }

        const installedCount = this._wallets.filter(w => w.installed).length;
        const statusMsg = this._wallets.length === 0
            ? 'Detecting wallets...'
            : installedCount > 0
                ? `${installedCount} wallet(s) detected`
                : 'No MWA wallets installed \u2014 tap to install';

        if (this._walletStatusLabel) {
            this._walletStatusLabel.string = statusMsg;
        }
        console.log(`${TAG} _updateWalletButtons | DONE status="${statusMsg}"`)
    }

    private async _onWalletTapped(packageName: string): Promise<void> {
        console.log(`${TAG} _onWalletTapped | START pkg=${packageName} wallets_loaded=${this._wallets.length}`);
        const wallet = this._wallets.find(w => w.packageName === packageName);
        if (!wallet) {
            console.log(`${TAG} _onWalletTapped | ABORT wallet data not found for pkg=${packageName} — _wallets has: [${this._wallets.map(w => w.packageName).join(', ')}]`);
            return;
        }

        console.log(`${TAG} _onWalletTapped | WALLET name="${wallet.name}" pkg=${wallet.packageName} installed=${wallet.installed} storeUrl=${wallet.storeUrl}`);

        if (wallet.installed) {
            console.log(`${TAG} _onWalletTapped | ACTION=connect — calling authorizeWithWallet("${packageName}")`);
            this._setLandingEnabled(false);
            if (this._walletStatusLabel) this._walletStatusLabel.string = `Connecting to ${wallet.name}...`;

            const result = await MWAManager.instance?.authorizeWithWallet(packageName);
            if (result) {
                console.log(`${TAG} _onWalletTapped | RESULT=SUCCESS wallet="${wallet.name}" pubkey=${result.pubkey} authToken_len=${result.authToken?.length ?? 0}`);
                showToast(`Connected via ${wallet.name}`);
                showToast('Auth cached');
                this._showHome();
            } else {
                console.log(`${TAG} _onWalletTapped | RESULT=FAIL wallet="${wallet.name}" — authorizeWithWallet returned null`);
                showToast(`${wallet.name} connection failed`);
                if (this._walletStatusLabel) this._walletStatusLabel.string = `${wallet.name} connection failed`;
                this._setLandingEnabled(true);
            }
        } else {
            console.log(`${TAG} _onWalletTapped | ACTION=install — opening Play Store url=${wallet.storeUrl}`);
            showToast(`Opening Play Store for ${wallet.name}`);
            await MWAManager.instance?.openUrl(wallet.storeUrl);
            console.log(`${TAG} _onWalletTapped | DONE store intent launched for ${wallet.name}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PANEL SWITCHING
    // ═══════════════════════════════════════════════════════════════════

    private _showLanding(): void {
        const hasCached = MWAManager.instance?.cache?.hasCachedAuth() ?? false;
        console.log(`${TAG} _showLanding | START adapterReady=${this._adapterReady} hasCached=${hasCached} isSeeker=${this._deviceInfo.isSeeker} isSaga=${this._deviceInfo.isSaga}`);
        this._landingPanel.active = true;
        this._homePanel.active = false;
        if (this._landingStatus) this._landingStatus.string = 'Tap Connect to link your wallet';
        if (this._reconnectButton) this._reconnectButton.node.active = hasCached;
        this._setLandingEnabled(true);

        // Mutually exclusive visibility: TabBar (side-by-side) vs stacked buttons — NEVER both
        if (this._adapterReady) {
            const isSeeker = this._deviceInfo.isSeeker || this._deviceInfo.isSaga;

            if (isSeeker && hasCached) {
                // CACHED SEEKER: side-by-side tabs + Reconnect. NO stacked buttons.
                console.log(`${TAG} _showLanding | LAYOUT=cached_seeker — TabBar=visible, stacked=hidden, Reconnect=visible`);
                if (this._tabBar) this._tabBar.active = true;
                if (this._connectButton) this._connectButton.node.active = false;
                if (this._connectViaWalletButton) this._connectViaWalletButton.node.active = false;
                if (this._reconnectButton) {
                    this._reconnectButton.node.active = true;
                    // Keep Reconnect at default position, move TabBar down instead
                    this._reconnectButton.node.setPosition(0, -100, 0);
                }
                // Move TabBar down closer to Reconnect (default y=240 is too high)
                if (this._tabBar) this._tabBar.node.setPosition(0, 20, 0);
                if (this._seedVaultPanel) this._seedVaultPanel.active = true;
                if (this._walletListPanel) this._walletListPanel.active = false;
                this._showSeedVaultTab();
            } else if (isSeeker && !hasCached) {
                // FRESH SEEKER: stacked full-width buttons. NO side-by-side tabs.
                console.log(`${TAG} _showLanding | LAYOUT=fresh_seeker — TabBar=hidden, stacked=visible, Reconnect=hidden`);
                if (this._tabBar) this._tabBar.active = false;
                if (this._connectButton) this._connectButton.node.active = true;
                if (this._connectViaWalletButton) this._connectViaWalletButton.node.active = true;
                if (this._reconnectButton) {
                    this._reconnectButton.node.active = false;
                    this._reconnectButton.node.setPosition(0, -100, 0);
                }
                // Reset TabBar position back to default
                if (this._tabBar) this._tabBar.node.setPosition(0, 240, 0);
                if (this._seedVaultPanel) this._seedVaultPanel.active = true;
                if (this._walletListPanel) this._walletListPanel.active = false;
            } else {
                // NON-SEEKER: wallet list only
                console.log(`${TAG} _showLanding | LAYOUT=generic — everything hidden except WalletListPanel`);
                if (this._tabBar) this._tabBar.active = false;
                if (this._seedVaultPanel) this._seedVaultPanel.active = false;
                if (this._walletListPanel) this._walletListPanel.active = true;
            }
        } else {
            console.log(`${TAG} _showLanding | LAYOUT=scene_defaults — adapter not ready yet, skipping sub-panel logic`);
        }
        console.log(`${TAG} _showLanding | DONE`);
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
        console.log(`${TAG} _showHome | DONE pubkeyLabel="${this._pubkeyLabel?.string}" walletPackage=${MWAManager.instance?.connectedWalletPackage || '(default)'}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  LANDING HANDLERS (Seed Vault flow)
    // ═══════════════════════════════════════════════════════════════════

    private async _onConnect(): Promise<void> {
        console.log(`${TAG} onConnect | START`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Opening wallet...';

        const result = await MWAManager.instance?.authorize();
        if (result) {
            console.log(`${TAG} onConnect | SUCCESS pubkey=${result.pubkey} authToken_len=${result.authToken?.length ?? 0} walletUriBase=${result.walletUriBase || '(empty)'}`);
            showToast(`Connected: ${result.pubkey.substring(0, 4)}...${result.pubkey.substring(result.pubkey.length - 4)}`);
            showToast('Auth cached');
            this._showHome();
        } else {
            console.log(`${TAG} onConnect | FAIL result=null`);
            showToast('Authorization failed');
            this._setLandingEnabled(true);
        }
    }

    private _onConnectViaWallet(): void {
        console.log(`${TAG} _onConnectViaWallet | switching to WalletListPanel`);
        if (this._tabBar) this._tabBar.active = false;
        if (this._seedVaultPanel) this._seedVaultPanel.active = false;
        if (this._walletListPanel) this._walletListPanel.active = true;
        this._refreshWallets();
    }

    private async _onReconnect(): Promise<void> {
        console.log(`${TAG} onReconnect | START`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Reconnecting...';

        const result = await MWAManager.instance?.reauthorize();
        if (result) {
            console.log(`${TAG} onReconnect | SUCCESS pubkey=${result.pubkey} authToken_len=${result.authToken?.length ?? 0}`);
            showToast('Reconnected');
            this._showHome();
        } else {
            console.log(`${TAG} onReconnect | FAIL result=null`);
            showToast('Reconnect failed');
            this._setLandingEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  HOME HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    private async _onSignMessage(): Promise<void> {
        console.log(`${TAG} onSignMessage | START message="Hello from Cocos MWA SDK!" message_len=25`);
        this._setHomeEnabled(false);
        const sig = await MWAManager.instance!.signMessage('Hello from Cocos MWA SDK!');
        console.log(`${TAG} onSignMessage | RESULT sig_len=${sig?.length ?? 0} sig=${sig || '(empty)'}`);
        if (this._homeStatus) this._homeStatus.string = sig ? `Signed: ${sig.substring(0, 20)}...` : 'Sign failed';
        if (sig) showToast(`Message Signed!`);
        else showToast('Sign message failed');
        this._setHomeEnabled(true);
    }

    private async _onSignTransaction(): Promise<void> {
        console.log(`${TAG} onSignTransaction | START pubkey=${MWAManager.instance!.connectedPubkey}`);
        this._setHomeEnabled(false);
        if (this._homeStatus) this._homeStatus.string = 'Fetching blockhash...';
        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onSignTransaction | FAIL blockhash=null`);
            if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash';
            this._setHomeEnabled(true);
            return;
        }
        console.log(`${TAG} onSignTransaction | blockhash=${bh.blockhash} lastValidBlockHeight=${bh.lastValidBlockHeight}`);
        const tx = buildMemoTransaction(MWAManager.instance!.connectedPubkey, 'Hello from Cocos Creator MWA SDK!', bh.blockhash);
        console.log(`${TAG} onSignTransaction | built_tx_bytes=${tx.length}`);
        if (this._homeStatus) this._homeStatus.string = 'Approve in wallet...';
        const signed = await MWAManager.instance!.signTransaction(tx);
        console.log(`${TAG} onSignTransaction | RESULT signed_bytes=${signed.length} success=${signed.length > 0}`);
        if (this._homeStatus) this._homeStatus.string = signed.length > 0
            ? 'Transaction signed successfully!'
            : 'Sign transaction failed';
        if (signed.length > 0) showToast('Transaction Signed!');
        else showToast('Sign transaction failed');
        this._setHomeEnabled(true);
    }

    private async _onSignAndSend(): Promise<void> {
        console.log(`${TAG} onSignAndSend | START pubkey=${MWAManager.instance!.connectedPubkey}`);
        this._setHomeEnabled(false);
        if (this._homeStatus) this._homeStatus.string = 'Fetching blockhash...';
        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onSignAndSend | FAIL blockhash=null`);
            if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash';
            this._setHomeEnabled(true);
            return;
        }
        console.log(`${TAG} onSignAndSend | blockhash=${bh.blockhash} lastValidBlockHeight=${bh.lastValidBlockHeight}`);
        const tx = buildMemoTransaction(MWAManager.instance!.connectedPubkey, 'Hello from Cocos Creator MWA SDK!', bh.blockhash);
        console.log(`${TAG} onSignAndSend | built_tx_bytes=${tx.length}`);
        if (this._homeStatus) this._homeStatus.string = 'Signing & sending...';
        const sig = await MWAManager.instance!.signAndSendTransaction(tx);
        console.log(`${TAG} onSignAndSend | RESULT sig_len=${sig?.length ?? 0} sig=${sig || '(empty)'}`);
        if (this._homeStatus) this._homeStatus.string = sig ? `Sent! ${sig.substring(0, 24)}...` : 'Send failed';
        if (sig) showToast(`Transaction Sent!`, true);
        else showToast('Sign & send failed');
        this._setHomeEnabled(true);
    }

    private async _onCapabilities(): Promise<void> {
        console.log(`${TAG} onCapabilities | START`);
        this._setHomeEnabled(false);
        const caps = await MWAManager.instance!.getCapabilities();
        console.log(`${TAG} onCapabilities | RESULT success=${caps != null} max_txs=${caps?.maxTransactionsPerRequest ?? 'N/A'} max_msgs=${caps?.maxMessagesPerRequest ?? 'N/A'} versions=${JSON.stringify(caps?.supportedTransactionVersions ?? [])} features=${JSON.stringify(caps?.features ?? [])}`);
        if (this._homeStatus) this._homeStatus.string = caps
            ? `max_txs: ${caps.maxTransactionsPerRequest}\nmax_msgs: ${caps.maxMessagesPerRequest}`
            : 'Failed';
        if (caps) showToast(`Capabilities: max_txs=${caps.maxTransactionsPerRequest}`);
        else showToast('Get capabilities failed');
        this._setHomeEnabled(true);
    }

    private async _onReconnectHome(): Promise<void> {
        console.log(`${TAG} onReconnectHome | START current_pubkey=${MWAManager.instance!.connectedPubkey}`);
        this._setHomeEnabled(false);
        const result = await MWAManager.instance!.reauthorize();
        console.log(`${TAG} onReconnectHome | RESULT success=${result != null} pubkey=${result?.pubkey || '(null)'}`);
        if (this._homeStatus) this._homeStatus.string = result ? 'Reconnected' : 'Reconnect failed';
        if (result) showToast('Reconnected');
        else showToast('Reconnect failed');
        this._setHomeEnabled(true);
    }

    private async _onDisconnect(): Promise<void> {
        const mwa = MWAManager.instance!;
        console.log(`${TAG} onDisconnect | START pubkey=${mwa.connectedPubkey} walletPackage=${mwa.connectedWalletPackage || '(default)'} authToken_len=${mwa.authToken?.length ?? 0}`);
        await mwa.deauthorize();
        console.log(`${TAG} onDisconnect | DONE isConnected=${mwa.isConnected}`);
        showToast('Disconnected');
    }

    private async _onDelete(): Promise<void> {
        const mwa = MWAManager.instance!;
        console.log(`${TAG} onDelete | START pubkey=${mwa.connectedPubkey} walletPackage=${mwa.connectedWalletPackage || '(default)'}`);
        this._setHomeEnabled(false);
        await mwa.deleteAccount();
        console.log(`${TAG} onDelete | DONE isConnected=${mwa.isConnected} cache_has_auth=${mwa.cache?.hasCachedAuth() ?? false}`);
        if (!mwa.isConnected) {
            showToast('Account deleted');
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
        console.log(`${TAG} _setLandingEnabled | enabled=${enabled} walletButtons=${this._walletButtons.size}`);
        if (this._connectButton) this._connectButton.interactable = enabled;
        if (this._connectViaWalletButton) this._connectViaWalletButton.interactable = enabled;
        if (this._reconnectButton) this._reconnectButton.interactable = enabled;
        for (const btn of this._walletButtons.values()) {
            btn.interactable = enabled;
        }
    }

    private _setHomeEnabled(enabled: boolean): void {
        for (const btn of this._allHomeButtons) btn.interactable = enabled;
    }
}

/**
 * AppUI.ts — Unified UI controller for Landing + Home panels.
 *
 * Landing: single "Connect Wallet" button → OS picker selects wallet.
 * Home: Sign Message, Sign Tx, Sign & Send, Capabilities, Reconnect, Disconnect, Delete.
 */

import { _decorator, Component, Label, Button, Node, Sprite, Color, EditBox, ScrollView, Slider, SpriteFrame, ImageAsset, Texture2D, assetManager, UITransform, tween, Vec3, Tween } from 'cc';
import { MWAManager } from '../../solana-mwa/scripts/MWAManager';
import { SolanaRpc } from '../../solana-mwa/scripts/SolanaRpc';
import { buildMemoTransaction } from '../../solana-mwa/scripts/TransactionBuilder';
import { AnchorBackend } from '../../token-duel/scripts/AnchorBackend';
import { STAKE_LAMPORTS, STAKE_MIN_SOL, STAKE_MAX_SOL, STAKE_DEFAULT_SOL, FEED_ROW_LIMIT } from '../../token-duel/scripts/constants';
import { MWA_AUTHORIZED, MWA_AUTH_FAILED, MWA_DISCONNECTED, MWA_STATUS } from '../../solana-mwa/scripts/MWAEvents';
import { getAppIdentity } from '../../solana-mwa/scripts/AppIdentity';
import { TokenDuelRpc, Holding } from '../../token-duel/scripts/TokenDuelRpc';
import { TokenDuelGame } from '../../token-duel/scripts/TokenDuelGame';
import { PriceFeed } from '../../token-duel/scripts/PriceFeed';
import { TokenSquad } from '../../token-duel/scripts/TokenSquad';
import { BirdeyeClient } from '../../token-duel/scripts/birdeye/BirdeyeClient';
import { FeedTab, TokenRow } from '../../token-duel/scripts/birdeye/types';
import { showToast } from './AndroidToast';

const { ccclass } = _decorator;
const TAG = '[AppUI]';

@ccclass('AppUI')
export class AppUI extends Component {

    // Panels
    private _landingPanel: Node = null!;
    private _homePanel: Node = null!;
    private _tokenDuelPanel: Node = null!;

    // Landing elements
    private _connectButton: Button = null!;
    private _reconnectButton: Button = null!;
    private _landingStatus: Label = null!;

    // Home elements
    private _pubkeyLabel: Label = null!;
    private _homeStatus: Label = null!;
    private _allHomeButtons: Button[] = [];

    // Token Duel elements
    private _holdingLabels: Label[] = [];
    private _tokenDuelStatus: Label = null!;
    private _tdRpc!: TokenDuelRpc;
    private _cachedHoldings?: Holding[];
    // Session 2: single-button commit replaces Sign + Broadcast. `_signStakeButton`
    // kept as alias for backward compat during the scene-regen transition — it
    // points to whichever of `StakeCommitButton` / `SignStakeButton` the scene
    // exposes. `_signedStakeTx` / `_broadcastStakeButton` deleted — the buffer
    // and second button are no longer needed now that MWAManager.signAndSendTransaction
    // handles sign + broadcast in one wallet prompt.
    private _stakeCommitButton: Button = null!;
    private _signStakeButton: Button = null!; // alias → _stakeCommitButton
    private _stakeCommitSig: string | null = null; // tx signature once committed on-chain
    private _sessionSeed: bigint | null = null; // Phase 6: per-round seed for Anchor PDAs
    private _startGameButton: Button = null!;
    private _gameArea: Node = null!;
    private _heightLabel: Label = null!;
    private _tokenBadgeLabel: Label = null!;
    private _blockTemplate: Sprite = null!;
    private _gameOverLabel: Label = null!;
    private _game: TokenDuelGame | null = null;
    private _priceFeed: PriceFeed | null = null;

    // ── Phase III + Session 3: full Birdeye picker with native Cocos widgets ──
    private _squad: TokenSquad = new TokenSquad();
    private _birdeye: BirdeyeClient | null = null;
    // Balance chip (top-right of panel)
    private _balanceChipLabel: Label | null = null;
    // Search
    private _searchEditBox: EditBox | null = null;
    private _searchClearButton: Button | null = null;
    private _searchDebounceHandle: number | null = null;
    private _searchMode: boolean = false; // true while a search query is active (non-empty)
    // Feed tabs — 4 buttons (trending / gainers / new / top10)
    private _feedTabButtons: Map<FeedTab | 'top10', Button> = new Map();
    private _currentFeedTab: FeedTab | 'top10' = 'trending';
    // Feed row pool — up to FEED_ROW_LIMIT row nodes under ScrollView content.
    private _feedScrollView: ScrollView | null = null;
    private _feedContent: Node | null = null;
    private _feedRowNodes: Node[] = [];
    private _feedRowButtons: Button[] = [];
    private _feedRowSprites: Sprite[] = [];
    private _feedRowLogoSprites: Sprite[] = [];
    private _feedRowSymbolLabels: Label[] = [];
    private _feedRowDeltaLabels: Label[] = [];
    private _currentFeedRows: TokenRow[] = [];
    private _feedPollTimer: number | null = null;
    // Squad slot buttons (3) — label child shows symbol or "+"
    private _squadSlotButtons: Button[] = [];
    private _squadSlotLabels: Label[] = [];
    private _lastSquadDeltas: number[] = [0, 0, 0]; // for pulse diff detection
    // Stake controls — slider is primary; chips snap to presets.
    private _stakeSlider: Slider | null = null;
    private _stakeValueLabel: Label | null = null;
    private _stakeChipButtons: Map<'001' | '010' | '100', Button> = new Map();
    private _selectedStakeLamports: bigint = STAKE_LAMPORTS;
    // Remote logo cache: url → SpriteFrame.
    private _logoCache: Map<string, SpriteFrame> = new Map();
    // Logos in flight: sprite instance → url. Guards against races when a
    // row gets re-rendered before a pending fetch resolves.
    private _logoPending: WeakMap<Sprite, string> = new WeakMap();
    private _claimButton: Button = null!;
    private _lastGameHeight: number = 0;
    private _heroTileButtons: Button[] = [];
    private _heroTileLabels: Label[] = [];
    private _pickedHeroSymbol: string | null = null;
    private _pickedHeroSig: string | null = null;
    private _sessionDeltas: Record<string, number> | null = null;

    // RPC
    private _rpc!: SolanaRpc;

    start(): void {
        console.log(`${TAG} start | START`);

        // Find panels
        this._landingPanel = this.node.getChildByName('LandingPanel')!;
        this._homePanel = this.node.getChildByName('HomePanel')!;
        this._tokenDuelPanel = this.node.getChildByName('TokenDuelPanel')!;

        if (!this._landingPanel || !this._homePanel || !this._tokenDuelPanel) {
            console.log(`${TAG} start | FAIL panels not found landing=${!!this._landingPanel} home=${!!this._homePanel} tokenDuel=${!!this._tokenDuelPanel}`);
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
            'PlayTokenDuelButton',
            'SignMessageButton', 'SignTxButton', 'SignSendButton',
            'CapabilitiesButton', 'DisconnectButton', 'DeleteButton',
        ];
        const homeHandlers = [
            this._onPlayTokenDuel,
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

        // ── Token Duel panel: just the Back button for iteration 2 ──
        const tdBackNode = this._tokenDuelPanel.getChildByName('BackButton');
        const tdBack = tdBackNode?.getComponent(Button);
        if (tdBack) {
            tdBack.node.on(Button.EventType.CLICK, this._onTokenDuelBack, this);
            console.log(`${TAG} start | wired TokenDuel BackButton`);
        } else {
            console.log(`${TAG} start | WARN TokenDuel BackButton not found`);
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

        // Init Token Duel RPC + find holding labels / status.
        this._tdRpc = new TokenDuelRpc();
        const h1 = this._tokenDuelPanel.getChildByName('Holding1Label')?.getComponent(Label);
        const h2 = this._tokenDuelPanel.getChildByName('Holding2Label')?.getComponent(Label);
        const h3 = this._tokenDuelPanel.getChildByName('Holding3Label')?.getComponent(Label);
        this._holdingLabels = [h1, h2, h3].filter((l): l is Label => !!l);
        this._tokenDuelStatus = this._tokenDuelPanel.getChildByName('StatusLabel')?.getComponent(Label)!;
        console.log(`${TAG} start | TokenDuel wiring — holding_labels=${this._holdingLabels.length}/3 statusLabel=${!!this._tokenDuelStatus}`);

        // Stake flow buttons (Phase C)
        // Session 2: resolve commit button under either the new name
        // (StakeCommitButton) or the legacy name (SignStakeButton). After the
        // scene regen only the former exists; keeping the fallback means this
        // code keeps running even if the user rebuilds an old scene.
        const commitNode = this._tokenDuelPanel.getChildByName('StakeCommitButton')
            ?? this._tokenDuelPanel.getChildByName('SignStakeButton');
        this._stakeCommitButton = commitNode?.getComponent(Button)!;
        this._signStakeButton = this._stakeCommitButton; // legacy alias
        this._stakeCommitButton?.node.on(Button.EventType.CLICK, this._onCommitStake, this);
        // Hide any lingering BroadcastStakeButton from a stale scene — handler removed.
        const staleBroadcast = this._tokenDuelPanel.getChildByName('BroadcastStakeButton');
        if (staleBroadcast) {
            staleBroadcast.active = false;
            console.log(`${TAG} start | hid stale BroadcastStakeButton — flow is now single-tap signAndSend`);
        }
        console.log(`${TAG} start | TokenDuel commit button — wired=${!!this._stakeCommitButton} resolved_name=${commitNode?.name ?? '(none)'} stale_broadcast_hidden=${!!staleBroadcast}`);

        // Game loop wiring (Phase D): Start button, GameArea + HUD, BlockTemplate sprite, GameOverLabel.
        this._startGameButton = this._tokenDuelPanel.getChildByName('StartGameButton')?.getComponent(Button)!;
        this._startGameButton?.node.on(Button.EventType.CLICK, this._onStartGame, this);
        this._gameArea = this._tokenDuelPanel.getChildByName('GameArea')!;
        this._heightLabel = this._gameArea?.getChildByName('HeightLabel')?.getComponent(Label)!;
        this._tokenBadgeLabel = this._gameArea?.getChildByName('TokenBadgeLabel')?.getComponent(Label)!;
        this._blockTemplate = this._gameArea?.getChildByName('BlockTemplate')?.getComponent(Sprite)!;
        this._gameOverLabel = this._tokenDuelPanel.getChildByName('GameOverLabel')?.getComponent(Label)!;
        console.log(`${TAG} start | TokenDuel game wiring — start=${!!this._startGameButton} gameArea=${!!this._gameArea} height=${!!this._heightLabel} badge=${!!this._tokenBadgeLabel} blockTpl=${!!this._blockTemplate} gameOver=${!!this._gameOverLabel}`);

        // Tap-to-drop: forward GameArea touches to the active TokenDuelGame.
        this._gameArea?.on(Node.EventType.TOUCH_START, () => {
            if (this._game) this._game.onTap();
        }, this);

        // Phase E: Claim Payout button (revealed on game-over).
        this._claimButton = this._tokenDuelPanel.getChildByName('ClaimPayoutButton')?.getComponent(Button)!;
        this._claimButton?.node.on(Button.EventType.CLICK, this._onClaim, this);
        console.log(`${TAG} start | TokenDuel claim button — wired=${!!this._claimButton}`);

        // Phase F: hero-pick tiles (wallet-gated by sign_messages support).
        for (let i = 1; i <= 3; i++) {
            const node = this._tokenDuelPanel.getChildByName(`HeroTile${i}Button`);
            const btn = node?.getComponent(Button);
            const lbl = node?.getChildByName('Label')?.getComponent(Label);
            if (btn && lbl) {
                this._heroTileButtons.push(btn);
                this._heroTileLabels.push(lbl);
                const idx = i - 1;
                btn.node.on(Button.EventType.CLICK, () => this._onHeroTileClick(idx), this);
            }
        }
        console.log(`${TAG} start | TokenDuel hero tiles — wired=${this._heroTileButtons.length}/3`);

        // ── Session 2 — Phase III wiring: balance chip, feed tabs, feed rows,
        //    squad slots, stake chips. Any missing child is tolerated (scene
        //    regen drift); AppUI simply skips features whose nodes aren't there.
        const balanceNode = this._tokenDuelPanel.getChildByName('BalanceChipLabel');
        this._balanceChipLabel = balanceNode?.getComponent(Label) ?? null;

        const feedTabDefs: Array<{ name: string; tab: FeedTab | 'top10' }> = [
            { name: 'FeedTabTrending', tab: 'trending' },
            { name: 'FeedTabGainers',  tab: 'gainers'  },
            { name: 'FeedTabNew',      tab: 'new'      },
            { name: 'FeedTabTop10',    tab: 'top10'    },
        ];
        let feedTabsWired = 0;
        for (const def of feedTabDefs) {
            const node = this._tokenDuelPanel.getChildByName(def.name);
            const btn = node?.getComponent(Button);
            if (btn) {
                this._feedTabButtons.set(def.tab, btn);
                btn.node.on(Button.EventType.CLICK, () => this._onFeedTabClick(def.tab), this);
                feedTabsWired++;
            }
        }

        // Feed rows live inside the ScrollView's content node.
        const feedSvNode = this._tokenDuelPanel.getChildByName('FeedScrollView');
        this._feedScrollView = feedSvNode?.getComponent(ScrollView) ?? null;
        // content is nested under 'view' (see mkScrollView layout) — locate both.
        const viewNode = feedSvNode?.getChildByName('view');
        this._feedContent = viewNode?.getChildByName('content') ?? null;
        const rowsHost = this._feedContent ?? this._tokenDuelPanel;
        for (let i = 0; i < FEED_ROW_LIMIT; i++) {
            const rowNode = rowsHost.getChildByName(`FeedRow_${i}`);
            if (!rowNode) continue;
            const btn = rowNode.getComponent(Button);
            const spr = rowNode.getComponent(Sprite);
            const logoSpr = rowNode.getChildByName('LogoSprite')?.getComponent(Sprite);
            const symL = rowNode.getChildByName('SymbolLabel')?.getComponent(Label);
            const dltL = rowNode.getChildByName('DeltaLabel')?.getComponent(Label);
            if (!btn || !spr || !symL || !dltL) {
                console.log(`${TAG} start | WARN FeedRow_${i} missing children btn=${!!btn} spr=${!!spr} sym=${!!symL} delta=${!!dltL} logo=${!!logoSpr}`);
                continue;
            }
            this._feedRowNodes.push(rowNode);
            this._feedRowButtons.push(btn);
            this._feedRowSprites.push(spr);
            this._feedRowLogoSprites.push(logoSpr!);
            this._feedRowSymbolLabels.push(symL);
            this._feedRowDeltaLabels.push(dltL);
            const idx = i;
            btn.node.on(Button.EventType.CLICK, () => this._onFeedRowTap(idx), this);
        }
        console.log(`${TAG} start | TokenDuel feed_scrollview wired=${!!this._feedScrollView} content=${!!this._feedContent} rows_collected=${this._feedRowNodes.length}/${FEED_ROW_LIMIT}`);

        // Search EditBox (Session 3 A1 / Session 4 A1).
        const searchNode = this._tokenDuelPanel.getChildByName('SearchEditBox');
        this._searchEditBox = searchNode?.getComponent(EditBox) ?? null;
        if (this._searchEditBox) {
            // Cocos 3.8 emits EditBox events under inconsistent names across point
            // releases — 'text-changed' in some, 'textChanged' in others. Register
            // both so neither build surprises us. Logs tell us which fired.
            this._bindEvent(this._searchEditBox.node, ['text-changed', 'textChanged'], this._onSearchTextChanged, 'search_text');
            this._bindEvent(this._searchEditBox.node, ['editing-did-ended', 'editingDidEnded'], this._onSearchTextChanged, 'search_end');
            this._bindEvent(this._searchEditBox.node, ['editing-return', 'editingReturn'], this._onSearchTextChanged, 'search_return');
            console.log(`${TAG} start | TokenDuel search_editbox wired=true dual_name_events=true`);
        } else {
            console.log(`${TAG} start | TokenDuel search_editbox wired=false — fall back to tab-only browsing`);
        }

        // Session 4 B3 — Search clear (×) button.
        const clearNode = this._tokenDuelPanel.getChildByName('SearchClearButton');
        this._searchClearButton = clearNode?.getComponent(Button) ?? null;
        if (this._searchClearButton) {
            this._searchClearButton.node.on(Button.EventType.CLICK, this._onSearchClear, this);
            console.log(`${TAG} start | TokenDuel search_clear_button wired=true`);
        } else {
            console.log(`${TAG} start | TokenDuel search_clear_button wired=false`);
        }

        // Stake slider (Session 3 A3). Chips remain as snap-to presets.
        const sliderNode = this._tokenDuelPanel.getChildByName('StakeSlider');
        this._stakeSlider = sliderNode?.getComponent(Slider) ?? null;
        const stakeValueNode = this._tokenDuelPanel.getChildByName('StakeValueLabel');
        this._stakeValueLabel = stakeValueNode?.getComponent(Label) ?? null;
        if (this._stakeSlider) {
            // Dual-name events (see EditBox comment above).
            this._bindEvent(this._stakeSlider.node, ['slide', 'slidechange'], this._onStakeSliderSlide, 'stake_slide');
            // Initialize progress to default stake (0.01 SOL within MIN/MAX).
            const defaultProgress = (STAKE_DEFAULT_SOL - STAKE_MIN_SOL) / (STAKE_MAX_SOL - STAKE_MIN_SOL);
            this._stakeSlider.progress = defaultProgress;
            this._selectedStakeLamports = BigInt(Math.floor(STAKE_DEFAULT_SOL * 1_000_000_000));
            this._syncStakeValueLabel(STAKE_DEFAULT_SOL);
            console.log(`${TAG} start | TokenDuel stake_slider wired=true default_progress=${defaultProgress.toFixed(3)} default_sol=${STAKE_DEFAULT_SOL} dual_name_events=true`);
        } else {
            console.log(`${TAG} start | TokenDuel stake_slider wired=false — falling back to chip-only stake selection`);
        }

        // Squad slot buttons — 3 slots. Each button has a child `Label` node
        // carrying the display string (symbol or "+"). We mirror the pattern
        // used by HeroTile buttons.
        for (let i = 0; i < 3; i++) {
            const node = this._tokenDuelPanel.getChildByName(`SquadSlot_${i}`);
            const btn = node?.getComponent(Button);
            const lbl = node?.getChildByName('Label')?.getComponent(Label);
            if (btn && lbl) {
                this._squadSlotButtons.push(btn);
                this._squadSlotLabels.push(lbl);
                const idx = i;
                btn.node.on(Button.EventType.CLICK, () => this._onSquadSlotTap(idx), this);
            }
        }

        // Stake chips — 3 preset amounts. Default selection is 0.01 SOL (middle).
        const chipDefs: Array<{ name: string; kind: '001' | '010' | '100'; sol: number }> = [
            { name: 'StakeChip_001', kind: '001', sol: 0.001 },
            { name: 'StakeChip_010', kind: '010', sol: 0.01  },
            { name: 'StakeChip_100', kind: '100', sol: 0.1   },
        ];
        let chipsWired = 0;
        for (const def of chipDefs) {
            const node = this._tokenDuelPanel.getChildByName(def.name);
            const btn = node?.getComponent(Button);
            if (btn) {
                this._stakeChipButtons.set(def.kind, btn);
                btn.node.on(Button.EventType.CLICK, () => this._onStakeChipTap(def.kind, def.sol), this);
                chipsWired++;
            }
        }
        // Initial render + highlight defaults.
        this._renderSquad();
        this._highlightActiveStakeChip('010');
        this._highlightActiveFeedTab('trending');

        // Price feed → squad change pulses → squad re-render.
        this._squad.onChange(() => this._renderSquad());

        console.log(`${TAG} start | TokenDuel Phase III — balance_chip=${!!this._balanceChipLabel} feed_tabs=${feedTabsWired}/3 feed_rows=${this._feedRowNodes.length}/8 squad_slots=${this._squadSlotButtons.length}/3 stake_chips=${chipsWired}/3`);

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
        this._setActivePanel('landing');
        this._cachedHoldings = undefined; // invalidate — fresh fetch on next Token Duel entry
        if (this._game) {
            this._game.destroy();
            this._game = null;
        }
        if (this._landingStatus) this._landingStatus.string = 'Tap Connect to link your wallet';
        if (this._reconnectButton) this._reconnectButton.node.active = hasCached;
        this._setLandingEnabled(true);
    }

    private _showHome(): void {
        console.log(`${TAG} _showHome | switching to home panel`);
        this._setActivePanel('home');
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

    private _showTokenDuel(): void {
        console.log(`${TAG} _showTokenDuel | switching to Token Duel panel`);
        this._setActivePanel('tokenDuel');
        this._resetStakeFlow();

        // Phase III — kick off Birdeye feed fetch + balance chip refresh. Both
        // run async; the panel opens instantly and rows populate when ready.
        this._refreshFeed().catch((e) => console.log(`${TAG} _showTokenDuel | feed_refresh_error=${e}`));
        const mwa = MWAManager.instance;
        if (mwa?.connectedPubkey) {
            this._refreshBalanceChip(mwa.connectedPubkey).catch((e) =>
                console.log(`${TAG} _showTokenDuel | balance_refresh_error=${e}`)
            );
        }
        // Session 3 A7: per-tab cadence (15s for trending/gainers, 30s for new/top10).
        this._restartFeedPoll();

        if (this._cachedHoldings) {
            this._renderHoldings(this._cachedHoldings);
            this._offerHeroPickIfSupported();
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Pick a squad and stake — feed is live';
            return;
        }

        this._resetHoldingLabels('--');
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Pick a squad and stake — feed is loading';
        this._loadHoldings();
    }

    private _resetStakeFlow(): void {
        const hadCommitted = !!this._stakeCommitSig;
        const hadHero = !!this._pickedHeroSymbol;
        const hadGame = !!this._game;
        const hadSessionSeed = this._sessionSeed !== null;
        console.log(`${TAG} _resetStakeFlow | START had_committed_sig=${hadCommitted} had_hero=${hadHero} had_game=${hadGame} had_session_seed=${hadSessionSeed} last_height=${this._lastGameHeight}`);
        this._stakeCommitSig = null;
        if (this._stakeCommitButton) {
            this._stakeCommitButton.node.active = true;
            this._stakeCommitButton.interactable = true;
        }
        // Phase D: also reset game state / visuals.
        if (this._startGameButton) this._startGameButton.node.active = false;
        if (this._gameArea) this._gameArea.active = false;
        if (this._gameOverLabel) this._gameOverLabel.node.active = false;
        if (this._claimButton) this._claimButton.node.active = false;
        this._lastGameHeight = 0;
        this._sessionSeed = null; // Phase 6: clear per-round Anchor PDA seed.
        this._setPreGameContextActive(true);
        // Phase F: reset hero-pick state.
        for (const b of this._heroTileButtons) {
            b.node.active = false;
            b.interactable = true;
        }
        this._pickedHeroSymbol = null;
        this._pickedHeroSig = null;
        this._sessionDeltas = null;
        if (this._game) {
            this._game.destroy();
            this._game = null;
        }
        console.log(`${TAG} _resetStakeFlow | DONE commit_btn_visible=${this._stakeCommitButton?.node.active === true} start_btn_visible=${this._startGameButton?.node.active === true} claim_btn_visible=${this._claimButton?.node.active === true} game_area_visible=${this._gameArea?.active === true} hero_tiles_visible=${this._heroTileButtons.filter(b => b.node.active).length}`);
    }

    private _setPreGameContextActive(active: boolean): void {
        const sub = this._tokenDuelPanel?.getChildByName('SubtitleLabel');
        const subToggled = !!sub;
        if (sub) sub.active = active;
        for (const lbl of this._holdingLabels) lbl.node.active = active;
        console.log(`${TAG} _setPreGameContextActive | DONE active=${active} subtitle_toggled=${subToggled} holding_labels_count=${this._holdingLabels.length}`);
    }

    private async _loadHoldings(): Promise<void> {
        const pubkey = MWAManager.instance?.connectedPubkey ?? '';
        if (!pubkey) {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Not connected';
            return;
        }
        try {
            const holdings = await this._tdRpc.getTopHoldings(pubkey);
            if (!this._tokenDuelPanel.active) {
                console.log(`${TAG} _loadHoldings | panel no longer active — dropping result`);
                return;
            }
            this._cachedHoldings = holdings;
            this._renderHoldings(holdings);
            this._offerHeroPickIfSupported();
            const short = `${pubkey.substring(0, 4)}…${pubkey.substring(pubkey.length - 4)}`;
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Holdings loaded (${short})`;
            console.log(`${TAG} _loadHoldings | SUCCESS symbols=[${holdings.map(h => h.symbol).join(', ')}]`);
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            const stack = e?.stack ? String(e.stack).split('\n')[0] : '(no stack)';
            const name = e?.name ?? '(no name)';
            console.log(`${TAG} _loadHoldings | FAIL err_name="${name}" err_msg="${msg}" first_frame="${stack}"`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to load holdings';
        }
    }

    private _renderHoldings(holdings: Holding[]): void {
        const symbols = holdings.map(h => h?.symbol ?? '---').join(',');
        for (let i = 0; i < this._holdingLabels.length; i++) {
            const h = holdings[i];
            this._holdingLabels[i].string = h?.symbol ?? '---';
        }
        console.log(`${TAG} _renderHoldings | DONE label_count=${this._holdingLabels.length} symbols="${symbols}"`);
    }

    private _resetHoldingLabels(placeholder: string): void {
        for (const lbl of this._holdingLabels) lbl.string = placeholder;
        console.log(`${TAG} _resetHoldingLabels | DONE placeholder="${placeholder}" label_count=${this._holdingLabels.length}`);
    }

    private _offerHeroPickIfSupported(): void {
        const mwa = MWAManager.instance;
        const supports = mwa ? mwa.supportsSignMessages() : false;
        const stakeSigned = !!this._stakeCommitSig;
        const heroPicked = !!this._pickedHeroSymbol;
        const squadFilled = this._squad.filled;
        const hasHoldings = !!this._cachedHoldings;
        console.log(`${TAG} _offerHeroPickIfSupported | START mwa_ready=${!!mwa} supports_sign_messages=${supports} squad_filled=${squadFilled} has_holdings=${hasHoldings} stake_signed=${stakeSigned} hero_picked=${heroPicked} tiles_wired=${this._heroTileButtons.length}`);
        if (!mwa || !supports) {
            for (const b of this._heroTileButtons) b.node.active = false;
            console.log(`${TAG} _offerHeroPickIfSupported | DONE path=hidden reason=unsupported`);
            return;
        }
        if (stakeSigned || heroPicked) {
            console.log(`${TAG} _offerHeroPickIfSupported | DONE path=skip reason=already_past_stake`);
            return;
        }

        // Session 4 B1 — prefer the squad as hero-pick source. When the squad
        // is non-empty we pick from it (aligns the hero bonus with the tokens
        // the player actually staked on). Fallback to wallet holdings only
        // when the squad is empty — preserves pre-Session-3 behavior.
        let source: 'squad' | 'wallet' | 'none' = 'none';
        let symbols: string[] = [];
        if (squadFilled > 0) {
            source = 'squad';
            symbols = this._squad.slots.map((s) => s?.symbol ?? '');
        } else if (hasHoldings) {
            source = 'wallet';
            symbols = this._cachedHoldings!.map((h) => h?.symbol ?? '');
        } else {
            console.log(`${TAG} _offerHeroPickIfSupported | DONE path=skip reason=no_source`);
            return;
        }

        let shown = 0;
        let empty = 0;
        let missingBindings = 0;
        for (let i = 0; i < 3; i++) {
            const sym = symbols[i];
            const btn = this._heroTileButtons[i];
            const lbl = this._heroTileLabels[i];
            if (!btn || !lbl) { missingBindings++; continue; }
            if (!sym || sym === '---') {
                btn.node.active = false;
                btn.interactable = false;
                empty++;
                continue;
            }
            lbl.string = `Pick ${sym}`;
            btn.node.active = true;
            btn.interactable = true;
            shown++;
        }
        console.log(`${TAG} _offerHeroPickIfSupported | DONE path=shown source=${source} tiles_shown=${shown} tiles_empty=${empty} bindings_missing=${missingBindings} symbols=[${symbols.join(',')}]`);
    }

    private _setActivePanel(which: 'landing' | 'home' | 'tokenDuel'): void {
        this._landingPanel.active = which === 'landing';
        this._homePanel.active = which === 'home';
        this._tokenDuelPanel.active = which === 'tokenDuel';
        console.log(`${TAG} _setActivePanel | DONE which=${which} landing=${this._landingPanel.active} home=${this._homePanel.active} tokenDuel=${this._tokenDuelPanel.active}`);
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

    private _onPlayTokenDuel(): void {
        console.log(`${TAG} onPlayTokenDuel | transitioning to Token Duel panel`);
        this._showTokenDuel();
    }

    private _onTokenDuelBack(): void {
        console.log(`${TAG} onTokenDuelBack | returning to Home panel feed_poll_was_active=${this._feedPollTimer !== null} squad_filled=${this._squad.filled}`);
        if (this._game) {
            this._game.destroy();
            this._game = null;
        }
        // Phase III teardown — stop feed poll + price feed, but keep the squad
        // in memory so re-entering the panel restores the user's picks.
        if (this._feedPollTimer !== null) {
            clearInterval(this._feedPollTimer as unknown as number);
            this._feedPollTimer = null;
        }
        this._priceFeed?.stop();
        this._showHome();
    }

    private _onStartGame(): void {
        console.log(`${TAG} onStartGame | START squad_filled=${this._squad.filled}`);

        // Phase III: prefer the squad's picks. Fallback to the wallet's top
        // holdings when the squad is empty (no squad tokens → game skin uses
        // the user's SPL balances, same as v1 behavior).
        const squadHoldings: Holding[] = [];
        for (const s of this._squad.slots) {
            if (s) squadHoldings.push({ mint: s.address, symbol: s.symbol, uiAmount: 0 });
        }
        // Pad to 3 for the game loop's assumption. If the squad had 1 pick we
        // repeat it so blocks don't cycle through empty '---' tiles.
        while (squadHoldings.length > 0 && squadHoldings.length < 3) {
            squadHoldings.push(squadHoldings[squadHoldings.length % Math.max(1, this._squad.filled)]);
        }

        let gameHoldings: Holding[];
        if (squadHoldings.length === 3) {
            gameHoldings = squadHoldings;
            console.log(`${TAG} onStartGame | source=squad symbols=[${gameHoldings.map(h => h.symbol).join(', ')}]`);
        } else if (this._cachedHoldings && this._cachedHoldings.length >= 3) {
            gameHoldings = this._cachedHoldings;
            console.log(`${TAG} onStartGame | source=wallet_holdings symbols=[${gameHoldings.map(h => h.symbol).join(', ')}]`);
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Pick a squad or wait for holdings — tap Back and retry';
            console.log(`${TAG} onStartGame | FAIL no_source cached=${this._cachedHoldings?.length ?? 0} squad=${this._squad.filled}`);
            return;
        }
        // Stash for downstream (claim flow reads from _cachedHoldings for hero display).
        this._cachedHoldings = gameHoldings;

        // Hide pre-game UI and stake controls.
        this._setPreGameContextActive(false);
        if (this._startGameButton) this._startGameButton.node.active = false;
        if (this._stakeCommitButton) this._stakeCommitButton.node.active = false;
        if (this._gameOverLabel) this._gameOverLabel.node.active = false;

        // Show game area.
        if (this._gameArea) this._gameArea.active = true;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Tap to drop — stack as high as you can';

        // Lazy-init PriceFeed once per session. Creating it is cheap (constructs
        // a BirdeyeClient with an embedded API key), so this could move to ctor,
        // but we defer so users who never enter Token Duel don't pay the cost.
        const priceFeedExisted = !!this._priceFeed;
        if (!this._priceFeed) this._priceFeed = new PriceFeed();
        console.log(`${TAG} onStartGame | priceFeed_lazy_init=${!priceFeedExisted} reused=${priceFeedExisted}`);

        // Instantiate and start the game.
        this._game = new TokenDuelGame({
            gameArea: this._gameArea,
            blockTemplate: this._blockTemplate,
            heightLabel: this._heightLabel,
            tokenBadgeLabel: this._tokenBadgeLabel,
            holdings: gameHoldings,
            priceFeed: this._priceFeed,
            onGameOver: (h, d) => this._onGameOver(h, d),
        });
        // `start()` is now async (awaits Birdeye). Fire-and-forget; taps
        // before deltas resolve are ignored by the game's `_running` guard.
        this._game.start().catch((e) => console.log(`${TAG} onStartGame | START_ERROR error=${e}`));
    }

    private _onGameOver(height: number, deltas: Record<string, number>): void {
        console.log(`${TAG} onGameOver | height=${height} deltas=${JSON.stringify(deltas)}`);
        this._sessionDeltas = deltas;
        const tier = this._tierFor(height);
        if (this._gameOverLabel) {
            this._gameOverLabel.string = `Game Over — Height: ${height}\n(Tier: ${tier})`;
            this._gameOverLabel.node.active = true;
        }
        if (this._gameArea) this._gameArea.active = false;
        // Phase E: stash the height + reveal Claim Payout.
        this._lastGameHeight = height;
        if (this._claimButton) {
            this._claimButton.node.active = true;
            this._claimButton.interactable = true;
        }
        if (this._tokenDuelStatus) {
            this._tokenDuelStatus.string = `Tap Claim Payout to settle (${tier})`;
        }
    }

    // CI7: tier thresholds centralized. These MUST mirror the on-chain logic in
    // `programs/token-duel/src/instructions/settle.rs::compute_payout`. If Rust
    // changes, update these in lockstep.
    private readonly TIER_HALF_MIN = 11;
    private readonly TIER_FULL_MIN = 21;
    private readonly TIER_DOUBLE_MIN = 36;

    private _tierInfo(height: number): { key: string; label: string } {
        let info: { key: string; label: string };
        if (height >= this.TIER_DOUBLE_MIN)       info = { key: 'double',  label: '2× payout' };
        else if (height >= this.TIER_FULL_MIN)    info = { key: 'full',    label: 'Full refund + bonus' };
        else if (height >= this.TIER_HALF_MIN)    info = { key: 'half',    label: 'Half refund' };
        else                                      info = { key: 'forfeit', label: 'Forfeit' };
        console.log(`${TAG} _tierInfo | DONE height=${height} key=${info.key} label="${info.label}" thresholds_half=${this.TIER_HALF_MIN}/full=${this.TIER_FULL_MIN}/double=${this.TIER_DOUBLE_MIN}`);
        return info;
    }

    private _tierFor(height: number): string { return this._tierInfo(height).label; }
    private _tierKey(height: number): string { return this._tierInfo(height).key; }

    private async _onClaim(): Promise<void> {
        console.log(`${TAG} onClaim | START height=${this._lastGameHeight}`);
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.isConnected) {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Not connected';
            return;
        }
        if (this._claimButton) this._claimButton.interactable = false;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Fetching blockhash…';

        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onClaim | FAIL blockhash=null`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to get blockhash';
            if (this._claimButton) this._claimButton.interactable = true;
            return;
        }

        // Phase 6: settle is now a real Anchor program call, not a memo tx.
        if (!this._sessionSeed) {
            // Trap state (audit T7): no session seed means the round can't be
            // settled — hide the Claim button instead of re-enabling it so the
            // user doesn't keep hitting an impossible state. Back is the exit.
            console.log(`${TAG} onClaim | FAIL no session_seed — stake was likely orphaned`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Session lost — tap Back to return to menu';
            if (this._claimButton) this._claimButton.node.active = false;
            showToast('No session to settle — return to menu', true);
            return;
        }

        // Hero bonus stays cosmetic in v1 (no longer lives in a memo since settle
        // is now a structured program call). Computed for status-text display only.
        let heroBonus = 0;
        if (this._pickedHeroSymbol && this._sessionDeltas) {
            const picked = this._sessionDeltas[this._pickedHeroSymbol] ?? 0;
            const max = Math.max(...Object.values(this._sessionDeltas));
            heroBonus = picked === max ? 25 : 0;
        }

        const tx = AnchorBackend.buildSettleTx(mwa.connectedPubkey, this._sessionSeed, this._lastGameHeight, bh.blockhash);
        if (tx.length === 0) {
            console.log(`${TAG} onClaim | FAIL tx_build`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to build settle tx';
            if (this._claimButton) this._claimButton.interactable = true;
            return;
        }

        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Sign settle tx in your wallet…';
        const sig = await mwa.signAndSendTransaction(tx);
        console.log(`${TAG} onClaim | sig=${sig || '(empty)'} lastError=${mwa.lastError?.code ?? '(none)'}`);

        if (sig) {
            // CI5: hero bonus is computed off-chain in v1 (the settle tx doesn't
            // carry it). Make the status explicit so a reviewer clicking the
            // explorer link isn't surprised that the bonus isn't in the memo.
            const heroSuffix = this._pickedHeroSymbol
                ? ` (Hero: ${this._pickedHeroSymbol}${heroBonus > 0 ? ` +${heroBonus}% off-chain v1` : ''})`
                : '';
            if (this._tokenDuelStatus) {
                this._tokenDuelStatus.string =
                    `Settled on-chain!${heroSuffix}\nSig: ${sig.substring(0, 24)}…\nhttps://explorer.solana.com/tx/${sig}?cluster=devnet`;
            }
            showToast('Settled via Token Duel program', true);
            // Flow complete — button stays disabled.
            return;
        }

        // Error fallbacks — mirror HomeUI._onSignAndSend.
        if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet mismatch';
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting", true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet timeout';
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet crashed';
        } else if (mwa.lastError?.code === 'INSUFFICIENT_FUNDS_FOR_RENT') {
            showToast('Fee-payer underfunded — send ≥0.001 SOL and retry', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Underfunded';
        } else if (mwa.lastError?.code === 'RPC_BROADCAST_FAILED') {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Broadcast failed — tap again';
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Settle rejected — tap again to retry';
        }
        if (this._claimButton) this._claimButton.interactable = true;
    }

    /**
     * Session 2: replaces the former Sign → Broadcast two-tap flow with a
     * single commit that delegates to `mwa.signAndSendTransaction`. Matches
     * the pattern `_onClaim` already uses (AppUI.ts settle flow) and what
     * HomeUI uses for the generic Sign+Send demo. The MWAManager picks the
     * right route per wallet: native MWA 2.0 sign_and_send for Phantom /
     * Jupiter, sign+RPC fallback for Backpack (KNOWN_ISSUES #9) and the
     * universal-safe default for Solflare / Seed Vault / unknown. The wallet
     * catches pre-flight errors (insufficient funds) and shows its own
     * native prompt instead of leaking raw `-32002 / AccountNotFound` to us.
     */
    private async _onCommitStake(): Promise<void> {
        console.log(`${TAG} onCommitStake | START`);
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.isConnected) {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Not connected';
            console.log(`${TAG} onCommitStake | FAIL not_connected`);
            return;
        }
        const btn = this._stakeCommitButton ?? this._signStakeButton;
        if (btn) btn.interactable = false;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Fetching blockhash…';

        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onCommitStake | FAIL blockhash=null`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to get blockhash';
            if (btn) btn.interactable = true;
            return;
        }

        // Phase 6: Anchor `commit` program call. Fresh session seed per round
        // — random up to 2^40, ample space for demo PDAs.
        this._sessionSeed = BigInt(Math.floor(Math.random() * 1_000_000_000_000));
        const stakeLamports = this._currentStakeLamports();
        const tx = AnchorBackend.buildCommitTx(mwa.connectedPubkey, stakeLamports, this._sessionSeed, bh.blockhash);
        if (tx.length === 0) {
            console.log(`${TAG} onCommitStake | FAIL tx_build stake_lamports=${stakeLamports}`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to build commit tx';
            if (btn) btn.interactable = true;
            return;
        }

        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Confirm stake in your wallet…';
        console.log(`${TAG} onCommitStake | SENDING tx_bytes=${tx.length} stake_lamports=${stakeLamports} seed=${this._sessionSeed}`);
        const sig = await mwa.signAndSendTransaction(tx);
        console.log(`${TAG} onCommitStake | result sig=${sig || '(empty)'} lastError=${mwa.lastError?.code ?? '(none)'}`);

        if (sig) {
            this._stakeCommitSig = sig;
            if (btn) btn.node.active = false;
            if (this._startGameButton) {
                this._startGameButton.node.active = true;
                this._startGameButton.interactable = true;
            }
            const cluster = getAppIdentity().cluster;
            if (this._tokenDuelStatus) {
                this._tokenDuelStatus.string =
                    `Stake escrowed on-chain!\nSig: ${sig.substring(0, 24)}…\nhttps://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
            }
            showToast('Stake escrowed via Token Duel program', true);
            return;
        }

        // Error fallbacks — mirror _onClaim's branches plus Token-Duel-specific
        // AccountNotFound (0-SOL wallet on devnet). MWAManager normalizes errors
        // into codes (WALLET_*, INSUFFICIENT_FUNDS_FOR_RENT, RPC_BROADCAST_FAILED).
        const code = mwa.lastError?.code;
        const msg = (mwa.lastError?.message ?? '').toLowerCase();
        const isSimulationFail = code === 'RPC_BROADCAST_FAILED'
            && (msg.includes('accountnotfound') || msg.includes('no record of a prior credit'));

        if (isSimulationFail) {
            showToast('Wallet has 0 SOL — fund at faucet.solana.com and retry', true);
            if (this._tokenDuelStatus) {
                this._tokenDuelStatus.string = 'Wallet needs devnet SOL\nhttps://faucet.solana.com';
            }
        } else if (code === 'WALLET_AUTH_MISMATCH') {
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet mismatch';
        } else if (code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting", true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet timeout';
        } else if (code === 'WALLET_CRASHED') {
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet crashed';
        } else if (code === 'INSUFFICIENT_FUNDS_FOR_RENT') {
            showToast('Fee-payer underfunded — send ≥0.001 SOL and retry', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Underfunded';
        } else if (code === 'RPC_BROADCAST_FAILED') {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Broadcast failed — tap Stake to retry\n${mwa.lastError?.message ?? ''}`;
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Commit rejected — tap Stake to retry';
        }
        if (btn) btn.interactable = true;
    }

    /** Current stake amount — driven by the active chip, or the v1 default. */
    private _currentStakeLamports(): bigint {
        console.log(`${TAG} _currentStakeLamports | DONE lamports=${this._selectedStakeLamports} default=${STAKE_LAMPORTS} is_default=${this._selectedStakeLamports === STAKE_LAMPORTS}`);
        return this._selectedStakeLamports;
    }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE III — Birdeye feed + squad picker + stake chips
    // ═══════════════════════════════════════════════════════════════

    /** Lazy-init the shared BirdeyeClient (also available through PriceFeed). */
    private _getBirdeye(): BirdeyeClient {
        if (!this._birdeye) {
            this._birdeye = new BirdeyeClient();
            console.log(`${TAG} _getBirdeye | LAZY_INIT`);
        }
        return this._birdeye;
    }

    private _onFeedTabClick(tab: FeedTab | 'top10'): void {
        console.log(`${TAG} _onFeedTabClick | tab=${tab} prev=${this._currentFeedTab} search_mode=${this._searchMode}`);
        this._currentFeedTab = tab;
        // Tab switch clears any active search and resets the EditBox.
        if (this._searchMode) {
            this._searchMode = false;
            if (this._searchEditBox) this._searchEditBox.string = '';
            if (this._searchClearButton) this._searchClearButton.node.active = false;
            console.log(`${TAG} _onFeedTabClick | cleared_search`);
        }
        this._highlightActiveFeedTab(tab);
        this._restartFeedPoll();
        this._refreshFeed();
    }

    private _highlightActiveFeedTab(active: FeedTab | 'top10'): void {
        for (const [tab, btn] of this._feedTabButtons) {
            const isActive = tab === active;
            const spr = btn.node.getComponent(Sprite);
            if (spr) {
                spr.color = isActive
                    ? new Color(51, 153, 255, 255)
                    : new Color(90, 90, 110, 255);
            }
        }
    }

    /** Cadence per tab: trending/gainers 15s, new 30s, top10 30s. */
    private _currentTabPollMs(): number {
        switch (this._currentFeedTab) {
            case 'trending':
            case 'gainers':
                return 15_000;
            case 'new':
            case 'top10':
                return 30_000;
            default:
                return 20_000;
        }
    }

    private _restartFeedPoll(): void {
        if (this._feedPollTimer !== null) {
            clearInterval(this._feedPollTimer as unknown as number);
            this._feedPollTimer = null;
            console.log(`${TAG} _restartFeedPoll | cleared_previous`);
        }
        const ms = this._currentTabPollMs();
        this._feedPollTimer = setInterval(() => {
            this._refreshFeed().catch(() => {});
            const owner = MWAManager.instance?.connectedPubkey;
            if (owner) this._refreshBalanceChip(owner).catch(() => {});
        }, ms) as unknown as number;
        console.log(`${TAG} _restartFeedPoll | tab=${this._currentFeedTab} interval_ms=${ms} timer=${this._feedPollTimer}`);
    }

    /** Call Birdeye (or leaderboard RPC) for the current tab and render rows. */
    private async _refreshFeed(): Promise<void> {
        if (this._searchMode) {
            console.log(`${TAG} _refreshFeed | SKIP_SEARCH_ACTIVE tab=${this._currentFeedTab}`);
            return;
        }
        console.log(`${TAG} _refreshFeed | START tab=${this._currentFeedTab}`);
        if (this._currentFeedTab === 'top10') {
            await this._renderLeaderboardRows();
            return;
        }

        // Session 4 B2 — show "Loading…" row on first fetch so the panel
        // doesn't look empty while the Birdeye request is in flight.
        if (this._currentFeedRows.length === 0) {
            this._renderEmptyStateRow(`Loading ${this._currentFeedTab}…`, 'LOADING');
        }

        const client = this._getBirdeye();
        let rows: TokenRow[] = [];
        try {
            rows = await client.getTrending(this._currentFeedTab, this._feedRowNodes.length);
        } catch (e) {
            console.log(`${TAG} _refreshFeed | CLIENT_ERROR tab=${this._currentFeedTab} error=${e}`);
        }
        const usable = rows.filter((r) => r.address && r.symbol);
        if (usable.length === 0) {
            console.log(`${TAG} _refreshFeed | EMPTY tab=${this._currentFeedTab} rows_received=${rows.length}`);
            this._renderEmptyStateRow(`No results for ${this._currentFeedTab}`, 'EMPTY_TAB');
            this._currentFeedRows = [];
            return;
        }
        this._currentFeedRows = usable;
        this._renderFeedRows(usable);
        console.log(`${TAG} _refreshFeed | DONE tab=${this._currentFeedTab} rendered=${usable.length}/${this._feedRowNodes.length}`);
    }

    /**
     * B2 helper — fills row 0 with a message and hides the rest. Used for
     * Loading / Empty / Not-initialized states. Transition-log pattern:
     *   console.log via the `state` label so future state machines can be grepped.
     */
    private _renderEmptyStateRow(message: string, state: string): void {
        for (let i = 0; i < this._feedRowNodes.length; i++) {
            const node = this._feedRowNodes[i];
            if (!node) continue;
            if (i === 0) {
                node.active = true;
                const logo = this._feedRowLogoSprites[0];
                if (logo?.node) logo.node.active = false;
                const symL = this._feedRowSymbolLabels[0];
                const dltL = this._feedRowDeltaLabels[0];
                const spr = this._feedRowSprites[0];
                if (symL) symL.string = message;
                if (dltL) dltL.string = '';
                if (spr) spr.color = new Color(35, 35, 50, 255);
            } else {
                node.active = false;
            }
        }
        console.log(`${TAG} _renderEmptyStateRow | state=${state} message="${message}"`);
    }

    /**
     * Leaderboard rendering (Phase B B8): re-use the same row pool, but each
     * row shows "rank. player (short) — height — elapsed" with a trophy-esque
     * backdrop tint by rank. Uses a distinct address scheme (rank-prefixed
     * sentinel strings) so _onFeedRowTap ignores taps.
     */
    private async _renderLeaderboardRows(): Promise<void> {
        console.log(`${TAG} _renderLeaderboardRows | START`);
        let entries: { player: string; height: number; settled_at: number }[] = [];
        let rpcErr: any = null;
        try {
            entries = await this._tdRpc.getLeaderboard();
        } catch (e) {
            rpcErr = e;
            console.log(`${TAG} _renderLeaderboardRows | CLIENT_ERROR error=${e}`);
        }
        // Distinguish "not initialized" (empty result + no error) from "no finishers yet"
        // (PDA exists, all entries zero). TokenDuelRpc.getLeaderboard logs NOT_INITIALIZED
        // when getAccountInfo returns null — we can't see the distinction here, but the
        // message below is broad enough to cover both without lying to the user.
        if (entries.length === 0) {
            const msg = rpcErr
                ? 'Leaderboard fetch failed — tap another tab and retry'
                : 'No finishers yet — be the first';
            const state = rpcErr ? 'EMPTY_LEADERBOARD_ERR' : 'EMPTY_LEADERBOARD';
            this._renderEmptyStateRow(msg, state);
            this._currentFeedRows = [];
            return;
        }
        this._currentFeedRows = []; // taps are no-ops on leaderboard rows
        const nowSec = Math.floor(Date.now() / 1000);
        for (let i = 0; i < this._feedRowNodes.length; i++) {
            const entry = entries[i];
            const node = this._feedRowNodes[i];
            if (!entry || entry.height === 0) {
                node.active = false;
                continue;
            }
            node.active = true;
            const symL = this._feedRowSymbolLabels[i];
            const dltL = this._feedRowDeltaLabels[i];
            const spr = this._feedRowSprites[i];
            const logo = this._feedRowLogoSprites[i];
            // Hide the logo sprite on leaderboard rows (no token to show).
            if (logo?.node) logo.node.active = false;
            if (symL) {
                const short = entry.player.length > 8
                    ? `${entry.player.substring(0, 4)}…${entry.player.substring(entry.player.length - 4)}`
                    : entry.player;
                symL.string = `${i + 1}.  ${short}`;
            }
            if (dltL) {
                const elapsedSec = Math.max(0, nowSec - entry.settled_at);
                const elapsedStr = elapsedSec < 60
                    ? `${elapsedSec}s ago`
                    : elapsedSec < 3600
                        ? `${Math.floor(elapsedSec / 60)}m ago`
                        : `${Math.floor(elapsedSec / 3600)}h ago`;
                dltL.string = `H${entry.height} · ${elapsedStr}`;
                dltL.color = new Color(218, 165, 32, 255);
            }
            if (spr) {
                // Rank tint: gold → silver → bronze → flat.
                if (i === 0) spr.color = new Color(90, 70, 10, 255);
                else if (i === 1) spr.color = new Color(70, 70, 70, 255);
                else if (i === 2) spr.color = new Color(70, 50, 30, 255);
                else spr.color = new Color(40, 40, 60, 255);
            }
        }
        console.log(`${TAG} _renderLeaderboardRows | DONE entries=${entries.length}`);
    }

    private _renderFeedRows(rows: TokenRow[]): void {
        for (let i = 0; i < this._feedRowNodes.length; i++) {
            const node = this._feedRowNodes[i];
            const row = rows[i];
            if (!row) {
                node.active = false;
                continue;
            }
            node.active = true;
            // Logo (Session 3 A5): show + fetch if URL present.
            const logo = this._feedRowLogoSprites[i];
            if (logo?.node) logo.node.active = true;
            this._loadLogoInto(logo, row.logoUri);
            // Symbol + price in one line (keeps the row slim).
            const symL = this._feedRowSymbolLabels[i];
            const dltL = this._feedRowDeltaLabels[i];
            if (symL) {
                const priceStr = row.priceUsd > 0.01
                    ? `$${row.priceUsd.toFixed(2)}`
                    : row.priceUsd > 0
                        ? `$${row.priceUsd.toPrecision(2)}`
                        : '';
                symL.string = priceStr ? `${row.symbol}  ${priceStr}` : row.symbol;
            }
            if (dltL) {
                const d = row.change24hPct;
                const sign = d > 0 ? '+' : '';
                dltL.string = d === 0 ? '' : `${sign}${d.toFixed(1)}%`;
                dltL.color = d > 0
                    ? new Color(120, 220, 120, 255)   // green
                    : d < 0
                        ? new Color(240, 110, 110, 255) // red
                        : new Color(200, 200, 200, 255);
            }
            // Backdrop tint: subtle green-shift for gainers, red-shift for losers.
            const spr = this._feedRowSprites[i];
            if (spr) {
                const d = row.change24hPct;
                const amp = Math.min(Math.abs(d) / 20, 1);
                if (d > 0) {
                    spr.color = new Color(Math.floor(40 + 30 * amp), Math.floor(50 + 30 * amp), Math.floor(60 - 20 * amp), 255);
                } else if (d < 0) {
                    spr.color = new Color(Math.floor(60 + 40 * amp), Math.floor(40 - 10 * amp), Math.floor(50 - 10 * amp), 255);
                } else {
                    spr.color = new Color(40, 40, 60, 255);
                }
            }
        }
    }

    private _onFeedRowTap(i: number): void {
        const row = this._currentFeedRows[i];
        if (!row) {
            console.log(`${TAG} _onFeedRowTap | NO_ROW index=${i}`);
            return;
        }
        const added = this._squad.add(row);
        console.log(`${TAG} _onFeedRowTap | index=${i} symbol="${row.symbol}" address=${row.address} squad_index=${added}`);
        if (added === -1 && !this._squad.isFull) {
            // add() returned -1 AND squad isn't full → must be a duplicate.
            showToast(`${row.symbol} already in squad`);
        } else if (added >= 0) {
            showToast(`+ ${row.symbol} → slot ${added + 1}`);
        }
    }

    private _onSquadSlotTap(i: number): void {
        console.log(`${TAG} _onSquadSlotTap | index=${i} had=${this._squad.slots[i]?.symbol ?? 'empty'}`);
        this._squad.clearAt(i);
    }

    private _renderSquad(): void {
        const slots = this._squad.slots;
        for (let i = 0; i < this._squadSlotLabels.length; i++) {
            const lbl = this._squadSlotLabels[i];
            const slot = slots[i];
            if (!slot) {
                lbl.string = '+';
                lbl.color = new Color(200, 200, 200, 255);
            } else {
                const d = slot.change24hPct;
                const sign = d > 0 ? '+' : '';
                lbl.string = `${slot.symbol}\n${sign}${d.toFixed(1)}%`;
                lbl.color = d > 0
                    ? new Color(120, 220, 120, 255)
                    : d < 0
                        ? new Color(240, 110, 110, 255)
                        : new Color(255, 255, 255, 255);
            }
        }
        console.log(`${TAG} _renderSquad | DONE filled=${this._squad.filled}/${slots.length} labels_updated=${this._squadSlotLabels.length}`);
        // Pulse any slots whose 24h % has drifted since the last render (A6).
        this._maybePulseSquadOnDeltas();
        // Session 4 B1: if the squad just crossed empty → populated (or vice versa)
        // re-offer the hero pick so tiles track the new source.
        if (this._tokenDuelPanel?.active && !this._stakeCommitSig && !this._pickedHeroSymbol) {
            this._offerHeroPickIfSupported();
        }
    }

    private _onStakeChipTap(kind: '001' | '010' | '100', sol: number): void {
        this._selectedStakeLamports = BigInt(Math.floor(sol * 1_000_000_000));
        console.log(`${TAG} _onStakeChipTap | kind=${kind} sol=${sol} lamports=${this._selectedStakeLamports}`);
        this._highlightActiveStakeChip(kind);
        // Update commit button label so the user sees the selected amount.
        if (this._stakeCommitButton) {
            const lbl = this._stakeCommitButton.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.string = `Stake ${sol} SOL + Commit`;
        }
    }

    private _highlightActiveStakeChip(active: '001' | '010' | '100'): void {
        const colorActive = new Color(51, 153, 255, 255);
        const colorInactive = new Color(90, 90, 110, 255);
        for (const [kind, btn] of this._stakeChipButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = kind === active ? colorActive : colorInactive;
        }
    }

    private async _refreshBalanceChip(owner: string): Promise<void> {
        if (!this._balanceChipLabel) return;
        try {
            const bal = await this._rpc.getBalance(owner);
            const sol = bal / 1_000_000_000;
            this._balanceChipLabel.string = `◼ ${sol.toFixed(4)} SOL`;
            console.log(`${TAG} _refreshBalanceChip | DONE owner="${owner.substring(0, 8)}..." lamports=${bal} sol=${sol.toFixed(4)}`);
        } catch (e) {
            console.log(`${TAG} _refreshBalanceChip | ERROR owner="${owner.substring(0, 8)}..." error=${e}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 4 A1 — dual-name event binding helper
    // ═══════════════════════════════════════════════════════════════
    //
    // Tracks which event-name variant actually fired so we can log
    // `dual_name_event_fired=<variant>` the first time each kicks in. If
    // neither fires after the panel's been open a while, the NO_EVENTS sweep
    // in _refreshBalanceChip surfaces that for debugging.
    private _firedEventVariants: Set<string> = new Set();

    private _bindEvent<T>(
        node: Node,
        eventNames: string[],
        handler: (arg: T) => void,
        label: string,
    ): void {
        const self = this;
        for (const name of eventNames) {
            node.on(name, function (arg: T) {
                const key = `${label}:${name}`;
                if (!self._firedEventVariants.has(key)) {
                    self._firedEventVariants.add(key);
                    console.log(`${TAG} _bindEvent | FIRST_FIRE label=${label} event="${name}" total_fired=${self._firedEventVariants.size}`);
                }
                handler.call(self, arg);
            }, this);
        }
        console.log(`${TAG} _bindEvent | REGISTERED label=${label} events=[${eventNames.join(',')}]`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 3 — search + slider + remote logos + squad pulse
    // ═══════════════════════════════════════════════════════════════

    /**
     * EditBox text-changed handler (fires on every keystroke). Debounces
     * 500ms so Birdeye isn't hammered per character.
     */
    private _onSearchTextChanged(editBox: EditBox): void {
        const raw = editBox?.string ?? '';
        const query = raw.trim();
        console.log(`${TAG} _onSearchTextChanged | raw="${raw}" query_len=${query.length}`);
        // B3: show/hide the × clear button based on input length.
        if (this._searchClearButton) this._searchClearButton.node.active = raw.length > 0;
        if (this._searchDebounceHandle !== null) {
            clearTimeout(this._searchDebounceHandle as unknown as number);
            this._searchDebounceHandle = null;
        }
        if (query.length === 0) {
            // Empty query — restore tab mode.
            if (this._searchMode) {
                this._searchMode = false;
                console.log(`${TAG} _onSearchTextChanged | EMPTY — restoring tab mode tab=${this._currentFeedTab}`);
                this._refreshFeed().catch(() => {});
            }
            return;
        }
        // Skip noise queries (single char, punctuation).
        if (query.length < 2) {
            console.log(`${TAG} _onSearchTextChanged | SKIP_SHORT query="${query}"`);
            return;
        }
        this._searchDebounceHandle = setTimeout(() => {
            this._searchDebounceHandle = null;
            this._runSearch(query).catch((e) => console.log(`${TAG} _runSearch | ERROR query="${query}" error=${e}`));
        }, 500) as unknown as number;
        console.log(`${TAG} _onSearchTextChanged | DEBOUNCE_SCHEDULED query="${query}" delay_ms=500`);
    }

    private async _runSearch(query: string): Promise<void> {
        console.log(`${TAG} _runSearch | START query="${query}"`);
        this._searchMode = true;
        const client = this._getBirdeye();
        let rows: TokenRow[] = [];
        try {
            rows = await client.search(query, this._feedRowNodes.length);
        } catch (e) {
            console.log(`${TAG} _runSearch | CLIENT_ERROR query="${query}" error=${e}`);
        }
        const usable = rows.filter((r) => r.address && r.symbol);
        if (usable.length === 0) {
            console.log(`${TAG} _runSearch | EMPTY_RESULTS query="${query}" raw=${rows.length}`);
            this._renderEmptyStateRow(`No matches for "${query}"`, 'EMPTY_SEARCH');
            this._currentFeedRows = [];
            return;
        }
        this._currentFeedRows = usable;
        this._renderFeedRows(usable);
        console.log(`${TAG} _runSearch | DONE query="${query}" rendered=${usable.length}`);
    }

    /** Session 4 B3 — Clear the search input and restore tab mode. */
    private _onSearchClear(): void {
        console.log(`${TAG} _onSearchClear | was_search_mode=${this._searchMode}`);
        if (this._searchEditBox) this._searchEditBox.string = '';
        if (this._searchClearButton) this._searchClearButton.node.active = false;
        if (this._searchDebounceHandle !== null) {
            clearTimeout(this._searchDebounceHandle as unknown as number);
            this._searchDebounceHandle = null;
        }
        const wasSearching = this._searchMode;
        this._searchMode = false;
        if (wasSearching) {
            this._refreshFeed().catch((e) => console.log(`${TAG} _onSearchClear | refresh_error=${e}`));
        }
    }

    /** cc.Slider's 'slide' event carries the Slider instance; read `.progress`. */
    private _onStakeSliderSlide(slider: Slider): void {
        const raw = slider?.progress ?? 0;
        const clamped = Math.min(1, Math.max(0, raw));
        if (clamped !== raw) {
            console.log(`${TAG} _onStakeSliderSlide | CLAMPED raw=${raw} clamped=${clamped}`);
        }
        const sol = STAKE_MIN_SOL + clamped * (STAKE_MAX_SOL - STAKE_MIN_SOL);
        this._selectedStakeLamports = BigInt(Math.floor(sol * 1_000_000_000));
        this._syncStakeValueLabel(sol);
        console.log(`${TAG} _onStakeSliderSlide | progress=${clamped.toFixed(3)} sol=${sol.toFixed(4)} lamports=${this._selectedStakeLamports}`);
    }

    private _syncStakeValueLabel(sol: number): void {
        if (this._stakeValueLabel) {
            const str = sol < 0.01
                ? `${sol.toFixed(4)} SOL`
                : sol < 0.1
                    ? `${sol.toFixed(3)} SOL`
                    : `${sol.toFixed(2)} SOL`;
            this._stakeValueLabel.string = str;
        }
        if (this._stakeCommitButton) {
            const lbl = this._stakeCommitButton.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.string = `Stake ${sol.toFixed(3)} SOL + Commit`;
        }
    }

    /**
     * Remote logo fetch → SpriteFrame → apply. Cancel-safe (pending map),
     * cache by URL. Session 4 A2: adds a fetch+blob+Image fallback when
     * `assetManager.loadRemote` refuses the response (Birdeye occasionally
     * returns `image/webp` or a redirect chain that Cocos's native loader
     * doesn't grok).
     */
    private _loadLogoInto(sprite: Sprite, url: string): void {
        if (!sprite) {
            console.log(`${TAG} _loadLogoInto | NO_SPRITE url="${url?.substring(0, 32) ?? ''}..."`);
            return;
        }
        if (!url) {
            sprite.spriteFrame = null;
            sprite.color = new Color(180, 180, 180, 140);
            console.log(`${TAG} _loadLogoInto | EMPTY_URL resetting sprite`);
            return;
        }
        const cached = this._logoCache.get(url);
        if (cached) {
            sprite.spriteFrame = cached;
            sprite.color = new Color(255, 255, 255, 255);
            console.log(`${TAG} _loadLogoInto | CACHE_HIT url_suffix="${url.substring(url.length - 24)}" cache_size=${this._logoCache.size}`);
            return;
        }
        this._logoPending.set(sprite, url);
        console.log(`${TAG} _loadLogoInto | FETCH url_suffix="${url.substring(url.length - 24)}" cache_size=${this._logoCache.size}`);
        assetManager.loadRemote<ImageAsset>(url, { ext: '.png' }, (err, asset) => {
            if (err || !asset) {
                // Primary path failed — try the fetch+Image fallback before giving up.
                const reason = err ? (err as any)?.message ?? String(err) : 'null_asset';
                console.log(`${TAG} _loadLogoInto | PRIMARY_ERR url_suffix="${url.substring(url.length - 24)}" reason="${reason}" — FALLBACK_START`);
                this._loadLogoFallback(sprite, url);
                return;
            }
            this._applyLogoAsset(sprite, url, asset, 'PRIMARY_OK');
        });
    }

    /**
     * A2 fallback: fetch the URL, convert blob → Image → Texture2D → SpriteFrame.
     * Used when `assetManager.loadRemote` rejects the response (webp, redirect).
     */
    private _loadLogoFallback(sprite: Sprite, url: string): void {
        fetch(url).then(async (resp) => {
            if (!resp.ok) {
                console.log(`${TAG} _loadLogoInto | FALLBACK_FETCH_ERR url_suffix="${url.substring(url.length - 24)}" status=${resp.status}`);
                return;
            }
            let blob: Blob;
            try {
                blob = await resp.blob();
            } catch (e) {
                console.log(`${TAG} _loadLogoInto | FALLBACK_BLOB_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
                return;
            }
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const tex = new Texture2D();
                    // initWithElement is the Cocos 3.x path to load from a DOM/Image source.
                    // Width/height are read from the element; format defaults to RGBA8888.
                    (tex as any).initWithElement(img);
                    const frame = new SpriteFrame();
                    frame.texture = tex;
                    this._logoCache.set(url, frame);
                    if (!sprite.isValid) {
                        console.log(`${TAG} _loadLogoInto | FALLBACK_SPRITE_DESTROYED url_suffix="${url.substring(url.length - 24)}" cached_for_future=true`);
                        URL.revokeObjectURL(objectUrl);
                        return;
                    }
                    const expected = this._logoPending.get(sprite);
                    if (expected !== url) {
                        console.log(`${TAG} _loadLogoInto | FALLBACK_STALE url_suffix="${url.substring(url.length - 24)}"`);
                        URL.revokeObjectURL(objectUrl);
                        return;
                    }
                    sprite.spriteFrame = frame;
                    sprite.color = new Color(255, 255, 255, 255);
                    URL.revokeObjectURL(objectUrl);
                    console.log(`${TAG} _loadLogoInto | FALLBACK_OK url_suffix="${url.substring(url.length - 24)}" cache_size=${this._logoCache.size}`);
                } catch (e) {
                    console.log(`${TAG} _loadLogoInto | FALLBACK_DECODE_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
                    URL.revokeObjectURL(objectUrl);
                }
            };
            img.onerror = (e) => {
                console.log(`${TAG} _loadLogoInto | FALLBACK_IMG_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
                URL.revokeObjectURL(objectUrl);
            };
            img.src = objectUrl;
        }).catch((e) => {
            console.log(`${TAG} _loadLogoInto | FALLBACK_NET_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
        });
    }

    /** Shared path: convert an ImageAsset into a SpriteFrame and apply (respecting cancellation). */
    private _applyLogoAsset(sprite: Sprite, url: string, asset: ImageAsset, phase: string): void {
        let frame: SpriteFrame;
        try {
            const tex = new Texture2D();
            tex.image = asset;
            frame = new SpriteFrame();
            frame.texture = tex;
        } catch (e) {
            console.log(`${TAG} _loadLogoInto | SPRITEFRAME_ERROR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
            return;
        }
        this._logoCache.set(url, frame);
        if (!sprite.isValid) {
            console.log(`${TAG} _loadLogoInto | SPRITE_DESTROYED url_suffix="${url.substring(url.length - 24)}" cached_for_future=true`);
            return;
        }
        const expected = this._logoPending.get(sprite);
        if (expected !== url) {
            console.log(`${TAG} _loadLogoInto | STALE_CALLBACK url_suffix="${url.substring(url.length - 24)}" expected_suffix="${expected?.substring((expected?.length ?? 0) - 24) ?? '(none)'}"`);
            return;
        }
        sprite.spriteFrame = frame;
        sprite.color = new Color(255, 255, 255, 255);
        console.log(`${TAG} _loadLogoInto | APPLIED url_suffix="${url.substring(url.length - 24)}" cache_size=${this._logoCache.size} phase=${phase}`);
    }

    /** Squad delta pulse (A6). Compares new price deltas to last snapshot. */
    private _maybePulseSquadOnDeltas(): void {
        const slots = this._squad.slots;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const prev = this._lastSquadDeltas[i] ?? 0;
            const next = slot?.change24hPct ?? 0;
            if (next === prev) continue;
            const btn = this._squadSlotButtons[i];
            if (!btn) continue;
            const node = btn.node;
            Tween.stopAllByTarget(node);
            node.setScale(1, 1, 1);
            tween(node)
                .to(0.15, { scale: new Vec3(1.12, 1.12, 1) })
                .to(0.15, { scale: new Vec3(1, 1, 1) })
                .start();
            console.log(`${TAG} _maybePulseSquadOnDeltas | PULSE slot=${i} prev=${prev} next=${next}`);
            this._lastSquadDeltas[i] = next;
        }
    }

    private async _onHeroTileClick(index: number): Promise<void> {
        console.log(`${TAG} onHeroTileClick | index=${index} squad_filled=${this._squad.filled}`);
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.isConnected) return;

        // Session 4 B1: hero source matches what _offerHeroPickIfSupported rendered —
        // squad first, wallet holdings as fallback. The index→symbol mapping MUST
        // mirror that function or the user taps "WIF" and we sign a BONK message.
        let symbol = '';
        let source: 'squad' | 'wallet' = 'wallet';
        if (this._squad.filled > 0) {
            source = 'squad';
            symbol = this._squad.slots[index]?.symbol ?? '';
        } else {
            const h = this._cachedHoldings?.[index];
            symbol = h?.symbol ?? '';
        }
        if (!symbol || symbol === '---') {
            console.log(`${TAG} onHeroTileClick | SKIP index=${index} source=${source} — no symbol at slot`);
            return;
        }
        console.log(`${TAG} onHeroTileClick | resolved index=${index} source=${source} symbol="${symbol}"`);

        for (const b of this._heroTileButtons) b.interactable = false;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Sign hero commit (${symbol})…`;

        // Pulse the tapped tile so the user sees the selection land.
        const tapped = this._heroTileButtons[index]?.node;
        if (tapped) {
            Tween.stopAllByTarget(tapped);
            tapped.setScale(1, 1, 1);
            tween(tapped)
                .to(0.12, { scale: new Vec3(1.15, 1.15, 1) })
                .to(0.12, { scale: new Vec3(1, 1, 1) })
                .start();
        }

        const message = `tdl:hero:${symbol}:ts=${Date.now()}`;
        const sig = await mwa.signMessage(message);

        if (sig && sig.length > 0) {
            this._pickedHeroSymbol = symbol;
            this._pickedHeroSig = sig;
            for (const b of this._heroTileButtons) b.node.active = false;
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Hero locked: ${symbol} — now Sign Stake`;
            showToast(`Hero: ${symbol}`);
            return;
        }

        // Error fallbacks — mirror HomeUI._onSignMessage's code-based messaging.
        // C1: `WALLET_AUTH_MISMATCH` on sign_messages is actually Jupiter (and
        // similar wallets) rejecting the method — the Java side misclassifies
        // "unsupported" as "auth mismatch" because both surface as
        // AuthorizationNotValidException (code=-1). Treat the same as
        // UNSUPPORTED on THIS panel (hero is optional, UX should just degrade).
        // The Home panel still treats WALLET_AUTH_MISMATCH as "wrong wallet"
        // for its signMessage button, which is the correct interpretation
        // THERE (KNOWN_ISSUES #17 wallet-switch case).
        if (
            mwa.lastError?.code === 'UNSUPPORTED' ||
            mwa.lastError?.code === 'WALLET_HUNG' ||
            mwa.lastError?.code === 'WALLET_CRASHED' ||
            mwa.lastError?.code === 'WALLET_AUTH_MISMATCH'
        ) {
            // Wallet doesn't support sign_messages (Phantom, Solflare, Jupiter,
            // ...). Hide tiles and continue without hero bonus.
            for (const b of this._heroTileButtons) b.node.active = false;
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Hero pick unsupported on this wallet — continuing without bonus';
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Hero sign rejected — pick another or skip';
            for (const b of this._heroTileButtons) b.interactable = true;
        }
    }

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
        console.log(`${TAG} _setLandingEnabled | DONE enabled=${enabled} connect_wired=${!!this._connectButton} reconnect_wired=${!!this._reconnectButton}`);
    }

    private _setHomeEnabled(enabled: boolean): void {
        for (const btn of this._allHomeButtons) btn.interactable = enabled;
        console.log(`${TAG} _setHomeEnabled | DONE enabled=${enabled} button_count=${this._allHomeButtons.length}`);
    }
}

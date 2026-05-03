/**
 * MWAManager.ts - Core singleton for Solana Mobile Wallet Adapter operations.
 *
 * Direct port of:
 *   - Unity:  MWAManager.cs  (359 lines) - grant-unity/Assets/Scripts/MWAManager.cs
 *   - Godot:  mwa_manager.gd (522 lines) - grant-godot/scripts/mwa_manager.gd
 *
 * This Component is the single entry point for all MWA operations.
 * Attach it to a Node in your scene and it persists across scene transitions.
 *
 * Usage:
 *   const result = await MWAManager.instance.authorize();
 *   const sig = await MWAManager.instance.signMessage('Hello Solana!');
 *   await MWAManager.instance.deauthorize();
 *
 * Bug Prevention Applied:
 *   G3  - Timeout + logging on every bridge command (no silent failures)
 *   G4  - Pubkey always string from JSON (no object type mismatch)
 *   G5  - Validate pubkey length > 20 before accepting (no empty false positives)
 *   G6  - Deauthorize sends command to native + clears local state
 *   G9  - Chain signMessage after authorize for biometric confirmation
 *   G10 - Require signMessage before deleteAccount
 *   U1  - Deauthorize sends MWA deauthorize RPC via bridge (not just local clear)
 *   U3  - Validate authToken.length after authorize (warn if empty)
 */

import { _decorator, Component, game, sys, director, view, screen, ResolutionPolicy } from 'cc';
import { MWABridge } from './MWABridge';
import { AuthCache } from './AuthCache';
import { getAppIdentity, getSiwsIdentity } from './AppIdentity';
import { isValidBase58Pubkey } from './Base58';
import { SolanaRpc } from './SolanaRpc';
import { buildMemoTransaction } from './TransactionBuilder';
import {
    AuthorizeResult,
    AuthorizeSiwsResult,
    SignInResult,
    WalletCapabilities,
    WalletInfo,
    DeviceInfo,
    MWAError,
    IMWAAuthCache,
} from './MWATypes';
import {
    MWA_AUTHORIZED,
    MWA_AUTH_FAILED,
    MWA_DISCONNECTED,
    MWA_MESSAGE_SIGNED,
    MWA_TRANSACTION_SIGNED,
    MWA_TRANSACTIONS_SENT,
    MWA_CAPABILITIES_RECEIVED,
    MWA_STATUS,
} from './MWAEvents';

const { ccclass } = _decorator;
const TAG = '[MWAManager]';

@ccclass('MWAManager')
export class MWAManager extends Component {

    // ─── Singleton ───────────────────────────────────────────────────────

    private static _instance: MWAManager | null = null;
    private static _resolutionSetupDone: boolean = false;

    /** Global singleton access. Null until onLoad fires. */
    static get instance(): MWAManager | null {
        return MWAManager._instance;
    }

    /**
     * Force the design resolution to 720×1280 portrait with FIXED_WIDTH policy.
     *
     * The Cocos project ships without `settings/v2/packages/project.json`
     * populated, so the editor defaults leak in as 1280×720 landscape at
     * SHOW_ALL - which when rendered inside a portrait-locked Activity
     * produces a small centered rectangle with massive black borders (the
     * "phone inside a phone" look).
     *
     * FIXED_WIDTH scales the design's 720 horizontal units to fill the real
     * device width; height scales proportionally so content extends edge-to-
     * edge vertically and nothing gets clipped on taller screens.
     *
     * Idempotent: first caller wins. Safe to call multiple times.
     */
    private static _setupPortraitResolution(): void {
        if (MWAManager._resolutionSetupDone) {
            console.log(`${TAG} _setupPortraitResolution | SKIP already_done`);
            return;
        }
        try {
            const winSize = screen?.windowSize;
            const devW = winSize?.width ?? -1;
            const devH = winSize?.height ?? -1;
            // Use FIXED_WIDTH so 720 units == device width. On a 1080×2340 phone
            // that gives a ~1.5× scale; content at y=640 still clips only if
            // the device is shorter than 1280 design units scaled - virtually
            // no modern phone is, so fill is complete.
            view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
            MWAManager._resolutionSetupDone = true;
            const vs = view.getVisibleSize();
            const scaleX = view.getScaleX?.() ?? -1;
            const scaleY = view.getScaleY?.() ?? -1;
            console.log(`${TAG} _setupPortraitResolution | DONE design_w=720 design_h=1280 policy=FIXED_WIDTH device_w=${devW} device_h=${devH} visible_w=${vs.width.toFixed(1)} visible_h=${vs.height.toFixed(1)} scale_x=${scaleX} scale_y=${scaleY}`);
        } catch (e: any) {
            console.log(`${TAG} _setupPortraitResolution | FAIL error="${e?.message ?? e}" - scene will fall back to Cocos defaults (landscape letterbox)`);
        }
    }

    // ─── Public State ────────────────────────────────────────────────────

    /** Whether a wallet is currently connected. */
    public isConnected: boolean = false;

    /** Base58-encoded public key of the connected wallet. Empty if not connected. */
    public connectedPubkey: string = '';

    /** MWA auth token for session reuse. May be empty (see Unity Bug U3). */
    public authToken: string = '';

    /** Wallet URI base from MWA authorize response. */
    public walletUriBase: string = '';

    /** Android package name of the connected wallet (e.g., "app.phantom"). Empty if connected via default picker. */
    public connectedWalletPackage: string = '';

    /**
     * Last error from the most recent MWA operation - populated in catch blocks
     * of signMessage/signTransaction/etc., cleared on successful start. Lets
     * UI code branch on specific error codes (e.g., WALLET_CRASHED) without
     * changing the return-empty-on-failure convention of the async methods.
     *
     * Notable codes:
     *   - WALLET_CRASHED - wallet app closed WebSocket mid-request (e.g.,
     *     Solflare sign_messages bug). See KNOWN_ISSUES.md #6.
     *   - USER_REJECTED  - user tapped reject in the wallet UI.
     *   - TIMEOUT        - wallet did not respond within 60s.
     *   - WALLET_ERROR   - generic wallet-side error with a message.
     *   - INVALID_PAYLOADS - payload validation failed at the wallet.
     */
    public lastError: { code: string; message: string } | null = null;

    // ─── Internal ────────────────────────────────────────────────────────

    /** The bridge to native Android MWA layer. */
    private _bridge!: MWABridge;

    /** Persistent auth cache (survives app restarts). Implements IMWAAuthCache for extensibility. */
    private _cache!: IMWAAuthCache;

    /** Guard against concurrent authorize calls. */
    private _authorizing: boolean = false;

    /** Pubkeys that have been deleted this session - prevents reconnect to deleted account. */
    private _deletedPubkeys: Set<string> = new Set();

    /**
     * Lazy Solana JSON-RPC client - instantiated on first use by
     * `_getRpc()`. Used by the Backpack sign+broadcast fallback
     * (`_signAndBroadcastViaRpc`) since Backpack's native
     * `sign_and_send_transactions` crashes with a deserialization bug.
     */
    private _rpc: SolanaRpc | null = null;

    /**
     * Cached `get_capabilities` result for the current session - fetched
     * silently after authorize/reauthorize success. Feeds
     * `supportsSignMessages()` so the UI can hide the Sign Message button
     * on wallets that don't declare the feature (Phantom, Solflare).
     * Cleared on disconnect/delete.
     */
    private _cachedCapabilities: WalletCapabilities | null = null;

    // ─── Lifecycle ───────────────────────────────────────────────────────

    onLoad(): void {
        console.log(`${TAG} onLoad | START instance_exists=${MWAManager._instance != null} node=${this.node.name}`);

        // Session 5 fullscreen fix - runs FIRST so every subsequent UI component
        // gets the right viewport. Cocos defaults to 1280×720 landscape at
        // SHOW_ALL on this project (see build/android/data/src/settings.json),
        // which letterboxes a landscape design inside a portrait phone → tiny
        // centered rectangle with black borders. Overriding here at runtime is
        // editor-proof - survives every rebuild regardless of editor state.
        MWAManager._setupPortraitResolution();

        // Singleton enforcement
        if (MWAManager._instance != null && MWAManager._instance !== this) {
            console.log(`${TAG} onLoad | DUPLICATE destroying self (keeping existing instance)`);
            this.node.destroy();
            return;
        }
        MWAManager._instance = this;

        // addPersistRootNode ONLY works on root-level nodes (direct children of Scene).
        // If MWAManager is nested under Canvas, reparent it to the scene root first.
        const scene = director.getScene();
        if (scene && this.node.parent !== scene) {
            console.log(`${TAG} onLoad | reparenting from ${this.node.parent?.name} to scene root (required for persistence)`);
            this.node.setParent(scene);
        }

        // Persist across scene transitions (equivalent to Unity DontDestroyOnLoad)
        game.addPersistRootNode(this.node);
        console.log(`${TAG} onLoad | singleton established, node persisted across scenes`);

        // Initialize bridge and cache
        this._bridge = new MWABridge();
        this._cache = new AuthCache();

        const identity = getAppIdentity();
        console.log(`${TAG} onLoad | platform=${sys.os} is_native=${sys.isNative} app="${identity.appName}" cluster=${identity.cluster}`);
        console.log(`${TAG} onLoad | bridge_mode=${this._bridge.isNativeAvailable ? 'native' : 'mock'} cache_has_auth=${this._cache.hasCachedAuth()}`);
        console.log(`${TAG} onLoad | DONE`);
    }

    onDestroy(): void {
        console.log(`${TAG} onDestroy | START pubkey=${this.connectedPubkey} is_connected=${this.isConnected}`);

        // Cancel any pending bridge requests
        if (this._bridge) {
            this._bridge.cancelAll();
        }

        // Clear singleton ref if this was the active instance
        if (MWAManager._instance === this) {
            MWAManager._instance = null;
            console.log(`${TAG} onDestroy | singleton reference cleared`);
        }

        console.log(`${TAG} onDestroy | DONE`);
    }

    // ─── Public Accessors ────────────────────────────────────────────────

    /** Access the auth cache for external queries (e.g., LandingUI checks hasCachedAuth). */
    get cache(): IMWAAuthCache {
        return this._cache;
    }

    /**
     * Replace the default auth cache with a custom implementation.
     * Call this before authorize() if you need encrypted, cloud, or custom storage.
     * @example MWAManager.instance.setCache(new MyEncryptedAuthCache());
     */
    setCache(cache: IMWAAuthCache): void {
        console.log(`${TAG} setCache | replacing cache implementation old=${this._cache?.constructor?.name} new=${cache?.constructor?.name}`);
        this._cache = cache;
    }

    /** Check if MWA is available on this platform. */
    isAvailable(): boolean {
        const result = this._bridge?.isNativeAvailable ?? false;
        console.log(`${TAG} isAvailable | platform=${sys.os} is_native=${sys.isNative} result=${result}`);
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  WALLET & DEVICE DETECTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Detect which MWA-compatible wallets are installed on the device.
     * @returns Array of {name, packageName, installed, storeUrl}
     */
    async detectWallets(): Promise<WalletInfo[]> {
        console.log(`${TAG} detectWallets | START - sending detect_wallets to bridge`);
        try {
            const result = await this._bridge.sendCommand<{ wallets: WalletInfo[] }>('detect_wallets', {});
            const wallets = result?.wallets ?? [];
            const installed = wallets.filter(w => w.installed).length;
            for (const w of wallets) {
                console.log(`${TAG} detectWallets |   ${w.installed ? 'INSTALLED' : 'NOT_INSTALLED'} ${w.name} (${w.packageName})`);
            }
            console.log(`${TAG} detectWallets | DONE total=${wallets.length} installed=${installed} not_installed=${wallets.length - installed}`);
            return wallets;
        } catch (e: any) {
            console.log(`${TAG} detectWallets | FAIL error="${e?.message || e}"`);
            return [];
        }
    }

    /**
     * Detect if running on a Solana Mobile device (Seeker/Saga).
     * @returns {isSeeker, isSaga, isSolanaMobile, manufacturer, model}
     */
    async detectDevice(): Promise<DeviceInfo> {
        console.log(`${TAG} detectDevice | START`);
        const fallback: DeviceInfo = { isSeeker: false, isSaga: false, isSolanaMobile: false, manufacturer: '', model: '' };
        try {
            const result = await this._bridge.sendCommand<DeviceInfo>('detect_device', {});
            console.log(`${TAG} detectDevice | DONE isSeeker=${result?.isSeeker} isSaga=${result?.isSaga} manufacturer=${result?.manufacturer} model=${result?.model}`);
            return result ?? fallback;
        } catch (e: any) {
            console.log(`${TAG} detectDevice | FAIL ${e?.message || e}`);
            return fallback;
        }
    }

    /**
     * Authorize with a specific wallet by Android package name.
     * Uses Intent.setPackage() to bypass the OS wallet picker.
     *
     * @param targetPackage Android package name (e.g., "app.phantom")
     * @returns AuthorizeResult on success, null on failure
     */
    async authorizeWithWallet(targetPackage: string): Promise<AuthorizeResult | null> {
        console.log(`${TAG} authorizeWithWallet | START targetPackage=${targetPackage}`);
        return this.authorize(targetPackage);
    }

    /**
     * Open a URL via native Android intent (e.g., Play Store link).
     */
    async openUrl(url: string): Promise<void> {
        console.log(`${TAG} openUrl | START url=${url}`);
        try {
            await this._bridge.sendCommand('open_url', { url });
            console.log(`${TAG} openUrl | DONE`);
        } catch (e: any) {
            console.log(`${TAG} openUrl | FAIL ${e?.message || e}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  AUTHORIZE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Connect to a wallet via MWA and confirm with biometric sign-in.
     *
     * Flow (matches Unity MWAManager.cs:46-96 / Godot mwa_manager.gd:139-221):
     *   1. Send 'authorize' command to native bridge
     *   2. Wallet picker appears (Seed Vault / Phantom / etc.)
     *   3. User approves → bridge returns pubkey + authToken
     *   4. Chain signMessage("Sign in to <APP>") for biometric confirmation (Bug G9)
     *   5. Cache auth, emit MWA_AUTHORIZED event
     *
     * If user rejects at any step, the entire auth is cancelled.
     *
     * @returns AuthorizeResult on success, null on failure/cancellation
     */
    async authorize(targetPackage?: string): Promise<AuthorizeResult | null> {
        console.log(`${TAG} authorize | START is_connected=${this.isConnected} authorizing=${this._authorizing} targetPackage=${targetPackage || '(none)'}`);

        // Pass 10: SIWS-first routing. When the app has configured a SIWS
        // identity via `setSiwsIdentity({ domain, statement })`, delegate to
        // `authorizeSiws()` so MWA 2.0 wallets (Backpack natively; Jupiter /
        // Seed Vault via sign_messages fallback) produce a proof-of-ownership
        // signature alongside the authorize token. Wallets that don't
        // implement the SIWS path degrade gracefully to a plain authorize
        // session (Phantom/Solflare take this route - their sign_messages
        // handler doesn't exist, so the 15 s JS timeout in authorizeSiws
        // fallback fires and we proceed without signInResult).
        const siws = getSiwsIdentity();
        if (siws.domain && siws.domain.length > 0) {
            console.log(`${TAG} authorize | ROUTE=authorizeSiws domain=${siws.domain} statement_len=${siws.statement?.length ?? 0}`);
            return await this.authorizeSiws(siws.domain, siws.statement || '', targetPackage);
        }

        // Guard: don't allow concurrent authorizations
        if (this._authorizing) {
            console.log(`${TAG} authorize | BLOCKED - already authorizing, ignoring duplicate call`);
            return null;
        }
        this._authorizing = true;

        // Clear deleted keys on fresh connect (matches Unity/Godot behavior)
        if (this._deletedPubkeys.size > 0) {
            console.log(`${TAG} authorize | clearing ${this._deletedPubkeys.size} deleted key(s) - fresh connect = clean slate`);
            this._deletedPubkeys.clear();
        }

        this._updateStatus('Requesting wallet authorization...');

        try {
            // Build params from app identity
            const identity = getAppIdentity();
            const params = {
                appName: identity.appName,
                appUri: identity.appUri,
                appIconPath: identity.appIconPath,
                cluster: identity.cluster,
            };

            // Always use plain authorize - OS picker handles wallet selection
            const authorizeParams: Record<string, any> = { ...params };
            if (targetPackage) {
                authorizeParams.targetPackage = targetPackage;
            }

            console.log(`${TAG} authorize | sending authorize command app="${identity.appName}" cluster=${identity.cluster} targetPackage=${targetPackage || '(OS picker)'}`);
            let result: AuthorizeResult | null;
            result = await this._bridge.sendCommand<AuthorizeResult>('authorize', authorizeParams);

            // Validate response (Bug G4, G5 prevention)
            if (!result || !result.pubkey) {
                console.log(`${TAG} authorize | FAIL result is null or missing pubkey`);
                this._updateStatus('Authorization failed - no response from wallet');
                this.node.emit(MWA_AUTH_FAILED, 'Wallet returned null or empty response');
                return null;
            }

            if (!isValidBase58Pubkey(result.pubkey)) {
                console.log(`${TAG} authorize | FAIL invalid pubkey="${result.pubkey}" length=${result.pubkey.length} (must be 32-44 base58 chars)`);
                this._updateStatus('Authorization failed - invalid pubkey returned');
                this.node.emit(MWA_AUTH_FAILED, `Invalid pubkey from wallet: ${result.pubkey}`);
                return null;
            }

            // Bug U3 prevention: warn if auth token is empty
            if (!result.authToken || result.authToken.length === 0) {
                console.log(`${TAG} authorize | WARN auth_token is empty - reauthorization may fail (Unity Bug U3)`);
            }

            // Set connected state (needed for signMessage to work)
            this.connectedPubkey = result.pubkey;
            this.authToken = result.authToken || '';
            this.walletUriBase = result.walletUriBase || '';
            this.connectedWalletPackage = targetPackage || '';
            this.isConnected = true;

            console.log(`${TAG} authorize | STATE_SET pubkey=${this.connectedPubkey} authToken_len=${this.authToken.length} walletUriBase=${this.walletUriBase || '(empty)'} walletPackage="${this.connectedWalletPackage || '(default picker)'}" isConnected=${this.isConnected}`);

            // ─── Cache Auth ──────────────────────────────────────────────
            this._cache.set(this.connectedPubkey, this.authToken, this.walletUriBase, this.connectedWalletPackage);
            console.log(`${TAG} authorize | CACHED pubkey=${this.connectedPubkey} authToken_len=${this.authToken.length} walletPackage=${this.connectedWalletPackage || '(default)'}`);

            // ─── Emit Success ────────────────────────────────────────────
            this._updateStatus(`Connected: ${this._truncatePubkey(this.connectedPubkey)}`);
            this.node.emit(MWA_AUTHORIZED, this.connectedPubkey);

            console.log(`${TAG} authorize | DONE connected=true pubkey=${this.connectedPubkey} - emitted MWA_AUTHORIZED`);
            return result;

        } catch (e: any) {
            const error = e as MWAError;
            console.log(`${TAG} authorize | EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e}`);
            this._updateStatus(`Authorization failed: ${error?.message || e}`);
            this.node.emit(MWA_AUTH_FAILED, error?.message || String(e));
            return null;
        } finally {
            this._authorizing = false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  AUTHORIZE SIWS (MWA 2.0 - Sign In With Solana)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * MWA 2.0 authorize with Sign In With Solana (SIWS).
     * One-shot connect + prove ownership - wallet returns a signed message
     * proving the user owns the account.
     *
     * Matches Godot connectWalletSiws (myAction=5) and Unity _Login SIWS path.
     *
     * @param domain  SIWS domain (e.g., "myapp.example.com")
     * @param statement  SIWS statement (e.g., "Sign in to MyApp")
     * @param targetPackage  Optional wallet package to target directly
     * @returns AuthorizeSiwsResult on success, null on failure
     */
    async authorizeSiws(domain: string, statement: string, targetPackage?: string): Promise<AuthorizeSiwsResult | null> {
        const startTime = Date.now();
        console.log(`${TAG} authorizeSiws | START domain=${domain} statement=${statement} targetPackage=${targetPackage || '(none)'} is_connected=${this.isConnected} authorizing=${this._authorizing}`);

        if (this._authorizing) {
            console.log(`${TAG} authorizeSiws | BLOCKED - already authorizing, ignoring duplicate call`);
            return null;
        }
        this._authorizing = true;

        this._updateStatus('Requesting SIWS authorization...');

        try {
            // STEP 1: Build command parameters
            const identity = getAppIdentity();
            const params: Record<string, any> = {
                appName: identity.appName,
                appUri: identity.appUri,
                appIconPath: identity.appIconPath,
                cluster: identity.cluster,
                siwsDomain: domain,
                siwsStatement: statement,
            };
            if (targetPackage) {
                params.targetPackage = targetPackage;
            }
            console.log(`${TAG} authorizeSiws | STEP_1_PARAMS_BUILT app="${identity.appName}" cluster=${identity.cluster} domain=${domain} statement=${statement} elapsed_ms=${Date.now() - startTime}`);

            // STEP 2: Send authorize_siws command to native bridge
            console.log(`${TAG} authorizeSiws | STEP_2_BRIDGE_SENDING cmd=authorize_siws elapsed_ms=${Date.now() - startTime}`);
            const result = await this._bridge.sendCommand<AuthorizeSiwsResult>('authorize_siws', params);
            console.log(`${TAG} authorizeSiws | STEP_3_RESULT_RECEIVED has_result=${result != null} has_pubkey=${!!(result?.pubkey)} elapsed_ms=${Date.now() - startTime}`);

            // STEP 4: Validate pubkey
            if (!result || !result.pubkey) {
                console.log(`${TAG} authorizeSiws | STEP_4_FAIL result is null or missing pubkey elapsed_ms=${Date.now() - startTime}`);
                this._updateStatus('SIWS authorization failed - no response from wallet');
                this.node.emit(MWA_AUTH_FAILED, 'Wallet returned null or empty response');
                return null;
            }

            if (!isValidBase58Pubkey(result.pubkey)) {
                console.log(`${TAG} authorizeSiws | STEP_4_FAIL invalid pubkey="${result.pubkey}" length=${result.pubkey.length} elapsed_ms=${Date.now() - startTime}`);
                this._updateStatus('SIWS authorization failed - invalid pubkey');
                this.node.emit(MWA_AUTH_FAILED, `Invalid pubkey from wallet: ${result.pubkey}`);
                return null;
            }
            console.log(`${TAG} authorizeSiws | STEP_4_PUBKEY_VALID pubkey=${result.pubkey} elapsed_ms=${Date.now() - startTime}`);

            // STEP 5: Extract SIWS result. Pass 11: the native plugin now
            // handles both paths inside a SINGLE LocalAssociationScenario -
            //   • native sign_in_result (Backpack, Seed Vault when supported)
            //   • in-session sign_messages fallback (Jupiter, …)
            // - which is why there's only one OS wallet picker. Wallets that
            // don't implement sign_messages at all (Phantom, Solflare -
            // KNOWN_ISSUES #11) degrade via the Java-side 15s
            // SIWS_FALLBACK_TIMEOUT_MS and simply come back without
            // `signInResult`. See KNOWN_ISSUES.md #16.
            if (result.signInResult) {
                console.log(`${TAG} authorizeSiws | STEP_5_SIWS_EXTRACTED address=${result.signInResult.address} sig_len=${result.signInResult.signature?.length || 0} sig_preview=${(result.signInResult.signature || '').substring(0, 20)}... signedMsg_len=${result.signInResult.signedMessage?.length || 0} sigType=${result.signInResult.signatureType} elapsed_ms=${Date.now() - startTime}`);
            } else {
                console.log(`${TAG} authorizeSiws | STEP_5_SIWS_ABSENT - Java in-session fallback unavailable (wallet likely doesn't implement sign_messages); authorize-only session elapsed_ms=${Date.now() - startTime}`);
            }

            console.log(`${TAG} authorizeSiws | STEP_5_ACCOUNT_META label="${result.accountLabel || ''}" chains="${result.accountChains || ''}" features="${result.accountFeatures || ''}" elapsed_ms=${Date.now() - startTime}`);

            if (!result.authToken || result.authToken.length === 0) {
                console.log(`${TAG} authorizeSiws | STEP_5_WARN auth_token is empty - reauthorization may fail`);
            }

            // STEP 6: Commit connection state (post-authorize, once we know the
            // bridge call succeeded - no more pre-fallback ordering hack).
            this.connectedPubkey = result.pubkey;
            this.authToken = result.authToken || '';
            this.walletUriBase = result.walletUriBase || '';
            this.connectedWalletPackage = targetPackage || '';
            this.isConnected = true;
            console.log(`${TAG} authorizeSiws | STEP_6_STATE_SET pubkey=${this.connectedPubkey} authToken_len=${this.authToken.length} isConnected=${this.isConnected} siwsResult=${result.signInResult != null} elapsed_ms=${Date.now() - startTime}`);

            // STEP 7: Cache auth
            this._cache.set(this.connectedPubkey, this.authToken, this.walletUriBase, this.connectedWalletPackage);
            console.log(`${TAG} authorizeSiws | STEP_7_CACHED pubkey=${this.connectedPubkey} authToken_len=${this.authToken.length} elapsed_ms=${Date.now() - startTime}`);

            // STEP 8: Emit success event
            this._updateStatus(`SIWS Connected: ${this._truncatePubkey(this.connectedPubkey)}`);
            this.node.emit(MWA_AUTHORIZED, this.connectedPubkey);

            const totalMs = Date.now() - startTime;
            console.log(`${TAG} authorizeSiws | STEP_8_DONE pubkey=${this.connectedPubkey} hasSiws=${result.signInResult != null} total_elapsed_ms=${totalMs}`);
            return result;

        } catch (e: any) {
            const elapsed = Date.now() - startTime;
            const error = e as MWAError;
            console.log(`${TAG} authorizeSiws | FAIL_EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e} elapsed_ms=${elapsed}`);
            this._updateStatus(`SIWS authorization failed: ${error?.message || e}`);
            this.node.emit(MWA_AUTH_FAILED, error?.message || String(e));
            return null;
        } finally {
            this._authorizing = false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  REAUTHORIZE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Reconnect silently from persistent cache - client-only operation.
     *
     * Parity with Unity `Login()` (returns cached pubkey via PlayerPrefs
     * without RPC), Godot cached-connect (trust local state), and React
     * Native account hydration from cache. No MWA RPC is sent to the wallet
     * - doing so would require opening a LocalAssociationScenario which
     * would launch the wallet app and prompt the user. That's a UX bug
     * (observed: Backpack opened and prompted on "Reconnect (cached)").
     *
     * Behavior:
     *   - Cache hit → restore in-memory state, emit MWA_AUTHORIZED, return
     *     the cached auth shape {pubkey, authToken, walletUriBase}.
     *   - Cache empty → return null (UI keeps showing Landing's Connect
     *     button; no fallback to full authorize because that's user's
     *     explicit next action).
     *   - Cached pubkey is in the deleted-pubkeys session set → return
     *     null; cache stays cleared.
     *
     * The next privileged operation (signMessage, signTransaction, etc.)
     * will validate the cached authToken implicitly inside its own
     * transact() session - if the token is stale/expired, that call will
     * fail and the user can re-authorize then.
     *
     * @returns AuthorizeResult on cache hit, null on cache miss
     */
    async reauthorize(): Promise<AuthorizeResult | null> {
        console.log(`${TAG} reauthorize | START (client-only cache restore)`);

        const cached = this._cache.getLatest();
        if (!cached) {
            console.log(`${TAG} reauthorize | FAIL no cached authorization found`);
            this._updateStatus('No cached authorization found');
            return null;
        }

        // Reject deleted pubkeys - prevent reconnect to an account the user
        // deleted earlier in this app session.
        if (this._deletedPubkeys.has(cached.pubkey)) {
            console.log(`${TAG} reauthorize | REJECTED pubkey=${cached.pubkey} is in deleted keys`);
            this._updateStatus('Previously deleted account - please connect fresh');
            return null;
        }

        // Validate pubkey shape defensively (guards against corrupted cache)
        if (!cached.pubkey || !isValidBase58Pubkey(cached.pubkey)) {
            console.log(`${TAG} reauthorize | FAIL cached pubkey invalid shape - treating as cache miss`);
            this._updateStatus('Cached auth corrupted - please connect fresh');
            return null;
        }

        const cacheAge = Math.floor(Date.now() / 1000) - (cached.timestamp || 0);
        console.log(`${TAG} reauthorize | cached_pubkey=${cached.pubkey} cached_token_len=${cached.authToken?.length ?? 0} walletPackage=${cached.walletPackage || '(default)'} timestamp=${cached.timestamp} age_seconds=${cacheAge}`);

        // Restore in-memory state from cache
        this.connectedPubkey = cached.pubkey;
        this.authToken = cached.authToken || '';
        this.walletUriBase = cached.walletUriBase || '';
        this.connectedWalletPackage = cached.walletPackage || '';
        this.isConnected = true;
        this.lastError = null;

        // Bug U3: warn if cached token empty (signMessage may need to re-auth)
        if (!this.authToken) {
            console.log(`${TAG} reauthorize | WARN cached auth_token is empty - next privileged op may fail`);
        }

        const result: AuthorizeResult = {
            pubkey: this.connectedPubkey,
            authToken: this.authToken,
            walletUriBase: this.walletUriBase,
        };

        // Pass 10: re-write the cache entry so `isAuthenticated` flips back
        // to `true`. The Pass-3 flow left cache untouched here on the
        // assumption that nothing had changed on disk - but after Pass 10
        // `deauthorize()` marks the entry as disconnected, so a successful
        // reconnect needs to flip it back or cold-start auto-sign-in would
        // stay off until the next fresh authorize.
        this._cache.set(this.connectedPubkey, this.authToken, this.walletUriBase, this.connectedWalletPackage);

        console.log(`${TAG} reauthorize | SUCCESS (from cache) pubkey=${this.connectedPubkey} auth_token_len=${this.authToken.length} cache_reauth_marked=true`);
        this._updateStatus(`Reconnected: ${this._truncatePubkey(this.connectedPubkey)}`);
        this.node.emit(MWA_AUTHORIZED, this.connectedPubkey);

        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DEAUTHORIZE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Disconnect wallet - client-side only operation. Cache is RETAINED.
     *
     * Clears in-memory state (`isConnected`, `connectedPubkey`, `authToken`,
     * `walletUriBase`, `connectedWalletPackage`) so the user is no longer
     * actively connected, but leaves the persistent cache intact so the
     * Landing panel can show "Reconnect (cached)" alongside "Connect".
     * User then chooses:
     *   - "Reconnect (cached)" → instant restore from cache (no wallet intent)
     *   - "Connect" → fresh OS-picker authorize (cache overwritten)
     *   - "Delete Account" (from Home) → protocol-level revoke + cache wipe
     *
     * No MWA RPC is sent to the wallet - doing so would require opening a
     * LocalAssociationScenario which would launch the wallet app and prompt
     * the user for approval. That's a UX bug (observed: Backpack opened and
     * prompted on disconnect before Pass 2).
     *
     * For explicit protocol-level revocation + cache wipe, call
     * `deauthorizeRemote()` (sends MWA deauthorize RPC + clears cache) or
     * `deleteAccount()` (sign-and-deauthorize + cache wipe).
     *
     * The wallet's copy of the auth token is orphaned until the user manually
     * revokes in the wallet's "Connected Apps" UI - standard behavior across
     * all peer SDKs.
     */
    async deauthorize(): Promise<void> {
        console.log(`${TAG} deauthorize | START (client-only, cache retained) pubkey=${this.connectedPubkey} is_connected=${this.isConnected} auth_token_len=${this.authToken.length}`);

        const oldPubkey = this.connectedPubkey;
        const oldPackage = this.connectedWalletPackage;
        const oldTokenLen = this.authToken?.length ?? 0;

        // Clear in-memory state only - cache is kept so the Landing panel
        // can offer "Reconnect (cached)" for a one-tap restore.
        this.connectedPubkey = '';
        this.authToken = '';
        this.walletUriBase = '';
        this.connectedWalletPackage = '';
        this.isConnected = false;
        this.lastError = null;
        this._cachedCapabilities = null;

        // Pass 10: flip cache.isAuthenticated=false so cold-start auto-sign-in
        // stays off until the user explicitly reconnects. Preserves pubkey +
        // authToken so the Landing "Reconnect (cached)" button continues to
        // work - the only thing that changes is `hasAutoLoginAuth()` returns
        // false until `reauthorize()` or `authorize()` re-writes the entry.
        if (oldPubkey) {
            this._cache.markDisconnected(oldPubkey);
        }

        console.log(`${TAG} deauthorize | DONE old_pubkey=${oldPubkey} old_walletPackage="${oldPackage}" old_authToken_len=${oldTokenLen} isConnected=${this.isConnected} cache_retained=true cache_marked_disconnected=${!!oldPubkey}`);
        this._updateStatus('Disconnected');
        this.node.emit(MWA_DISCONNECTED);
    }

    /**
     * Protocol-level deauthorize - sends the MWA `deauthorize` RPC to the
     * wallet and clears local state. Opens the wallet app; user may see an
     * approval prompt. Use only when you explicitly need the wallet's copy
     * of the auth token invalidated (rare - Unity's `DisconnectWallet()`
     * does this as a best-effort operation).
     *
     * Default UI "Disconnect" button maps to `deauthorize()` (client-only),
     * not this method, for parity with peer SDKs.
     */
    async deauthorizeRemote(): Promise<void> {
        console.log(`${TAG} deauthorizeRemote | START pubkey=${this.connectedPubkey} is_connected=${this.isConnected}`);
        this._updateStatus('Revoking session with wallet...');

        if (this.isConnected && this.authToken) {
            try {
                console.log(`${TAG} deauthorizeRemote | sending deauthorize RPC via bridge`);
                await this._bridge.sendCommand('deauthorize', this._withSessionParams({ authToken: this.authToken }));
                console.log(`${TAG} deauthorizeRemote | deauthorize RPC sent successfully`);
            } catch (e: any) {
                console.log(`${TAG} deauthorizeRemote | WARN deauthorize RPC failed: ${e?.message || e} (clearing local state anyway)`);
            }
        }

        // Delegate to client-only path to clear state + cache + emit
        await this.deauthorize();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  AUTH RECOVERY (Pass 14 - KNOWN_ISSUES #17)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Transparent recovery from `WALLET_AUTH_MISMATCH`. The wallet rejected
     * its own previously-issued cached `authToken` on `reauthorize` (the
     * wallet's process was killed, its session expired, or its local token
     * store was rotated - see KNOWN_ISSUES.md #17). The cached state on the
     * Cocos side is verifiably dead; the only way forward is to authorize
     * fresh and try again.
     *
     * Caller invokes the privileged op; on `lastError.code === 'WALLET_AUTH_MISMATCH'`,
     * caller invokes this helper. We wipe the dead token, call `authorize()`
     * (deep-link if `connectedWalletPackage` is known, else OS picker), and
     * verify the new pubkey matches. If so, return `true` - caller retries
     * the op once. If pubkey changed (user genuinely picked a different
     * wallet), set `WALLET_CHANGED` and return `false`. If re-auth itself
     * failed/dismissed, preserve `WALLET_AUTH_MISMATCH` and return `false`.
     *
     * Bounded to one retry per call site to prevent popup loops.
     */
    private async _recoverFromAuthMismatch(opName: string): Promise<boolean> {
        if (this.lastError?.code !== 'WALLET_AUTH_MISMATCH') return false;

        const originalPubkey = this.connectedPubkey;
        const targetPackage = this.connectedWalletPackage;
        console.log(`${TAG} ${opName} | RECOVERY_START WALLET_AUTH_MISMATCH detected - transparent re-auth pubkey=${originalPubkey.slice(0, 8)}… target=${targetPackage || '(picker)'}`);
        this._updateStatus('Refreshing wallet session…');

        // Wipe the dead token. Keep connectedPubkey/isConnected so UI doesn't
        // flash "disconnected" - authorize() overwrites both on success.
        try { this._cache.clear(originalPubkey); } catch (_) { /* ignore */ }
        this.authToken = '';
        this.lastError = null;

        let authResult: AuthorizeResult | AuthorizeSiwsResult | null = null;
        try {
            authResult = await this.authorize(targetPackage);
        } catch (e) {
            console.log(`${TAG} ${opName} | RECOVERY_FAIL re-auth threw err=${e}`);
            this.lastError = { code: 'WALLET_AUTH_MISMATCH', message: 'Re-auth failed during recovery' };
            return false;
        }

        if (!authResult || !authResult.pubkey) {
            console.log(`${TAG} ${opName} | RECOVERY_FAIL re-auth returned null (user dismissed?)`);
            this.lastError = { code: 'WALLET_AUTH_MISMATCH', message: 'Re-auth dismissed during recovery' };
            return false;
        }

        if (authResult.pubkey !== originalPubkey) {
            console.log(`${TAG} ${opName} | RECOVERY_FAIL pubkey_mismatch was=${originalPubkey.slice(0, 8)} now=${authResult.pubkey.slice(0, 8)}`);
            this.lastError = {
                code: 'WALLET_CHANGED',
                message: `Different wallet selected (${authResult.pubkey.slice(0, 8)}…). Reconnect to switch accounts.`,
            };
            return false;
        }

        console.log(`${TAG} ${opName} | RECOVERY_OK same pubkey, retrying original op`);
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SIGN MESSAGE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sign a text message and return the base64-encoded signature.
     *
     * Port of Unity MWAManager.cs:146-187 / Godot mwa_manager.gd:271-301.
     *
     * The message is UTF-8 encoded, sent to the wallet for signing via MWA,
     * and the 64-byte Ed25519 signature is returned as a base64 string.
     *
     * @param message - The text message to sign
     * @returns Base64-encoded signature string, or empty string on failure
     */
    async signMessage(message: string): Promise<string> {
        // Pass 14: clear stale lastError on entry.
        this.lastError = null;
        const result = await this._signMessageInner(message);
        if (result.length > 0) return result;
        // Pass 14: transparent recovery on stale-token mismatch.
        if (await this._recoverFromAuthMismatch('signMessage')) {
            return await this._signMessageInner(message);
        }
        return result;
    }

    private async _signMessageInner(message: string): Promise<string> {
        console.log(`${TAG} signMessage | START message_len=${message.length} is_connected=${this.isConnected}`);

        if (!this.isConnected || !this.connectedPubkey) {
            console.log(`${TAG} signMessage | FAIL not connected (is_connected=${this.isConnected} pubkey="${this.connectedPubkey}")`);
            this._updateStatus('Not connected');
            this.lastError = { code: 'NOT_CONNECTED', message: 'Not connected' };
            return '';
        }

        // Belt-and-suspenders: if we know the wallet doesn't support
        // sign_messages (via cached caps or static package map), skip the
        // wallet roundtrip and surface a truthful error immediately.
        if (!this.supportsSignMessages()) {
            console.log(`${TAG} signMessage | FAIL wallet doesn't support sign_messages walletPackage="${this.connectedWalletPackage || '(unknown)'}" cachedFeatures=${this._cachedCapabilities ? '[' + this._cachedCapabilities.features.join(',') + ']' : '(none)'}`);
            this.lastError = { code: 'UNSUPPORTED', message: 'Wallet does not support sign_messages' };
            this._updateStatus('This wallet does not support sign_messages');
            return '';
        }

        this._updateStatus('Signing message...');

        try {
            // Encode message as base64 payload
            const encoder = new TextEncoder();
            const messageBytes = encoder.encode(message);
            const payloadBase64 = this._uint8ArrayToBase64(messageBytes);

            console.log(`${TAG} signMessage | sending sign_messages command payload_bytes=${messageBytes.length} payload_base64_len=${payloadBase64.length}`);

            const result = await this._bridge.sendCommand<{ signatures: string[] }>('sign_messages', this._withSessionParams({
                payloads: [payloadBase64],
                addresses: [this.connectedPubkey],
                authToken: this.authToken,
            }));

            // Validate response
            if (!result || !result.signatures || result.signatures.length === 0) {
                console.log(`${TAG} signMessage | FAIL empty or missing signatures in response`);
                this._updateStatus('Sign message failed - empty signature');
                this.lastError = { code: 'EMPTY_SIGNATURE', message: 'Wallet returned no signatures' };
                return '';
            }

            const sig = result.signatures[0];
            if (!sig || sig.length === 0) {
                console.log(`${TAG} signMessage | FAIL signature[0] is empty`);
                this._updateStatus('Sign message failed - empty signature');
                this.lastError = { code: 'EMPTY_SIGNATURE', message: 'Wallet returned an empty signature' };
                return '';
            }

            console.log(`${TAG} signMessage | SUCCESS sig_len=${sig.length} sig=${sig.substring(0, 20)}...`);
            this._updateStatus(`Signed: ${sig.substring(0, 20)}...`);
            this.node.emit(MWA_MESSAGE_SIGNED, sig);
            return sig;

        } catch (e: any) {
            const error = e as MWAError;
            const code = error?.code || 'UNKNOWN';
            const msg = error?.message || String(e);
            console.log(`${TAG} signMessage | EXCEPTION code=${code} message=${msg}`);
            this.lastError = { code, message: msg };
            // Friendlier status text for the known-broken Solflare path so the
            // label + toast don't just say "Unknown error". Pass 13 adds the
            // wrong-wallet branch (KNOWN_ISSUES.md #17).
            let statusMsg: string;
            if (code === 'WALLET_CRASHED') {
                statusMsg = 'Wallet crashed - try Backpack, Phantom, or Jupiter';
            } else if (code === 'WALLET_AUTH_MISMATCH') {
                statusMsg = 'Sign message failed - wrong wallet picked. Use the wallet you connected with, or Disconnect and Connect again.';
            } else {
                statusMsg = `Sign message failed: ${msg}`;
            }
            this._updateStatus(statusMsg);
            return '';
        }
    }

    /**
     * Sign multiple message payloads.
     *
     * @param payloads - Array of Uint8Array message payloads
     * @returns Array of base64-encoded signatures, or empty array on failure
     */
    async signMessages(payloads: Uint8Array[]): Promise<string[]> {
        // Pass 14: clear stale lastError on entry.
        this.lastError = null;
        const result = await this._signMessagesInner(payloads);
        if (result.length > 0) return result;
        // Pass 14: transparent recovery on stale-token mismatch.
        if (await this._recoverFromAuthMismatch('signMessages')) {
            return await this._signMessagesInner(payloads);
        }
        return result;
    }

    private async _signMessagesInner(payloads: Uint8Array[]): Promise<string[]> {
        console.log(`${TAG} signMessages | START payload_count=${payloads.length} is_connected=${this.isConnected}`);

        if (!this.isConnected || !this.connectedPubkey) {
            console.log(`${TAG} signMessages | FAIL not connected`);
            this._updateStatus('Not connected');
            return [];
        }

        this._updateStatus(`Signing ${payloads.length} message(s)...`);

        try {
            const payloadsBase64 = payloads.map(p => this._uint8ArrayToBase64(p));
            console.log(`${TAG} signMessages | sending sign_messages command payload_count=${payloadsBase64.length}`);

            const result = await this._bridge.sendCommand<{ signatures: string[] }>('sign_messages', this._withSessionParams({
                payloads: payloadsBase64,
                addresses: [this.connectedPubkey],
                authToken: this.authToken,
            }));

            if (!result || !result.signatures) {
                console.log(`${TAG} signMessages | FAIL empty response`);
                this._updateStatus('Sign messages failed');
                return [];
            }

            console.log(`${TAG} signMessages | SUCCESS signature_count=${result.signatures.length}`);
            this._updateStatus(`Signed ${result.signatures.length} message(s)`);
            return result.signatures;

        } catch (e: any) {
            const error = e as MWAError;
            const code = error?.code || 'UNKNOWN';
            const msg = error?.message || String(e);
            console.log(`${TAG} signMessages | EXCEPTION code=${code} message=${msg}`);
            this.lastError = { code, message: msg };
            const statusMsg = code === 'WALLET_AUTH_MISMATCH'
                ? 'Sign messages failed - wrong wallet picked. Use the wallet you connected with, or Disconnect and Connect again.'
                : `Sign messages failed: ${msg}`;
            this._updateStatus(statusMsg);
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SIGN TRANSACTIONS (sign-only, no broadcast)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sign a single transaction without broadcasting. Returns the signed tx bytes.
     *
     * Port of Unity MWAManager.cs:SignTransaction / Godot mwa_manager.gd:sign_transaction.
     *
     * @param transaction - Serialized transaction as Uint8Array (unsigned)
     * @returns Signed transaction bytes as Uint8Array, or empty Uint8Array on failure
     */
    async signTransaction(transaction: Uint8Array): Promise<Uint8Array> {
        console.log(`${TAG} signTransaction | START tx_bytes=${transaction.length} is_connected=${this.isConnected}`);

        const results = await this.signTransactions([transaction]);
        if (results.length > 0 && results[0].length > 0) {
            console.log(`${TAG} signTransaction | SUCCESS signed_bytes=${results[0].length}`);
            return results[0];
        }
        console.log(`${TAG} signTransaction | FAIL results_count=${results.length} first_len=${results[0]?.length ?? 0}`);
        return new Uint8Array(0);
    }

    /**
     * Sign multiple transactions without broadcasting. Returns the signed tx bytes.
     *
     * The wallet injects signatures into each transaction and returns them.
     * Unlike signAndSendTransactions, these are NOT broadcast - the caller
     * can inspect the signed bytes, broadcast at their own pace, or discard.
     *
     * @param transactions - Array of serialized transactions (unsigned Uint8Arrays)
     * @returns Array of signed transaction bytes as Uint8Arrays
     */
    async signTransactions(transactions: Uint8Array[]): Promise<Uint8Array[]> {
        // Pass 14: clear stale lastError on entry so a leftover code from a
        // prior op can't masquerade as this op's failure cause.
        this.lastError = null;
        const result = await this._signTransactionsInner(transactions);
        if (result.length > 0) return result;
        // Pass 14: transparent recovery on stale-token mismatch
        // (KNOWN_ISSUES #17). One retry max per call site.
        if (await this._recoverFromAuthMismatch('signTransactions')) {
            return await this._signTransactionsInner(transactions);
        }
        return result;
    }

    private async _signTransactionsInner(transactions: Uint8Array[]): Promise<Uint8Array[]> {
        console.log(`${TAG} signTransactions | START tx_count=${transactions.length} is_connected=${this.isConnected}`);

        if (!this.isConnected || !this.connectedPubkey) {
            console.log(`${TAG} signTransactions | FAIL not connected`);
            this._updateStatus('Not connected');
            return [];
        }

        this._updateStatus(`Signing ${transactions.length} transaction(s)...`);

        try {
            const payloadsBase64 = transactions.map((tx, i) => {
                const b64 = this._uint8ArrayToBase64(tx);
                console.log(`${TAG} signTransactions | payload[${i}] bytes=${tx.length} base64_len=${b64.length}`);
                return b64;
            });

            console.log(`${TAG} signTransactions | sending sign_transactions command payload_count=${payloadsBase64.length}`);

            const result = await this._bridge.sendCommand<{ signedPayloads: string[] }>('sign_transactions', this._withSessionParams({
                payloads: payloadsBase64,
                authToken: this.authToken,
            }));

            if (!result || !result.signedPayloads || result.signedPayloads.length === 0) {
                console.log(`${TAG} signTransactions | FAIL empty or missing signedPayloads in response`);
                this._updateStatus('Sign transaction failed - no signed data returned');
                return [];
            }

            // Decode base64 signed payloads back to Uint8Arrays
            const signedTxs = result.signedPayloads.map((b64, i) => {
                const bytes = this._base64ToUint8Array(b64);
                console.log(`${TAG} signTransactions | signedPayload[${i}] base64_len=${b64.length} decoded_bytes=${bytes.length}`);
                return bytes;
            });

            console.log(`${TAG} signTransactions | SUCCESS signed_count=${signedTxs.length}`);
            this._updateStatus(`Transaction signed!`);
            this.node.emit(MWA_TRANSACTION_SIGNED, signedTxs);
            return signedTxs;

        } catch (e: any) {
            const error = e as MWAError;
            const code = error?.code || 'UNKNOWN';
            const msg = error?.message || String(e);
            console.log(`${TAG} signTransactions | EXCEPTION code=${code} message=${msg}`);
            // Persist so `deleteAccount` (which gates on signTransactions) can
            // distinguish `WALLET_AUTH_MISMATCH` (Pass 13 / KNOWN_ISSUES #17
            // - user picked a different wallet than the one that issued the
            // cached token) from the default `DELETE_CANCELLED` path.
            this.lastError = { code, message: msg };
            const statusMsg = code === 'WALLET_AUTH_MISMATCH'
                ? 'Sign transaction failed - wrong wallet picked. Use the wallet you connected with, or Disconnect and Connect again.'
                : `Sign transaction failed: ${msg}`;
            this._updateStatus(statusMsg);
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SIGN AND SEND TRANSACTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sign and broadcast a single transaction (DEFAULT path: sign via MWA
     * + broadcast via Solana JSON-RPC - Godot Node-level pattern).
     *
     * This pattern works for every wallet including Backpack, whose native
     * MWA `sign_and_send_transactions` handler crashes with a Kotlin
     * JsonDecodingException. Only one wallet intent is opened (the
     * signTransactions call) - same UX as the native path, one approval.
     *
     * To use MWA 2.0's native `sign_and_send_transactions` RPC directly
     * (will fail on Backpack), call `signAndSendTransactionNative()` instead.
     *
     * @param transaction - Serialized transaction as Uint8Array (unsigned)
     * @returns Transaction signature (base58) on success, empty string on failure
     */
    async signAndSendTransaction(transaction: Uint8Array): Promise<string> {
        console.log(`${TAG} signAndSendTransaction | START tx_bytes=${transaction.length} is_connected=${this.isConnected}`);

        const sigs = await this.signAndSendTransactions([transaction]);
        const sig = sigs.length > 0 ? sigs[0] : '';
        console.log(`${TAG} signAndSendTransaction | DONE returned_count=${sigs.length} sig_len=${sig.length} sig_preview="${sig.substring(0, 16)}${sig.length > 16 ? '...' : ''}" lastError=${this.lastError?.code ?? '(none)'}`);
        return sig;
    }

    /**
     * Sign and broadcast multiple transactions (DEFAULT path: sign via MWA
     * + broadcast via Solana JSON-RPC - Godot Node-level pattern).
     *
     * Always routes through `_signAndBroadcastViaRpc`. No wallet-identity
     * branching, no native MWA `sign_and_send_transactions` by default.
     * Works for every wallet including Backpack.
     *
     * For MWA 2.0 native sign_and_send, use `signAndSendTransactionsNative`.
     *
     * @param transactions - Array of unsigned serialized transactions
     * @param options      - Solana RPC options passed through to sendTransaction
     * @returns Array of base58 transaction signatures, or [] on failure
     */
    async signAndSendTransactions(transactions: Uint8Array[], options?: {
        commitment?: string;
        skipPreflight?: boolean;
    }): Promise<string[]> {
        const pkg = this.connectedWalletPackage;
        console.log(`${TAG} signAndSendTransactions | START tx_count=${transactions.length} is_connected=${this.isConnected} walletPackage=${pkg || '(default)'}`);

        if (!this.isConnected || !this.connectedPubkey) {
            console.log(`${TAG} signAndSendTransactions | FAIL not connected`);
            this._updateStatus('Not connected');
            return [];
        }

        // Routing decision:
        //   1. Backpack → sign+RPC (native handler crashes, KNOWN_ISSUES #9)
        //   2. Known native-supporting wallet targeted via wallet-list button → native MWA
        //      (Phantom, Jupiter - see _NATIVE_SIGN_AND_SEND_SUPPORTED)
        //   3. Everything else (OS picker, Solflare, Seed Vault, unknown) → sign+RPC
        //      This is the safe default: works for every wallet tested and doesn't
        //      require us to guess wallet identity when the OS picker hides it.
        const forceSignRpc = !!pkg && MWAManager._FORCE_SIGN_AND_RPC.has(pkg);
        const canNative = !!pkg && !forceSignRpc && MWAManager._NATIVE_SIGN_AND_SEND_SUPPORTED.has(pkg);

        if (canNative) {
            console.log(`${TAG} signAndSendTransactions | ROUTE route=native pkg=${pkg} (wallet advertises native sign_and_send)`);
            return await this.signAndSendTransactionsNative(transactions, options);
        }

        console.log(`${TAG} signAndSendTransactions | ROUTE route=sign+rpc pkg=${pkg || '(unknown)'} reason=${forceSignRpc ? 'backpack_native_crash' : 'default_universal_path'}`);
        return await this._signAndBroadcastViaRpc(transactions, options);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SIGN AND SEND TRANSACTION - NATIVE MWA 2.0 (advanced, opt-in)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Advanced: use MWA 2.0's native `sign_and_send_transactions` RPC
     * directly. The wallet signs AND submits the transaction in one step,
     * returning a signature.
     *
     * **Will fail on Backpack** (JsonDecodingException in Backpack's Kotlin
     * module, see KNOWN_ISSUES.md #9). Use the default `signAndSendTransaction`
     * instead for universal wallet compatibility.
     *
     * Kept exposed for:
     *   - Demonstrating MWA 2.0 spec compliance
     *   - Wallets that fully support native sign_and_send and where the
     *     caller specifically wants wallet-side broadcast (batching, etc.)
     */
    async signAndSendTransactionNative(transaction: Uint8Array): Promise<string> {
        console.log(`${TAG} signAndSendTransactionNative | START tx_bytes=${transaction.length} is_connected=${this.isConnected}`);
        const sigs = await this.signAndSendTransactionsNative([transaction]);
        if (sigs.length > 0 && sigs[0]) return sigs[0];
        return '';
    }

    /**
     * Advanced: MWA 2.0 native `sign_and_send_transactions` RPC (batch).
     * See `signAndSendTransactionNative` for caveats (Backpack crashes).
     */
    async signAndSendTransactionsNative(transactions: Uint8Array[], options?: {
        minContextSlot?: number;
        commitment?: string;
        skipPreflight?: boolean;
        maxRetries?: number;
        waitForCommitment?: boolean;
    }): Promise<string[]> {
        // Pass 14: clear stale lastError on entry.
        this.lastError = null;
        const result = await this._signAndSendTransactionsNativeInner(transactions, options);
        if (result.length > 0) return result;
        // Pass 14: transparent recovery on stale-token mismatch.
        if (await this._recoverFromAuthMismatch('signAndSendTransactionsNative')) {
            return await this._signAndSendTransactionsNativeInner(transactions, options);
        }
        return result;
    }

    private async _signAndSendTransactionsNativeInner(transactions: Uint8Array[], options?: {
        minContextSlot?: number;
        commitment?: string;
        skipPreflight?: boolean;
        maxRetries?: number;
        waitForCommitment?: boolean;
    }): Promise<string[]> {
        const startTime = Date.now();
        console.log(`${TAG} signAndSendTransactionsNative | START tx_count=${transactions.length} is_connected=${this.isConnected} minContextSlot=${options?.minContextSlot ?? 'auto'} walletPackage=${this.connectedWalletPackage || '(default)'}`);

        if (!this.isConnected || !this.connectedPubkey) {
            console.log(`${TAG} signAndSendTransactionsNative | FAIL not connected`);
            this._updateStatus('Not connected');
            return [];
        }

        this._updateStatus(`Signing and sending ${transactions.length} transaction(s) via MWA native...`);

        try {
            // STEP 1: Encode transaction payloads as base64
            const payloadsBase64 = transactions.map((tx, i) => {
                const b64 = this._uint8ArrayToBase64(tx);
                console.log(`${TAG} signAndSendTransactionsNative | STEP_1_PAYLOAD_ENCODED [${i}] bytes=${tx.length} base64_len=${b64.length}`);
                return b64;
            });
            console.log(`${TAG} signAndSendTransactionsNative | STEP_1_PAYLOADS_ENCODED count=${payloadsBase64.length} elapsed_ms=${Date.now() - startTime}`);

            // STEP 2: Auto-fetch minContextSlot if not provided (Phantom requires it - solana-mobile#1146)
            let minContextSlot = options?.minContextSlot;
            if (minContextSlot == null) {
                try {
                    const identity = getAppIdentity();
                    const rpcUrl = identity.cluster === 'devnet'
                        ? 'https://api.devnet.solana.com'
                        : 'https://api.mainnet-beta.solana.com';
                    const resp = await fetch(rpcUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: options?.commitment || 'confirmed' }] }),
                    });
                    const json = await resp.json();
                    if (json?.result?.context?.slot) {
                        minContextSlot = json.result.context.slot;
                        console.log(`${TAG} signAndSendTransactionsNative | STEP_2_CONTEXT_SLOT fetched minContextSlot=${minContextSlot} elapsed_ms=${Date.now() - startTime}`);
                    }
                } catch (e) { /* non-fatal */ }
            }

            // STEP 3: Send sign_and_send command to native bridge
            const bridgeParams: any = {
                payloads: payloadsBase64,
                authToken: this.authToken,
            };
            if (minContextSlot != null) bridgeParams.minContextSlot = minContextSlot;
            if (options?.commitment) bridgeParams.commitment = options.commitment;
            if (options?.skipPreflight != null) bridgeParams.skipPreflight = options.skipPreflight;
            if (options?.maxRetries != null) bridgeParams.maxRetries = options.maxRetries;
            if (options?.waitForCommitment != null) bridgeParams.waitForCommitment = options.waitForCommitment;

            console.log(`${TAG} signAndSendTransactionsNative | STEP_3_BRIDGE_SENDING cmd=sign_and_send authToken_len=${this.authToken.length} minContextSlot=${minContextSlot ?? 'null'} elapsed_ms=${Date.now() - startTime}`);
            const result = await this._bridge.sendCommand<{ signatures: string[] }>('sign_and_send', this._withSessionParams(bridgeParams));
            console.log(`${TAG} signAndSendTransactionsNative | STEP_4_RESULT_RECEIVED has_result=${result != null} has_signatures=${!!(result?.signatures)} elapsed_ms=${Date.now() - startTime}`);

            if (!result || !result.signatures) {
                console.log(`${TAG} signAndSendTransactionsNative | STEP_5_FAIL empty response elapsed_ms=${Date.now() - startTime}`);
                this._updateStatus('Sign & send (native) failed - no signatures returned');
                return [];
            }

            for (let i = 0; i < result.signatures.length; i++) {
                console.log(`${TAG} signAndSendTransactionsNative | STEP_5_SIG[${i}] base58=${result.signatures[i].substring(0, 20)}... sig_len=${result.signatures[i].length}`);
            }

            this._updateStatus(`Sent (native)! Sig: ${result.signatures[0]?.substring(0, 20)}...`);
            this.node.emit(MWA_TRANSACTIONS_SENT, result.signatures);
            console.log(`${TAG} signAndSendTransactionsNative | STEP_6_DONE sig_count=${result.signatures.length} total_elapsed_ms=${Date.now() - startTime}`);
            return result.signatures;

        } catch (e: any) {
            const elapsed = Date.now() - startTime;
            const error = e as MWAError;
            const code = error?.code || 'UNKNOWN';
            const msg = error?.message || String(e);
            console.log(`${TAG} signAndSendTransactionsNative | FAIL_EXCEPTION code=${code} message=${msg} elapsed_ms=${elapsed}`);
            this.lastError = { code, message: msg };
            let statusMsg: string;
            if (code === 'WALLET_HUNG') {
                statusMsg = 'Sign & send crashed - this wallet likely has the Backpack-class bug; use default signAndSendTransaction()';
            } else if (code === 'WALLET_AUTH_MISMATCH') {
                statusMsg = 'Sign & send failed - wrong wallet picked. Use the wallet you connected with, or Disconnect and Connect again.';
            } else {
                statusMsg = `Sign & send (native) failed: ${msg}`;
            }
            this._updateStatus(statusMsg);
            return [];
        }
    }

    /**
     * Lazy accessor for the Solana JSON-RPC client. Instantiated on first use
     * with the app's configured cluster (mainnet-beta or devnet). Used by the
     * Backpack sign+broadcast fallback.
     */
    private _getRpc(): SolanaRpc {
        if (this._rpc) return this._rpc;
        const identity = getAppIdentity();
        const rpcUrl = identity.cluster === 'devnet'
            ? 'https://api.devnet.solana.com'
            : 'https://api.mainnet-beta.solana.com';
        console.log(`${TAG} _getRpc | INSTANTIATED rpc_url=${rpcUrl} cluster=${identity.cluster}`);
        this._rpc = new SolanaRpc(rpcUrl);
        return this._rpc;
    }

    /**
     * Default sign+RPC-broadcast path for signAndSendTransaction(s).
     * Matches Godot's `WalletAdapterAndroid` Node-level `signAndSendTransaction`
     * pattern: call MWA `sign_transactions` to get signed bytes back, then
     * broadcast each signed transaction via Solana JSON-RPC `sendTransaction`.
     *
     * Works for every wallet - including Backpack, whose native MWA
     * `sign_and_send_transactions` handler crashes with `JsonDecodingException`.
     * Because Backpack's `sign_transactions` handler works fine, we go through
     * that and broadcast ourselves via the RPC endpoint configured in
     * `SolanaRpc.ts` (mainnet-beta or devnet per `getAppIdentity().cluster`).
     *
     * Only one wallet intent is opened (the signTransactions call) - same
     * UX as MWA's native sign_and_send: one wallet approval. The RPC
     * broadcast is a server-to-server call with no wallet interaction.
     *
     * Logging is verbose and per-step so any failure mode is easy to locate:
     *   STEP_0_ENTRY   - params snapshot (count + options)
     *   STEP_1_MWA_SIGN_START / _DONE - signTransactions round-trip
     *   STEP_2_DECODE[i] - per-tx base64 length check
     *   STEP_3_RPC_SEND_START[i] / _DONE[i] - per-tx RPC call
     *   STEP_4_EMIT     - MWA_TRANSACTIONS_SENT emitted
     *   DONE            - total elapsed
     *
     * On any failure: populates `lastError` with a specific code and returns
     * an empty array.
     */
    private async _signAndBroadcastViaRpc(
        transactions: Uint8Array[],
        options?: { commitment?: string; skipPreflight?: boolean }
    ): Promise<string[]> {
        const startTime = Date.now();
        const preflight = (options?.commitment as any) || 'confirmed';
        const skip = options?.skipPreflight ?? false;
        console.log(`${TAG} _signAndBroadcastViaRpc | STEP_0_ENTRY tx_count=${transactions.length} commitment=${preflight} skipPreflight=${skip} is_connected=${this.isConnected} walletPackage=${this.connectedWalletPackage || '(default)'} pubkey=${this.connectedPubkey?.substring(0, 8)}…`);
        this._updateStatus(`Signing and sending ${transactions.length} transaction(s)...`);
        this.lastError = null;

        try {
            // STEP_PREFLIGHT_BALANCE: short-circuit if the fee-payer account is
            // under the rent-exempt minimum + fee + priority-fee buffer. Seed
            // Vault's Solflare-wrapper injects ~52 bytes of ComputeBudget
            // priority-fee instructions before signing, so underfunded accounts
            // get `-32002 InsufficientFundsForRent` at preflight even for a
            // trivial memo tx. Rather than sending the user through the wallet
            // approval only to have the broadcast fail, check the balance
            // first. See KNOWN_ISSUES.md #13.
            const RENT_EXEMPT_MIN_BUFFER_LAMPORTS = 1_000_000; // 890_880 rent + ~5000 fee + ~100_000 priority-fee buffer
            if (this.connectedPubkey) {
                const balance = await this._getRpc().getBalance(this.connectedPubkey);
                if (balance < 0) {
                    console.log(`${TAG} _signAndBroadcastViaRpc | STEP_PREFLIGHT_BALANCE_UNKNOWN - getBalance failed, proceeding anyway`);
                } else if (balance < RENT_EXEMPT_MIN_BUFFER_LAMPORTS) {
                    console.log(`${TAG} _signAndBroadcastViaRpc | STEP_PREFLIGHT_FAIL balance=${balance} required=~${RENT_EXEMPT_MIN_BUFFER_LAMPORTS} pubkey=${this.connectedPubkey.substring(0, 8)}…`);
                    this.lastError = {
                        code: 'INSUFFICIENT_FUNDS_FOR_RENT',
                        message: `Fee-payer has ${balance} lamports. Send at least 0.001 SOL to ${this.connectedPubkey} before signing.`,
                    };
                    this._updateStatus('Fee-payer account underfunded - send ≥0.001 SOL and retry');
                    return [];
                } else {
                    console.log(`${TAG} _signAndBroadcastViaRpc | STEP_PREFLIGHT_BALANCE_OK balance=${balance} threshold=${RENT_EXEMPT_MIN_BUFFER_LAMPORTS}`);
                }
            }

            // STEP 1: Sign via MWA sign_transactions (works for all wallets)
            console.log(`${TAG} _signAndBroadcastViaRpc | STEP_1_MWA_SIGN_START calling signTransactions (MWA)`);
            const signed = await this.signTransactions(transactions);
            const signElapsed = Date.now() - startTime;
            if (!signed || signed.length === 0) {
                console.log(`${TAG} _signAndBroadcastViaRpc | STEP_1_MWA_SIGN_FAIL signTransactions returned empty - lastError=${this.lastError?.code ?? '(none)'} elapsed_ms=${signElapsed}`);
                if (!this.lastError) {
                    this.lastError = { code: 'EMPTY_SIGNATURE', message: 'Wallet returned no signed transactions' };
                }
                this._updateStatus(this.lastError.code === 'WALLET_CRASHED'
                    ? 'Wallet crashed during signing'
                    : 'Sign failed - nothing to broadcast');
                return [];
            }
            console.log(`${TAG} _signAndBroadcastViaRpc | STEP_1_MWA_SIGN_DONE count=${signed.length} first_bytes=${signed[0]?.length ?? 0} elapsed_ms=${signElapsed}`);

            // STEP 2: Encode each signed tx (Uint8Array → base64 string for RPC).
            // NOTE: `signed[i]` is a Uint8Array from the native bridge. Passing
            // it straight into rpc.sendTransaction serializes it to JSON as a
            // map ({"0":1,…}), which Solana RPC rejects with -32602
            // "invalid type: map, expected a string". Encode first.
            const signedBase64s: string[] = new Array(signed.length);
            for (let i = 0; i < signed.length; i++) {
                signedBase64s[i] = this._uint8ArrayToBase64(signed[i]);
                console.log(`${TAG} _signAndBroadcastViaRpc | STEP_2_ENCODE[${i}] raw_bytes=${signed[i]?.length ?? 0} base64_len=${signedBase64s[i].length}`);
            }

            // STEP 3: Broadcast each signed tx via Solana RPC sendTransaction
            const rpc = this._getRpc();
            const rpcUrl = (rpc as any)._url ?? '(unknown)';
            const signatures: string[] = [];

            for (let i = 0; i < signed.length; i++) {
                const signedBase64 = signedBase64s[i];
                const rpcStart = Date.now();
                console.log(`${TAG} _signAndBroadcastViaRpc | STEP_3_RPC_SEND_START[${i}] rpc_url=${rpcUrl} base64_len=${signedBase64.length} skipPreflight=${skip} preflightCommitment=${preflight}`);
                const sig = await rpc.sendTransaction(signedBase64, {
                    skipPreflight: skip,
                    preflightCommitment: preflight,
                });
                const rpcElapsed = Date.now() - rpcStart;
                if (!sig) {
                    // Inspect the RPC error payload captured on the client. The
                    // Solana RPC returns a rich `err` structure on preflight
                    // simulation failure (code -32002). Detect the common
                    // `InsufficientFundsForRent` case so the UI can show a
                    // specific "fund the account" toast instead of the generic
                    // "RPC rejected" message. See KNOWN_ISSUES.md #13.
                    const rpcErr = (rpc as any).lastRpcError as { code: number; message: string; data: any } | null;
                    const rawErr = rpcErr?.data?.err;
                    const rawErrStr = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr ?? null);
                    const isRentError =
                        (rawErrStr && rawErrStr.indexOf('InsufficientFundsForRent') >= 0) ||
                        (rpcErr?.message && rpcErr.message.indexOf('insufficient funds for rent') >= 0);

                    if (isRentError) {
                        console.log(`${TAG} _signAndBroadcastViaRpc | STEP_3_RPC_SEND_FAIL[${i}] INSUFFICIENT_FUNDS_FOR_RENT rpc_elapsed_ms=${rpcElapsed} err=${rawErrStr}`);
                        this.lastError = {
                            code: 'INSUFFICIENT_FUNDS_FOR_RENT',
                            message: `Fee-payer account underfunded. Send at least 0.001 SOL to ${this.connectedPubkey} and retry.`,
                        };
                        this._updateStatus('Fee-payer account underfunded - send ≥0.001 SOL and retry');
                    } else {
                        console.log(`${TAG} _signAndBroadcastViaRpc | STEP_3_RPC_SEND_FAIL[${i}] RPC returned empty signature rpc_elapsed_ms=${rpcElapsed} rpc_error_code=${rpcErr?.code ?? '(none)'} msg=${rpcErr?.message ?? '(none)'}`);
                        this.lastError = { code: 'RPC_BROADCAST_FAILED', message: rpcErr?.message || 'RPC sendTransaction returned empty signature' };
                        this._updateStatus('Broadcast failed - RPC rejected the transaction');
                    }
                    return [];
                }
                console.log(`${TAG} _signAndBroadcastViaRpc | STEP_3_RPC_SEND_DONE[${i}] sig_base58=${sig.substring(0, 20)}... sig_len=${sig.length} rpc_elapsed_ms=${rpcElapsed}`);
                signatures.push(sig);
            }

            // STEP 4: Emit + status + return
            console.log(`${TAG} _signAndBroadcastViaRpc | STEP_4_EMIT MWA_TRANSACTIONS_SENT sig_count=${signatures.length}`);
            this._updateStatus(`Sent! Sig: ${signatures[0]?.substring(0, 20)}...`);
            this.node.emit(MWA_TRANSACTIONS_SENT, signatures);
            const totalMs = Date.now() - startTime;
            console.log(`${TAG} _signAndBroadcastViaRpc | DONE sig_count=${signatures.length} first_sig=${signatures[0]?.substring(0, 24)}... total_elapsed_ms=${totalMs}`);
            return signatures;

        } catch (e: any) {
            const elapsed = Date.now() - startTime;
            const error = e as MWAError;
            const code = error?.code || 'UNKNOWN';
            const msg = error?.message || String(e);
            console.log(`${TAG} _signAndBroadcastViaRpc | FAIL_EXCEPTION code=${code} message=${msg} elapsed_ms=${elapsed}`);
            this.lastError = { code, message: msg };
            this._updateStatus(`Sign & send failed: ${msg}`);
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  GET CAPABILITIES
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Query the connected wallet's capabilities.
     *
     * Port of Unity MWAManager.cs:278-307 / Godot mwa_manager.gd:373-395.
     *
     * @returns WalletCapabilities on success, null on failure
     */
    async getCapabilities(): Promise<WalletCapabilities | null> {
        console.log(`${TAG} getCapabilities | START is_connected=${this.isConnected}`);

        if (!this.isConnected) {
            console.log(`${TAG} getCapabilities | FAIL not connected`);
            this._updateStatus('Not connected');
            return null;
        }

        this._updateStatus('Querying wallet capabilities...');

        try {
            console.log(`${TAG} getCapabilities | sending get_capabilities command`);

            const result = await this._bridge.sendCommand<WalletCapabilities>('get_capabilities', this._withSessionParams({}));

            if (!result) {
                console.log(`${TAG} getCapabilities | FAIL empty response`);
                this._updateStatus('Failed to get capabilities');
                return null;
            }

            // Normalize field names (Java side may use different naming)
            const caps: WalletCapabilities = {
                maxTransactionsPerRequest: result.maxTransactionsPerRequest ?? result['max_transactions_per_request'] ?? 10,
                maxMessagesPerRequest: result.maxMessagesPerRequest ?? result['max_messages_per_request'] ?? 10,
                supportedTransactionVersions: result.supportedTransactionVersions ?? result['supported_transaction_versions'] ?? ['legacy', '0'],
                features: result.features ?? [],
            };

            console.log(`${TAG} getCapabilities | SUCCESS max_txs=${caps.maxTransactionsPerRequest} max_msgs=${caps.maxMessagesPerRequest} versions=[${caps.supportedTransactionVersions.join(',')}] features=[${caps.features.join(',')}]`);
            this._updateStatus(`Capabilities: max_txs=${caps.maxTransactionsPerRequest} max_msgs=${caps.maxMessagesPerRequest}`);
            this._cachedCapabilities = caps;
            this.node.emit(MWA_CAPABILITIES_RECEIVED, caps);
            return caps;

        } catch (e: any) {
            const error = e as MWAError;
            console.log(`${TAG} getCapabilities | EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e}`);
            this._updateStatus(`Get capabilities failed: ${error?.message || e}`);
            return null;
        }
    }

    /**
     * Most recently fetched `get_capabilities` result for the session, or
     * null if not yet fetched or the wallet returned an error. Populated
     * automatically by the silent prefetch after authorize/reauthorize;
     * also populated by explicit `getCapabilities()` calls.
     */
    get cachedCapabilities(): WalletCapabilities | null {
        return this._cachedCapabilities;
    }

    /**
     * Whether the connected wallet supports `sign_messages` over MWA.
     *
     * Checked in priority order:
     *   1. If we have a cached `get_capabilities` response (from the user
     *      explicitly tapping Get Capabilities earlier in the session),
     *      trust its `features[]` - per MWA spec that's the authoritative
     *      declaration. Phantom advertises `supports_sign_and_send_transactions`,
     *      Solflare advertises `solana:signTransactions` - neither includes
     *      any sign_messages variant.
     *   2. Else fall back to a static map of known-bad wallet packages.
     *      Phantom Mobile (`app.phantom`) and Solflare Mobile
     *      (`com.solflare.mobile`) are confirmed non-implementers via
     *      their capability logs. See KNOWN_ISSUES.md #11.
     *   3. Else (unknown wallet or OS-picker without package info) return
     *      `true` optimistically. If it doesn't work, `signMessage()` will
     *      surface a truthful `WALLET_HUNG` / timeout error instead of
     *      showing nothing.
     *
     * We deliberately do NOT proactively fetch `get_capabilities` after
     * authorize/reauthorize - doing so would open a second wallet intent
     * (breaking the "cached reconnect = instant" UX contract) for no
     * benefit beyond what this static map already covers.
     */
    supportsSignMessages(): boolean {
        const caps = this._cachedCapabilities;
        const pkg = this.connectedWalletPackage;
        let result: boolean;
        let path: string;
        if (caps && caps.features) {
            const features = caps.features;
            result = (
                features.indexOf('solana:signMessages') >= 0 ||
                features.indexOf('supports_sign_messages') >= 0 ||
                features.indexOf('sign_messages') >= 0
            );
            path = 'capabilities';
        } else if (pkg && MWAManager._KNOWN_NO_SIGN_MESSAGES.has(pkg)) {
            result = false;
            path = 'static_blocklist';
        } else {
            result = true;
            path = 'optimistic_default';
        }
        console.log(`${TAG} supportsSignMessages | DONE result=${result} path=${path} walletPackage="${pkg || '(none)'}" caps_cached=${!!caps} features_len=${caps?.features?.length ?? 0}`);
        return result;
    }

    /**
     * Static set of wallet packages empirically confirmed to NOT implement
     * `sign_messages` via MWA on Android. Determined by direct
     * `get_capabilities` inspection (see KNOWN_ISSUES.md #11 for the logs).
     */
    private static readonly _KNOWN_NO_SIGN_MESSAGES: Set<string> = new Set([
        'app.phantom',
        'com.solflare.mobile',
    ]);

    /**
     * Wallet packages that advertise native MWA `sign_and_send_transactions`
     * support via their `get_capabilities` feature list and - when targeted
     * via the in-app wallet-list button (which populates `connectedWalletPackage`)
     * - should be routed to the native path instead of sign+RPC.
     *
     * - `app.phantom`: advertises `supports_sign_and_send_transactions` (MWA 1.x)
     * - `ag.jup.app`: advertises `solana:signAndSendTransaction` (MWA 2.0)
     *
     * For OS-picker connections (where `connectedWalletPackage` is empty) we
     * don't know the wallet identity, so we stay on the current sign+RPC
     * default - that path works for every wallet tested and is the safe
     * behaviour when wallet identity is unknown. See KNOWN_ISSUES.md Issue #13.
     */
    private static readonly _NATIVE_SIGN_AND_SEND_SUPPORTED: Set<string> = new Set([
        'app.phantom',
        'ag.jup.app',
    ]);

    /**
     * Wallet packages that must NEVER be routed to native
     * `sign_and_send_transactions` because their native handler crashes or
     * misbehaves. Overrides `_NATIVE_SIGN_AND_SEND_SUPPORTED`.
     *
     * - `app.backpack`: crashes with Kotlin `JsonDecodingException` ("Class
     *   discriminator was missing"). Uses sign+RPC instead. See KNOWN_ISSUES.md #9.
     */
    private static readonly _FORCE_SIGN_AND_RPC: Set<string> = new Set([
        'app.backpack',
    ]);

    // ═══════════════════════════════════════════════════════════════════════
    //  DELETE ACCOUNT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Delete account - gated by a real user-intent sign via MWA
     * `sign_transactions` on a memo-only throwaway transaction.
     *
     * Evolution: Pass 6 tried `sign_messages` with SIWS-format text, then
     * empirical testing of `get_capabilities` revealed Phantom Mobile
     * (`features=["supports_sign_and_send_transactions"]`) and Solflare
     * Mobile (`features=["solana:signTransactions"]`) DO NOT declare
     * `solana:signMessages` support - so `sign_messages` RPC either hangs
     * or is dropped without reply. See KNOWN_ISSUES.md #11.
     *
     * Fix: gate delete on `signTransactions` (which every wallet we target
     * DOES implement) using a minimal memo-only transaction whose memo text
     * is the ownership-proof wording. Wallet UI shows "This program will
     * write a memo: <confirmation text>" and the user approves.
     *
     * The signed transaction is NOT broadcast - we only want the signature
     * as ownership proof. No on-chain cost, no lamports spent. The fresh
     * blockhash from `getLatestBlockhash` will expire harmlessly.
     *
     * On success: add pubkey to `_deletedPubkeys`, null in-memory state,
     * `_cache.clearAll()`, emit `MWA_DISCONNECTED`, status "Account deleted".
     * On empty sig (user reject / wallet hang / unsupported): leave state
     * intact, status "Delete cancelled - confirmation required". `lastError`
     * is preserved from `signTransactions` so AppUI can branch on specific
     * codes (WALLET_CRASHED, WALLET_HUNG, etc.).
     *
     * No `deauthorize` RPC - matches React Native, Unity, Godot behavior.
     * The wallet-side auth_token is orphaned; `_deletedPubkeys` blocks
     * cached reconnect for the process lifetime.
     */
    async deleteAccount(): Promise<void> {
        console.log(`${TAG} deleteAccount | START (signTransactions-gated, memo-only) pubkey=${this.connectedPubkey} is_connected=${this.isConnected}`);

        if (!this.isConnected) {
            console.log(`${TAG} deleteAccount | FAIL not connected - nothing to delete`);
            this._updateStatus('Not connected - cannot delete');
            return;
        }

        const oldPubkey = this.connectedPubkey;
        const oldPackage = this.connectedWalletPackage;
        this.lastError = null;

        // Step 1: fetch a fresh blockhash for the memo tx. Must be live at
        // sign time to satisfy the wallet's "show tx content" preflight UI.
        const blockhashResult = await this._getRpc().getLatestBlockhash('confirmed');
        if (!blockhashResult || !blockhashResult.blockhash) {
            console.log(`${TAG} deleteAccount | FAIL could not fetch blockhash`);
            this.lastError = { code: 'RPC_BLOCKHASH_FAILED', message: 'Could not fetch recent blockhash' };
            this._updateStatus('Delete failed - could not reach Solana RPC');
            return;
        }
        console.log(`${TAG} deleteAccount | blockhash=${blockhashResult.blockhash.substring(0, 12)}...`);

        // Step 2: build a memo-only tx with ownership-proof wording.
        const identity = getAppIdentity();
        const nonce = this._generateNonce();
        const memoText = `${identity.appName}: wallet ownership proof, nonce=${nonce}`;
        const memoTx = buildMemoTransaction(oldPubkey, memoText, blockhashResult.blockhash);
        if (!memoTx || memoTx.length === 0) {
            console.log(`${TAG} deleteAccount | FAIL memo tx build returned empty bytes`);
            this.lastError = { code: 'TX_BUILD_FAILED', message: 'Could not build memo transaction' };
            this._updateStatus('Delete failed - could not build confirmation transaction');
            return;
        }
        console.log(`${TAG} deleteAccount | memo_tx_bytes=${memoTx.length} memo="${memoText}"`);

        // Step 3: ask wallet to sign. DO NOT broadcast - we only need the
        // signature as ownership proof; the tx is intentionally throwaway.
        const signed = await this.signTransactions([memoTx]);
        if (!signed || signed.length === 0 || !signed[0] || signed[0].length === 0) {
            const code = this.lastError?.code ?? 'DELETE_CANCELLED';
            const msg = this.lastError?.message ?? 'User did not confirm';
            console.log(`${TAG} deleteAccount | CANCELLED signed_count=${signed?.length ?? 0} code=${code} message=${msg} - leaving state intact`);
            // Pass 13: when signTransactions failed with WALLET_AUTH_MISMATCH
            // (Pass 13 / KNOWN_ISSUES #17), tell the user what actually went
            // wrong instead of the misleading "User did not confirm" fallback.
            const statusMsg = code === 'WALLET_AUTH_MISMATCH'
                ? 'Delete failed - wrong wallet picked. Use the wallet you connected with, or Disconnect and Connect again.'
                : 'Delete cancelled - confirmation required';
            this._updateStatus(statusMsg);
            return;
        }
        console.log(`${TAG} deleteAccount | CONFIRMED signed_bytes=${signed[0].length} - clearing local state (no broadcast)`);

        // Step 4: record deleted pubkey so reauthorize-from-cache rejects it later
        if (oldPubkey) {
            this._deletedPubkeys.add(oldPubkey);
            console.log(`${TAG} deleteAccount | recorded deleted key=${oldPubkey} total_deleted=${this._deletedPubkeys.size}`);
        }

        // Step 5: clear in-memory state
        this.isConnected = false;
        this.connectedPubkey = '';
        this.authToken = '';
        this.walletUriBase = '';
        this.connectedWalletPackage = '';
        this._cachedCapabilities = null;

        // Step 6: wipe persistent cache
        this._cache.clearAll();

        // Step 7: emit + status
        this.node.emit(MWA_DISCONNECTED);
        this._updateStatus('Account deleted');

        console.log(`${TAG} deleteAccount | DONE old_pubkey=${oldPubkey} old_walletPackage="${oldPackage}" cache_cleared=true emitted=MWA_DISCONNECTED`);
    }

    /** 16-char alphanumeric nonce for throwaway transaction uniqueness. */
    private _generateNonce(): string {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let out = '';
        for (let i = 0; i < 16; i++) {
            out += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return out;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Truncate a pubkey for display: "7xKX...4bNr"
     * Matches Unity MWAManager.cs:339-343 / Godot mwa_manager.gd:465-468.
     */
    truncatePubkey(pubkey: string): string {
        return this._truncatePubkey(pubkey);
    }

    /**
     * Get display name for a wallet package. Used for Home screen labeling.
     * Maps Android package names to human-readable wallet names.
     *
     * @param packageName Optional override; defaults to connectedWalletPackage
     * @returns Display name (e.g., "Phantom", "Seed Vault")
     */
    walletDisplayName(packageName?: string): string {
        const pkg = packageName || this.connectedWalletPackage;
        const NAMES: Record<string, string> = {
            'app.phantom': 'Phantom',
            'app.backpack': 'Backpack',
            'com.solflare.mobile': 'Solflare',
            'com.pleasecrypto.flutter': 'Espresso Cash',
            'ag.jup.app': 'Jupiter',
        };
        return NAMES[pkg] || (pkg ? pkg : 'Seed Vault');
    }

    private _truncatePubkey(pubkey: string): string {
        if (!pubkey || pubkey.length <= 8) return pubkey || '';
        return pubkey.substring(0, 4) + '...' + pubkey.substring(pubkey.length - 4);
    }

    /**
     * Inject connectedWalletPackage as targetPackage into bridge command params.
     * Ensures subsequent operations target the same wallet the user chose at connect.
     */
    private _withSessionParams(params: Record<string, any>): Record<string, any> {
        const identity = getAppIdentity();
        const enriched: Record<string, any> = {
            ...params,
            appName: identity.appName,
            appUri: identity.appUri,
            appIconPath: identity.appIconPath,
        };
        if (this.connectedWalletPackage) {
            enriched.targetPackage = this.connectedWalletPackage;
        }
        return enriched;
    }

    /**
     * Emit a status update event for UI binding.
     * Matches Unity MWAManager.cs:345-349 / Godot mwa_manager.gd status_updated signal.
     */
    private _updateStatus(message: string): void {
        console.log(`${TAG} STATUS | ${message}`);
        this.node.emit(MWA_STATUS, message);
    }

    /**
     * Convert Uint8Array to base64 string.
     * Uses btoa which is available in Cocos Creator's V8 runtime.
     */
    private _uint8ArrayToBase64(bytes: Uint8Array): string {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert base64 string to Uint8Array.
     */
    private _base64ToUint8Array(base64: string): Uint8Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
}

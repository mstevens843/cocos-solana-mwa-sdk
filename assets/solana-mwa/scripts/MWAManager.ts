/**
 * MWAManager.ts — Core singleton for Solana Mobile Wallet Adapter operations.
 *
 * Direct port of:
 *   - Unity:  MWAManager.cs  (359 lines) — grant-unity/Assets/Scripts/MWAManager.cs
 *   - Godot:  mwa_manager.gd (522 lines) — grant-godot/scripts/mwa_manager.gd
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
 *   G3  — Timeout + logging on every bridge command (no silent failures)
 *   G4  — Pubkey always string from JSON (no object type mismatch)
 *   G5  — Validate pubkey length > 20 before accepting (no empty false positives)
 *   G6  — Deauthorize sends command to native + clears local state
 *   G9  — Chain signMessage after authorize for biometric confirmation
 *   G10 — Require signMessage before deleteAccount
 *   U1  — Deauthorize sends MWA deauthorize RPC via bridge (not just local clear)
 *   U3  — Validate authToken.length after authorize (warn if empty)
 */

import { _decorator, Component, game, sys, director } from 'cc';
import { MWABridge } from './MWABridge';
import { AuthCache } from './AuthCache';
import { getAppIdentity } from './AppIdentity';
import { isValidBase58Pubkey } from './Base58';
import {
    AuthorizeResult,
    WalletCapabilities,
    MWAError,
} from './MWATypes';
import {
    MWA_AUTHORIZED,
    MWA_AUTH_FAILED,
    MWA_DISCONNECTED,
    MWA_MESSAGE_SIGNED,
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

    /** Global singleton access. Null until onLoad fires. */
    static get instance(): MWAManager | null {
        return MWAManager._instance;
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

    // ─── Internal ────────────────────────────────────────────────────────

    /** The bridge to native Android MWA layer. */
    private _bridge!: MWABridge;

    /** Persistent auth cache (survives app restarts). */
    private _cache!: AuthCache;

    /** Guard against concurrent authorize calls. */
    private _authorizing: boolean = false;

    // ─── Lifecycle ───────────────────────────────────────────────────────

    onLoad(): void {
        console.log(`${TAG} onLoad | START instance_exists=${MWAManager._instance != null} node=${this.node.name}`);

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
    get cache(): AuthCache {
        return this._cache;
    }

    /** Check if MWA is available on this platform. */
    isAvailable(): boolean {
        const result = this._bridge?.isNativeAvailable ?? false;
        console.log(`${TAG} isAvailable | platform=${sys.os} is_native=${sys.isNative} result=${result}`);
        return result;
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
    async authorize(): Promise<AuthorizeResult | null> {
        console.log(`${TAG} authorize | START is_connected=${this.isConnected} authorizing=${this._authorizing}`);

        // Guard: don't allow concurrent authorizations
        if (this._authorizing) {
            console.log(`${TAG} authorize | BLOCKED — already authorizing, ignoring duplicate call`);
            return null;
        }
        this._authorizing = true;
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

            // Compound command: authorize + signMessage in one MWA session
            // Matches Unity/Godot which chain signMessage for biometric confirmation
            const signInMessage = `Sign in to ${identity.appName}`;
            const compoundParams = {
                ...params,
                signInMessage,
            };

            console.log(`${TAG} authorize | sending authorize_and_sign command via bridge app="${identity.appName}" cluster=${identity.cluster}`);

            const result = await this._bridge.sendCommand<AuthorizeResult & { signInSignature: string }>('authorize_and_sign', compoundParams);

            // Validate response (Bug G4, G5 prevention)
            if (!result || !result.pubkey) {
                console.log(`${TAG} authorize | FAIL result is null or missing pubkey`);
                this._updateStatus('Authorization failed — no response from wallet');
                this.node.emit(MWA_AUTH_FAILED, 'Wallet returned null or empty response');
                return null;
            }

            if (!isValidBase58Pubkey(result.pubkey)) {
                console.log(`${TAG} authorize | FAIL invalid pubkey="${result.pubkey}" length=${result.pubkey.length} (must be 32-44 base58 chars)`);
                this._updateStatus('Authorization failed — invalid pubkey returned');
                this.node.emit(MWA_AUTH_FAILED, `Invalid pubkey from wallet: ${result.pubkey}`);
                return null;
            }

            // Check biometric confirmation signature
            if (!result.signInSignature) {
                console.log(`${TAG} authorize | FAIL biometric confirmation rejected — no sign-in signature`);
                this._updateStatus('Authorization cancelled — biometric not confirmed');
                this.node.emit(MWA_AUTH_FAILED, 'Biometric confirmation rejected');
                return null;
            }

            console.log(`${TAG} authorize | biometric confirmed sig_len=${result.signInSignature.length}`);

            // Bug U3 prevention: warn if auth token is empty
            if (!result.authToken || result.authToken.length === 0) {
                console.log(`${TAG} authorize | WARN auth_token is empty — reauthorization may fail (Unity Bug U3)`);
            }

            // Set connected state
            this.connectedPubkey = result.pubkey;
            this.authToken = result.authToken || '';
            this.walletUriBase = result.walletUriBase || '';
            this.isConnected = true;

            console.log(`${TAG} authorize | SUCCESS pubkey=${this.connectedPubkey} auth_token_len=${this.authToken.length} wallet_uri_base=${this.walletUriBase || '(empty)'}`);

            // ─── Cache Auth ──────────────────────────────────────────────
            this._cache.set(this.connectedPubkey, this.authToken, this.walletUriBase);
            console.log(`${TAG} authorize | cached auth pubkey=${this.connectedPubkey} token_len=${this.authToken.length}`);

            // ─── Emit Success ────────────────────────────────────────────
            this._updateStatus(`Connected: ${this._truncatePubkey(this.connectedPubkey)}`);
            this.node.emit(MWA_AUTHORIZED, this.connectedPubkey);

            console.log(`${TAG} authorize | DONE connected=true pubkey=${this.connectedPubkey} — emitted MWA_AUTHORIZED`);
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
    //  REAUTHORIZE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Silently reconnect using cached auth token.
     *
     * Port of Unity MWAManager.cs:100-120 / Godot mwa_manager.gd:225-240.
     *
     * If cached auth exists, attempts to reauthorize with the stored token.
     * Falls back to full authorize if reauthorize fails.
     *
     * @returns AuthorizeResult on success, null on failure
     */
    async reauthorize(): Promise<AuthorizeResult | null> {
        console.log(`${TAG} reauthorize | START`);

        const cached = this._cache.getLatest();
        if (!cached) {
            console.log(`${TAG} reauthorize | FAIL no cached authorization found`);
            this._updateStatus('No cached authorization found');
            return null;
        }

        console.log(`${TAG} reauthorize | cached_pubkey=${cached.pubkey} cached_token_len=${cached.authToken?.length ?? 0} timestamp=${cached.timestamp}`);
        this._updateStatus('Reauthorizing with cached token...');

        try {
            const identity = getAppIdentity();
            const params = {
                appName: identity.appName,
                appUri: identity.appUri,
                appIconPath: identity.appIconPath,
                cluster: identity.cluster,
                authToken: cached.authToken,
            };

            console.log(`${TAG} reauthorize | sending reauthorize command via bridge`);
            const result = await this._bridge.sendCommand<AuthorizeResult>('reauthorize', params);

            if (!result || !result.pubkey || !isValidBase58Pubkey(result.pubkey)) {
                console.log(`${TAG} reauthorize | FAIL invalid response — falling back to full authorize()`);
                return await this.authorize();
            }

            // Bug U3: check auth token
            if (!result.authToken || result.authToken.length === 0) {
                console.log(`${TAG} reauthorize | WARN auth_token is empty in reauthorize response`);
            }

            // Update state
            this.connectedPubkey = result.pubkey;
            this.authToken = result.authToken || '';
            this.walletUriBase = result.walletUriBase || '';
            this.isConnected = true;

            // Update cache with fresh token
            this._cache.set(this.connectedPubkey, this.authToken, this.walletUriBase);

            console.log(`${TAG} reauthorize | SUCCESS pubkey=${this.connectedPubkey} auth_token_len=${this.authToken.length}`);
            this._updateStatus(`Reconnected: ${this._truncatePubkey(this.connectedPubkey)}`);
            this.node.emit(MWA_AUTHORIZED, this.connectedPubkey);

            return result;

        } catch (e: any) {
            const error = e as MWAError;
            console.log(`${TAG} reauthorize | EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e}`);
            console.log(`${TAG} reauthorize | falling back to full authorize()`);
            // Fall back to full authorize on any error
            return await this.authorize();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DEAUTHORIZE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Disconnect wallet and clear session state.
     *
     * Port of Unity MWAManager.cs:124-142 / Godot mwa_manager.gd:245-266.
     *
     * Bug U1 Prevention: Sends deauthorize RPC to wallet via bridge,
     * not just local state clear. This ensures the wallet knows the
     * session is invalidated.
     */
    async deauthorize(): Promise<void> {
        console.log(`${TAG} deauthorize | START pubkey=${this.connectedPubkey} is_connected=${this.isConnected} auth_token_len=${this.authToken.length}`);
        this._updateStatus('Deauthorizing...');

        // Bug U1: Send deauthorize to native side (sends MWA deauthorize RPC to wallet)
        if (this.isConnected && this.authToken) {
            try {
                console.log(`${TAG} deauthorize | sending deauthorize command to wallet via bridge`);
                await this._bridge.sendCommand('deauthorize', { authToken: this.authToken });
                console.log(`${TAG} deauthorize | deauthorize RPC sent successfully`);
            } catch (e: any) {
                // Deauthorize failure is non-fatal — we still clear local state
                console.log(`${TAG} deauthorize | WARN deauthorize command failed: ${e?.message || e} (clearing local state anyway)`);
            }
        } else {
            console.log(`${TAG} deauthorize | skipping bridge command (not connected or no auth token)`);
        }

        // Clear local state
        const oldPubkey = this.connectedPubkey;
        this.connectedPubkey = '';
        this.authToken = '';
        this.walletUriBase = '';
        this.isConnected = false;

        console.log(`${TAG} deauthorize | DONE old_pubkey=${oldPubkey} state_cleared=true`);
        this._updateStatus('Disconnected');
        this.node.emit(MWA_DISCONNECTED);
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
        console.log(`${TAG} signMessage | START message_len=${message.length} is_connected=${this.isConnected}`);

        if (!this.isConnected || !this.connectedPubkey) {
            console.log(`${TAG} signMessage | FAIL not connected (is_connected=${this.isConnected} pubkey="${this.connectedPubkey}")`);
            this._updateStatus('Not connected');
            return '';
        }

        this._updateStatus('Signing message...');

        try {
            // Encode message as base64 payload
            const encoder = new TextEncoder();
            const messageBytes = encoder.encode(message);
            const payloadBase64 = this._uint8ArrayToBase64(messageBytes);

            console.log(`${TAG} signMessage | sending sign_messages command payload_bytes=${messageBytes.length} payload_base64_len=${payloadBase64.length}`);

            const result = await this._bridge.sendCommand<{ signatures: string[] }>('sign_messages', {
                payloads: [payloadBase64],
                addresses: [this.connectedPubkey],
                authToken: this.authToken,
            });

            // Validate response
            if (!result || !result.signatures || result.signatures.length === 0) {
                console.log(`${TAG} signMessage | FAIL empty or missing signatures in response`);
                this._updateStatus('Sign message failed — empty signature');
                return '';
            }

            const sig = result.signatures[0];
            if (!sig || sig.length === 0) {
                console.log(`${TAG} signMessage | FAIL signature[0] is empty`);
                this._updateStatus('Sign message failed — empty signature');
                return '';
            }

            console.log(`${TAG} signMessage | SUCCESS sig_len=${sig.length} sig=${sig.substring(0, 20)}...`);
            this._updateStatus(`Signed: ${sig.substring(0, 20)}...`);
            this.node.emit(MWA_MESSAGE_SIGNED, sig);
            return sig;

        } catch (e: any) {
            const error = e as MWAError;
            console.log(`${TAG} signMessage | EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e}`);
            this._updateStatus(`Sign message failed: ${error?.message || e}`);
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

            const result = await this._bridge.sendCommand<{ signatures: string[] }>('sign_messages', {
                payloads: payloadsBase64,
                addresses: [this.connectedPubkey],
                authToken: this.authToken,
            });

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
            console.log(`${TAG} signMessages | EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e}`);
            this._updateStatus(`Sign messages failed: ${error?.message || e}`);
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SIGN AND SEND TRANSACTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sign and broadcast a single transaction.
     *
     * Port of Unity MWAManager.cs:228-274.
     *
     * @param transaction - Serialized transaction as Uint8Array (unsigned)
     * @returns Transaction signature string on success, empty string on failure
     */
    async signAndSendTransaction(transaction: Uint8Array): Promise<string> {
        console.log(`${TAG} signAndSendTransaction | START tx_bytes=${transaction.length} is_connected=${this.isConnected}`);

        const sigs = await this.signAndSendTransactions([transaction]);
        if (sigs.length > 0 && sigs[0]) {
            return sigs[0];
        }
        return '';
    }

    /**
     * Sign and broadcast multiple transactions.
     *
     * @param transactions - Array of serialized transactions (unsigned Uint8Arrays)
     * @returns Array of transaction signature strings
     */
    async signAndSendTransactions(transactions: Uint8Array[]): Promise<string[]> {
        console.log(`${TAG} signAndSendTransactions | START tx_count=${transactions.length} is_connected=${this.isConnected}`);

        if (!this.isConnected || !this.connectedPubkey) {
            console.log(`${TAG} signAndSendTransactions | FAIL not connected`);
            this._updateStatus('Not connected');
            return [];
        }

        this._updateStatus(`Signing and sending ${transactions.length} transaction(s)...`);

        try {
            const payloadsBase64 = transactions.map((tx, i) => {
                const b64 = this._uint8ArrayToBase64(tx);
                console.log(`${TAG} signAndSendTransactions | payload[${i}] bytes=${tx.length} base64_len=${b64.length}`);
                return b64;
            });

            console.log(`${TAG} signAndSendTransactions | sending sign_and_send command payload_count=${payloadsBase64.length}`);

            const result = await this._bridge.sendCommand<{ signatures: string[] }>('sign_and_send', {
                payloads: payloadsBase64,
                authToken: this.authToken,
            });

            if (!result || !result.signatures) {
                console.log(`${TAG} signAndSendTransactions | FAIL empty response`);
                this._updateStatus('Sign & send failed — no signatures returned');
                return [];
            }

            for (let i = 0; i < result.signatures.length; i++) {
                console.log(`${TAG} signAndSendTransactions | sig[${i}]=${result.signatures[i].substring(0, 20)}...`);
            }

            console.log(`${TAG} signAndSendTransactions | SUCCESS signature_count=${result.signatures.length}`);
            this._updateStatus(`Sent! Sig: ${result.signatures[0]?.substring(0, 20)}...`);
            this.node.emit(MWA_TRANSACTIONS_SENT, result.signatures);
            return result.signatures;

        } catch (e: any) {
            const error = e as MWAError;
            console.log(`${TAG} signAndSendTransactions | EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e}`);
            this._updateStatus(`Sign & send failed: ${error?.message || e}`);
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

            const result = await this._bridge.sendCommand<WalletCapabilities>('get_capabilities');

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
            this.node.emit(MWA_CAPABILITIES_RECEIVED, caps);
            return caps;

        } catch (e: any) {
            const error = e as MWAError;
            console.log(`${TAG} getCapabilities | EXCEPTION code=${error?.code || 'UNKNOWN'} message=${error?.message || e}`);
            this._updateStatus(`Get capabilities failed: ${error?.message || e}`);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DELETE ACCOUNT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Delete account with biometric confirmation, then disconnect and clear cache.
     *
     * Port of Unity MWAManager.cs:311-335 / Godot mwa_manager.gd:400-435.
     *
     * Bug G10: Requires wallet confirmation via signMessage before proceeding.
     * This ensures a stolen phone with an unlocked app can't delete without
     * Seed Vault biometric confirmation.
     */
    async deleteAccount(): Promise<void> {
        console.log(`${TAG} deleteAccount | START pubkey=${this.connectedPubkey} is_connected=${this.isConnected}`);

        if (!this.isConnected) {
            console.log(`${TAG} deleteAccount | FAIL not connected — nothing to delete`);
            this._updateStatus('Not connected — cannot delete');
            return;
        }

        // Compound command: sign confirmation + deauthorize in one MWA session
        // Fixes bug where back-to-back intents caused the deauthorize to be dismissed
        const identity = getAppIdentity();
        const params = {
            authToken: this.authToken,
            appName: identity.appName,
            appUri: identity.appUri,
            appIconPath: identity.appIconPath,
            message: `Confirm account deletion for ${identity.appName}`,
            pubkey: this.connectedPubkey,
        };

        this._updateStatus('Confirm deletion in wallet...');
        console.log(`${TAG} deleteAccount | sending sign_and_deauthorize compound command`);

        try {
            const result = await this._bridge.sendCommand<{ signatures: string[] }>('sign_and_deauthorize', params);

            if (!result?.signatures || result.signatures.length === 0) {
                console.log(`${TAG} deleteAccount | ABORTED user did not confirm — no signature returned`);
                this._updateStatus('Delete cancelled — confirmation required');
                return;
            }

            console.log(`${TAG} deleteAccount | CONFIRMED sig=${result.signatures[0].substring(0, 20)}... — deauthorized in same session`);
        } catch (e: any) {
            console.log(`${TAG} deleteAccount | REJECTED error=${e?.message || e}`);
            this._updateStatus('Delete cancelled');
            return;
        }

        // Clear local state
        this.isConnected = false;
        this.connectedPubkey = '';
        this.authToken = '';
        this.walletUriBase = '';
        this._cache.clearAll();
        this.node.emit(MWA_DISCONNECTED);

        console.log(`${TAG} deleteAccount | DONE cache cleared, session destroyed`);
        this._updateStatus('Account deleted — all cached data cleared');
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

    private _truncatePubkey(pubkey: string): string {
        if (!pubkey || pubkey.length <= 8) return pubkey || '';
        return pubkey.substring(0, 4) + '...' + pubkey.substring(pubkey.length - 4);
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

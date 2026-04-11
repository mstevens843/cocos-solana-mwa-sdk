/**
 * MWABridge.ts — Promise-based JsbBridge communication layer.
 *
 * This is the core bridge between TypeScript and the Android native MWA layer.
 * Every MWA command goes through here. Every response comes back through here.
 *
 * Architecture:
 *   TypeScript: MWABridge.sendCommand('authorize', params)
 *     → JSON serialized → native.bridge.sendToNative('mwa', json)
 *     → Java: MWABridgePlugin receives, dispatches to MWASessionManager
 *     → Java: MWASessionManager executes MWA operation via clientlib
 *     → Java: JsbBridge.sendToScript('mwa', responseJson)
 *     → TypeScript: native.bridge.onNative callback fires
 *     → MWABridge correlates response.id to pending Promise → resolve/reject
 *
 * Godot Bug Prevention:
 *   - G3 (signal never fires): Timeout after 60s with detailed logging
 *   - G4 (type mismatch): JSON enforces string types, no Pubkey objects
 *   - G5 (empty pubkey): Validated at MWAManager level after response
 *   - G7 (signature delivery): Response format defines signatures as base64 strings
 *
 * Unity Bug Prevention:
 *   - U2 (WebSocket exception spam): Noted in logs as expected behavior
 *
 * JsbBridge Limitations & Mitigations:
 *   - Single callback: Namespace prefix "mwa" + unique request IDs
 *   - String-only: JSON serialization for all data
 *   - Fire-and-forget: Promise map correlates responses by ID
 *   - GL thread: Java side uses CocosHelper.runOnGameThread() before sendToScript
 */

import { native, sys } from 'cc';
import { MWACommandName, MWACommand, MWAResponse, MWAError, PendingRequest } from './MWATypes';

const TAG = '[MWABridge]';
const BRIDGE_NAMESPACE = 'mwa';
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

export class MWABridge {

    /** Map of pending request ID → Promise resolve/reject + metadata */
    private _pendingRequests: Map<string, PendingRequest> = new Map();

    /** Auto-incrementing request ID counter */
    private _nextId: number = 1;

    /** Whether the native JsbBridge is available (Android native only) */
    private _isNativeAvailable: boolean = false;

    /** Whether this bridge has been initialized */
    private _initialized: boolean = false;

    // ─── Initialization ──────────────────────────────────────────────────

    constructor() {
        // Detect platform
        this._isNativeAvailable = sys.os === sys.OS.ANDROID && sys.isNative;

        console.log(`${TAG} constructor | START platform=${sys.os} is_native=${sys.isNative} bridge_available=${this._isNativeAvailable}`);

        if (this._isNativeAvailable) {
            this._registerNativeCallback();
            console.log(`${TAG} constructor | DONE mode=native (JsbBridge registered)`);
        } else {
            console.log(`${TAG} constructor | DONE mode=mock (editor/non-Android — will return fake responses)`);
        }

        this._initialized = true;
    }

    /**
     * Register the single JsbBridge callback.
     * All responses from Java come through this one handler.
     */
    private _registerNativeCallback(): void {
        console.log(`${TAG} _registerNativeCallback | START`);

        try {
            native.bridge.onNative = (arg0: string, arg1?: string) => {
                this._onNativeResponse(arg0, arg1);
            };
            console.log(`${TAG} _registerNativeCallback | DONE native.bridge.onNative set`);
        } catch (e) {
            console.log(`${TAG} _registerNativeCallback | FAIL error=${e}`);
        }
    }

    // ─── Send Command ────────────────────────────────────────────────────

    /**
     * Send a command to the native Android MWA layer and return a Promise.
     *
     * On Android: serializes as JSON, sends via native.bridge.sendToNative(),
     * returns Promise that resolves when the matching response arrives.
     *
     * In editor/non-Android: returns mock response after a simulated delay.
     *
     * @param cmd - The MWA command name
     * @param params - Command-specific parameters
     * @param timeoutMs - Timeout in milliseconds (default 60s)
     * @returns Promise resolving to the result payload, or rejecting with MWAError
     */
    sendCommand<T = any>(cmd: MWACommandName, params: Record<string, any> = {}, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
        const id = `req_${String(this._nextId++).padStart(3, '0')}`;
        const paramKeys = Object.keys(params);

        console.log(`${TAG} sendCommand | START cmd=${cmd} id=${id} params_keys=[${paramKeys.join(',')}] timeout_ms=${timeoutMs}`);

        // Mock mode for editor testing
        if (!this._isNativeAvailable) {
            console.log(`${TAG} sendCommand | MOCK mode — generating fake response for cmd=${cmd}`);
            return this._mockResponse<T>(cmd, params, id);
        }

        return new Promise<T>((resolve, reject) => {
            // Store pending request for correlation
            const pending: PendingRequest = {
                resolve,
                reject,
                cmd,
                timestamp: Date.now(),
            };
            this._pendingRequests.set(id, pending);

            // Build command JSON
            const command: MWACommand = { id, cmd, params };
            const json = JSON.stringify(command);

            console.log(`${TAG} sendCommand | SENDING id=${id} json_len=${json.length} pending_count=${this._pendingRequests.size}`);

            // Send to native
            try {
                native.bridge.sendToNative(BRIDGE_NAMESPACE, json);
                console.log(`${TAG} sendCommand | SENT id=${id} cmd=${cmd}`);
            } catch (e) {
                console.log(`${TAG} sendCommand | SEND_FAIL id=${id} error=${e}`);
                this._pendingRequests.delete(id);
                reject({ code: 'SEND_FAILED', message: `Failed to send command: ${e}` } as MWAError);
                return;
            }

            // Timeout handler
            setTimeout(() => {
                if (this._pendingRequests.has(id)) {
                    const elapsed = Date.now() - pending.timestamp;
                    console.log(`${TAG} sendCommand | TIMEOUT id=${id} cmd=${cmd} elapsed_ms=${elapsed} pending_count=${this._pendingRequests.size}`);
                    this._pendingRequests.delete(id);
                    reject({ code: 'TIMEOUT', message: `Command '${cmd}' timed out after ${timeoutMs}ms` } as MWAError);
                }
            }, timeoutMs);
        });
    }

    // ─── Response Handler ────────────────────────────────────────────────

    /**
     * Handle all responses from the native layer.
     * Called by native.bridge.onNative callback.
     */
    private _onNativeResponse(arg0: string, arg1?: string): void {
        // Filter by namespace
        if (arg0 !== BRIDGE_NAMESPACE) {
            console.log(`${TAG} onNative | IGNORED namespace="${arg0}" (expected "${BRIDGE_NAMESPACE}")`);
            return;
        }

        if (!arg1 || arg1.length === 0) {
            console.log(`${TAG} onNative | WARN empty payload received — ignoring`);
            return;
        }

        console.log(`${TAG} onNative | RECEIVED namespace=${arg0} payload_len=${arg1.length}`);

        // Parse response JSON
        let response: MWAResponse;
        try {
            response = JSON.parse(arg1);
        } catch (e) {
            console.log(`${TAG} onNative | PARSE_ERROR payload="${arg1.substring(0, 100)}..." error=${e}`);
            return;
        }

        if (!response.id) {
            console.log(`${TAG} onNative | WARN response missing 'id' field — ignoring`);
            return;
        }

        const hasResult = response.result != null;
        const hasError = response.error != null;
        console.log(`${TAG} onNative | PARSED id=${response.id} has_result=${hasResult} has_error=${hasError}`);

        // Find matching pending request
        const pending = this._pendingRequests.get(response.id);
        if (!pending) {
            console.log(`${TAG} onNative | WARN no pending request for id=${response.id} (stale response? already timed out?)`);
            return;
        }

        // Calculate elapsed time
        const elapsedMs = Date.now() - pending.timestamp;
        this._pendingRequests.delete(response.id);

        // Resolve or reject
        if (hasError && response.error) {
            console.log(`${TAG} onNative | ERROR id=${response.id} cmd=${pending.cmd} code=${response.error.code} message="${response.error.message}" elapsed_ms=${elapsedMs}`);
            console.log(`${TAG} onNative | REJECTING id=${response.id} pending_count=${this._pendingRequests.size}`);
            pending.reject(response.error);
        } else if (hasResult) {
            const resultKeys = Object.keys(response.result!);
            console.log(`${TAG} onNative | SUCCESS id=${response.id} cmd=${pending.cmd} result_keys=[${resultKeys.join(',')}] elapsed_ms=${elapsedMs}`);
            console.log(`${TAG} onNative | RESOLVING id=${response.id} pending_count=${this._pendingRequests.size}`);
            pending.resolve(response.result);
        } else {
            // Neither result nor error — treat as empty success
            console.log(`${TAG} onNative | EMPTY_RESPONSE id=${response.id} cmd=${pending.cmd} elapsed_ms=${elapsedMs} (treating as success)`);
            pending.resolve({});
        }
    }

    // ─── Mock Mode ───────────────────────────────────────────────────────

    /**
     * Generate mock responses for editor testing.
     * Simulates wallet interaction delays so the UI flow can be tested.
     */
    private async _mockResponse<T>(cmd: MWACommandName, params: Record<string, any>, id: string): Promise<T> {
        console.log(`${TAG} mockResponse | START cmd=${cmd} id=${id}`);

        // Simulate wallet interaction delay (500ms-2s)
        const delay = cmd === 'is_available' ? 100 : 1500;
        await this._delay(delay);

        let result: any;

        switch (cmd) {
            case 'authorize':
                result = {
                    pubkey: 'MockPK111111111111111111111111111111111111111',
                    authToken: 'mock_auth_token_' + Date.now(),
                    walletUriBase: 'https://mock-wallet.example.com',
                };
                console.log(`${TAG} mockResponse | cmd=authorize mock_pubkey=${result.pubkey} mock_token_len=${result.authToken.length}`);
                break;

            case 'reauthorize':
                result = {
                    pubkey: 'MockPK111111111111111111111111111111111111111',
                    authToken: 'mock_reauth_token_' + Date.now(),
                    walletUriBase: 'https://mock-wallet.example.com',
                };
                console.log(`${TAG} mockResponse | cmd=reauthorize mock_pubkey=${result.pubkey}`);
                break;

            case 'deauthorize':
                result = {};
                console.log(`${TAG} mockResponse | cmd=deauthorize (session cleared)`);
                break;

            case 'sign_messages': {
                const payloadCount = (params.payloads as any[])?.length ?? 1;
                const mockSigs: string[] = [];
                for (let i = 0; i < payloadCount; i++) {
                    // Generate a fake base64 signature (88 chars = 64 bytes base64-encoded)
                    mockSigs.push('MOCK_SIG_' + btoa(String(Date.now()) + '_' + i).substring(0, 79));
                }
                result = { signatures: mockSigs };
                console.log(`${TAG} mockResponse | cmd=sign_messages mock_sig_count=${mockSigs.length} sig[0]_len=${mockSigs[0].length}`);
                break;
            }

            case 'sign_and_send': {
                const txCount = (params.payloads as any[])?.length ?? 1;
                const mockTxSigs: string[] = [];
                for (let i = 0; i < txCount; i++) {
                    mockTxSigs.push('MockTxSig' + String(Date.now()).substring(5) + String(i));
                }
                result = { signatures: mockTxSigs };
                console.log(`${TAG} mockResponse | cmd=sign_and_send mock_tx_sig_count=${mockTxSigs.length}`);
                break;
            }

            case 'get_capabilities':
                result = {
                    maxTransactionsPerRequest: 10,
                    maxMessagesPerRequest: 10,
                    supportedTransactionVersions: ['legacy', '0'],
                    features: ['solana:signMessages', 'solana:signAndSendTransaction'],
                };
                console.log(`${TAG} mockResponse | cmd=get_capabilities max_txs=${result.maxTransactionsPerRequest} max_msgs=${result.maxMessagesPerRequest}`);
                break;

            case 'is_available':
                result = { available: true };
                console.log(`${TAG} mockResponse | cmd=is_available result=true (mock always available)`);
                break;

            default:
                console.log(`${TAG} mockResponse | UNKNOWN cmd=${cmd} — returning empty`);
                result = {};
        }

        console.log(`${TAG} mockResponse | DONE cmd=${cmd} id=${id} delay_ms=${delay}`);
        return result as T;
    }

    // ─── Utilities ───────────────────────────────────────────────────────

    /**
     * Check if the native bridge is available (Android native only).
     */
    get isNativeAvailable(): boolean {
        return this._isNativeAvailable;
    }

    /**
     * Get the number of currently pending requests.
     * Useful for debugging stale/leaked requests.
     */
    get pendingCount(): number {
        return this._pendingRequests.size;
    }

    /**
     * Cancel all pending requests (e.g., on app shutdown).
     */
    cancelAll(): void {
        const count = this._pendingRequests.size;
        console.log(`${TAG} cancelAll | START pending_count=${count}`);

        for (const [id, pending] of this._pendingRequests) {
            const elapsed = Date.now() - pending.timestamp;
            console.log(`${TAG} cancelAll | CANCELLING id=${id} cmd=${pending.cmd} elapsed_ms=${elapsed}`);
            pending.reject({ code: 'CANCELLED', message: 'All pending requests cancelled' });
        }
        this._pendingRequests.clear();

        console.log(`${TAG} cancelAll | DONE cancelled=${count}`);
    }

    /**
     * Simple delay utility for mock mode.
     */
    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

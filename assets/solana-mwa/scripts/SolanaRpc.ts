/**
 * SolanaRpc.ts — Minimal Solana JSON-RPC client using fetch().
 *
 * Zero npm dependencies. No @solana/web3.js. Uses the standard fetch API
 * which is available in Cocos Creator's V8 runtime on all platforms.
 *
 * Provides only the RPC methods needed for the MWA SDK demo:
 *   - getLatestBlockhash (required for building transactions)
 *   - getBalance (display wallet balance)
 *   - sendTransaction (broadcast signed transaction)
 *   - confirmTransaction (poll for confirmation)
 *   - requestAirdrop (devnet/testnet only)
 */

const TAG = '[SolanaRpc]';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BlockhashResult {
    blockhash: string;           // base58-encoded 32-byte blockhash
    lastValidBlockHeight: number;
}

export interface RpcResponse<T> {
    jsonrpc: string;
    id: number;
    result?: T;
    error?: { code: number; message: string; data?: any };
}

export type Commitment = 'processed' | 'confirmed' | 'finalized';

// ─── RPC Client ──────────────────────────────────────────────────────────────

export class SolanaRpc {

    private _url: string;
    private _nextId: number = 1;

    /**
     * @param rpcUrl The Solana RPC endpoint URL
     */
    constructor(rpcUrl: string = 'https://api.devnet.solana.com') {
        this._url = rpcUrl;
        console.log(`${TAG} constructor | rpc_url=${this._url}`);
    }

    /** Get/set the RPC endpoint URL. */
    get url(): string { return this._url; }
    set url(value: string) {
        console.log(`${TAG} setUrl | old=${this._url} new=${value}`);
        this._url = value;
    }

    // ─── getLatestBlockhash ──────────────────────────────────────────────

    /**
     * Get the latest blockhash for transaction construction.
     *
     * @param commitment The commitment level (default: 'confirmed')
     * @returns BlockhashResult or null on error
     */
    async getLatestBlockhash(commitment: Commitment = 'confirmed'): Promise<BlockhashResult | null> {
        console.log(`${TAG} getLatestBlockhash | START commitment=${commitment}`);

        const result = await this._call<{
            value: { blockhash: string; lastValidBlockHeight: number };
        }>('getLatestBlockhash', [{ commitment }]);

        if (!result || !result.value) {
            console.log(`${TAG} getLatestBlockhash | FAIL null or missing value`);
            return null;
        }

        console.log(`${TAG} getLatestBlockhash | SUCCESS blockhash=${result.value.blockhash.substring(0, 12)}... lastValidBlockHeight=${result.value.lastValidBlockHeight}`);
        return {
            blockhash: result.value.blockhash,
            lastValidBlockHeight: result.value.lastValidBlockHeight,
        };
    }

    // ─── getBalance ──────────────────────────────────────────────────────

    /**
     * Get the SOL balance of an account in lamports.
     *
     * @param pubkey Base58-encoded public key
     * @returns Balance in lamports, or -1 on error
     */
    async getBalance(pubkey: string): Promise<number> {
        console.log(`${TAG} getBalance | START pubkey=${pubkey.substring(0, 8)}...`);

        const result = await this._call<{ value: number }>('getBalance', [pubkey]);

        if (result == null || result.value == null) {
            console.log(`${TAG} getBalance | FAIL null response`);
            return -1;
        }

        const lamports = result.value;
        const sol = lamports / 1_000_000_000;
        console.log(`${TAG} getBalance | SUCCESS lamports=${lamports} sol=${sol.toFixed(9)}`);
        return lamports;
    }

    // ─── sendTransaction ─────────────────────────────────────────────────

    /**
     * Broadcast a signed transaction to the network.
     *
     * @param signedTxBase64 Base64-encoded signed transaction
     * @param options Optional send options
     * @returns Transaction signature (base58) or empty string on error
     */
    async sendTransaction(
        signedTxBase64: string,
        options?: { skipPreflight?: boolean; preflightCommitment?: Commitment }
    ): Promise<string> {
        console.log(`${TAG} sendTransaction | START tx_base64_len=${signedTxBase64.length}`);

        const params: any[] = [signedTxBase64, {
            encoding: 'base64',
            skipPreflight: options?.skipPreflight ?? false,
            preflightCommitment: options?.preflightCommitment ?? 'confirmed',
        }];

        const result = await this._call<string>('sendTransaction', params);

        if (!result) {
            console.log(`${TAG} sendTransaction | FAIL null response`);
            return '';
        }

        console.log(`${TAG} sendTransaction | SUCCESS signature=${result.substring(0, 20)}...`);
        return result;
    }

    // ─── confirmTransaction ──────────────────────────────────────────────

    /**
     * Poll for transaction confirmation.
     * Polls every 2 seconds up to maxRetries times.
     *
     * @param signature Base58 transaction signature
     * @param commitment Commitment level (default: 'confirmed')
     * @param maxRetries Maximum poll attempts (default: 30 = 60 seconds)
     * @returns true if confirmed, false if timed out or errored
     */
    async confirmTransaction(
        signature: string,
        commitment: Commitment = 'confirmed',
        maxRetries: number = 30
    ): Promise<boolean> {
        console.log(`${TAG} confirmTransaction | START signature=${signature.substring(0, 16)}... commitment=${commitment} max_retries=${maxRetries}`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const result = await this._call<{
                value: { confirmationStatus: string; err: any } | null;
            }>('getSignatureStatuses', [[signature]]);

            if (result && result.value) {
                const status = (result.value as any)?.[0];
                if (status && status.confirmationStatus) {
                    const confirmed = this._commitmentMet(status.confirmationStatus, commitment);
                    if (confirmed) {
                        const hasError = status.err != null;
                        console.log(`${TAG} confirmTransaction | CONFIRMED attempt=${attempt} status=${status.confirmationStatus} has_error=${hasError}`);
                        return !hasError;
                    }
                    console.log(`${TAG} confirmTransaction | PENDING attempt=${attempt} status=${status.confirmationStatus} (need=${commitment})`);
                } else {
                    console.log(`${TAG} confirmTransaction | PENDING attempt=${attempt} status=null`);
                }
            }

            // Wait 2 seconds before next poll
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`${TAG} confirmTransaction | TIMEOUT after ${maxRetries} attempts`);
        return false;
    }

    // ─── requestAirdrop ──────────────────────────────────────────────────

    /**
     * Request an airdrop (devnet/testnet only).
     *
     * @param pubkey Base58-encoded public key
     * @param lamports Amount in lamports (default: 1 SOL = 1_000_000_000)
     * @returns Airdrop transaction signature or empty string on error
     */
    async requestAirdrop(pubkey: string, lamports: number = 1_000_000_000): Promise<string> {
        console.log(`${TAG} requestAirdrop | START pubkey=${pubkey.substring(0, 8)}... lamports=${lamports}`);

        const result = await this._call<string>('requestAirdrop', [pubkey, lamports]);

        if (!result) {
            console.log(`${TAG} requestAirdrop | FAIL null response`);
            return '';
        }

        console.log(`${TAG} requestAirdrop | SUCCESS signature=${result.substring(0, 20)}...`);
        return result;
    }

    // ─── Internal RPC Call ───────────────────────────────────────────────

    /**
     * Make a JSON-RPC 2.0 call to the Solana RPC endpoint.
     */
    private async _call<T>(method: string, params: any[] = []): Promise<T | null> {
        const id = this._nextId++;

        const body = JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params,
        });

        console.log(`${TAG} _call | POST method=${method} id=${id} body_len=${body.length}`);

        try {
            const response = await fetch(this._url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });

            if (!response.ok) {
                console.log(`${TAG} _call | HTTP_ERROR method=${method} status=${response.status} statusText=${response.statusText}`);
                return null;
            }

            const json: RpcResponse<T> = await response.json();

            if (json.error) {
                console.log(`${TAG} _call | RPC_ERROR method=${method} code=${json.error.code} message="${json.error.message}"`);
                return null;
            }

            return json.result ?? null;

        } catch (e) {
            console.log(`${TAG} _call | FETCH_ERROR method=${method} error=${e}`);
            return null;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    /**
     * Check if a confirmation status meets the required commitment.
     * processed < confirmed < finalized
     */
    private _commitmentMet(actual: string, required: Commitment): boolean {
        const levels: Record<string, number> = { processed: 0, confirmed: 1, finalized: 2 };
        return (levels[actual] ?? -1) >= (levels[required] ?? 1);
    }
}

/**
 * TokenDuelRpc.ts - Token Duel-specific RPC helpers.
 *
 * Plain TypeScript class (NOT a Cocos Component) so it doesn't need a
 * class UUID registered in `generate-scenes.js`. AppUI owns the instance.
 *
 * Session 3 role: holdings read is the legacy fallback when the player
 * hasn't built a squad yet. Primary data source for the panel is now
 * `BirdeyeClient` (trending / gainers / new-listings / search) - see
 * `assets/token-duel/scripts/birdeye/BirdeyeClient.ts`. This module also
 * hosts `getLeaderboard()` which reads the on-chain Leaderboard PDA.
 */

import { getAppIdentity } from '../../solana-mwa/scripts/AppIdentity';
import { base58Encode, base58Decode } from '../../solana-mwa/scripts/Base58';
import { PROGRAM_ID } from './constants';
import { findProgramAddress } from './PdaDeriver';

const TAG = '[TokenDuelRpc]';

// SPL Token program (classic; Token-2022 is a separate programId, ignored in v1).
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Known-mint priority. Earlier = higher priority. Unknown mints sort last.
// Kept compact but covers most recognizable tokens a demo wallet might hold.
// Decimals are best-effort; uiAmount isn't surfaced in the UI so wrong decimals
// only affect internal sorting, not display.
const KNOWN_TOKENS: Array<{ mint: string; symbol: string; decimals: number }> = [
    // Stablecoins
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
    { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
    // LSTs
    { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'JitoSOL', decimals: 9 },
    { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  symbol: 'mSOL', decimals: 9 },
    // Memecoins (top by volume, 2025-2026)
    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
    { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF',  decimals: 6 },
    { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', decimals: 9 },
    { mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',   symbol: 'MEW',  decimals: 5 },
    { mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',    symbol: 'WEN',  decimals: 5 },
    { mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',   symbol: 'BOME', decimals: 6 },
    // Protocol / governance
    { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP',  decimals: 6 },
    { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', decimals: 6 },
    { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY',  decimals: 6 },
    { mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', symbol: 'W',    decimals: 6 },
    { mint: 'DBRiDgJAMu3KJL5kRh7s1h4jrM11ntPQm8WqHKSQFcWG', symbol: 'DBR',  decimals: 6 },
];

const KNOWN_MINT_TO_SYMBOL = new Map(KNOWN_TOKENS.map(t => [t.mint, t.symbol]));
const KNOWN_MINT_TO_DECIMALS = new Map(KNOWN_TOKENS.map(t => [t.mint, t.decimals]));
const KNOWN_MINT_PRIORITY = new Map(KNOWN_TOKENS.map((t, i) => [t.mint, i]));

export interface Holding {
    mint: string;      // base58 mint, or '' for native SOL / empty slot
    symbol: string;    // 'SOL', 'BONK', etc.; '---' for empty slot
    uiAmount: number;  // amount / 10**decimals
    /** Birdeye logo URI for the token. Optional; populated when the holding
     *  was sourced from a squad pick (TokenRow has logoUri) and consumed by
     *  the in-race token cards to render the circular icon. Empty / absent
     *  for wallet-discovered fallback holdings. */
    logoUri?: string;
}

/** On-chain leaderboard entry. Matches the 41-byte Rust struct exactly. */
export interface LeaderboardEntry {
    player: string;     // base58 pubkey (32 bytes)
    height: number;     // u8
    settled_at: number; // i64 seconds since epoch (fits in number until 2038+; we cast)
}

const LEADERBOARD_SEED = new TextEncoder().encode('leaderboard');
const LEADERBOARD_SIZE = 10;
const LEADERBOARD_ENTRY_SIZE = 32 + 1 + 8; // 41 bytes per entry
const ANCHOR_DISCRIMINATOR_SIZE = 8;

interface RpcResponse<T> {
    jsonrpc: string;
    id: number;
    result?: T;
    error?: { code: number; message: string; data?: any };
}

interface TokenAccountResult {
    context: { slot: number };
    value: Array<{
        pubkey: string;
        account: {
            data: [string, string]; // [base64 payload, 'base64' encoding tag]
            executable: boolean;
            lamports: number;
            owner: string;
            rentEpoch: number;
        };
    }>;
}

export class TokenDuelRpc {
    private _url: string;
    private _nextId = 1;

    constructor() {
        const cluster = getAppIdentity().cluster;
        this._url = cluster === 'mainnet-beta'
            ? 'https://api.mainnet-beta.solana.com'
            : cluster === 'testnet'
                ? 'https://api.testnet.solana.com'
                : 'https://api.devnet.solana.com';
        console.log(`${TAG} ctor | url=${this._url} cluster=${cluster}`);
    }

    /**
     * Top-3 holdings: SOL first, then the highest-priority SPL tokens the wallet
     * holds. Missing slots are padded with `{ symbol: '---' }` so result.length === 3.
     */
    async getTopHoldings(owner: string): Promise<Holding[]> {
        console.log(`${TAG} getTopHoldings | START owner=${owner}`);

        const [solLamports, spl] = await Promise.all([
            this._getBalance(owner),
            this.getTokenAccountsByOwner(owner),
        ]);

        const sol: Holding = {
            mint: '',
            symbol: 'SOL',
            uiAmount: solLamports / 1_000_000_000,
        };

        // Skip empty token accounts, sort by known-token priority.
        const nonZero = spl.filter(a => a.amount > 0n);
        nonZero.sort((a, b) => {
            const pa = KNOWN_MINT_PRIORITY.get(a.mint) ?? 999;
            const pb = KNOWN_MINT_PRIORITY.get(b.mint) ?? 999;
            return pa - pb;
        });

        const empty: Holding = { mint: '', symbol: '---', uiAmount: 0 };
        const out: Holding[] = [sol];
        for (let i = 0; i < 2; i++) {
            const acc = nonZero[i];
            if (!acc) { out.push(empty); continue; }
            const symbol = this.resolveTokenSymbol(acc.mint);
            const decimals = KNOWN_MINT_TO_DECIMALS.get(acc.mint) ?? 0;
            const uiAmount = decimals > 0 ? Number(acc.amount) / Math.pow(10, decimals) : Number(acc.amount);
            out.push({ mint: acc.mint, symbol, uiAmount });
        }

        console.log(`${TAG} getTopHoldings | DONE [${out.map(h => h.symbol).join(', ')}]`);
        return out;
    }

    /**
     * Raw RPC - parses the 165-byte SPL Account layout from base64.
     * Returns `{ mint, amount }` per account; decimals lookup is done
     * against the hardcoded table to avoid a second RPC call.
     */
    async getTokenAccountsByOwner(owner: string): Promise<{ mint: string; amount: bigint }[]> {
        const result = await this._call<TokenAccountResult>('getTokenAccountsByOwner', [
            owner,
            { programId: TOKEN_PROGRAM_ID },
            { encoding: 'base64', commitment: 'confirmed' },
        ]);

        if (!result || !result.value) {
            console.log(`${TAG} getTokenAccountsByOwner | empty or null result`);
            return [];
        }

        const out: { mint: string; amount: bigint }[] = [];
        for (const item of result.value) {
            const [b64] = item.account.data;
            const bytes = this._base64ToBytes(b64);
            if (bytes.length < 72) continue; // SPL Account layout requires at least mint+owner+amount.
            const mint = base58Encode(bytes.subarray(0, 32));
            const amount = this._u64LE(bytes, 64);
            out.push({ mint, amount });
        }
        console.log(`${TAG} getTokenAccountsByOwner | accounts=${out.length}`);
        return out;
    }

    /** Lookup a known mint symbol; unknown mints return `?<first4>`. */
    resolveTokenSymbol(mint: string): string {
        const known = KNOWN_MINT_TO_SYMBOL.get(mint);
        const symbol = known ?? `?${mint.substring(0, 4)}`;
        console.log(`${TAG} resolveTokenSymbol | DONE mint="${mint.substring(0, 8)}..." known=${!!known} symbol="${symbol}"`);
        return symbol;
    }

    /**
     * Fetch the on-chain leaderboard (top 10). Returns sorted descending by
     * height. Empty array when the PDA is uninitialized or the parse fails.
     *
     * Layout (matches programs/token-duel/src/state.rs `Leaderboard`):
     *   [8 bytes Anchor discriminator][10 × (32 + 1 + 8)] = 8 + 410 = 418 bytes
     * Entries with height == 0 are treated as empty (Rust zero-default).
     */
    async getLeaderboard(): Promise<LeaderboardEntry[]> {
        console.log(`${TAG} getLeaderboard | START`);
        const [pda] = findProgramAddress([LEADERBOARD_SEED], PROGRAM_ID);
        console.log(`${TAG} getLeaderboard | pda=${pda}`);
        const result = await this._call<{ value: { data: [string, string]; owner: string; lamports: number } | null }>(
            'getAccountInfo',
            [pda, { encoding: 'base64', commitment: 'confirmed' }],
        );
        if (!result || !result.value) {
            console.log(`${TAG} getLeaderboard | NOT_INITIALIZED pda=${pda} result_null=${!result}`);
            return [];
        }
        const owner = result.value.owner;
        if (owner !== PROGRAM_ID) {
            console.log(`${TAG} getLeaderboard | WRONG_OWNER pda=${pda} expected=${PROGRAM_ID} got=${owner}`);
            return [];
        }
        const [b64] = result.value.data;
        const bytes = this._base64ToBytes(b64);
        const expected = ANCHOR_DISCRIMINATOR_SIZE + LEADERBOARD_SIZE * LEADERBOARD_ENTRY_SIZE;
        if (bytes.length < expected) {
            console.log(`${TAG} getLeaderboard | SHORT_ACCOUNT expected=${expected} got=${bytes.length}`);
            return [];
        }
        const out: LeaderboardEntry[] = [];
        for (let i = 0; i < LEADERBOARD_SIZE; i++) {
            const off = ANCHOR_DISCRIMINATOR_SIZE + i * LEADERBOARD_ENTRY_SIZE;
            const playerBytes = bytes.subarray(off, off + 32);
            const height = bytes[off + 32];
            const settledAt = Number(this._i64LE(bytes, off + 33));
            if (height === 0) continue; // zero-initialized slot
            out.push({
                player: base58Encode(playerBytes),
                height,
                settled_at: settledAt,
            });
        }
        // Program guarantees sorted order, but sort defensively in case of
        // an older bytecode version returning unsorted entries.
        out.sort((a, b) => b.height - a.height);
        console.log(`${TAG} getLeaderboard | DONE entries=${out.length} top_height=${out[0]?.height ?? 0}`);
        return out;
    }

    // ─── Session D Part 3: generic RPC surface for MatchRpc + UserStatsRpc ───

    /**
     * Read a single account. Returns `{ dataBase64, owner, lamports }` or null.
     * Used by MatchRpc.getMatch() and UserStatsRpc.getUserStats().
     */
    async getAccountInfo(pda: string): Promise<{ dataBase64: string; owner: string; lamports: number } | null> {
        const result = await this._call<{ value: { data: [string, string]; owner: string; lamports: number } | null }>(
            'getAccountInfo',
            [pda, { encoding: 'base64', commitment: 'confirmed' }],
        );
        if (!result || !result.value) {
            console.log(`${TAG} getAccountInfo | NULL pda=${pda}`);
            return null;
        }
        return {
            dataBase64: result.value.data[0],
            owner: result.value.owner,
            lamports: result.value.lamports,
        };
    }

    /**
     * Thin getProgramAccounts wrapper - accepts raw Solana filter objects
     * (memcmp offsets in bytes, base58-encoded pattern bytes). Returns
     * array of `{ pubkey, dataBase64, owner, lamports }`.
     */
    async getProgramAccounts(
        programId: string,
        filters: Array<{ memcmp: { offset: number; bytes: string } } | { dataSize: number }>,
    ): Promise<Array<{ pubkey: string; dataBase64: string; owner: string; lamports: number }>> {
        const result = await this._call<Array<{
            pubkey: string;
            account: { data: [string, string]; owner: string; lamports: number };
        }>>('getProgramAccounts', [
            programId,
            {
                encoding: 'base64',
                commitment: 'confirmed',
                filters,
            },
        ]);
        if (!result) {
            console.log(`${TAG} getProgramAccounts | NULL program=${programId} filters=${filters.length}`);
            return [];
        }
        const out = result.map((r) => ({
            pubkey: r.pubkey,
            dataBase64: r.account.data[0],
            owner: r.account.owner,
            lamports: r.account.lamports,
        }));
        console.log(`${TAG} getProgramAccounts | DONE program=${programId} filters=${filters.length} found=${out.length}`);
        return out;
    }

    /**
     * Part 9: `getSignaturesForAddress` - paginated wrapper used by
     * MatchHistoryRpc to walk back through a user's UserStats-PDA
     * signature log. `before` is the cursor (last signature from prior
     * page); `until` stops the walk at a known older signature.
     */
    async getSignaturesForAddress(
        address: string,
        opts: { limit?: number; before?: string; until?: string } = {},
    ): Promise<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>> {
        const params: any[] = [address, {
            limit: opts.limit ?? 100,
            ...(opts.before ? { before: opts.before } : {}),
            ...(opts.until ? { until: opts.until } : {}),
            commitment: 'confirmed',
        }];
        const result = await this._call<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>>(
            'getSignaturesForAddress', params,
        );
        if (!result) {
            console.log(`${TAG} getSignaturesForAddress | NULL address=${address.substring(0, 8)}... before=${opts.before ?? '-'}`);
            return [];
        }
        console.log(`${TAG} getSignaturesForAddress | DONE address=${address.substring(0, 8)}... returned=${result.length} before=${opts.before ?? '-'}`);
        return result;
    }

    /**
     * Part 9: `getTransaction` - fetch a single tx (we use the log messages
     * only). MatchHistoryRpc scans `meta.logMessages` for `Program data:`
     * lines and decodes MatchSettled/MatchForceSettled events.
     */
    async getTransaction(signature: string): Promise<{
        meta: { logMessages: string[] | null; err: unknown } | null;
        blockTime: number | null;
        slot: number;
    } | null> {
        const result = await this._call<{
            meta: { logMessages: string[] | null; err: unknown } | null;
            blockTime: number | null;
            slot: number;
        }>('getTransaction', [signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
        }]);
        if (!result) {
            console.log(`${TAG} getTransaction | NULL sig=${signature.substring(0, 16)}...`);
            return null;
        }
        return result;
    }

    // ─── Internals ────────────────────────────────────────────────────────

    private _i64LE(bytes: Uint8Array, offset: number): bigint {
        // Two's complement signed 64-bit little-endian.
        let val = 0n;
        for (let i = 7; i >= 0; i--) {
            val = (val << 8n) | BigInt(bytes[offset + i]);
        }
        // Sign-extend if high bit set.
        if (bytes[offset + 7] & 0x80) {
            val = val - (1n << 64n);
        }
        return val;
    }

    private async _getBalance(pubkey: string): Promise<number> {
        const result = await this._call<{ value: number }>('getBalance', [pubkey]);
        const lamports = result?.value ?? 0;
        console.log(`${TAG} _getBalance | DONE pubkey="${pubkey.substring(0, 8)}..." lamports=${lamports} sol=${(lamports / 1_000_000_000).toFixed(6)}`);
        return lamports;
    }

    // CP4: retry once on transient failures (HTTP 429 / 5xx / network errors).
    // Hard RPC errors (bad method args, unknown account) aren't retried - those
    // are user-facing issues, not rate limits.
    private async _call<T>(method: string, params: any[] = []): Promise<T | null> {
        const attempt = async (): Promise<{ result: T | null; transient: boolean }> => {
            const id = this._nextId++;
            const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
            try {
                const response = await fetch(this._url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                });
                if (!response.ok) {
                    console.log(`${TAG} _call | HTTP_ERROR method=${method} status=${response.status}`);
                    return { result: null, transient: response.status === 429 || response.status >= 500 };
                }
                const json = await response.json() as RpcResponse<T>;
                if (json.error) {
                    console.log(`${TAG} _call | RPC_ERROR method=${method} code=${json.error.code} message="${json.error.message}"`);
                    return { result: null, transient: false };
                }
                return { result: json.result ?? null, transient: false };
            } catch (e) {
                console.log(`${TAG} _call | FETCH_ERROR method=${method} error=${e}`);
                return { result: null, transient: true };
            }
        };

        let res = await attempt();
        if (res.result === null && res.transient) {
            await new Promise((r) => setTimeout(r, 500));
            console.log(`${TAG} _call | RETRY method=${method}`);
            res = await attempt();
        }
        return res.result;
    }

    private _base64ToBytes(b64: string): Uint8Array {
        const binary = atob(b64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        console.log(`${TAG} _base64ToBytes | DONE b64_chars=${b64.length} bytes=${out.length} insufficient_for_spl_account=${out.length < 72}`);
        return out;
    }

    private _u64LE(bytes: Uint8Array, offset: number): bigint {
        let val = 0n;
        for (let i = 7; i >= 0; i--) {
            val = (val << 8n) | BigInt(bytes[offset + i]);
        }
        return val;
    }
}

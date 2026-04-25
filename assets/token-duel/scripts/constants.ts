/**
 * Token Duel — program/cluster constants.
 *
 * Devnet-only for v1. Mainnet values swap in at Phase 7 deploy time.
 *
 * Pubkeys are kept as base58 strings (not web3.js `PublicKey` objects) so
 * this module works in the Cocos Android runtime — @solana/web3.js pulls in
 * `tr46` which Cocos's Rollup bundler can't resolve. Callers that need the
 * raw 32-byte form use `base58Decode` from the SDK's `Base58` module.
 */

export type SolanaCluster = 'devnet' | 'mainnet-beta';

/** Token Duel Anchor program, deployed to devnet. */
export const PROGRAM_ID = '14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd';

/** Singleton protocol pool PDA, derived from seed [b"pool"] — constant per deploy. */
export const POOL_PDA = 'Gq2WfDRim2pu4x6FW3adpwMRah4uW46hNt3dTYeSFgp4';

/**
 * Part 14: tournament host public key (mutable cache).
 *
 * The backend runs a scheduled cron (every 15 min on devnet, 1 hr on
 * mainnet) that creates BattleRoyale matches as player 0. Matches seeded
 * by this pubkey are surfaced in the client as "tournaments" — a rotating
 * badge on HomePanel + a dedicated TournamentPanel for spectating + joining.
 *
 * AppUI fetches `/tournaments/host` from the backend on connect and calls
 * `setTournamentHostPubkey` to populate this. Before the fetch resolves,
 * the getter returns empty string and tournament features are disabled.
 */
const _tournamentHostRef = { value: '' };

export function getTournamentHostPubkey(): string {
    return _tournamentHostRef.value;
}

export function setTournamentHostPubkey(pubkey: string): void {
    _tournamentHostRef.value = pubkey ?? '';
}

/** @deprecated use `getTournamentHostPubkey()`. Kept as a placeholder for
 *  build-time imports that prefer a constant name; always reflects the
 *  getter's current value via a property accessor. */
export const TOURNAMENT_HOST_PUBKEY = '';

/** System Program ID — "11111111111111111111111111111111". */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export const CLUSTER: SolanaCluster = 'devnet';
export const RPC_URL = 'https://api.devnet.solana.com';

/** Stake amount used by the v1 demo. Must satisfy the program's bounds. */
export const STAKE_LAMPORTS = 10_000_000n; // 0.01 SOL

/** Stake slider range (Session 2) — must sit inside the on-chain MIN/MAX. */
export const STAKE_MIN_SOL = 0.001;
export const STAKE_MAX_SOL = 0.1;
export const STAKE_DEFAULT_SOL = 0.01;

/** Seeds — must stay in lockstep with `programs/token-duel/src/state.rs`. */
export const SEEDS = {
    POOL: new TextEncoder().encode('pool'),
    SESSION: new TextEncoder().encode('session'),
    ESCROW: new TextEncoder().encode('escrow'),
    LEADERBOARD: new TextEncoder().encode('leaderboard'),
    // Session D — match / stats / rake
    TREASURY: new TextEncoder().encode('treasury'),
    MATCH_COUNTER: new TextEncoder().encode('match_counter'),
    MATCH: new TextEncoder().encode('match'),
    MATCH_ESCROW: new TextEncoder().encode('match_escrow'),
    USER_STATS: new TextEncoder().encode('userstats'),
    // Part 10 Bundle 3 — retention PDAs
    DAILY_CHALLENGE: new TextEncoder().encode('daily_challenge'),
    SEASON: new TextEncoder().encode('season'),
};

// ─── Birdeye (off-chain data) ────────────────────────────────────────────
//
// Embedded in-bundle for v1. Known trade-off: APK decompile gets you the key.
// Acceptable because the Birdeye key is read-only, CU-metered, and can't sign.
// Post-hackathon moves this behind a backend proxy.
//
// If the key is empty, `BirdeyeClient` still constructs and calls fail with a
// clean 401 — the game falls back to the deterministic-seed PriceFeedMock path.
export const BIRDEYE_API_KEY = '9f0cc75842d144a394229cc14efecfd1';

/** Feed row count per tab. Birdeye caps /defi/v3/token/list at 20 per page. */
export const FEED_ROW_LIMIT = 20;

/** Squad size — number of tokens the player picks. Locked to 3 for v1. */
export const SQUAD_SIZE = 3;

/** Price-feed poll cadence (ms). Birdeye /defi/price_volume/multi is cheap — 15s is safe. */
export const PRICE_FEED_POLL_MS = 15_000;

/** Search autocomplete popover row count — matches solpulse's 5-row suggestion list. */
export const SEARCH_SUGGEST_LIMIT = 5;

/** Birdeye /defi/v3/token/meta-data/multiple caps at 50 addresses per call. */
export const META_DATA_BATCH = 50;

/** Search input debounce (ms) — matches solpulse's 1000ms "NewPairsFeed" timing. */
export const SEARCH_DEBOUNCE_MS = 1000;

/** LocalStorage key for watchlist persistence. Schema: WatchlistItem[]. */
export const WATCHLIST_LS_KEY = 'tokenduel:watchlist';

// ═══════════════════════════════════════════════════════════════════
// Part 10 Bundle 1 — server-signed height receipts
// ═══════════════════════════════════════════════════════════════════

/**
 * URL of the receipt-signing backend. Overridable at runtime via
 * `globalThis.TD_RECEIPT_URL` for dev; production builds bake the
 * Railway / Fly URL in. For local dev, point at `http://<host-ip>:3000`
 * (Android emulator uses 10.0.2.2, device-on-LAN uses your laptop IP).
 */
export const RECEIPT_BACKEND_URL: string =
    (globalThis as any).TD_RECEIPT_URL ?? 'http://10.0.2.2:3000';
console.log(`[constants] BOOT RECEIPT_BACKEND_URL=${RECEIPT_BACKEND_URL}`);

/** Solana Ed25519 native program address — required when building the
 *  precompile instruction that precedes `settle_match_verified`. */
export const ED25519_PROGRAM_ID = 'Ed25519SigVerify111111111111111111111111111';

/** Instructions sysvar address — read by `settle_match_verified` to find
 *  the Ed25519 precompile ix at index 0. */
export const SYSVAR_INSTRUCTIONS_ID = 'Sysvar1nstructions1111111111111111111111111';

// ═══════════════════════════════════════════════════════════════════
// Part 11 Bundle B — NFT trophies (Metaplex Bubblegum cNFT)
// ═══════════════════════════════════════════════════════════════════

/**
 * Helius DAS (Digital Asset Standard) endpoint for cNFT queries. Key is the
 * same Helius account as the devnet receipt signer (see reference_deployments).
 * Override at runtime via `globalThis.TD_HELIUS_KEY` if rotated.
 */
const HELIUS_KEY = (globalThis as any).TD_HELIUS_KEY ?? '3078be0f-e9b1-4685-8a0b-081b87dddf45';
export const HELIUS_DAS_URL: string = `https://devnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

/**
 * Bubblegum merkle tree that holds Token Duel weekly trophy cNFTs.
 * Set by `scripts/init-trophy-tree.ts` and pasted here after one-time creation.
 * Empty means the feature is disabled client-side (TrophyRpc returns []).
 */
export const TROPHY_TREE_ADDRESS: string =
    (globalThis as any).TD_TROPHY_TREE ?? '';

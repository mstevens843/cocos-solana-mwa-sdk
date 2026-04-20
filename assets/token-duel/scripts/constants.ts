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

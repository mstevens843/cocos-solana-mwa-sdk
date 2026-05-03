/**
 * WagerCurrency.ts — single source of truth for the SOL / SKR wager-currency
 * picker added in the betting-duel branch.
 *
 * Mirrors `state.rs` constants (WAGER_TIERS_SKR_ATOMS) and the on-chain
 * mint validation in `instructions/join_match_skr.rs`. Pubkeys are kept as
 * base58 strings (no `PublicKey` objects) to stay compatible with the Cocos
 * Android bundler — see constants.ts header for the rationale.
 */

import { CLUSTER, type SolanaCluster } from './constants';

export type WagerCurrency = 'SOL' | 'SKR';

/** Native SOL has 9 decimals (lamports); SKR is a 6-decimal SPL token. */
export const SOL_DECIMALS = 9;
export const SKR_DECIMALS = 6;

/**
 * Canonical Solana Mobile $SKR mint on mainnet-beta.
 * Source: https://blog.solanamobile.com/post/skr-is-live (2026-01-21).
 */
export const SKR_MINT_MAINNET = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';

/**
 * Devnet test-SKR mint, provisioned 2026-05-02 by `scripts/setup-devnet-skr.sh`
 * from the admin keypair (`8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe`).
 * Decimals=6, initial supply=100M held by treasury ATA. Hackathon judges +
 * smoke tests use this. Must mirror `state::SKR_MINT_DEVNET` in lockstep.
 */
export const SKR_MINT_DEVNET = 'EL1pCD9yEqkbivjRjYuhRWtUxqPmgKK8xHmZcqqPDFC1';

/** Resolve the active SKR mint for the current cluster. */
export function skrMintForCluster(cluster: SolanaCluster = CLUSTER): string {
    return cluster === 'mainnet-beta' ? SKR_MINT_MAINNET : SKR_MINT_DEVNET;
}

/** True when the SKR mint is configured for the current cluster (i.e. SKR
 *  wagers are enabled). False on devnet until the test-mint is provisioned. */
export function isSkrAvailable(cluster: SolanaCluster = CLUSTER): boolean {
    return skrMintForCluster(cluster).length > 0;
}

/**
 * Round-number SKR wager tiers in atom units (10^SKR_DECIMALS = 1 SKR).
 * MUST match `WAGER_TIERS_SKR_ATOMS` in `state.rs`.
 *
 * Append-only: pre-existing SKR matches with `wager_tier: 0..N` keep
 * resolving correctly. New tiers go at the end.
 */
export const WAGER_TIERS_SKR_ATOMS: bigint[] = [
    100_000_000n,    // 100 SKR    — index 0
    500_000_000n,    // 500 SKR    — index 1
    1_000_000_000n,  // 1k SKR     — index 2
    5_000_000_000n,  // 5k SKR     — index 3
    10_000_000_000n, // 10k SKR    — index 4
    25_000_000_000n, // 25k SKR    — index 5
];

export const WAGER_TIERS_SKR_LABELS: string[] = [
    '100 SKR',
    '500 SKR',
    '1K SKR',
    '5K SKR',
    '10K SKR',
    '25K SKR',
];

/**
 * SKR dropdown display index → on-chain tier index. The wager dropdown for
 * SKR has fewer rows than SOL (no INTRO tier) so the mapping is identity.
 * Kept as a constant so the mapping is symmetric with `WAGER_DISPLAY_TO_TIER`
 * in ModeDefs.ts.
 */
export const WAGER_DISPLAY_TO_TIER_SKR: readonly number[] = [0, 1, 2, 3, 4, 5];

/**
 * Format a raw atom amount for display. `atoms` is interpreted in the
 * currency's smallest unit (lamports for SOL, 10^-6 SKR for SKR).
 */
export function formatWagerAmount(atoms: bigint, currency: WagerCurrency): string {
    const decimals = currency === 'SOL' ? SOL_DECIMALS : SKR_DECIMALS;
    const divisor = 10n ** BigInt(decimals);
    const whole = atoms / divisor;
    const frac = atoms % divisor;
    if (frac === 0n) return `${whole.toString()} ${currency}`;
    // Trim trailing zeros from the fractional part for compactness.
    let fracStr = frac.toString().padStart(decimals, '0');
    fracStr = fracStr.replace(/0+$/, '');
    return `${whole.toString()}.${fracStr} ${currency}`;
}

/**
 * Resolve a (currency, tier) pair to atoms. Returns 0n if the tier index is
 * out of bounds for the currency. Mirrors the `WAGER_TIERS[tier]` lookup the
 * Anchor program does at create time.
 */
export function tierAtoms(currency: WagerCurrency, tierIndex: number): bigint {
    if (currency === 'SKR') {
        if (tierIndex < 0 || tierIndex >= WAGER_TIERS_SKR_ATOMS.length) return 0n;
        return WAGER_TIERS_SKR_ATOMS[tierIndex];
    }
    // SOL tiers live in ModeDefs.ts as `WAGER_TIERS_LAMPORTS: number[]`.
    // Re-import lazily here to avoid a circular import at module-load.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WAGER_TIERS_LAMPORTS } = require('./ModeDefs');
    const arr: number[] = WAGER_TIERS_LAMPORTS;
    if (tierIndex < 0 || tierIndex >= arr.length) return 0n;
    return BigInt(arr[tierIndex]);
}

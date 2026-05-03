/**
 * AnchorBackend.ts — builds Token Duel Anchor-program transactions as raw
 * Uint8Array bytes that the existing MWAManager.signAndSendTransaction()
 * surface consumes.
 *
 * No @solana/web3.js in the Cocos bundle — web3.js transitively pulls in
 * `tr46` which Cocos's Rollup bundler can't resolve. We build tx bytes via
 * the SDK's own `buildAnchorTransaction` helper (pure-TS, zero external
 * deps), derive PDAs via `PdaDeriver` (sha256 + @noble/curves ed25519
 * curve check), and compute the Anchor instruction discriminator via
 * `js-sha256`.
 *
 * Account order in each instruction MUST exactly match the Rust
 * `#[derive(Accounts)]` struct field order in
 * `programs/token-duel/src/instructions/{commit,settle}.rs`.
 */

import { sha256 } from '@noble/hashes/sha256';

import {
    buildAnchorTransaction,
    buildMultiIxTransaction,
    AnchorAccountMetaInput,
    RawInstructionInput,
} from '../../solana-mwa/scripts/TransactionBuilder';
import { base58Decode } from '../../solana-mwa/scripts/Base58';
import { ED25519_PROGRAM_ID, POOL_PDA, PROGRAM_ID, SEEDS, SYSTEM_PROGRAM_ID, SYSVAR_INSTRUCTIONS_ID, SYSVAR_RENT_ID } from './constants';
import { findProgramAddress, u64LeBytes } from './PdaDeriver';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    buildCreateAtaIdempotentIx,
    deriveAssociatedTokenAddress,
} from './SplTokenIx';

/** Legacy singleton leaderboard PDA — seeds [b"leaderboard"]. Used by solo settle. */
function deriveLeaderboardPda(): string {
    const [pda] = findProgramAddress([SEEDS.LEADERBOARD], PROGRAM_ID);
    return pda;
}

/** Per-mode leaderboard PDA — seeds [b"leaderboard", &[mode]]. Session D Part 7. */
function deriveModeLeaderboardPda(modeU8: number): string {
    const modeByte = new Uint8Array([modeU8 & 0xff]);
    const [pda] = findProgramAddress([SEEDS.LEADERBOARD, modeByte], PROGRAM_ID);
    return pda;
}

const TAG = '[AnchorBackend]';

function concat(...arrays: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
        out.set(a, offset);
        offset += a.length;
    }
    return out;
}

function bytesToHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

/** Decode a base64 string into a Uint8Array. Works in Cocos (atob) and Node (Buffer). */
function base64ToBytes(b64: string): Uint8Array {
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    const B: any = (globalThis as any).Buffer;
    if (B) return new Uint8Array(B.from(b64, 'base64'));
    throw new Error('no base64 decoder (neither atob nor Buffer)');
}

export class AnchorBackend {
    /** Anchor instruction discriminator: `sha256('global:<ix>').slice(0, 8)`. */
    static discriminator(ixName: string): Uint8Array {
        const input = `global:${ixName}`;
        const inputBytes = new TextEncoder().encode(input);
        const all = sha256(inputBytes); // @noble/hashes returns Uint8Array directly.
        const first8 = all.subarray(0, 8);
        console.log(`${TAG} discriminator | DONE input="${input}" full_hash=${bytesToHex(all)} first8_hex=${bytesToHex(first8)}`);
        return first8;
    }

    /**
     * Derive the per-round session + escrow PDAs for a given player +
     * session_seed.
     *   session: [b"session", player.toBytes(), u64LE(sessionSeed)]
     *   escrow:  [b"escrow", session.toBytes()]
     *
     * @returns Both PDAs as base58 strings.
     */
    static derivePdas(playerBase58: string, sessionSeed: bigint): {
        session: string;
        escrow: string;
    } {
        const playerBytes = base58Decode(playerBase58);
        const seedBytes = u64LeBytes(sessionSeed);

        const [session] = findProgramAddress(
            [SEEDS.SESSION, playerBytes, seedBytes],
            PROGRAM_ID,
        );
        const [escrow] = findProgramAddress(
            [SEEDS.ESCROW, base58Decode(session)],
            PROGRAM_ID,
        );
        console.log(`${TAG} derivePdas | DONE player=${playerBase58} seed_hex=${bytesToHex(seedBytes)} seed_u64=${sessionSeed} session=${session} escrow=${escrow}`);
        return { session, escrow };
    }

    /**
     * Build an unsigned commit transaction.
     * Keys: [player (signer,mut), session (mut), escrow (mut), system_program].
     * Data: [disc(commit) | amount u64 LE | sessionSeed u64 LE].
     */
    static buildCommitTx(
        playerBase58: string,
        amountLamports: bigint,
        sessionSeed: bigint,
        blockhash: string,
    ): Uint8Array {
        const { session, escrow } = this.derivePdas(playerBase58, sessionSeed);

        const disc = this.discriminator('commit');
        const data = concat(
            disc,
            u64LeBytes(amountLamports),
            u64LeBytes(sessionSeed),
        );

        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,   isSigner: true,  isWritable: true  },
            { pubkeyBase58: session,         isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,          isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];

        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildCommitTx | DONE player=${playerBase58} amount=${amountLamports} seed=${sessionSeed} session=${session} escrow=${escrow} data_hex=${bytesToHex(data)} tx_bytes=${bytes.length} blockhash=${blockhash}`);
        return bytes;
    }

    /**
     * Build an unsigned settle transaction.
     * Keys: [player (signer,mut), session (mut), escrow (mut), pool (mut), leaderboard (mut), system_program].
     * Data: [disc(settle) | height u8].
     *
     * Session 3 Phase B: `settle` now requires a Leaderboard account. The
     * program amends the PDA's entries after payout succeeds. If the PDA
     * isn't initialized yet (pre-B5 devnet state), the tx will revert with
     * an Anchor AccountNotInitialized error — fix by running the B6 init script.
     */
    static buildSettleTx(
        playerBase58: string,
        sessionSeed: bigint,
        height: number,
        blockhash: string,
    ): Uint8Array {
        const { session, escrow } = this.derivePdas(playerBase58, sessionSeed);
        const leaderboard = deriveLeaderboardPda();

        const disc = this.discriminator('settle');
        const data = concat(disc, new Uint8Array([height & 0xff]));

        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: session,             isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,              isSigner: false, isWritable: true  },
            { pubkeyBase58: POOL_PDA,            isSigner: false, isWritable: true  },
            { pubkeyBase58: leaderboard,         isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID,   isSigner: false, isWritable: false },
        ];

        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildSettleTx | DONE player=${playerBase58} height=${height} seed=${sessionSeed} session=${session} escrow=${escrow} pool=${POOL_PDA} leaderboard=${leaderboard} data_hex=${bytesToHex(data)} tx_bytes=${bytes.length} blockhash=${blockhash}`);
        return bytes;
    }

    /** Public derivation helpers for per-mode leaderboards. */
    static deriveModeLeaderboardPda(modeU8: number): string {
        return deriveModeLeaderboardPda(modeU8);
    }
    /** Public derivation helper for legacy singleton leaderboard (solo settle). */
    static deriveLegacyLeaderboardPda(): string {
        return deriveLeaderboardPda();
    }

    /**
     * Build an unsigned initialize_leaderboard transaction.
     * Keys: [admin (signer,mut), leaderboard (mut,init), system_program].
     * Data: [disc(initialize_leaderboard)].
     */
    static buildInitLeaderboardTx(adminBase58: string, blockhash: string): Uint8Array {
        const leaderboard = deriveLeaderboardPda();
        const disc = this.discriminator('initialize_leaderboard');
        const data = disc;

        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: leaderboard,        isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID,  isSigner: false, isWritable: false },
        ];

        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildInitLeaderboardTx | DONE admin=${adminBase58} leaderboard=${leaderboard} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build an unsigned initialize_mode_leaderboard transaction (Session D Part 7).
     * Keys: [admin (signer,mut), mode_leaderboard (mut,init), system_program].
     * Data: [disc(initialize_mode_leaderboard) | mode u8].
     */
    static buildInitModeLeaderboardTx(
        adminBase58: string,
        modeU8: number,
        blockhash: string,
    ): Uint8Array {
        const leaderboard = deriveModeLeaderboardPda(modeU8);
        const disc = this.discriminator('initialize_mode_leaderboard');
        const data = concat(disc, new Uint8Array([modeU8 & 0xff]));
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: leaderboard,       isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildInitModeLeaderboardTx | DONE admin=${adminBase58} mode=${modeU8} leaderboard=${leaderboard} tx_bytes=${bytes.length}`);
        return bytes;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Session D — Match-making, UserStats, Treasury tx builders
    // Ix account order MUST match #[derive(Accounts)] in Rust instruction
    // files. If Rust struct order changes, break this wire protocol.
    // ═══════════════════════════════════════════════════════════════════

    /** Derive Treasury PDA. */
    static deriveTreasuryPda(): string {
        const [pda] = findProgramAddress([SEEDS.TREASURY], PROGRAM_ID);
        return pda;
    }

    /** Derive Pool PDA (Session D Part 8 — legacy pool, still holds residual SOL). */
    static derivePoolPda(): string {
        const [pda] = findProgramAddress([SEEDS.POOL], PROGRAM_ID);
        return pda;
    }

    /** Derive MatchCounter PDA. */
    static deriveMatchCounterPda(): string {
        const [pda] = findProgramAddress([SEEDS.MATCH_COUNTER], PROGRAM_ID);
        return pda;
    }

    /** Derive UserStats PDA for a given player. */
    static deriveUserStatsPda(playerBase58: string): string {
        const [pda] = findProgramAddress([SEEDS.USER_STATS, base58Decode(playerBase58)], PROGRAM_ID);
        return pda;
    }

    /**
     * Derive Match PDA for a given (mode, wager_tier, seq).
     * Seeds: [b"match", mode_u8, wager_tier_u8, seq_u64_le]
     */
    static deriveMatchPda(mode: number, wagerTier: number, seq: bigint): string {
        const modeBytes = new Uint8Array([mode & 0xff]);
        const tierBytes = new Uint8Array([wagerTier & 0xff]);
        const seqBytes = u64LeBytes(seq);
        const [pda] = findProgramAddress([SEEDS.MATCH, modeBytes, tierBytes, seqBytes], PROGRAM_ID);
        return pda;
    }

    /** Derive MatchEscrow (system-account PDA) for a given Match. */
    static deriveMatchEscrowPda(matchPdaBase58: string): string {
        const [pda] = findProgramAddress([SEEDS.MATCH_ESCROW, base58Decode(matchPdaBase58)], PROGRAM_ID);
        return pda;
    }

    /** Part 10 Bundle 3: derive DailyChallenge PDA for a given day_id. */
    static deriveDailyChallengePda(dayId: bigint): string {
        const [pda] = findProgramAddress([SEEDS.DAILY_CHALLENGE, u64LeBytes(dayId)], PROGRAM_ID);
        return pda;
    }

    /** Part 10 Bundle 3: derive Season PDA for a given season_id (week). */
    static deriveSeasonPda(seasonId: bigint): string {
        const [pda] = findProgramAddress([SEEDS.SEASON, u64LeBytes(seasonId)], PROGRAM_ID);
        return pda;
    }

    /** Compute current-day id (matches Rust DAY_SECONDS = 86_400). */
    static currentDayId(nowSec?: number): bigint {
        const sec = nowSec ?? Math.floor(Date.now() / 1000);
        return BigInt(Math.floor(sec / 86_400));
    }

    /** Compute current-season id (matches Rust WEEK_SECONDS = 7 * 86_400). */
    static currentSeasonId(nowSec?: number): bigint {
        const sec = nowSec ?? Math.floor(Date.now() / 1000);
        return BigInt(Math.floor(sec / (7 * 86_400)));
    }

    /** Build unsigned initialize_treasury tx. Keys: admin, treasury, system_program. */
    static buildInitTreasuryTx(adminBase58: string, blockhash: string): Uint8Array {
        const treasury = this.deriveTreasuryPda();
        const disc = this.discriminator('initialize_treasury');
        const data = disc;
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: treasury,          isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildInitTreasuryTx | DONE admin=${adminBase58} treasury=${treasury} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /** Build unsigned initialize_match_counter tx. Keys: admin, counter, system_program. */
    static buildInitMatchCounterTx(adminBase58: string, blockhash: string): Uint8Array {
        const counter = this.deriveMatchCounterPda();
        const disc = this.discriminator('initialize_match_counter');
        const data = disc;
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: counter,           isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildInitMatchCounterTx | DONE admin=${adminBase58} counter=${counter} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /** Build unsigned initialize_user_stats tx. Keys: player, stats, system_program. */
    static buildInitUserStatsTx(playerBase58: string, blockhash: string): Uint8Array {
        const stats = this.deriveUserStatsPda(playerBase58);
        const disc = this.discriminator('initialize_user_stats');
        const data = disc;
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,      isSigner: true,  isWritable: true  },
            { pubkeyBase58: stats,             isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildInitUserStatsTx | DONE player=${playerBase58} stats=${stats} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build unsigned join_match_create tx. Keys: player, counter, match, match_escrow, system_program.
     * Data (Part 9):
     *   [disc(join_match_create) | mode u8 | wager_tier u8 | xp_bucket u16 LE
     *    | time_window u8 | seq u64 LE]
     * time_window ∈ {0=1h, 1=24h, 2=3d, 3=7d}. It is stored in the Match
     * account but NOT part of the PDA seed (seq is globally unique).
     */
    static buildJoinMatchCreateTx(
        playerBase58: string,
        mode: number,
        wagerTier: number,
        xpBucket: number,
        timeWindow: number,
        seq: bigint,
        blockhash: string,
    ): Uint8Array {
        const counter = this.deriveMatchCounterPda();
        const matchPda = this.deriveMatchPda(mode, wagerTier, seq);
        const escrow = this.deriveMatchEscrowPda(matchPda);
        const disc = this.discriminator('join_match_create');
        const argBytes = new Uint8Array(1 + 1 + 2 + 1 + 8);
        argBytes[0] = mode & 0xff;
        argBytes[1] = wagerTier & 0xff;
        argBytes[2] = xpBucket & 0xff;
        argBytes[3] = (xpBucket >> 8) & 0xff;
        argBytes[4] = timeWindow & 0xff;
        argBytes.set(u64LeBytes(seq), 5);
        const data = concat(disc, argBytes);
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,      isSigner: true,  isWritable: true  },
            { pubkeyBase58: counter,           isSigner: false, isWritable: true  },
            { pubkeyBase58: matchPda,          isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,            isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildJoinMatchCreateTx | DONE player=${playerBase58} mode=${mode} tier=${wagerTier} window=${timeWindow} seq=${seq} match=${matchPda} escrow=${escrow} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build unsigned join_match_join tx. Keys: player, match, match_escrow, system_program.
     * Data: [disc(join_match_join)].
     */
    static buildJoinMatchJoinTx(
        playerBase58: string,
        matchPdaBase58: string,
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const disc = this.discriminator('join_match_join');
        const data = disc;
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,      isSigner: true,  isWritable: true  },
            { pubkeyBase58: matchPdaBase58,    isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,            isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildJoinMatchJoinTx | DONE player=${playerBase58} match=${matchPdaBase58} escrow=${escrow} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Session D Part 6: mode-generic settle_match tx.
     *
     * Named accounts (6):
     *   [player, match, match_escrow, treasury, leaderboard, system_program]
     * Remaining accounts (N + K):
     *   [stats_p0, stats_p1, ..., stats_pN-1, payout_1, payout_2, ..., payout_K]
     *
     * N = allPlayers.length; K = payoutRecipients.length. Caller MUST:
     *   - Pass all N players in the same order as `match.players[0..N]`.
     *   - Pass payoutRecipients sorted by rank (1st place first), of length K
     *     == mode.payoutBps.length.
     *
     * For the partial-settler path (settled_count < required - 1), remaining
     * accounts can be empty or omitted; program ignores them.
     *
     * Data: [disc(settle_match) | height u32 LE].
     */
    static buildSettleMatchTx(
        playerBase58: string,
        matchPdaBase58: string,
        matchModeU8: number,
        allPlayersBase58: string[],
        payoutRecipientsBase58: string[],
        height: number,
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const treasury = this.deriveTreasuryPda();
        const leaderboard = deriveModeLeaderboardPda(matchModeU8);
        // Part 10 Bundle 3: retention PDAs pinned to the current UTC day/week.
        const dailyChallenge = this.deriveDailyChallengePda(this.currentDayId());
        const season = this.deriveSeasonPda(this.currentSeasonId());
        const disc = this.discriminator('settle_match');
        const heightBytes = new Uint8Array(4);
        heightBytes[0] = height & 0xff;
        heightBytes[1] = (height >> 8) & 0xff;
        heightBytes[2] = (height >> 16) & 0xff;
        heightBytes[3] = (height >> 24) & 0xff;
        const data = concat(disc, heightBytes);

        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,      isSigner: true,  isWritable: true  },
            { pubkeyBase58: matchPdaBase58,    isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,            isSigner: false, isWritable: true  },
            { pubkeyBase58: treasury,          isSigner: false, isWritable: true  },
            { pubkeyBase58: leaderboard,       isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkeyBase58: dailyChallenge,    isSigner: false, isWritable: true  },
            { pubkeyBase58: season,            isSigner: false, isWritable: true  },
        ];
        // Append N stats accounts (derived from each player pubkey).
        for (const p of allPlayersBase58) {
            accounts.push({ pubkeyBase58: this.deriveUserStatsPda(p), isSigner: false, isWritable: true });
        }
        // Append K payout recipients (in rank order).
        for (const r of payoutRecipientsBase58) {
            accounts.push({ pubkeyBase58: r, isSigner: false, isWritable: true });
        }
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildSettleMatchTx | DONE player=${playerBase58} match=${matchPdaBase58} mode=${matchModeU8} leaderboard=${leaderboard} daily=${dailyChallenge} season=${season} height=${height} n_stats=${allPlayersBase58.length} k_payouts=${payoutRecipientsBase58.length} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Session D Part 8: admin_withdraw tx builder (Treasury → recipient).
     * Keys: [admin, treasury, recipient, system_program].
     * Data: [disc(admin_withdraw) | amount u64 LE].
     */
    static buildAdminWithdrawTx(
        adminBase58: string,
        recipientBase58: string,
        amountLamports: bigint,
        blockhash: string,
    ): Uint8Array {
        const treasury = this.deriveTreasuryPda();
        const disc = this.discriminator('admin_withdraw');
        const data = concat(disc, u64LeBytes(amountLamports));
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: treasury,          isSigner: false, isWritable: true  },
            { pubkeyBase58: recipientBase58,   isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildAdminWithdrawTx | DONE admin=${adminBase58} treasury=${treasury} recipient=${recipientBase58} amount=${amountLamports} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Session D Part 8: admin_withdraw_pool tx builder (Pool → recipient).
     * Keys: [admin, pool, recipient, system_program].
     * Data: [disc(admin_withdraw_pool) | amount u64 LE].
     */
    static buildAdminWithdrawPoolTx(
        adminBase58: string,
        recipientBase58: string,
        amountLamports: bigint,
        blockhash: string,
    ): Uint8Array {
        const pool = this.derivePoolPda();
        const disc = this.discriminator('admin_withdraw_pool');
        const data = concat(disc, u64LeBytes(amountLamports));
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: pool,              isSigner: false, isWritable: true  },
            { pubkeyBase58: recipientBase58,   isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildAdminWithdrawPoolTx | DONE admin=${adminBase58} pool=${pool} recipient=${recipientBase58} amount=${amountLamports} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Part 10 Bundle 1: settle_match_verified tx builder.
     *
     * The backend signed a 76-byte receipt `[match_pda || player || height || signed_at]`
     * using the `RECEIPT_SIGNER_PUBKEY` keypair and returned the full
     * Ed25519 precompile instruction data blob (base64). We wrap that as
     * ix[0], append `settle_match_verified(height, signed_at)` as ix[1],
     * and build a single transaction the player signs via MWA.
     *
     * Named accounts on the Anchor ix (7):
     *   [player, match, match_escrow, treasury, leaderboard, system_program, ix_sysvar]
     * Remaining accounts (N + K): same as settle_match — stats[] + payout recipients[].
     */
    static buildSettleMatchVerifiedTx(
        playerBase58: string,
        matchPdaBase58: string,
        matchModeU8: number,
        allPlayersBase58: string[],
        payoutRecipientsBase58: string[],
        height: number,
        signedAt: number, // unix seconds, matches the receipt's signed_at
        ed25519IxDataB64: string,
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const treasury = this.deriveTreasuryPda();
        const leaderboard = deriveModeLeaderboardPda(matchModeU8);

        // ix[0] — Ed25519 precompile. Data is verbatim what the backend emitted.
        const ed25519Data = base64ToBytes(ed25519IxDataB64);
        const ed25519Ix: RawInstructionInput = {
            programIdBase58: ED25519_PROGRAM_ID,
            accounts: [], // Precompile takes no account inputs.
            data: ed25519Data,
        };

        // ix[1] — settle_match_verified(height u32 LE, signed_at i64 LE).
        const disc = this.discriminator('settle_match_verified');
        const argBytes = new Uint8Array(4 + 8);
        argBytes[0] = height & 0xff;
        argBytes[1] = (height >> 8) & 0xff;
        argBytes[2] = (height >> 16) & 0xff;
        argBytes[3] = (height >> 24) & 0xff;
        // i64 signed_at LE. `signedAt` fits in Number for any reasonable date.
        const saBig = BigInt(signedAt);
        const saBytes = u64LeBytes(saBig);
        argBytes.set(saBytes, 4);
        const data = concat(disc, argBytes);

        // Part 10 Bundle 3: retention PDAs (identical to legacy path).
        const dailyChallenge = this.deriveDailyChallengePda(this.currentDayId());
        const season = this.deriveSeasonPda(this.currentSeasonId());

        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,         isSigner: true,  isWritable: true  },
            { pubkeyBase58: matchPdaBase58,       isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,               isSigner: false, isWritable: true  },
            { pubkeyBase58: treasury,             isSigner: false, isWritable: true  },
            { pubkeyBase58: leaderboard,          isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID,    isSigner: false, isWritable: false },
            { pubkeyBase58: SYSVAR_INSTRUCTIONS_ID, isSigner: false, isWritable: false },
            { pubkeyBase58: dailyChallenge,       isSigner: false, isWritable: true  },
            { pubkeyBase58: season,               isSigner: false, isWritable: true  },
        ];
        for (const p of allPlayersBase58) {
            accounts.push({ pubkeyBase58: this.deriveUserStatsPda(p), isSigner: false, isWritable: true });
        }
        for (const r of payoutRecipientsBase58) {
            accounts.push({ pubkeyBase58: r, isSigner: false, isWritable: true });
        }

        const anchorIx: RawInstructionInput = {
            programIdBase58: PROGRAM_ID,
            accounts,
            data,
        };

        const bytes = buildMultiIxTransaction([ed25519Ix, anchorIx], playerBase58, blockhash);
        console.log(`${TAG} buildSettleMatchVerifiedTx | DONE player=${playerBase58} match=${matchPdaBase58} h=${height} signed_at=${signedAt} daily=${dailyChallenge} season=${season} ed25519_ix_bytes=${ed25519Data.length} anchor_ix_data_bytes=${data.length} tx_bytes=${bytes.length}`);
        return bytes;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Part 10 Bundle 3 — retention tx builders
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Migrate a player's UserStats from v1 (72B) to v2 (112B).
     * Keys: [player (signer+mut), stats (mut,realloc), system_program].
     * Data: [disc(migrate_user_stats)] — no args.
     */
    static buildMigrateUserStatsTx(playerBase58: string, blockhash: string): Uint8Array {
        const stats = this.deriveUserStatsPda(playerBase58);
        const disc = this.discriminator('migrate_user_stats');
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,      isSigner: true,  isWritable: true  },
            { pubkeyBase58: stats,             isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, disc, playerBase58, blockhash);
        console.log(`${TAG} buildMigrateUserStatsTx | DONE player=${playerBase58} stats=${stats} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Admin-gated: initialize today's DailyChallenge PDA.
     * Data: [disc(initialize_daily_challenge) | day_id u64 LE | Challenge×3 each (kind u8 | target u32 LE | reward_xp u16 LE)]
     */
    static buildInitDailyChallengeTx(
        adminBase58: string,
        dayId: bigint,
        challenges: Array<{ kind: number; target: number; rewardXp: number }>,
        blockhash: string,
    ): Uint8Array {
        if (challenges.length !== 3) throw new Error('challenges must be a 3-element array');
        const challengePda = this.deriveDailyChallengePda(dayId);
        const disc = this.discriminator('initialize_daily_challenge');
        // Args: day_id u64 + 3 × (kind u8 + target u32 + reward_xp u16) = 8 + 21 = 29 bytes
        const argBytes = new Uint8Array(8 + 21);
        argBytes.set(u64LeBytes(dayId), 0);
        let o = 8;
        for (const c of challenges) {
            argBytes[o] = c.kind & 0xff; o += 1;
            argBytes[o] = c.target & 0xff;
            argBytes[o + 1] = (c.target >> 8) & 0xff;
            argBytes[o + 2] = (c.target >> 16) & 0xff;
            argBytes[o + 3] = (c.target >> 24) & 0xff;
            o += 4;
            argBytes[o] = c.rewardXp & 0xff;
            argBytes[o + 1] = (c.rewardXp >> 8) & 0xff;
            o += 2;
        }
        const data = concat(disc, argBytes);
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: challengePda,      isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildInitDailyChallengeTx | DONE admin=${adminBase58} day_id=${dayId} pda=${challengePda} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Admin-gated: initialize the current-week Season PDA.
     * Data: [disc(initialize_season) | season_id u64 LE]
     */
    static buildInitSeasonTx(
        adminBase58: string,
        seasonId: bigint,
        blockhash: string,
    ): Uint8Array {
        const seasonPda = this.deriveSeasonPda(seasonId);
        const disc = this.discriminator('initialize_season');
        const data = concat(disc, u64LeBytes(seasonId));
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: seasonPda,         isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildInitSeasonTx | DONE admin=${adminBase58} season_id=${seasonId} pda=${seasonPda} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Admin-gated: pay out 20% of a past season's accumulated rake to top-3.
     * Keys: [admin, treasury, season, system_program], then 3 recipient AccountInfos.
     * Data: [disc(pay_season) | season_id u64 LE]
     */
    static buildPaySeasonTx(
        adminBase58: string,
        seasonId: bigint,
        recipientsBase58: string[],
        blockhash: string,
    ): Uint8Array {
        const treasury = this.deriveTreasuryPda();
        const seasonPda = this.deriveSeasonPda(seasonId);
        const disc = this.discriminator('pay_season');
        const data = concat(disc, u64LeBytes(seasonId));
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: adminBase58,       isSigner: true,  isWritable: true  },
            { pubkeyBase58: treasury,          isSigner: false, isWritable: true  },
            { pubkeyBase58: seasonPda,         isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        for (const r of recipientsBase58) {
            accounts.push({ pubkeyBase58: r, isSigner: false, isWritable: true });
        }
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, adminBase58, blockhash);
        console.log(`${TAG} buildPaySeasonTx | DONE admin=${adminBase58} season_id=${seasonId} recipients=${recipientsBase58.length} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Part 9: force_settle tx builder. Same account + remaining-accounts
     * contract as settle_match's final-settler path, but:
     *   - caller doesn't need to be a match player
     *   - no height arg in instruction data (program forfeits absent players
     *     by filling their slot with 0)
     *
     * Named accounts (6):
     *   [caller, match, match_escrow, treasury, leaderboard, system_program]
     * Remaining accounts (N + K):
     *   [stats_p0, ..., stats_pN-1, payout_1, ..., payout_K]
     */
    static buildForceSettleTx(
        callerBase58: string,
        matchPdaBase58: string,
        matchModeU8: number,
        allPlayersBase58: string[],
        payoutRecipientsBase58: string[],
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const treasury = this.deriveTreasuryPda();
        const leaderboard = deriveModeLeaderboardPda(matchModeU8);
        // Part 10 Bundle 3: retention PDAs pinned to current UTC day/week
        // (mirrors buildSettleMatchTx placement).
        const dailyChallenge = this.deriveDailyChallengePda(this.currentDayId());
        const season = this.deriveSeasonPda(this.currentSeasonId());
        const disc = this.discriminator('force_settle');
        const data = disc;

        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: callerBase58,      isSigner: true,  isWritable: true  },
            { pubkeyBase58: matchPdaBase58,    isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,            isSigner: false, isWritable: true  },
            { pubkeyBase58: treasury,          isSigner: false, isWritable: true  },
            { pubkeyBase58: leaderboard,       isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkeyBase58: dailyChallenge,    isSigner: false, isWritable: true  },
            { pubkeyBase58: season,            isSigner: false, isWritable: true  },
        ];
        for (const p of allPlayersBase58) {
            accounts.push({ pubkeyBase58: this.deriveUserStatsPda(p), isSigner: false, isWritable: true });
        }
        for (const r of payoutRecipientsBase58) {
            accounts.push({ pubkeyBase58: r, isSigner: false, isWritable: true });
        }
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, callerBase58, blockhash);
        console.log(`${TAG} buildForceSettleTx | DONE caller=${callerBase58} match=${matchPdaBase58} mode=${matchModeU8} daily=${dailyChallenge} season=${season} n_stats=${allPlayersBase58.length} k_payouts=${payoutRecipientsBase58.length} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build unsigned cancel_match tx.
     * Keys: canceller, match, match_escrow, refund_recipient, system_program.
     * Data: [disc(cancel_match)].
     */
    static buildCancelMatchTx(
        cancellerBase58: string,
        matchPdaBase58: string,
        refundRecipientBase58: string,
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const disc = this.discriminator('cancel_match');
        const data = disc;
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: cancellerBase58,      isSigner: true,  isWritable: false },
            { pubkeyBase58: matchPdaBase58,       isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,               isSigner: false, isWritable: true  },
            { pubkeyBase58: refundRecipientBase58,isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSTEM_PROGRAM_ID,    isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, cancellerBase58, blockhash);
        console.log(`${TAG} buildCancelMatchTx | DONE canceller=${cancellerBase58} match=${matchPdaBase58} refund_to=${refundRecipientBase58} tx_bytes=${bytes.length}`);
        return bytes;
    }

    // ═══════════════════════════════════════════════════════════════════
    // betting-duel — $SKR (SPL-token) wager tx builders
    //
    // Account orders MUST match the #[derive(Accounts)] structs in
    // `programs/token-duel/src/instructions/{join_match_skr,
    // settle_match_skr, cancel_match_skr}.rs`. If a Rust struct field
    // reorders, this wire protocol breaks.
    // ═══════════════════════════════════════════════════════════════════

    /** Per-match SPL escrow TokenAccount PDA. Seeds: [b"match_escrow_token", match_pda]. */
    static deriveMatchEscrowTokenPda(matchPdaBase58: string): string {
        const [pda] = findProgramAddress([SEEDS.MATCH_ESCROW_TOKEN, base58Decode(matchPdaBase58)], PROGRAM_ID);
        return pda;
    }

    /** Per-mint treasury ATA. Authority is the Treasury PDA. */
    static deriveTreasuryTokenAta(mintBase58: string): string {
        return deriveAssociatedTokenAddress(this.deriveTreasuryPda(), mintBase58);
    }

    /** Player's ATA for a given mint (canonical associated token address). */
    static derivePlayerAta(playerBase58: string, mintBase58: string): string {
        return deriveAssociatedTokenAddress(playerBase58, mintBase58);
    }

    /**
     * Build a single-instruction tx that idempotently creates `wallet`'s
     * ATA for `mint`. Cheap preflight — no-op if the ATA already exists.
     */
    static buildEnsureAtaTx(
        fundingBase58: string,
        walletBase58: string,
        mintBase58: string,
        blockhash: string,
    ): Uint8Array {
        const ix = buildCreateAtaIdempotentIx(fundingBase58, walletBase58, mintBase58);
        const bytes = buildMultiIxTransaction([ix], fundingBase58, blockhash);
        console.log(`${TAG} buildEnsureAtaTx | DONE funder=${fundingBase58} wallet=${walletBase58} mint=${mintBase58} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build unsigned join_match_create_skr tx. The player's SKR ATA must
     * already be funded with at least the wager amount; caller is
     * responsible for any preflight `buildEnsureAtaTx`.
     *
     * Account order matches `JoinMatchCreateSkr`:
     *   [player, counter, match, match_escrow, mint, match_escrow_token,
     *    player_token_account, token_program, associated_token_program,
     *    system_program, rent]
     *
     * Data: [disc(join_match_create_skr) | mode u8 | wager_tier u8
     *        | xp_bucket u16 LE | time_window u8 | seq u64 LE]
     */
    static buildJoinMatchCreateSkrTx(
        playerBase58: string,
        mintBase58: string,
        mode: number,
        wagerTier: number,
        xpBucket: number,
        timeWindow: number,
        seq: bigint,
        blockhash: string,
    ): Uint8Array {
        const counter = this.deriveMatchCounterPda();
        const matchPda = this.deriveMatchPda(mode, wagerTier, seq);
        const escrow = this.deriveMatchEscrowPda(matchPda);
        const escrowToken = this.deriveMatchEscrowTokenPda(matchPda);
        const playerAta = this.derivePlayerAta(playerBase58, mintBase58);
        const disc = this.discriminator('join_match_create_skr');
        const argBytes = new Uint8Array(1 + 1 + 2 + 1 + 8);
        argBytes[0] = mode & 0xff;
        argBytes[1] = wagerTier & 0xff;
        argBytes[2] = xpBucket & 0xff;
        argBytes[3] = (xpBucket >> 8) & 0xff;
        argBytes[4] = timeWindow & 0xff;
        argBytes.set(u64LeBytes(seq), 5);
        const data = concat(disc, argBytes);
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,                isSigner: true,  isWritable: true  },
            { pubkeyBase58: counter,                     isSigner: false, isWritable: true  },
            { pubkeyBase58: matchPda,                    isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,                      isSigner: false, isWritable: true  },
            { pubkeyBase58: mintBase58,                  isSigner: false, isWritable: false },
            { pubkeyBase58: escrowToken,                 isSigner: false, isWritable: true  },
            { pubkeyBase58: playerAta,                   isSigner: false, isWritable: true  },
            { pubkeyBase58: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
            { pubkeyBase58: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkeyBase58: SYSTEM_PROGRAM_ID,           isSigner: false, isWritable: false },
            { pubkeyBase58: SYSVAR_RENT_ID,              isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildJoinMatchCreateSkrTx | DONE player=${playerBase58} mint=${mintBase58} mode=${mode} tier=${wagerTier} window=${timeWindow} seq=${seq} match=${matchPda} escrow_token=${escrowToken} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build unsigned join_match_join_skr tx. Account order matches
     * `JoinMatchJoinSkr`:
     *   [player, match, match_escrow, mint, match_escrow_token,
     *    player_token_account, token_program, system_program]
     */
    static buildJoinMatchJoinSkrTx(
        playerBase58: string,
        matchPdaBase58: string,
        mintBase58: string,
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const escrowToken = this.deriveMatchEscrowTokenPda(matchPdaBase58);
        const playerAta = this.derivePlayerAta(playerBase58, mintBase58);
        const disc = this.discriminator('join_match_join_skr');
        const data = disc;
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,      isSigner: true,  isWritable: true  },
            { pubkeyBase58: matchPdaBase58,    isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,            isSigner: false, isWritable: true  },
            { pubkeyBase58: mintBase58,        isSigner: false, isWritable: false },
            { pubkeyBase58: escrowToken,       isSigner: false, isWritable: true  },
            { pubkeyBase58: playerAta,         isSigner: false, isWritable: true  },
            { pubkeyBase58: TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
            { pubkeyBase58: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, playerBase58, blockhash);
        console.log(`${TAG} buildJoinMatchJoinSkrTx | DONE player=${playerBase58} match=${matchPdaBase58} mint=${mintBase58} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build unsigned settle_match_verified_skr tx — Ed25519 precompile +
     * Anchor ix in a single atomic transaction.
     *
     * Caller responsibilities:
     *   - Pass `allPlayersBase58` in match.players[0..N] order (UserStats
     *     PDAs are derived per-player here).
     *   - Pass `payoutRecipientsBase58` in rank order (1st, 2nd, ...) of
     *     length K = mode.payoutBps.length. Each recipient's SKR ATA is
     *     derived here. **The recipient ATAs MUST exist** before this tx
     *     runs — preflight `buildEnsureAtaTx` for any winner who hasn't
     *     held SKR before.
     *
     * Account order matches `SettleMatchVerifiedSkr`:
     *   [player, match, match_escrow, mint, match_escrow_token, treasury,
     *    treasury_token, leaderboard, ix_sysvar, token_program,
     *    associated_token_program, system_program, rent]
     * Remaining accounts (N + K):
     *   [stats_p0..stats_pN-1, recipient_ata_1..recipient_ata_K]
     */
    static buildSettleMatchVerifiedSkrTx(
        playerBase58: string,
        matchPdaBase58: string,
        matchModeU8: number,
        mintBase58: string,
        height: number,
        signedAt: number,
        ed25519IxDataB64: string,
        allPlayersBase58: string[],
        payoutRecipientsBase58: string[],
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const escrowToken = this.deriveMatchEscrowTokenPda(matchPdaBase58);
        const treasury = this.deriveTreasuryPda();
        const treasuryToken = this.deriveTreasuryTokenAta(mintBase58);
        const leaderboard = deriveModeLeaderboardPda(matchModeU8);

        const ed25519Data = base64ToBytes(ed25519IxDataB64);
        const ed25519Ix: RawInstructionInput = {
            programIdBase58: ED25519_PROGRAM_ID,
            accounts: [],
            data: ed25519Data,
        };

        const disc = this.discriminator('settle_match_verified_skr');
        const argBytes = new Uint8Array(4 + 8);
        argBytes[0] = height & 0xff;
        argBytes[1] = (height >> 8) & 0xff;
        argBytes[2] = (height >> 16) & 0xff;
        argBytes[3] = (height >> 24) & 0xff;
        argBytes.set(u64LeBytes(BigInt(signedAt)), 4);
        const data = concat(disc, argBytes);

        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: playerBase58,                isSigner: true,  isWritable: true  },
            { pubkeyBase58: matchPdaBase58,              isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,                      isSigner: false, isWritable: true  },
            { pubkeyBase58: mintBase58,                  isSigner: false, isWritable: false },
            { pubkeyBase58: escrowToken,                 isSigner: false, isWritable: true  },
            { pubkeyBase58: treasury,                    isSigner: false, isWritable: true  },
            { pubkeyBase58: treasuryToken,               isSigner: false, isWritable: true  },
            { pubkeyBase58: leaderboard,                 isSigner: false, isWritable: true  },
            { pubkeyBase58: SYSVAR_INSTRUCTIONS_ID,      isSigner: false, isWritable: false },
            { pubkeyBase58: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
            { pubkeyBase58: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkeyBase58: SYSTEM_PROGRAM_ID,           isSigner: false, isWritable: false },
            { pubkeyBase58: SYSVAR_RENT_ID,              isSigner: false, isWritable: false },
        ];
        for (const p of allPlayersBase58) {
            accounts.push({ pubkeyBase58: this.deriveUserStatsPda(p), isSigner: false, isWritable: true });
        }
        for (const r of payoutRecipientsBase58) {
            accounts.push({ pubkeyBase58: this.derivePlayerAta(r, mintBase58), isSigner: false, isWritable: true });
        }

        const anchorIx: RawInstructionInput = {
            programIdBase58: PROGRAM_ID,
            accounts,
            data,
        };

        const bytes = buildMultiIxTransaction([ed25519Ix, anchorIx], playerBase58, blockhash);
        console.log(`${TAG} buildSettleMatchVerifiedSkrTx | DONE player=${playerBase58} match=${matchPdaBase58} mint=${mintBase58} h=${height} signed_at=${signedAt} n_stats=${allPlayersBase58.length} k_payouts=${payoutRecipientsBase58.length} tx_bytes=${bytes.length}`);
        return bytes;
    }

    /**
     * Build unsigned cancel_match_skr tx. Account order matches
     * `CancelMatchSkr`:
     *   [canceller, match, match_escrow, mint, match_escrow_token,
     *    refund_recipient_ata, token_program, system_program]
     *
     * `refundRecipientBase58` is the WALLET pubkey of the creator (slot 0);
     * the ATA is derived here.
     */
    static buildCancelMatchSkrTx(
        cancellerBase58: string,
        matchPdaBase58: string,
        mintBase58: string,
        refundRecipientBase58: string,
        blockhash: string,
    ): Uint8Array {
        const escrow = this.deriveMatchEscrowPda(matchPdaBase58);
        const escrowToken = this.deriveMatchEscrowTokenPda(matchPdaBase58);
        const refundAta = this.derivePlayerAta(refundRecipientBase58, mintBase58);
        const disc = this.discriminator('cancel_match_skr');
        const data = disc;
        const accounts: AnchorAccountMetaInput[] = [
            { pubkeyBase58: cancellerBase58,    isSigner: true,  isWritable: false },
            { pubkeyBase58: matchPdaBase58,     isSigner: false, isWritable: true  },
            { pubkeyBase58: escrow,             isSigner: false, isWritable: true  },
            { pubkeyBase58: mintBase58,         isSigner: false, isWritable: false },
            { pubkeyBase58: escrowToken,        isSigner: false, isWritable: true  },
            { pubkeyBase58: refundAta,          isSigner: false, isWritable: true  },
            { pubkeyBase58: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
            { pubkeyBase58: SYSTEM_PROGRAM_ID,  isSigner: false, isWritable: false },
        ];
        const bytes = buildAnchorTransaction(PROGRAM_ID, accounts, data, cancellerBase58, blockhash);
        console.log(`${TAG} buildCancelMatchSkrTx | DONE canceller=${cancellerBase58} match=${matchPdaBase58} mint=${mintBase58} refund_to=${refundRecipientBase58} ata=${refundAta} tx_bytes=${bytes.length}`);
        return bytes;
    }
}

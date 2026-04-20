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
    AnchorAccountMetaInput,
} from '../../solana-mwa/scripts/TransactionBuilder';
import { base58Decode } from '../../solana-mwa/scripts/Base58';
import { POOL_PDA, PROGRAM_ID, SEEDS, SYSTEM_PROGRAM_ID } from './constants';
import { findProgramAddress, u64LeBytes } from './PdaDeriver';

/** Leaderboard PDA — derived once per call. Cached string for log clarity. */
function deriveLeaderboardPda(): string {
    const [pda] = findProgramAddress([SEEDS.LEADERBOARD], PROGRAM_ID);
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
}

/**
 * SplTokenIx.ts — hand-rolled SPL Token + Associated Token Account
 * instruction builders, returned in `RawInstructionInput` shape so they can
 * be combined with Anchor instructions in a single multi-ix transaction.
 *
 * We can't `import '@solana/spl-token'` from the Cocos bundle: web3.js's
 * transitive `tr46` dep breaks the Rollup build (see constants.ts header).
 *
 * Wire formats verified against the SPL programs:
 *   - Token Program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
 *     - TransferChecked discriminator = 12, args = [amount u64 LE | decimals u8]
 *   - Associated Token Account Program: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
 *     - CreateIdempotent discriminator = 1, no args
 *
 * ATA derivation: `findProgramAddress([owner, TOKEN_PROGRAM_ID, mint],
 * ASSOCIATED_TOKEN_PROGRAM_ID)`. Pre-existing ATA holders skip rent payment
 * via the idempotent variant.
 */

import { base58Decode } from '../../solana-mwa/scripts/Base58';
import {
    AnchorAccountMetaInput,
    RawInstructionInput,
} from '../../solana-mwa/scripts/TransactionBuilder';
import { findProgramAddress, u64LeBytes } from './PdaDeriver';
import { SYSTEM_PROGRAM_ID } from './constants';

const TAG = '[SplTokenIx]';

/** SPL Token Program v1. Identical on devnet and mainnet. */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** Associated Token Account Program. Identical on devnet and mainnet. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Derive the canonical Associated Token Account for `owner` + `mint`.
 *
 * Seeds: `[owner_bytes, TOKEN_PROGRAM_ID_bytes, mint_bytes]`,
 * program = ASSOCIATED_TOKEN_PROGRAM_ID. The ATA is itself a PDA so it's
 * always off-curve.
 */
export function deriveAssociatedTokenAddress(
    ownerBase58: string,
    mintBase58: string,
): string {
    const [pda] = findProgramAddress(
        [
            base58Decode(ownerBase58),
            base58Decode(TOKEN_PROGRAM_ID),
            base58Decode(mintBase58),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return pda;
}

/**
 * Build a `createAssociatedTokenAccountIdempotent` instruction.
 *
 * Idempotent: succeeds whether or not the ATA already exists. Cheaper to
 * always emit this preflight than to query account-info each round-trip.
 *
 * Account order (matches spl-associated-token-account program v1):
 *   [0] funding (signer, mut)        — pays rent if create needed
 *   [1] associated_token_account (mut) — derived ATA, will be created if missing
 *   [2] wallet                        — the owner of the ATA
 *   [3] mint                          — the SPL mint the ATA holds
 *   [4] system_program                — used by the create branch
 *   [5] token_program                 — used to init the new account
 */
export function buildCreateAtaIdempotentIx(
    fundingBase58: string,
    walletBase58: string,
    mintBase58: string,
): RawInstructionInput {
    const ata = deriveAssociatedTokenAddress(walletBase58, mintBase58);
    const accounts: AnchorAccountMetaInput[] = [
        { pubkeyBase58: fundingBase58,           isSigner: true,  isWritable: true  },
        { pubkeyBase58: ata,                     isSigner: false, isWritable: true  },
        { pubkeyBase58: walletBase58,            isSigner: false, isWritable: false },
        { pubkeyBase58: mintBase58,              isSigner: false, isWritable: false },
        { pubkeyBase58: SYSTEM_PROGRAM_ID,       isSigner: false, isWritable: false },
        { pubkeyBase58: TOKEN_PROGRAM_ID,        isSigner: false, isWritable: false },
    ];
    console.log(`${TAG} createAtaIdempotent | wallet=${walletBase58} mint=${mintBase58} ata=${ata}`);
    return {
        programIdBase58: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts,
        data: new Uint8Array([1]), // CreateIdempotent
    };
}

/**
 * Build a `transferChecked` SPL token instruction, returned as a
 * `RawInstructionInput` so the caller can splice it into a multi-ix tx
 * alongside Anchor instructions.
 *
 * Account order (matches spl-token v1):
 *   [0] source (mut)                  — sender's ATA
 *   [1] mint                          — readonly
 *   [2] destination (mut)             — receiver's ATA
 *   [3] authority (signer)            — owner of the source ATA
 *
 * Data layout (10 bytes):
 *   [0]    discriminator = 12 (TransferChecked)
 *   [1..9] amount u64 LE
 *   [9]    decimals u8
 */
export function buildTransferCheckedIx(
    sourceAtaBase58: string,
    mintBase58: string,
    destAtaBase58: string,
    authorityBase58: string,
    amount: bigint,
    decimals: number,
): RawInstructionInput {
    const data = new Uint8Array(10);
    data[0] = 12;
    data.set(u64LeBytes(amount), 1);
    data[9] = decimals & 0xff;
    const accounts: AnchorAccountMetaInput[] = [
        { pubkeyBase58: sourceAtaBase58,  isSigner: false, isWritable: true  },
        { pubkeyBase58: mintBase58,       isSigner: false, isWritable: false },
        { pubkeyBase58: destAtaBase58,    isSigner: false, isWritable: true  },
        { pubkeyBase58: authorityBase58,  isSigner: true,  isWritable: false },
    ];
    console.log(`${TAG} transferChecked | src=${sourceAtaBase58} dst=${destAtaBase58} amount=${amount} decimals=${decimals}`);
    return {
        programIdBase58: TOKEN_PROGRAM_ID,
        accounts,
        data,
    };
}

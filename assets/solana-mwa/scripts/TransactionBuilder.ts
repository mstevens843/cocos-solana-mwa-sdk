/**
 * TransactionBuilder.ts — Manual Solana transaction binary serializer.
 *
 * Zero dependencies. Builds raw legacy transaction bytes that MWA wallets
 * can sign via sign_and_send_transactions.
 *
 * Solana Legacy Transaction Wire Format:
 *   [compact-u16]  signature_count
 *   [64 bytes × N] signatures (all 0x00 for unsigned)
 *   [1 byte]       num_required_signatures
 *   [1 byte]       num_readonly_signed_accounts
 *   [1 byte]       num_readonly_unsigned_accounts
 *   [compact-u16]  num_account_keys
 *   [32 bytes × M] account_keys (ordered: writable signers, readonly signers,
 *                                         writable non-signers, readonly non-signers)
 *   [32 bytes]     recent_blockhash
 *   [compact-u16]  num_instructions
 *   [variable]     instructions...
 *
 * Each instruction:
 *   [1 byte]       program_id_index
 *   [compact-u16]  num_account_indices
 *   [1 byte × K]   account_indices
 *   [compact-u16]  data_length
 *   [data_length]  data
 */

import { base58Decode } from './Base58';

const TAG = '[TransactionBuilder]';

// ─── Well-Known Program IDs (32 bytes each) ──────────────────────────────────

/** System Program: 11111111111111111111111111111111 — all zero bytes */
const SYSTEM_PROGRAM_ID = new Uint8Array(32); // 32 zero bytes

/** Memo Program v2: MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr */
const MEMO_PROGRAM_ID = new Uint8Array([
    0x05, 0x4a, 0x53, 0x5a, 0x99, 0x29, 0x21, 0x06,
    0x4d, 0x24, 0xe8, 0x71, 0x60, 0xda, 0x38, 0x7c,
    0x7c, 0x35, 0xb5, 0xdd, 0xbc, 0x92, 0xbb, 0x81,
    0xe4, 0x1f, 0xa8, 0x40, 0x41, 0x05, 0x44, 0x8d,
]);

/** Token Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA */
const TOKEN_PROGRAM_ID = new Uint8Array([
    0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93,
    0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac,
    0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91,
    0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9,
]);

// ─── Internal Types ──────────────────────────────────────────────────────────

interface AccountMeta {
    pubkey: Uint8Array;    // 32-byte public key
    isSigner: boolean;
    isWritable: boolean;
}

interface Instruction {
    programId: Uint8Array; // 32-byte program ID
    accounts: AccountMeta[];
    data: Uint8Array;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build an unsigned memo transaction.
 * The simplest possible Solana transaction — writes a text memo on-chain.
 *
 * @param feePayerBase58 Fee payer public key (base58)
 * @param memoText The memo string
 * @param recentBlockhash Recent blockhash (base58)
 * @returns Serialized unsigned transaction as Uint8Array
 */
export function buildMemoTransaction(
    feePayerBase58: string,
    memoText: string,
    recentBlockhash: string,
): Uint8Array {
    console.log(`${TAG} buildMemoTransaction | START fee_payer=${feePayerBase58.substring(0, 8)}... memo_len=${memoText.length} blockhash=${recentBlockhash.substring(0, 12)}...`);

    const feePayer = base58Decode(feePayerBase58);
    const blockhash = base58Decode(recentBlockhash);

    if (feePayer.length !== 32) {
        console.log(`${TAG} buildMemoTransaction | FAIL invalid fee_payer length=${feePayer.length} (expected 32)`);
        return new Uint8Array(0);
    }
    if (blockhash.length !== 32) {
        console.log(`${TAG} buildMemoTransaction | FAIL invalid blockhash length=${blockhash.length} (expected 32)`);
        return new Uint8Array(0);
    }

    // Memo instruction: data = raw UTF-8 bytes of the memo string
    const encoder = new TextEncoder();
    const memoData = encoder.encode(memoText);

    const instruction: Instruction = {
        programId: MEMO_PROGRAM_ID,
        accounts: [
            { pubkey: feePayer, isSigner: true, isWritable: true },
        ],
        data: memoData,
    };

    const tx = serializeTransaction(feePayer, blockhash, [instruction]);
    console.log(`${TAG} buildMemoTransaction | DONE tx_bytes=${tx.length} accounts=2 instructions=1`);
    return tx;
}

/**
 * Build an unsigned SOL transfer transaction.
 *
 * @param fromBase58 Sender public key (base58)
 * @param toBase58 Recipient public key (base58)
 * @param lamports Amount in lamports
 * @param recentBlockhash Recent blockhash (base58)
 * @returns Serialized unsigned transaction as Uint8Array
 */
export function buildSolTransfer(
    fromBase58: string,
    toBase58: string,
    lamports: number,
    recentBlockhash: string,
): Uint8Array {
    console.log(`${TAG} buildSolTransfer | START from=${fromBase58.substring(0, 8)}... to=${toBase58.substring(0, 8)}... lamports=${lamports} blockhash=${recentBlockhash.substring(0, 12)}...`);

    const from = base58Decode(fromBase58);
    const to = base58Decode(toBase58);
    const blockhash = base58Decode(recentBlockhash);

    if (from.length !== 32 || to.length !== 32 || blockhash.length !== 32) {
        console.log(`${TAG} buildSolTransfer | FAIL invalid key lengths from=${from.length} to=${to.length} blockhash=${blockhash.length}`);
        return new Uint8Array(0);
    }

    // System Program Transfer instruction:
    // 4 bytes: u32 LE instruction index = 2
    // 8 bytes: u64 LE lamports
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true);          // instruction index 2 = Transfer
    writeBigUint64LE(data, 4, lamports); // lamports as u64 LE

    const instruction: Instruction = {
        programId: SYSTEM_PROGRAM_ID,
        accounts: [
            { pubkey: from, isSigner: true, isWritable: true },   // from (fee payer)
            { pubkey: to, isSigner: false, isWritable: true },    // to
        ],
        data,
    };

    const tx = serializeTransaction(from, blockhash, [instruction]);
    console.log(`${TAG} buildSolTransfer | DONE tx_bytes=${tx.length} accounts=3 instructions=1`);
    return tx;
}

/**
 * Build an unsigned SPL Token TransferChecked transaction.
 *
 * NOTE: This assumes both source and destination ATAs already exist.
 * If the destination ATA doesn't exist, you need to add a
 * CreateAssociatedTokenAccount instruction first.
 *
 * @param ownerBase58 Token owner/authority (base58, fee payer)
 * @param sourceAtaBase58 Source Associated Token Account (base58)
 * @param destAtaBase58 Destination Associated Token Account (base58)
 * @param mintBase58 Token mint address (base58)
 * @param amount Amount in smallest units (e.g., 1000000 for 1 USDC)
 * @param decimals Token decimals (e.g., 6 for USDC)
 * @param recentBlockhash Recent blockhash (base58)
 * @returns Serialized unsigned transaction as Uint8Array
 */
export function buildSplTokenTransfer(
    ownerBase58: string,
    sourceAtaBase58: string,
    destAtaBase58: string,
    mintBase58: string,
    amount: number,
    decimals: number,
    recentBlockhash: string,
): Uint8Array {
    console.log(`${TAG} buildSplTokenTransfer | START owner=${ownerBase58.substring(0, 8)}... mint=${mintBase58.substring(0, 8)}... amount=${amount} decimals=${decimals}`);

    const owner = base58Decode(ownerBase58);
    const sourceAta = base58Decode(sourceAtaBase58);
    const destAta = base58Decode(destAtaBase58);
    const mint = base58Decode(mintBase58);
    const blockhash = base58Decode(recentBlockhash);

    if (owner.length !== 32 || sourceAta.length !== 32 || destAta.length !== 32 ||
        mint.length !== 32 || blockhash.length !== 32) {
        console.log(`${TAG} buildSplTokenTransfer | FAIL invalid key lengths`);
        return new Uint8Array(0);
    }

    // SPL Token TransferChecked instruction:
    // 1 byte:  u8 instruction discriminator = 12
    // 8 bytes: u64 LE amount
    // 1 byte:  u8 decimals
    const data = new Uint8Array(10);
    data[0] = 12; // TransferChecked
    writeBigUint64LE(data, 1, amount);
    data[9] = decimals;

    const instruction: Instruction = {
        programId: TOKEN_PROGRAM_ID,
        accounts: [
            { pubkey: sourceAta, isSigner: false, isWritable: true },  // source ATA
            { pubkey: mint, isSigner: false, isWritable: false },      // mint (readonly)
            { pubkey: destAta, isSigner: false, isWritable: true },    // destination ATA
            { pubkey: owner, isSigner: true, isWritable: true },       // owner/authority (signer, fee payer)
        ],
        data,
    };

    const tx = serializeTransaction(owner, blockhash, [instruction]);
    console.log(`${TAG} buildSplTokenTransfer | DONE tx_bytes=${tx.length}`);
    return tx;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CORE SERIALIZER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Serialize a complete unsigned legacy transaction.
 *
 * 1. Collects all unique accounts from instructions, deduplicating by pubkey
 * 2. Sorts accounts into the 4 groups: writable-signers, readonly-signers,
 *    writable-non-signers, readonly-non-signers
 * 3. Fee payer is always account index 0
 * 4. Builds the message header, account keys, blockhash, and instruction bytes
 * 5. Prepends signature count + empty signature slots
 */
function serializeTransaction(
    feePayer: Uint8Array,
    recentBlockhash: Uint8Array,
    instructions: Instruction[],
): Uint8Array {

    // ─── Step 1: Collect all unique accounts ─────────────────────────────

    // Use a map keyed by hex string to deduplicate
    const accountMap = new Map<string, AccountMeta>();

    // Fee payer is always first — writable signer
    const feePayerHex = uint8ArrayToHex(feePayer);
    accountMap.set(feePayerHex, { pubkey: feePayer, isSigner: true, isWritable: true });

    // Collect from all instructions
    for (const ix of instructions) {
        for (const acc of ix.accounts) {
            const hex = uint8ArrayToHex(acc.pubkey);
            const existing = accountMap.get(hex);
            if (existing) {
                // Merge: promote to signer/writable if any instruction requires it
                existing.isSigner = existing.isSigner || acc.isSigner;
                existing.isWritable = existing.isWritable || acc.isWritable;
            } else {
                accountMap.set(hex, { ...acc, pubkey: new Uint8Array(acc.pubkey) });
            }
        }

        // Program IDs are readonly non-signers
        const progHex = uint8ArrayToHex(ix.programId);
        if (!accountMap.has(progHex)) {
            accountMap.set(progHex, { pubkey: new Uint8Array(ix.programId), isSigner: false, isWritable: false });
        }
    }

    // ─── Step 2: Sort into 4 groups ──────────────────────────────────────

    const writableSigners: AccountMeta[] = [];
    const readonlySigners: AccountMeta[] = [];
    const writableNonSigners: AccountMeta[] = [];
    const readonlyNonSigners: AccountMeta[] = [];

    for (const [hex, acc] of accountMap) {
        if (hex === feePayerHex) continue; // handle separately
        if (acc.isSigner && acc.isWritable) writableSigners.push(acc);
        else if (acc.isSigner && !acc.isWritable) readonlySigners.push(acc);
        else if (!acc.isSigner && acc.isWritable) writableNonSigners.push(acc);
        else readonlyNonSigners.push(acc);
    }

    // Fee payer at index 0, then rest of writable signers
    const orderedAccounts: AccountMeta[] = [
        accountMap.get(feePayerHex)!,
        ...writableSigners,
        ...readonlySigners,
        ...writableNonSigners,
        ...readonlyNonSigners,
    ];

    // Build index lookup: pubkey hex → position in orderedAccounts
    const indexMap = new Map<string, number>();
    for (let i = 0; i < orderedAccounts.length; i++) {
        indexMap.set(uint8ArrayToHex(orderedAccounts[i].pubkey), i);
    }

    // ─── Step 3: Compute header values ───────────────────────────────────

    const numRequiredSignatures = 1 + writableSigners.length + readonlySigners.length;
    const numReadonlySignedAccounts = readonlySigners.length;
    const numReadonlyUnsignedAccounts = readonlyNonSigners.length;

    // ─── Step 4: Serialize instructions ──────────────────────────────────

    const serializedInstructions: Uint8Array[] = [];
    for (const ix of instructions) {
        const programIndex = indexMap.get(uint8ArrayToHex(ix.programId))!;
        const accountIndices: number[] = [];
        for (const acc of ix.accounts) {
            accountIndices.push(indexMap.get(uint8ArrayToHex(acc.pubkey))!);
        }

        // Serialize: programIdIndex + compact-u16(numAccounts) + accountIndices +
        //            compact-u16(dataLen) + data
        const parts: Uint8Array[] = [
            new Uint8Array([programIndex]),
            encodeCompactU16(accountIndices.length),
            new Uint8Array(accountIndices),
            encodeCompactU16(ix.data.length),
            ix.data,
        ];
        serializedInstructions.push(concatBytes(...parts));
    }

    // ─── Step 5: Build message ───────────────────────────────────────────

    const messageParts: Uint8Array[] = [
        // Header: 3 bytes
        new Uint8Array([numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts]),
        // Account keys count + keys
        encodeCompactU16(orderedAccounts.length),
        ...orderedAccounts.map(a => a.pubkey),
        // Recent blockhash
        recentBlockhash,
        // Instructions count + instructions
        encodeCompactU16(instructions.length),
        ...serializedInstructions,
    ];

    const message = concatBytes(...messageParts);

    // ─── Step 6: Prepend signatures ──────────────────────────────────────

    // Unsigned: N empty 64-byte signature slots (all zeros)
    const signatureSlots = new Uint8Array(numRequiredSignatures * 64); // zeros

    const fullTransaction = concatBytes(
        encodeCompactU16(numRequiredSignatures),
        signatureSlots,
        message,
    );

    console.log(`${TAG} serializeTransaction | accounts=${orderedAccounts.length} signers=${numRequiredSignatures} readonly_signed=${numReadonlySignedAccounts} readonly_unsigned=${numReadonlyUnsignedAccounts} instructions=${instructions.length} message_bytes=${message.length} total_bytes=${fullTransaction.length}`);

    return fullTransaction;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BINARY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encode a value as compact-u16 (Solana's variable-length encoding).
 * Uses 7 bits per byte, high bit = continuation flag.
 *
 * 0-127:     1 byte
 * 128-16383: 2 bytes
 * 16384+:    3 bytes
 */
function encodeCompactU16(value: number): Uint8Array {
    const bytes: number[] = [];
    let rem = value;
    for (;;) {
        const low7 = rem & 0x7f;
        rem >>>= 7;
        if (rem === 0) {
            bytes.push(low7);
            break;
        } else {
            bytes.push(low7 | 0x80);
        }
    }
    return new Uint8Array(bytes);
}

/**
 * Write a u64 as little-endian bytes at the given offset.
 * JavaScript numbers are safe up to 2^53, which covers all practical lamport amounts.
 */
function writeBigUint64LE(target: Uint8Array, offset: number, value: number): void {
    // Write low 32 bits
    target[offset]     = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
    // Write high 32 bits (for values > 2^32)
    const high = Math.floor(value / 0x100000000);
    target[offset + 4] = high & 0xff;
    target[offset + 5] = (high >>> 8) & 0xff;
    target[offset + 6] = (high >>> 16) & 0xff;
    target[offset + 7] = (high >>> 24) & 0xff;
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    let totalLen = 0;
    for (const a of arrays) totalLen += a.length;

    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const a of arrays) {
        result.set(a, offset);
        offset += a.length;
    }
    return result;
}

/**
 * Convert Uint8Array to hex string for use as Map key.
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

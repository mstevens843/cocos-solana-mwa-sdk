/**
 * admin_signer - loads the admin keypair from env + sends pre-built admin txs.
 *
 * The cron uses this to send init_daily_challenge / init_season / pay_season.
 * ADMIN_SECRET is a base58 Ed25519 secret key (64 bytes before encoding).
 * Keep it in Railway / Fly secrets, never commit.
 */

import { Connection, Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

const TAG = '[admin_signer]';

export function loadAdminKeypair(): Keypair {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
        throw new Error('ADMIN_SECRET env var required for admin cron (base58 ed25519 secret key)');
    }
    const bytes = bs58.decode(secret.trim());
    if (bytes.length !== 64) {
        throw new Error(`ADMIN_SECRET decoded to ${bytes.length} bytes; expected 64`);
    }
    const kp = Keypair.fromSecretKey(bytes);
    console.log(`${TAG} loadAdminKeypair | pubkey=${kp.publicKey.toBase58()}`);
    return kp;
}

/**
 * Deserialize a pre-built tx from `AnchorBackend.build*Tx(...)`, sign with
 * admin, send, confirm, log the explorer link. Returns the tx signature.
 *
 * Idempotent for PDAs that already exist - the RPC returns "already in use"
 * which we treat as success.
 */
export async function sendAdminTx(
    connection: Connection,
    admin: Keypair,
    txBytes: Uint8Array,
    label: string,
): Promise<string> {
    const tx = Transaction.from(txBytes);
    tx.sign(admin);
    try {
        const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(sig, 'confirmed');
        console.log(`${TAG} sendAdminTx | ${label} sig=${sig} https://explorer.solana.com/tx/${sig}?cluster=devnet`);
        return sig;
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (msg.includes('already in use') || msg.includes('already exists')) {
            console.log(`${TAG} sendAdminTx | ${label} IDEMPOTENT_OK (PDA already initialized)`);
            return 'already-initialized';
        }
        console.warn(`${TAG} sendAdminTx | ${label} ERROR "${msg}"`);
        throw e;
    }
}

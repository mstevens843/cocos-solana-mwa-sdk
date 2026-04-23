/**
 * One-shot admin bootstrap: create the Metaplex Bubblegum merkle tree that
 * stores all Token Duel weekly trophy cNFTs.
 *
 * Part 11 Bundle B. Run ONCE per cluster. Costs ~0.2 SOL.
 *
 * Tree config:
 *   - depth  = 14   (capacity 16384 leaves ≈ 300 years of weekly top-3)
 *   - buffer = 64   (concurrent-mint buffer)
 *   - canopy = 11   (on-chain proof depth; leaves 3-step off-chain verify)
 *
 * After creation, paste the tree address into:
 *   backend/.env   →   TROPHY_TREE_ADDRESS=<pubkey>
 * The backend cron reads this to find where to mint trophies.
 *
 * Usage:
 *   cd backend && npm install   # picks up Metaplex deps if not already
 *   cd ../scripts
 *   npm run init-trophy-tree
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
    createTree,
    mplBubblegum,
} from '@metaplex-foundation/mpl-bubblegum';
import {
    createSignerFromKeypair,
    generateSigner,
    signerIdentity,
} from '@metaplex-foundation/umi';
import { Keypair as Web3Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

import { RPC_URL } from '../assets/token-duel/scripts/constants';

const TAG = '[init-trophy-tree]';

async function loadAdmin(): Promise<Web3Keypair> {
    const adminPath = path.join(homedir(), '.config/solana/id.json');
    const bytes = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
    return Web3Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function main() {
    console.log(`${TAG} START cluster=${RPC_URL}`);
    const admin = await loadAdmin();
    console.log(`${TAG} admin=${admin.publicKey.toBase58()}`);

    const umi = createUmi(RPC_URL).use(mplBubblegum());
    const adminUmiKp = umi.eddsa.createKeypairFromSecretKey(admin.secretKey);
    umi.use(signerIdentity(createSignerFromKeypair(umi, adminUmiKp)));

    const merkleTree = generateSigner(umi);
    console.log(`${TAG} new tree address=${merkleTree.publicKey}`);

    const builder = await createTree(umi, {
        merkleTree,
        maxDepth: 14,
        maxBufferSize: 64,
        canopyDepth: 11,
        public: false,
    });
    console.log(`${TAG} submitting createTree tx...`);
    const res = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
    console.log(`${TAG} SUCCESS tree=${merkleTree.publicKey} sig=${Buffer.from(res.signature).toString('hex').substring(0, 32)}...`);
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────');
    console.log('  │  Paste this into backend/.env as:');
    console.log(`  │    TROPHY_TREE_ADDRESS=${merkleTree.publicKey}`);
    console.log('  └─────────────────────────────────────────────────────────');
    console.log('');
    console.log(`Capacity: 16384 leaves (≈300 years of weekly top-3 trophies)`);
    console.log(`Explorer: https://explorer.solana.com/address/${merkleTree.publicKey}?cluster=devnet`);
}

main().catch((e) => {
    console.error(`${TAG} FATAL`, e);
    process.exit(1);
});

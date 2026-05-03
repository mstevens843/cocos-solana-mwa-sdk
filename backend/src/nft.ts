/**
 * nft.ts - Part 11 Bundle B.
 *
 * Mints compressed NFTs (Bubblegum cNFTs) as weekly season trophies. Called
 * from the cron's `payoutWeeklySeason` tick after `pay_season` confirms.
 *
 * Merkle tree must be pre-initialized via `scripts/init-trophy-tree.ts`; its
 * address lives in `TROPHY_TREE_ADDRESS` env var. Admin keypair signs mints
 * (shared with the existing admin PDAs init flow).
 *
 * Metadata JSON is served by our own backend at `/metadata/:weekId/:rank.json`
 * so cost stays in-house (no IPFS / Arweave setup needed for hackathon).
 *
 * Failure mode: mint is "best-effort" - if it fails the season payout
 * already happened; the trophy is the icing, not the cake. Logged + moved on.
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, publicKey as umiPk, keypairIdentity } from '@metaplex-foundation/umi';
import { mintToCollectionV1, mintV1, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { Keypair as Web3Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const TAG = '[nft]';

export interface MintTrophyParams {
    recipient: string;       // base58 wallet pubkey
    weekId: number;
    rank: number;            // 1, 2, or 3
    wins: number;
    metadataBaseUrl: string; // e.g. "https://backend.up.railway.app"
}

export interface MintTrophyResult {
    ok: boolean;
    signature?: string;
    error?: string;
}

/**
 * One-time setup: caller builds a umi instance + signer once and reuses it
 * across multiple mints (expensive to construct).
 */
export function createUmiForMint(rpcUrl: string, adminSecretB58: string) {
    const umi = createUmi(rpcUrl).use(mplBubblegum());
    const adminSecret = bs58.decode(adminSecretB58);
    const adminWeb3Kp = Web3Keypair.fromSecretKey(adminSecret);
    const adminUmiKp = umi.eddsa.createKeypairFromSecretKey(adminSecret);
    const signer = createSignerFromKeypair(umi, adminUmiKp);
    umi.use(signerIdentity(signer));
    console.log(`${TAG} createUmiForMint | admin=${adminWeb3Kp.publicKey.toBase58()}`);
    return umi;
}

export async function mintTrophy(
    umi: ReturnType<typeof createUmiForMint>,
    treeAddress: string,
    params: MintTrophyParams,
): Promise<MintTrophyResult> {
    try {
        const rankLabel = params.rank === 1 ? '1st' : params.rank === 2 ? '2nd' : '3rd';
        const name = `Token Duel · Week #${params.weekId} · ${rankLabel}`;
        const uri = `${params.metadataBaseUrl}/metadata/${params.weekId}/${params.rank}.json`;
        const recipient = umiPk(params.recipient);
        const tree = umiPk(treeAddress);

        console.log(`${TAG} mintTrophy | START week=${params.weekId} rank=${params.rank} recipient=${params.recipient} tree=${treeAddress}`);

        const ix = mintV1(umi, {
            leafOwner: recipient,
            merkleTree: tree,
            metadata: {
                name,
                symbol: 'TDW',
                uri,
                sellerFeeBasisPoints: 0,
                collection: { key: tree, verified: false },
                creators: [
                    { address: umi.identity.publicKey, verified: false, share: 100 },
                ],
            },
        });

        const result = await ix.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
        const sig = bs58.encode(result.signature);
        console.log(`${TAG} mintTrophy | OK sig=${sig}`);
        return { ok: true, signature: sig };
    } catch (e: any) {
        console.error(`${TAG} mintTrophy | ERROR`, e);
        return { ok: false, error: e?.message ?? String(e) };
    }
}

/**
 * Build the JSON payload for `/metadata/:weekId/:rank.json` route.
 * Image URL points at a sharecard variant we control; no external hosting.
 */
export function trophyMetadataJson(
    weekId: number,
    rank: number,
    wins: number,
    imageBaseUrl: string,
): Record<string, unknown> {
    const rankLabel = rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd';
    return {
        name: `Token Duel · Week #${weekId} · ${rankLabel}`,
        symbol: 'TDW',
        description: `Awarded for ${rankLabel} place in Token Duel's Week #${weekId} seasonal leaderboard with ${wins} wins.`,
        image: `${imageBaseUrl}/sharecard/trophy-${weekId}-${rank}.png`,
        attributes: [
            { trait_type: 'Week', value: weekId },
            { trait_type: 'Rank', value: rankLabel },
            { trait_type: 'Wins', value: wins },
            { trait_type: 'Game', value: 'Token Duel' },
        ],
        properties: {
            category: 'image',
            files: [
                { uri: `${imageBaseUrl}/sharecard/trophy-${weekId}-${rank}.png`, type: 'image/png' },
            ],
        },
    };
}

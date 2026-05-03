/**
 * cron - pure-JS daily tick for Token Duel retention PDAs.
 *
 * Schedule (UTC):
 *   - Every day @ 00:00 UTC: init_daily_challenge for today (from challenges.json rotation).
 *   - Sundays @ 00:00 UTC:   init_season for the upcoming week (offset = season_id + 1).
 *   - Mondays @ 00:00 UTC:   pay_season for the previous week (24h grace after close).
 *
 * Env:
 *   CRON_ENABLED=false  skip entirely (local dev default off is safer; server.ts
 *                       opts in when this !== 'false').
 *   CRON_DRY_RUN=1      log what would be sent, skip the actual send.
 *   RUN_NOW=daily|weekly|payout   fire that one immediately at startup, then
 *                                 continue normal schedule. Useful for testing.
 *   ADMIN_SECRET                  required unless CRON_DRY_RUN - see admin_signer.
 *   RPC_URL                       Solana cluster endpoint.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as path from 'path';
import * as fs from 'fs';
import bs58 from 'bs58';

import { AnchorBackend } from '../../assets/token-duel/scripts/AnchorBackend';
import { RPC_URL } from '../../assets/token-duel/scripts/constants';
import { loadAdminKeypair, sendAdminTx } from './admin_signer';
import { createUmiForMint, mintTrophy } from './nft';
import { query, dbConfigured } from './db';

const TAG = '[cron]';
const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;
const WEEK_SECONDS = 7 * 86_400;

interface ChallengeDef { kind: number; target: number; rewardXp: number }
type Rotation = Array<[ChallengeDef, ChallengeDef, ChallengeDef]>;

function loadRotation(): Rotation {
    // challenges.json lives next to backend/package.json. tsx compiles from
    // src/, but process.cwd() is the package root when launched via `npm run`.
    const p = path.resolve(__dirname, '..', 'challenges.json');
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.rotation) || parsed.rotation.length !== 14) {
        throw new Error(`${TAG} challenges.json: rotation must be 14 entries (got ${parsed?.rotation?.length ?? 'undefined'})`);
    }
    return parsed.rotation as Rotation;
}

function nowSec(): number { return Math.floor(Date.now() / 1000); }
function todayDayId(): bigint { return BigInt(Math.floor(nowSec() / DAY_SECONDS)); }
function thisWeekSeasonId(): bigint { return BigInt(Math.floor(nowSec() / WEEK_SECONDS)); }

/** Unix epoch was a Thursday. weekday: 0=Thu, 1=Fri ... 3=Sun, 4=Mon ... */
function utcWeekdayFromDayId(dayId: bigint): number {
    return Number(dayId % 7n);
}

function msUntilNextUtcMidnight(): number {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
    return next.getTime() - now.getTime();
}

async function tickDaily(connection: Connection, admin: ReturnType<typeof loadAdminKeypair>, rotation: Rotation, dryRun: boolean): Promise<void> {
    const dayId = todayDayId();
    const idx = Number(dayId % BigInt(rotation.length));
    const challenges = rotation[idx];
    console.log(`${TAG} tickDaily | day_id=${dayId} rotation_idx=${idx} challenges=${JSON.stringify(challenges)}`);
    const pda = AnchorBackend.deriveDailyChallengePda(dayId);
    const existing = await connection.getAccountInfo(new PublicKey(pda));
    if (existing) {
        console.log(`${TAG} tickDaily | SKIP already_initialized pda=${pda}`);
        return;
    }
    if (dryRun) {
        console.log(`${TAG} tickDaily | DRY_RUN would_init day_id=${dayId} pda=${pda}`);
        return;
    }
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitDailyChallengeTx(
        admin.publicKey.toBase58(),
        dayId,
        challenges,
        blockhash,
    );
    await sendAdminTx(connection, admin, txBytes, `init_daily_challenge day_id=${dayId}`);
}

async function tickWeekly(connection: Connection, admin: ReturnType<typeof loadAdminKeypair>, dryRun: boolean): Promise<void> {
    // Init the season for the UPCOMING week so the first settle of the new
    // week always has a valid PDA (the program rejects settles with a
    // next-week PDA reference via the staleness require!).
    const seasonId = thisWeekSeasonId();
    console.log(`${TAG} tickWeekly | season_id=${seasonId}`);
    const pda = AnchorBackend.deriveSeasonPda(seasonId);
    const existing = await connection.getAccountInfo(new PublicKey(pda));
    if (existing) {
        console.log(`${TAG} tickWeekly | SKIP already_initialized pda=${pda}`);
        return;
    }
    if (dryRun) {
        console.log(`${TAG} tickWeekly | DRY_RUN would_init season_id=${seasonId} pda=${pda}`);
        return;
    }
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitSeasonTx(admin.publicKey.toBase58(), seasonId, blockhash);
    await sendAdminTx(connection, admin, txBytes, `init_season season_id=${seasonId}`);
}

async function tickPayout(connection: Connection, admin: ReturnType<typeof loadAdminKeypair>, dryRun: boolean): Promise<void> {
    // Pay out the previous week's Season. Runs on Monday after the week
    // closed Sunday 23:59 UTC, giving a 24h grace for stragglers.
    const prevSeasonId = thisWeekSeasonId() - 1n;
    console.log(`${TAG} tickPayout | prev_season_id=${prevSeasonId}`);
    const pda = AnchorBackend.deriveSeasonPda(prevSeasonId);
    const info = await connection.getAccountInfo(new PublicKey(pda));
    if (!info) {
        console.warn(`${TAG} tickPayout | SKIP no_account prev_season_id=${prevSeasonId} (nothing to pay out)`);
        return;
    }
    // Parse Season PDA to extract top-3 recipients. We don't ship a parser in
    // backend/ - cron imports the client SeasonRpc parser instead.
    const { parseSeason } = await import('../../assets/token-duel/scripts/SeasonRpc');
    const raw = new Uint8Array(info.data);
    const state = parseSeason(pda, raw);
    if (!state) {
        console.warn(`${TAG} tickPayout | SKIP parse_failed prev_season_id=${prevSeasonId}`);
        return;
    }
    if (state.paidOut) {
        console.log(`${TAG} tickPayout | SKIP already_paid prev_season_id=${prevSeasonId}`);
        return;
    }
    const top3Entries = state.entries.slice(0, 3);
    const top3 = top3Entries.map((e) => e.player);
    if (top3.length === 0) {
        console.log(`${TAG} tickPayout | SKIP no_winners prev_season_id=${prevSeasonId}`);
        return;
    }
    if (dryRun) {
        console.log(`${TAG} tickPayout | DRY_RUN would_pay prev_season_id=${prevSeasonId} recipients=${JSON.stringify(top3)}`);
        // Still log what trophy mints would fire.
        for (let i = 0; i < top3Entries.length; i++) {
            const e = top3Entries[i];
            console.log(`${TAG} tickPayout | DRY_RUN would_mint_trophy rank=${i + 1} recipient=${e.player} wins=${e.wins}`);
        }
        return;
    }
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildPaySeasonTx(admin.publicKey.toBase58(), prevSeasonId, top3, blockhash);
    await sendAdminTx(connection, admin, txBytes, `pay_season prev_season_id=${prevSeasonId}`);

    // ── Part 12 Bundle A: best-effort cNFT trophy mint follow-up. ────
    // Failures here DO NOT block future payout cycles - the SOL payout already
    // landed; the trophy is the icing. Admin can re-mint manually later.
    const treeAddress = process.env.TROPHY_TREE_ADDRESS?.trim();
    if (!treeAddress) {
        console.warn(`${TAG} tickPayout | trophy mint skipped - TROPHY_TREE_ADDRESS env var not set. Run scripts/init-trophy-tree.ts to create one.`);
        return;
    }
    const metadataBaseUrl = (process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, '');
    const adminSecretB58 = bs58.encode(admin.secretKey);
    let umi;
    try {
        umi = createUmiForMint(RPC_URL, adminSecretB58);
    } catch (e) {
        console.error(`${TAG} tickPayout | trophy mint init failed - ${e}`);
        return;
    }
    console.log(`${TAG} tickPayout | minting ${top3Entries.length} trophies for week ${prevSeasonId}...`);
    for (let i = 0; i < top3Entries.length; i++) {
        const e = top3Entries[i];
        if (e.wins === 0) continue;
        const rank = i + 1;
        try {
            const result = await mintTrophy(umi, treeAddress, {
                recipient: e.player,
                weekId: Number(prevSeasonId),
                rank,
                wins: e.wins,
                metadataBaseUrl,
            });
            if (result.ok) {
                console.log(`${TAG} tickPayout | mint OK rank=${rank} recipient=${e.player} wins=${e.wins} sig=${result.signature}`);
            } else {
                console.warn(`${TAG} tickPayout | mint FAIL rank=${rank} recipient=${e.player} reason=${result.error}`);
            }
        } catch (err) {
            console.error(`${TAG} tickPayout | mint THROW rank=${rank} recipient=${e.player}`, err);
        }
    }
    console.log(`${TAG} tickPayout | trophy mint phase complete for season ${prevSeasonId}`);
}

/**
 * Round 3 - cluster-wide sweep that prunes paper_match_active rows whose
 * window expired more than 1 day ago. Mirrors the per-user opportunistic
 * prune in paper_match_active.ts:listActiveForUser, but covers users who
 * never log back in. The 1-day buffer avoids racing a user opening the app
 * exactly at expiry.
 */
async function tickPrunePaperMatchActive(dryRun: boolean): Promise<void> {
    if (!dbConfigured()) {
        console.log(`${TAG} tickPrunePaperMatchActive | SKIP db not configured`);
        return;
    }
    if (dryRun) {
        const rows = await query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM paper_match_active
              WHERE started_at + (duration_ms * INTERVAL '1 millisecond') < now() - INTERVAL '1 day'`,
        );
        console.log(`${TAG} tickPrunePaperMatchActive | DRY_RUN would_delete=${rows[0]?.count ?? '?'}`);
        return;
    }
    const deleted = await query<{ id: string }>(
        `DELETE FROM paper_match_active
          WHERE started_at + (duration_ms * INTERVAL '1 millisecond') < now() - INTERVAL '1 day'
          RETURNING id`,
    );
    console.log(`${TAG} tickPrunePaperMatchActive | deleted=${deleted.length}`);
}

async function runScheduledTicks(connection: Connection, admin: ReturnType<typeof loadAdminKeypair>, rotation: Rotation, dryRun: boolean): Promise<void> {
    const dayId = todayDayId();
    const weekday = utcWeekdayFromDayId(dayId); // 0=Thu, 1=Fri, 2=Sat, 3=Sun, 4=Mon, 5=Tue, 6=Wed
    console.log(`${TAG} runScheduledTicks | day_id=${dayId} weekday=${weekday} (0=Thu..6=Wed) dry_run=${dryRun}`);
    await tickDaily(connection, admin, rotation, dryRun);
    await tickPrunePaperMatchActive(dryRun);
    if (weekday === 3) { // Sunday
        await tickWeekly(connection, admin, dryRun);
    }
    if (weekday === 4) { // Monday
        await tickPayout(connection, admin, dryRun);
    }
}

export async function startCron(): Promise<void> {
    const dryRun = process.env.CRON_DRY_RUN === '1' || process.env.CRON_DRY_RUN === 'true';
    const runNow = process.env.RUN_NOW; // optional: 'daily' | 'weekly' | 'payout'
    console.log(`${TAG} startCron | dry_run=${dryRun} run_now=${runNow ?? 'none'} rpc=${RPC_URL}`);

    let admin: ReturnType<typeof loadAdminKeypair>;
    try {
        admin = loadAdminKeypair();
    } catch (e: any) {
        if (dryRun) {
            console.warn(`${TAG} startCron | DRY_RUN no ADMIN_SECRET - using ephemeral keypair for dry-run only`);
            const { Keypair } = await import('@solana/web3.js');
            admin = Keypair.generate();
        } else {
            throw e;
        }
    }
    const connection = new Connection(RPC_URL, 'confirmed');
    const rotation = loadRotation();

    if (runNow) {
        console.log(`${TAG} startCron | RUN_NOW=${runNow} firing immediately`);
        if (runNow === 'daily')   await tickDaily(connection, admin, rotation, dryRun);
        else if (runNow === 'weekly')  await tickWeekly(connection, admin, dryRun);
        else if (runNow === 'payout')  await tickPayout(connection, admin, dryRun);
        else if (runNow === 'prune')   await tickPrunePaperMatchActive(dryRun);
        else console.warn(`${TAG} startCron | unknown RUN_NOW="${runNow}" (expected daily|weekly|payout|prune)`);
    }

    const wait = msUntilNextUtcMidnight();
    console.log(`${TAG} startCron | first UTC-midnight tick in ${Math.round(wait / 60_000)}m`);
    setTimeout(() => {
        // Fire first tick, then every 24h.
        void runScheduledTicks(connection, admin, rotation, dryRun);
        setInterval(() => void runScheduledTicks(connection, admin, rotation, dryRun), DAY_MS);
    }, wait);
}

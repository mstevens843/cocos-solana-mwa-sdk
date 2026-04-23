/**
 * tournament_host — Part 14 Bundle A.
 *
 * Scheduled cron that seeds a BattleRoyale match every N minutes using a
 * dedicated "tournament host" keypair as player 0. The host's stake
 * subsidizes the winner pot (a "prize-seed bonus") — the host never
 * submits a height, so `force_settle` after 5 min forfeits its slot and
 * redistributes the full pot among the real players who did submit.
 *
 * Operator setup:
 *   1. `solana-keygen new --outfile host.json --no-bip39-passphrase`
 *   2. Fund host.json with 0.5 SOL on the target cluster
 *   3. `npm run init-tournament-host` (creates UserStats PDA for host)
 *   4. Export TOURNAMENT_HOST_SECRET (base58 64-byte secret key)
 *   5. Set TOURNAMENT_CRON_ENABLED=true
 *   6. Restart backend
 *
 * Runtime:
 *   Ticks at `TOURNAMENT_CADENCE_MS` cadence (default 15 min). Each tick:
 *     - Reads MatchCounter.seq
 *     - Builds join_match_create(mode=BR, tier=INTRO, seq=<current>)
 *     - Signs with host keypair + submits
 *     - On counter-race, retries once with a refreshed seq
 *     - Bumps StatsBucket.bumpTournamentCreated on success
 */

import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import { AnchorBackend } from '../../assets/token-duel/scripts/AnchorBackend';
import { StatsBucket } from './stats';

const TAG = '[tournament-host]';
const DEFAULT_CADENCE_MS = 15 * 60_000;     // 15 min
// Seed used to read the u64 seq from MatchCounter's raw bytes. Anchor's
// 8-byte discriminator comes first; seq sits at offset 8.
const COUNTER_SEQ_OFFSET = 8;

/** BattleRoyale mode byte (10 required players). */
const MODE_BR: number = 3;
/** INTRO wager tier index (0.001 SOL) — see state.rs WAGER_TIERS[5]. */
const STAKE_TIER_INTRO: number = 5;
/** Default time window byte (1 = 24h) — keeps widths generous for tournaments. */
const DEFAULT_TIME_WINDOW_24H: number = 1;

export interface TournamentHostOptions {
    connection: Connection;
    /** 64-byte ed25519 secret key encoded as base58 (Solana keypair format). */
    hostSecretB58: string;
    /** Milliseconds between tournament seeds. Default: 15 min. */
    cadenceMs?: number;
    /** Override stake tier (defaults to INTRO). Reserved for future whale tiers. */
    stakeTierIndex?: number;
    /** Override time window (0=1h, 1=24h, 2=3d, 3=7d). Default: 24h. */
    timeWindow?: number;
}

export class TournamentHost {
    private readonly host: Keypair;
    private readonly cadenceMs: number;
    private readonly stakeTierIndex: number;
    private readonly timeWindow: number;
    private timer: NodeJS.Timeout | null = null;
    private running = false;

    constructor(private readonly opts: TournamentHostOptions) {
        const bytes = bs58.decode(opts.hostSecretB58.trim());
        if (bytes.length !== 64) {
            throw new Error(`${TAG} TOURNAMENT_HOST_SECRET decoded to ${bytes.length} bytes; expected 64`);
        }
        this.host = Keypair.fromSecretKey(bytes);
        this.cadenceMs = Math.max(30_000, opts.cadenceMs ?? DEFAULT_CADENCE_MS);
        this.stakeTierIndex = opts.stakeTierIndex ?? STAKE_TIER_INTRO;
        this.timeWindow = opts.timeWindow ?? DEFAULT_TIME_WINDOW_24H;
        console.log(`${TAG} ctor | host=${this.host.publicKey.toBase58()} cadence=${this.cadenceMs}ms tier=${this.stakeTierIndex} window=${this.timeWindow}`);
    }

    /** Host's public key, used by client-side discovery to memcmp on players[0]. */
    get hostPubkey(): PublicKey { return this.host.publicKey; }

    start(): void {
        if (this.running) return;
        this.running = true;
        // Fire first tick after a short boot delay so the backend has time
        // to settle (signer init, StatsBucket context, etc.) before the
        // first on-chain tx fires. Subsequent ticks run at `cadenceMs`.
        setTimeout(() => void this.runTick(), 10_000);
        this.timer = setInterval(() => void this.runTick(), this.cadenceMs);
        console.log(`${TAG} start | scheduler armed cadence=${this.cadenceMs}ms next_tick=+10s`);
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        this.running = false;
    }

    private async runTick(): Promise<void> {
        try {
            const result = await this.createTournamentMatch();
            console.log(`${TAG} tick | OK match=${result.matchPda} sig=${result.sig} https://explorer.solana.com/tx/${result.sig}?cluster=devnet`);
            StatsBucket.bumpTournamentCreated(result.matchPda);
        } catch (e: any) {
            console.warn(`${TAG} tick | FAIL ${e?.message ?? e}`);
        }
    }

    private async createTournamentMatch(): Promise<{ sig: string; matchPda: string }> {
        // Attempt up to 3 times with fresh counter reads on race errors.
        let lastErr: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const seq = await this.readCounterSeq();
                const matchPda = AnchorBackend.deriveMatchPda(MODE_BR, this.stakeTierIndex, seq);
                const { blockhash } = await this.opts.connection.getLatestBlockhash('confirmed');
                const txBytes = AnchorBackend.buildJoinMatchCreateTx(
                    this.host.publicKey.toBase58(),
                    MODE_BR,
                    this.stakeTierIndex,
                    0,                     // xp_bucket = 0 (host has no XP; irrelevant for host slot)
                    this.timeWindow,
                    seq,
                    blockhash,
                );
                const tx = Transaction.from(txBytes);
                tx.sign(this.host);
                const sig = await this.opts.connection.sendRawTransaction(
                    tx.serialize(),
                    { skipPreflight: false, preflightCommitment: 'confirmed' },
                );
                await this.opts.connection.confirmTransaction(sig, 'confirmed');
                return { sig, matchPda };
            } catch (e: any) {
                const msg = (e?.message ?? String(e)).toLowerCase();
                lastErr = e;
                const isRace = ['already in use', 'accountalreadyinuse', '0x0'].some((m) => msg.includes(m));
                if (!isRace) throw e;
                console.warn(`${TAG} createTournamentMatch | RACE attempt=${attempt}/3 — rereading counter`);
            }
        }
        throw lastErr ?? new Error(`${TAG} createTournamentMatch failed after 3 attempts`);
    }

    private async readCounterSeq(): Promise<bigint> {
        const counterPda = new PublicKey(AnchorBackend.deriveMatchCounterPda());
        const info = await this.opts.connection.getAccountInfo(counterPda, 'confirmed');
        if (!info || !info.data) {
            throw new Error(`${TAG} MatchCounter PDA not found at ${counterPda.toBase58()} — run scripts/init-match-counter first`);
        }
        // Anchor account: 8-byte disc, then u64 LE seq.
        const data = info.data;
        let seq = 0n;
        for (let i = 7; i >= 0; i--) {
            seq = (seq << 8n) | BigInt(data[COUNTER_SEQ_OFFSET + i]);
        }
        return seq;
    }
}

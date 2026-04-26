/**
 * audit-deploy-readiness.ts — Stage 4 pre-deploy audit.
 *
 * Stage 3 changed the on-chain GameMode interpretation:
 *   modeU8=1: was FourPlayer (4p), now Trio (3p)
 *   modeU8=2: was EightPlayer (8p), now FourPlayer (4p)
 *   modeU8=3: was BattleRoyale (10p), now EightPlayer (8p)
 *
 * Existing devnet matches with modeU8 ∈ {1,2,3} will have a stale
 * `required_players` field after the new program deploys. This script lists
 * every non-Settled match so you can decide:
 *
 *   • Active matches → settle naturally before deploy, or accept stuck data
 *   • Waiting matches with no opponents → safe to leave; new players just
 *     can't join because required_players will mismatch. They'll time out
 *     after MATCH_WAIT_TIMEOUT_SECS=120 and any user can cancel + refund.
 *   • Waiting matches with partial fill → similar; anyone-cancel works after
 *     timeout.
 *
 * READ-ONLY. Does not write any state. Run BEFORE `anchor deploy`.
 *
 * Usage:
 *   npx ts-node scripts/audit-deploy-readiness.ts
 */

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PROGRAM_ID, RPC_URL } from '../assets/token-duel/scripts/constants';
import { findAllOpenMatchesUnfiltered, findActiveMatchesUnfiltered } from '../assets/token-duel/scripts/MatchRpc';
import { TokenDuelRpc } from '../assets/token-duel/scripts/TokenDuelRpc';

const TAG = '[audit-deploy]';

// Pre-Stage-3 mode mapping. modeU8=0 (1v1) is unchanged; 1/2/3 all shift.
const OLD_MODE_NAMES: Record<number, string> = {
    0: '1v1 (unchanged)',
    1: '4p (becomes Trio 3p — required_players changes 4→3)',
    2: '8p (becomes 4p — required_players changes 8→4)',
    3: 'BR10 (becomes 8p — required_players changes 10→8)',
};

function ageString(unixSec: number): string {
    const now = Date.now() / 1000;
    const elapsed = Math.max(0, now - unixSec);
    if (elapsed < 60) return `${Math.floor(elapsed)}s ago`;
    if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
    return `${Math.floor(elapsed / 3600)}h ago`;
}

async function main() {
    console.log(`${TAG} START program=${PROGRAM_ID} rpc=${RPC_URL}`);
    const conn = new Connection(RPC_URL, 'confirmed');
    const rpc = new TokenDuelRpc();
    void conn; // currently unused — TokenDuelRpc reads RPC_URL itself

    const open = await findAllOpenMatchesUnfiltered(rpc);
    const active = await findActiveMatchesUnfiltered(rpc);

    console.log('');
    console.log(`${TAG} SUMMARY open_lobbies=${open.length} active_matches=${active.length}`);
    console.log('');

    if (open.length === 0 && active.length === 0) {
        console.log(`${TAG} ✅ DEPLOY-READY — zero non-Settled matches on chain.`);
        console.log(`${TAG}    Run: anchor deploy --provider.cluster devnet`);
        return;
    }

    if (open.length > 0) {
        console.log(`── OPEN LOBBIES (${open.length}) ──`);
        for (const m of open) {
            const stake = Number(m.wagerLamports) / LAMPORTS_PER_SOL;
            const ageDelta = ageString(Number(m.createdAt));
            const breaks = m.mode > 0 ? '⚠ ' : '';
            const mode = OLD_MODE_NAMES[m.mode] ?? `mode ${m.mode}`;
            console.log(`  ${breaks}${m.pda.slice(0, 12)}… mode=${mode} stake=${stake.toFixed(3)} SOL filled=${m.playerCount}/${m.requiredPlayers} created=${ageDelta}`);
        }
        console.log('');
    }

    if (active.length > 0) {
        console.log(`── ACTIVE MATCHES (${active.length}) ──`);
        for (const m of active) {
            const stake = Number(m.wagerLamports) / LAMPORTS_PER_SOL;
            const ageDelta = ageString(Number(m.startedAt ?? m.createdAt));
            const breaks = m.mode > 0 ? '⚠ ' : '';
            const mode = OLD_MODE_NAMES[m.mode] ?? `mode ${m.mode}`;
            console.log(`  ${breaks}${m.pda.slice(0, 12)}… mode=${mode} stake=${stake.toFixed(3)} SOL players=${m.playerCount}/${m.requiredPlayers} started=${ageDelta}`);
        }
        console.log('');
    }

    const breakingOpen = open.filter((m) => m.mode > 0).length;
    const breakingActive = active.filter((m) => m.mode > 0).length;
    const totalBreaking = breakingOpen + breakingActive;

    console.log('── DEPLOY ASSESSMENT ──');
    if (totalBreaking === 0) {
        console.log(`${TAG} ✅ DEPLOY-SAFE — all non-Settled matches are 1v1 (modeU8=0) which is unchanged.`);
        console.log(`${TAG}    Run: anchor deploy --provider.cluster devnet`);
    } else {
        console.log(`${TAG} ⚠ ${totalBreaking} match(es) have stale required_players semantics post-deploy.`);
        console.log(`${TAG}   Recommended: wait for them to settle naturally, or:`);
        console.log(`${TAG}   • Open lobbies: timeout after 120s, then any user can cancel for refund.`);
        console.log(`${TAG}   • Active matches: continue racing; settle works regardless of mode rebalance.`);
        console.log(`${TAG}   • Worst case: stuck escrow on multi-player partial-fill 4p/8p/BR10. Rare on devnet.`);
        console.log(`${TAG}   You can deploy anyway — the new program won't crash on old data.`);
    }
}

main().catch((e) => {
    console.log(`${TAG} FAIL ${e?.message ?? e}`);
    process.exit(1);
});

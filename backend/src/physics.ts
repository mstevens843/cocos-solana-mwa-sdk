/**
 * Physics validator — gates every block-drop event the client sends over WS
 * against plausibility rules. If a session accumulates too many rejects,
 * the session manager tears it down and refuses to sign a receipt.
 *
 * The numbers here mirror TokenDuelGame.ts constants — if the game constants
 * change, update these in lockstep. The validator is intentionally strict
 * on the honest path (flag early) and permissive on edge cases so a single
 * laggy frame doesn't nuke a real player's session.
 */

import { BlockDropEvent, PhysicsVerdict, SessionState } from './types';

// Mirrors TokenDuelGame.ts
const MAX_HEIGHT = 50;
const BASE_WIDTH = 220;
const BLOCK_HEIGHT = 60;

// Human timing bounds per tap. Below MIN_DROP_GAP_MS is superhuman; above
// MAX_DROP_GAP_MS is a stall bot.
const MIN_DROP_GAP_MS = 150;
const MAX_DROP_GAP_MS = 8_000;
const MAX_SESSION_MS = 180_000; // 3 min absolute cap

// Width tolerance: backend recomputes expected width from squad delta and
// lets the client be off by ±2px to absorb float rounding.
const WIDTH_TOLERANCE = 2;

export class Physics {
    static validate(session: SessionState, ev: BlockDropEvent): PhysicsVerdict {
        // Index must be strictly sequential.
        const expectedIdx = session.drops.length;
        if (ev.blockIdx !== expectedIdx) {
            return { ok: false, reason: `blockIdx ${ev.blockIdx} != expected ${expectedIdx}` };
        }

        // Never exceed the cap.
        if (ev.blockIdx >= MAX_HEIGHT) {
            return { ok: false, reason: `blockIdx ${ev.blockIdx} exceeds MAX_HEIGHT ${MAX_HEIGHT}` };
        }

        // Timestamps monotonic.
        if (ev.tsMs < session.lastDropAt) {
            return { ok: false, reason: `ts ${ev.tsMs} < lastDrop ${session.lastDropAt}` };
        }
        const gap = ev.tsMs - (session.drops.length === 0 ? session.startedAt : session.lastDropAt);
        if (gap < MIN_DROP_GAP_MS) {
            return { ok: false, reason: `gap ${gap}ms < MIN ${MIN_DROP_GAP_MS}` };
        }
        if (gap > MAX_DROP_GAP_MS) {
            return { ok: false, reason: `gap ${gap}ms > MAX ${MAX_DROP_GAP_MS}` };
        }
        if (ev.tsMs - session.startedAt > MAX_SESSION_MS) {
            return { ok: false, reason: `session exceeded ${MAX_SESSION_MS}ms` };
        }

        // Width must match what the squad's delta dictates for this token.
        // Block index cycles through the 3-token squad: block i → squad[i % 3].
        // expectedWidth === 0 (or undefined) means backend couldn't resolve
        // the delta (no Birdeye key in dev, or Birdeye was down). Allow the
        // client's value rather than fail-closed — a Birdeye gap shouldn't
        // cost an honest player their match.
        const mintForBlock = session.squadMints[ev.blockIdx % session.squadMints.length];
        const expectedWidth = session.expectedWidths[mintForBlock];
        if (expectedWidth !== undefined && expectedWidth > 0) {
            const diff = Math.abs(ev.width - expectedWidth);
            if (diff > WIDTH_TOLERANCE) {
                return {
                    ok: false,
                    reason: `width ${ev.width}px diverges from expected ${expectedWidth}px (diff ${diff})`,
                };
            }
        }

        // Outcome plausibility:
        //   - Block 0 must always be 'ok' (can't miss before stacking anything).
        //   - 'miss' is terminal; no drops accepted after it.
        const prior = session.drops[session.drops.length - 1];
        if (ev.blockIdx === 0 && ev.outcome !== 'ok') {
            return { ok: false, reason: `block 0 cannot be a miss` };
        }
        if (prior?.outcome === 'miss') {
            return { ok: false, reason: `drops not allowed after miss` };
        }

        return { ok: true };
    }

    /**
     * Expected block width = BASE_WIDTH × deltaMultiplier(delta).
     * Mirrors TokenDuelGame.ts delta→width ladder.
     */
    static widthFor(delta24hPct: number): number {
        let mult: number;
        if (delta24hPct >= 5) mult = 1.0;
        else if (delta24hPct >= 0) mult = 0.8;
        else if (delta24hPct >= -5) mult = 0.6;
        else mult = 0.4;
        return Math.round(BASE_WIDTH * mult);
    }
}

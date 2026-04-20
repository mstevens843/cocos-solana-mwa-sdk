/**
 * PriceFeedMock.ts — Deterministic-per-session mock 24h price deltas.
 *
 * v1 does not fetch Jupiter or Pyth. This utility emits pseudo-random deltas
 * in [-8, +8] seeded by the current millisecond timestamp, so each session
 * gets a different difficulty mix but a recording session can retry until
 * the pitch video captures a nice blend.
 *
 * v2 will swap this for a real oracle call with the same static signature.
 */

const TAG = '[PriceFeedMock]';

export class PriceFeedMock {
    static getSessionDeltas(symbols: string[]): Record<string, number> {
        // CI2: allow deterministic deltas for pitch-video recording. Set
        // `globalThis.TD_DEMO_SEED = <number>` in the Cocos console to lock
        // the delta mix across app restarts. Defaults to `Date.now()` so
        // normal play varies session to session.
        const override = (globalThis as any).TD_DEMO_SEED;
        const seed = (typeof override === 'number' ? override : Date.now()) & 0xffff;

        const out: Record<string, number> = {};
        for (let i = 0; i < symbols.length; i++) {
            const s = symbols[i] || `slot${i}`;
            const rand = ((seed + i * 2654435761) * 1103515245 + 12345) >>> 0;
            const delta = ((rand % 1601) / 100) - 8; // 0..16.00 -> -8..+8
            out[s] = Math.round(delta * 10) / 10;
        }
        console.log(`${TAG} getSessionDeltas | seed=${seed} override=${override !== undefined} deltas=${JSON.stringify(out)}`);
        return out;
    }
}

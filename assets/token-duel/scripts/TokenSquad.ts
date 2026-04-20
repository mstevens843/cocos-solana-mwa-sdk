/**
 * TokenSquad.ts — 3-slot token squad state for the Token Duel picker.
 *
 * Plain TypeScript class (no Cocos coupling). AppUI owns the instance and
 * wires it to the feed-row taps; TokenDuelGame subscribes via `onChange` to
 * restyle falling blocks when the squad changes mid-game.
 *
 * Slots are ordered — index 0 is primary, 1/2 are secondaries. The game
 * cycles through them in order when spawning blocks.
 *
 * Invariants:
 *   - `slots.length === SQUAD_SIZE` always.
 *   - An empty slot is represented by `null` (not `undefined`) so consumers
 *     can index without optional chaining collapsing empty + missing.
 *   - Adding a token that's already in another slot swaps — no duplicates.
 */

import { SQUAD_SIZE } from './constants';
import { TokenRow } from './birdeye/types';

const TAG = '[TokenSquad]';

export type SquadListener = (snapshot: (TokenRow | null)[]) => void;

export class TokenSquad {
    private _slots: (TokenRow | null)[] = new Array(SQUAD_SIZE).fill(null);
    private _listeners: SquadListener[] = [];

    constructor() {
        console.log(`${TAG} ctor | DONE size=${SQUAD_SIZE}`);
    }

    /** Read-only snapshot; mutations happen through `add`/`setAt`/`clearAt`. */
    get slots(): (TokenRow | null)[] {
        return this._slots.slice();
    }

    /** How many slots are filled. */
    get filled(): number {
        let n = 0;
        for (const s of this._slots) if (s) n++;
        return n;
    }

    /** True iff no empty slots remain. */
    get isFull(): boolean {
        return this.filled === SQUAD_SIZE;
    }

    /**
     * Add a token to the first empty slot. If the token is already present,
     * no-op and returns -1. If the squad is full, evicts index 0 FIFO-style
     * so taps always feel responsive. Returns the index it was placed at.
     */
    add(row: TokenRow): number {
        if (!row.address) {
            // Caller handed us a malformed row — usually means a Birdeye
            // response was missing `address`. Don't silently swallow.
            console.log(`${TAG} add | MISSING_ADDRESS symbol="${row.symbol}" name="${row.name}" — rejecting`);
            return -1;
        }
        const dup = this._findIndex(row.address);
        if (dup !== -1) {
            console.log(`${TAG} add | DUPLICATE address=${row.address} existing_index=${dup} symbol=${row.symbol}`);
            return -1;
        }

        let idx = this._slots.indexOf(null);
        if (idx === -1) {
            // Full — evict slot 0 (oldest), shift others left.
            console.log(`${TAG} add | FULL evicting slot0=${this._slots[0]?.symbol ?? 'null'}`);
            this._slots[0] = this._slots[1];
            this._slots[1] = this._slots[2];
            this._slots[2] = null;
            idx = 2;
        }
        this._slots[idx] = row;
        console.log(`${TAG} add | DONE index=${idx} address=${row.address} symbol="${row.symbol}" change24h=${row.change24hPct}`);
        this._emit();
        return idx;
    }

    /**
     * Replace slot `i` with `row` (or null). Any existing slot holding the
     * same mint is cleared first to keep the no-duplicates invariant.
     */
    setAt(i: number, row: TokenRow | null): void {
        if (i < 0 || i >= SQUAD_SIZE) {
            console.log(`${TAG} setAt | OUT_OF_RANGE i=${i}`);
            return;
        }
        if (row) {
            const dup = this._findIndex(row.address);
            if (dup !== -1 && dup !== i) {
                console.log(`${TAG} setAt | CLEARING_DUP_SLOT dup_index=${dup} address=${row.address}`);
                this._slots[dup] = null;
            }
        }
        this._slots[i] = row;
        console.log(`${TAG} setAt | DONE i=${i} symbol="${row?.symbol ?? '---'}"`);
        this._emit();
    }

    clearAt(i: number): void {
        if (i < 0 || i >= SQUAD_SIZE) return;
        const prev = this._slots[i];
        this._slots[i] = null;
        console.log(`${TAG} clearAt | DONE i=${i} cleared_symbol="${prev?.symbol ?? '---'}"`);
        this._emit();
    }

    /** Drop every slot back to null. */
    reset(): void {
        for (let i = 0; i < SQUAD_SIZE; i++) this._slots[i] = null;
        console.log(`${TAG} reset | DONE`);
        this._emit();
    }

    /**
     * Merge fresh 24h % data into whichever slots hold those mints.
     * Non-destructive — rows not present in `priceMap` keep their last value.
     * Skips the emit if nothing changed so the game doesn't re-skin on every
     * no-op poll.
     */
    applyPriceUpdates(priceMap: Record<string, { priceUsd: number; change24hPct: number; volume24hUsd: number }>): void {
        let changed = 0;
        let nanGuarded = 0;
        let missingSlots = 0;
        for (let i = 0; i < SQUAD_SIZE; i++) {
            const s = this._slots[i];
            if (!s) continue;
            const update = priceMap[s.address];
            if (!update) { missingSlots++; continue; }
            if (!Number.isFinite(update.priceUsd) || !Number.isFinite(update.change24hPct) || !Number.isFinite(update.volume24hUsd)) {
                // Guard against poisoning the squad UI with NaN — keep prior values.
                console.log(`${TAG} applyPriceUpdates | NAN_UPDATE slot=${i} mint=${s.address} price=${update.priceUsd} change=${update.change24hPct} volume=${update.volume24hUsd} — keeping prior`);
                nanGuarded++;
                continue;
            }
            const priceDelta = update.priceUsd !== s.priceUsd;
            const changeDelta = update.change24hPct !== s.change24hPct;
            if (!priceDelta && !changeDelta) continue;
            this._slots[i] = {
                ...s,
                priceUsd: update.priceUsd,
                change24hPct: update.change24hPct,
                volume24hUsd: update.volume24hUsd,
            };
            changed++;
        }
        console.log(`${TAG} applyPriceUpdates | DONE updates=${Object.keys(priceMap).length} filled=${this.filled} missing_from_map=${missingSlots} nan_guarded=${nanGuarded} changed=${changed}`);
        if (changed > 0) this._emit();
    }

    /** Return the mint list for a Birdeye price_multi call. Omits empty slots. */
    mintList(): string[] {
        const out: string[] = [];
        for (const s of this._slots) if (s) out.push(s.address);
        return out;
    }

    /** Subscribe for change notifications. Returns an unsubscribe fn. */
    onChange(listener: SquadListener): () => void {
        this._listeners.push(listener);
        console.log(`${TAG} onChange | SUBSCRIBE listeners=${this._listeners.length}`);
        return () => {
            const i = this._listeners.indexOf(listener);
            if (i !== -1) this._listeners.splice(i, 1);
            console.log(`${TAG} onChange | UNSUBSCRIBE listeners=${this._listeners.length}`);
        };
    }

    private _findIndex(mint: string): number {
        for (let i = 0; i < SQUAD_SIZE; i++) {
            if (this._slots[i]?.address === mint) return i;
        }
        return -1;
    }

    private _emit(): void {
        const snap = this._slots.slice();
        for (const listener of this._listeners) {
            try { listener(snap); } catch (e) {
                console.log(`${TAG} _emit | LISTENER_ERROR error=${e}`);
            }
        }
    }
}

/**
 * JupiterPriceClient.ts - Lite Jupiter price API as a fallback for Birdeye.
 *
 * Background: PortfolioRace polls Birdeye `/defi/multi_price` every tick
 * during a betting-duel match. multi_price has narrower coverage than
 * Birdeye's trending endpoint: small-cap memecoins and recent pump.fun
 * graduates appear in trending (with a `priceUsd`) but never resolve via
 * multi_price. When that happens, the player's per-token cards silently
 * freeze at +0.00% for the entire race because PortfolioRace's snapshot
 * logic falls back to `cur = entry` when `current[mint]` is missing,
 * giving deltaPct = 0 every tick (PortfolioRace.ts:324).
 *
 * Jupiter is the canonical Solana DEX aggregator and indexes any token
 * with a routable pool, so it covers the long tail Birdeye misses.
 * PriceFeed.getSpotPrices calls Birdeye first, then routes leftover
 * (unindexed) mints here.
 *
 * Endpoint: https://lite-api.jup.ag/price/v3?ids=<comma-mints>
 * Free tier; no API key. Documented batch cap: 50 mints per call.
 *
 * Never throws - returns `{}` on any failure (matches the contract of
 * BirdeyeClient.spotPriceMulti). The caller already handles missing
 * mints by falling back to entry price (delta=0 for that mint), so a
 * Jupiter outage is a graceful degradation, not a crash.
 *
 * Logging: tagged `[AppUI:Jupiter]` so the entire stream passes through
 * the user's default adb logcat grep filter (anchored on `\[(MWA|AppUI|...)`).
 * Same call-id pattern as BirdeyeClient for log correlation.
 */

const TAG = '[AppUI:Jupiter]';
const BASE_URL = 'https://lite-api.jup.ag/price/v3';
const BATCH_LIMIT = 50;

interface JupiterPriceEntry {
    usdPrice?: number;
    blockId?: number;
    decimals?: number;
    priceChange24h?: number;
}

export class JupiterPriceClient {
    private _nextCallId = 1;

    /**
     * Batch-fetch USD spot prices for the given mints.
     * Returns `{ [mint]: priceUsd }`. Missing mints are omitted.
     */
    async fetchPrices(mints: string[]): Promise<Record<string, number>> {
        const callId = this._nextCallId++;
        const uniq = Array.from(new Set(mints.filter((m) => m && m.length > 0)));
        console.log(`${TAG} fetchPrices | START call_id=${callId} requested=${mints.length} unique=${uniq.length}`);
        if (uniq.length === 0) {
            console.log(`${TAG} fetchPrices | EMPTY_LIST call_id=${callId}`);
            return {};
        }

        const out: Record<string, number> = {};
        for (let i = 0; i < uniq.length; i += BATCH_LIMIT) {
            const chunk = uniq.slice(i, i + BATCH_LIMIT);
            const chunkIdx = i / BATCH_LIMIT;
            const url = `${BASE_URL}?ids=${chunk.join(',')}`;
            const json = await this._getOnce(url, callId, chunkIdx);
            if (!json) continue;
            for (const mint of chunk) {
                const entry = json[mint];
                if (!entry) continue;
                const price = Number(entry.usdPrice ?? 0);
                if (!Number.isFinite(price) || price <= 0) {
                    console.log(`${TAG} fetchPrices | BAD_VALUE call_id=${callId} mint=${mint.slice(0, 8)} value=${entry.usdPrice}`);
                    continue;
                }
                out[mint] = price;
            }
        }
        const missing = uniq.length - Object.keys(out).length;
        console.log(`${TAG} fetchPrices | DONE call_id=${callId} requested=${uniq.length} resolved=${Object.keys(out).length} missing=${missing}`);
        return out;
    }

    private async _getOnce(url: string, callId: number, chunkIdx: number): Promise<Record<string, JupiterPriceEntry> | null> {
        const pathOnly = url.length > 100 ? url.substring(0, 100) + '...' : url;
        console.log(`${TAG} _getOnce | ENTER call_id=${callId} chunk=${chunkIdx} url="${pathOnly}"`);
        let response: Response;
        try {
            response = await fetch(url, { method: 'GET', headers: { 'accept': 'application/json' } });
        } catch (e) {
            console.log(`${TAG} _getOnce | FETCH_ERROR call_id=${callId} chunk=${chunkIdx} error=${e}`);
            return null;
        }
        if (!response.ok) {
            let errBody = '';
            try { errBody = (await response.text()).substring(0, 200); } catch (_) { /* ignore */ }
            console.log(`${TAG} _getOnce | HTTP_ERROR call_id=${callId} chunk=${chunkIdx} status=${response.status} body_snip="${errBody.replace(/"/g, "'")}"`);
            return null;
        }
        let rawText: string;
        try {
            rawText = await response.text();
        } catch (e) {
            console.log(`${TAG} _getOnce | READ_ERROR call_id=${callId} chunk=${chunkIdx} error=${e}`);
            return null;
        }
        try {
            const json = JSON.parse(rawText) as Record<string, JupiterPriceEntry>;
            const keys = json && typeof json === 'object' ? Object.keys(json).length : 0;
            console.log(`${TAG} _getOnce | OK call_id=${callId} chunk=${chunkIdx} status=${response.status} body_bytes=${rawText.length} keys=${keys}`);
            return json;
        } catch (e) {
            console.log(`${TAG} _getOnce | PARSE_ERROR call_id=${callId} chunk=${chunkIdx} body_bytes=${rawText.length} body_snip="${rawText.substring(0, 120).replace(/"/g, "'")}" error=${e}`);
            return null;
        }
    }
}

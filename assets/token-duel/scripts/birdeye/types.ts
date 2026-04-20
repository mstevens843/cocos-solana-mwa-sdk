/**
 * Birdeye API response shapes.
 *
 * Only the fields Token Duel actually reads are modeled — Birdeye returns
 * many more (liquidity, fdv, holders, etc.) but we keep shapes minimal to
 * avoid coupling the game to fields that might change.
 *
 * Shapes are based on the /defi/v3/* and /defi/price_volume/multi endpoints
 * as of 2026-04. If Birdeye changes the schema, the `_normalize*` helpers
 * in `BirdeyeClient` are the single place to update.
 */

/** Normalized token row — what the feed list + squad picker consume. */
export interface TokenRow {
    /** Solana mint address, base58. */
    address: string;
    /** Trading symbol ("BONK", "WIF", ...). May be blank for obscure tokens. */
    symbol: string;
    /** Full display name. May be blank. */
    name: string;
    /** Current USD price. 0 if unknown. */
    priceUsd: number;
    /** 24h price change as a percentage (so 18.4 means +18.4%). */
    change24hPct: number;
    /** 24h trading volume in USD. 0 if unknown. */
    volume24hUsd: number;
    /** Mint decimals (needed to interpret on-chain balances). -1 if unknown. */
    decimals: number;
    /** Absolute URL to logo PNG/JPEG. '' if unknown. */
    logoUri: string;
}

/** Feed-tab identifier. Used by `BirdeyeClient.getTrending()` to pick sort. */
export type FeedTab = 'trending' | 'gainers' | 'new';

/** Raw /defi/v3/token/list response item. */
export interface RawTokenListItem {
    address: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    price?: number;
    volume_24h_usd?: number;
    price_change_24h_percent?: number;
    logo_uri?: string;
    logoURI?: string;
}

/** Raw /defi/v2/tokens/new_listing response item. */
export interface RawNewListingItem {
    address: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    liquidity?: number;
    logo_uri?: string;
    logoURI?: string;
    source?: string;
}

/** Raw /defi/v3/search match (target=token). */
export interface RawSearchTokenItem {
    address: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    price?: number;
    volume_24h_usd?: number;
    price_change_24h_percent?: number;
    logo_uri?: string;
    logoURI?: string;
}

/** Raw /defi/price_volume/multi response shape. */
export interface RawPriceVolumeMulti {
    [mint: string]: {
        price?: number;
        priceChangePercent?: number;
        volumeUSD?: number;
        updateUnixTime?: number;
    };
}

/** Normalized price update per mint (what the PriceFeed publishes). */
export interface PriceUpdate {
    mint: string;
    priceUsd: number;
    change24hPct: number;
    volume24hUsd: number;
    ts: number; // ms since epoch when Birdeye claimed this value
}

/**
 * Birdeye API response shapes — Session 11.
 *
 * Ported to parity with solpulse's `backend/api/tokenList.js` normalizer
 * output so the cocos `TokenRow` carries every field the trade-tab UI
 * consumes: liquidity, marketCap, fdv, holders, blockUnixTime, source,
 * smartTraders, netFlow — on top of the core identification + price fields.
 *
 * If Birdeye changes the schema, the `_normalize*` helpers in `BirdeyeClient`
 * are the single place to update. Raw interfaces below reflect the *current*
 * upstream shapes (snake_case vs camelCase differs per endpoint — caller
 * branches by tab).
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

    // ─── Session 11 additions (solpulse parity) ──────────────────────────

    /** USD liquidity depth. 0 if unknown. */
    liquidity: number;
    /** USD market cap. 0 if unknown. */
    marketCap: number;
    /** USD fully-diluted value. 0 if unknown. */
    fdv: number;
    /** Holder count. 0 if unknown. */
    holders: number;
    /** Unix seconds when the token was listed / liquidity added. 0 if unknown. */
    blockUnixTime: number;
    /** DEX / pool source, e.g. "meteora_damm_v2", "pump_amm". '' if unknown. */
    source: string;

    // ─── Smart-money-only fields (0 for non-smart-money feeds) ───────────

    /** Count of smart-money traders on this token in the window. */
    smartTraders: number;
    /** USD net flow from smart-money traders. Negative = net sell. */
    netFlow: number;
}

/** Feed-tab identifier. Used by `BirdeyeClient.getTrending()` to pick sort. */
export type FeedTab = 'trending' | 'gainers' | 'new' | 'smart_money';

/** Raw /defi/v3/token/list response item (snake_case per v3 convention). */
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
    liquidity?: number;
    market_cap?: number;
    marketcap?: number;
    fdv?: number;
    holder?: number;
}

/**
 * Raw /defi/token_trending response item. Fields are camelCase per
 * Birdeye's example payload: `volume24hUSD`, `price24hChangePercent`, `logoURI`.
 * This is distinct from /defi/v3/token/list which uses snake_case.
 */
export interface RawTrendingToken {
    address: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    price?: number;
    liquidity?: number;
    logoURI?: string;
    logo_uri?: string;
    volume24hUSD?: number;
    volume24hChangePercent?: number;
    price24hChangePercent?: number;
    rank?: number;
    fdv?: number;
    marketcap?: number;
    market_cap?: number;
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
    /** ISO-8601 string or unix seconds — normalizer coerces to unix sec. */
    liquidityAddedAt?: string | number;
    /** Fallback alternate spelling Birdeye sometimes ships. */
    block_unix_time?: number;
}

/** Raw /defi/v3/search match (target=token). */
export interface RawSearchTokenItem {
    address?: string;
    token?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    price?: number;
    volume_24h_usd?: number;
    price_change_24h_percent?: number;
    logo_uri?: string;
    logoURI?: string;
    liquidity?: number;
    market_cap?: number;
    marketCap?: number;
    fdv?: number;
    verified?: boolean;
}

/** Raw /smart-money/v1/token/list response item. */
export interface RawSmartMoneyItem {
    /** Mint address — key is `token` not `address`. */
    token?: string;
    address?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    price?: number;
    price_change_percent?: number;
    volume_usd?: number;
    liquidity?: number;
    logo_uri?: string;
    logoURI?: string;
    market_cap?: number;
    smart_traders_no?: number;
    net_flow?: number;
}

/** Raw /defi/v3/token/meta-data/multiple response item. */
export interface RawMetaDataItem {
    address: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    logo_uri?: string;
    logoURI?: string;
    website?: string;
    twitter?: string;
    description?: string;
}

/** Normalized metadata used by enricher — camelCase. */
export interface TokenMetaData {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUri: string;
    website: string;
    twitter: string;
    description: string;
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

// ─── Session 13: OHLCV candles (chart detail view) ────────────────────

/** Birdeye /defi/ohlcv `type` enum — maps 1:1 to solpulse timeframe buttons. */
export type OhlcvType = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';

/** Raw /defi/ohlcv response item. Field names come straight from Birdeye. */
export interface RawOhlcvCandle {
    unixTime: number;
    o: number;  // open
    h: number;  // high
    l: number;  // low
    c: number;  // close
    v: number;  // volume (base token)
}

/** Normalized candle — what CandlestickChart consumes. */
export interface Candle {
    t: number; // unix seconds
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
}

/**
 * DemoFlags.ts — single-source switches for demo / video-recording modes.
 *
 * Keep this file tiny and grep-friendly. Imported by the small number of
 * runtime modules that have to behave differently when we're recording a
 * pitch video vs running a real match.
 */

/**
 * DEMO_FAKE_PRICES — master switch for the recorded-demo race.
 *
 * `true`  → both player and bot use synthetic deltas (eased random walk).
 *           Use this for video recording: per-token cards animate even when
 *           the live price feed is too slow / cached / unindexed to show
 *           movement inside a 30-second race.
 *
 * `false` → player uses real Birdeye prices (PortfolioRace polls every tick);
 *           bot remains synthetic (LiveSquadBot — same as has been shipping).
 *           Wiring the bot to real Birdeye prices is a separate change.
 */
export const DEMO_FAKE_PRICES = true;

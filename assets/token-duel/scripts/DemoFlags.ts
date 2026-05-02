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

/**
 * DEBUG_POSTMATCH — verbose post-match panel diagnostics.
 *
 * `true`  → AppUI dumps button health (active / interactable / contentSize /
 *           UIOpacity / world AABB / parent-chain inactive ancestor) at
 *           250 / 750 / 2000 / 4000 ms after the post-match panel is shown,
 *           plus a one-shot list of any Canvas children with a higher
 *           siblingIndex than PostMatchPanel that are active and visible.
 *           Used to diagnose "Home / Pick New Squad buttons not clickable"
 *           on native Android. Default true for one APK build, then flip
 *           to false once the issue is verified fixed.
 *
 * `false` → no diagnostic dumps, normal behavior.
 */
export const DEBUG_POSTMATCH = true;

/**
 * DemoAppConfig.ts — Sets the app identity for the MWA demo app.
 *
 * Attach this Component to a persistent root node (or the same node as MWAManager).
 * It runs before LandingUI/HomeUI and configures the app identity
 * that gets sent to wallets during MWA authorization.
 */

import { _decorator, Component } from 'cc';
import { setAppIdentity, setSiwsIdentity } from '../../solana-mwa/scripts/AppIdentity';

const { ccclass } = _decorator;
const TAG = '[DemoAppConfig]';

@ccclass('DemoAppConfig')
export class DemoAppConfig extends Component {

    onLoad(): void {
        console.log(`${TAG} onLoad | START — configuring demo app identity`);

        // Placeholder `https://example.com` + "Example" appName was triggering
        // Phantom's Blowfish "unknown dApp / may be malicious" cascade on every
        // sign_transactions approval (KNOWN_ISSUES.md #12). Use a real repo URL
        // and a name that doesn't read as a scam template.
        //
        // Pass 11: cluster is back on `mainnet-beta`. We briefly tried `devnet`
        // to soften Blowfish warnings but Backpack's MWA implementation rejects
        // devnet with a "network not supported" toast and never replies
        // (90s id=1 timeout inside the Kotlin client). Jupiter's Seeker
        // integration is also mainnet-only. Blowfish warnings on an
        // unregistered dApp identity are a wallet UX policy, not a code bug —
        // the real fix is registering the dApp with Phantom's verification
        // program, documented in KNOWN_ISSUES.md #12. Downstream SDK consumers
        // can still override via `setAppIdentity()` / `setCluster()`.
        const identity = {
            appName: 'Cocos MWA SDK Demo',
            appUri: 'https://github.com/mstevens843/Cocos-Solana-MWA-SDK',
            appIconPath: '/icon.png',
            cluster: 'mainnet-beta' as const,
        };
        setAppIdentity(identity);

        // Pass 12: SIWS-on-Connect is gated behind a feature flag so the demo
        // ships with the plain-`authorize` path that works on all five wallets
        // (including Solflare, whose MWA implementation crashes when the
        // authorize request carries a `sign_in_payload` — KNOWN_ISSUES.md #6
        // and the test matrix in #16).
        //
        // Flip `USE_SIWS_ON_CONNECT` to `true` to re-engage the Pass 11 SIWS
        // flow: Backpack / Seed Vault return `signInResult` natively, Jupiter
        // gets a proof-of-ownership signature via the in-session
        // `sign_messages` fallback (one OS wallet picker, two wallet prompts),
        // Phantom degrades to authorize-only via the Java-side 15 s
        // `SIWS_FALLBACK_TIMEOUT_MS`, and Solflare crashes.
        //
        // Routing is implemented in `MWAManager.authorize()` — when
        // `getSiwsIdentity().domain` is non-empty it delegates to
        // `authorizeSiws()`; empty domain takes the plain path. The SDK itself
        // is unchanged by this flag; downstream SDK consumers pick SIWS by
        // calling `setSiwsIdentity({ domain, statement })` directly.
        const USE_SIWS_ON_CONNECT = false;

        if (USE_SIWS_ON_CONNECT) {
            const siwsIdentity = {
                domain: 'github.com',
                statement: 'Sign in to Cocos MWA SDK Demo',
            };
            setSiwsIdentity(siwsIdentity);
            console.log(`${TAG} onLoad | SIWS=on domain="${siwsIdentity.domain}" statement="${siwsIdentity.statement}"`);
        } else {
            // Empty domain disables the SIWS route in `MWAManager.authorize()`.
            setSiwsIdentity({ domain: '', statement: '' });
            console.log(`${TAG} onLoad | SIWS=off — Connect uses plain authorize (works on all 5 wallets including Solflare)`);
        }

        console.log(`${TAG} onLoad | DONE appName="${identity.appName}" appUri="${identity.appUri}" appIconPath="${identity.appIconPath}" cluster="${identity.cluster}" siws_on_connect=${USE_SIWS_ON_CONNECT}`);
        console.log(`${TAG} onLoad | NOTE demo cluster defaults to mainnet-beta (Backpack + Jupiter-Seeker require it); call setCluster('devnet') on AppIdentity for devnet testing`);
        console.log(`${TAG} onLoad | NOTE flip USE_SIWS_ON_CONNECT=true in this file to re-engage Pass 11 SIWS flow (KNOWN_ISSUES.md #16)`);
    }
}

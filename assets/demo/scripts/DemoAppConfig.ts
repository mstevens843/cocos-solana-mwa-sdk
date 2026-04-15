/**
 * DemoAppConfig.ts — Sets the app identity for the MWA demo app.
 *
 * Attach this Component to a persistent root node (or the same node as MWAManager).
 * It runs before LandingUI/HomeUI and configures the app identity
 * that gets sent to wallets during MWA authorization.
 */

import { _decorator, Component } from 'cc';
import { setAppIdentity } from '../../solana-mwa/scripts/AppIdentity';

const { ccclass } = _decorator;
const TAG = '[DemoAppConfig]';

@ccclass('DemoAppConfig')
export class DemoAppConfig extends Component {

    onLoad(): void {
        console.log(`${TAG} onLoad | START — configuring demo app identity`);

        const identity = {
            appName: 'Cocos MWA Example',
            appUri: 'https://example.com',
            appIconPath: '/icon.png',
            cluster: 'devnet' as const,
        };
        setAppIdentity(identity);

        console.log(`${TAG} onLoad | DONE appName="${identity.appName}" appUri="${identity.appUri}" appIconPath="${identity.appIconPath}" cluster="${identity.cluster}"`);
    }
}

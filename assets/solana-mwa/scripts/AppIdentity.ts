/**
 * AppIdentity.ts — Default app identity configuration for MWA authorization.
 *
 * Game developers override these values for their own app:
 *   import { setAppIdentity } from './AppIdentity';
 *   setAppIdentity({ appName: 'My Game', appUri: 'https://mygame.com', ... });
 */

import { AppIdentity, SolanaCluster } from './MWATypes';

const TAG = '[AppIdentity]';

/** Default identity used by the demo app. Override for your own app. */
let _currentIdentity: AppIdentity = {
    appName: 'MWA Example App',
    appUri: 'https://example.com',
    appIconPath: '/icon.png',
    cluster: 'devnet',
};

let _initialized = false;

/**
 * Get the current app identity.
 * Logs on first access for diagnostic visibility.
 */
export function getAppIdentity(): AppIdentity {
    if (!_initialized) {
        _initialized = true;
        console.log(`${TAG} getAppIdentity | FIRST_ACCESS app_name=${_currentIdentity.appName} app_uri=${_currentIdentity.appUri} cluster=${_currentIdentity.cluster} icon=${_currentIdentity.appIconPath}`);
    }
    return _currentIdentity;
}

/**
 * Override the app identity. Call this before any MWA operations.
 * Typically in your game's startup script.
 */
export function setAppIdentity(identity: Partial<AppIdentity>): void {
    const prev = { ..._currentIdentity };
    _currentIdentity = { ..._currentIdentity, ...identity };
    console.log(`${TAG} setAppIdentity | UPDATED app_name="${prev.appName}"->"${_currentIdentity.appName}" cluster="${prev.cluster}"->"${_currentIdentity.cluster}" app_uri="${_currentIdentity.appUri}"`);
}

/**
 * Set just the cluster. Convenience for switching between devnet/mainnet.
 */
export function setCluster(cluster: SolanaCluster): void {
    const prev = _currentIdentity.cluster;
    _currentIdentity.cluster = cluster;
    console.log(`${TAG} setCluster | UPDATED cluster="${prev}"->"${cluster}"`);
}

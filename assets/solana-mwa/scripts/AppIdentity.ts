/**
 * AppIdentity.ts - Default app identity configuration for MWA authorization.
 *
 * Game developers override these values for their own app:
 *   import { setAppIdentity } from './AppIdentity';
 *   setAppIdentity({ appName: 'My Game', appUri: 'https://mygame.com', ... });
 */

import { AppIdentity, SolanaCluster, SiwsIdentity } from './MWATypes';

const TAG = '[AppIdentity]';

/** Default identity used by the demo app. Override for your own app. */
let _currentIdentity: AppIdentity = {
    appName: 'MWA Example App',
    appUri: 'https://example.com',
    appIconPath: '/icon.png',
    cluster: 'devnet',
};

/**
 * SIWS (Sign-In-With-Solana) identity - when `domain` is non-empty, the Connect
 * flow uses MWA 2.0 `authorize_siws` with `sign_in_payload` instead of plain
 * authorize. Defaults to empty (SIWS opt-in). Apps opt in via
 * `setSiwsIdentity({ domain, statement })`.
 */
let _currentSiws: SiwsIdentity = {
    domain: '',
    statement: '',
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

/**
 * Set the SIWS (Sign-In-With-Solana) identity. When `domain` is non-empty,
 * the Connect flow issues MWA 2.0 `authorize_siws` with `sign_in_payload`.
 * Wallets that support it natively (Backpack) return `signInResult` inside
 * authorize; wallets that don't get a fallback `sign_messages` round with a
 * CAIP-122 message, bounded by a JS-level 15 s timeout so Phantom/Solflare
 * (which don't implement `sign_messages`) degrade gracefully to a plain
 * authorize session instead of hanging.
 */
export function setSiwsIdentity(siws: Partial<SiwsIdentity>): void {
    const prev = { ..._currentSiws };
    _currentSiws = { ..._currentSiws, ...siws };
    console.log(`${TAG} setSiwsIdentity | UPDATED domain="${prev.domain}"->"${_currentSiws.domain}" statement_len=${_currentSiws.statement?.length ?? 0}`);
}

/** Get the current SIWS identity. Returns empty domain when SIWS is not configured. */
export function getSiwsIdentity(): SiwsIdentity {
    return _currentSiws;
}

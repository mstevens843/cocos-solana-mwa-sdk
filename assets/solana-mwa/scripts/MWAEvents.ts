/**
 * MWAEvents.ts — Event name constants for the Solana MWA SDK.
 * Cocos Creator uses string-based EventTarget for node events.
 *
 * Usage:
 *   MWAManager.instance.node.on(MWA_AUTHORIZED, (pubkey: string) => { ... });
 *   MWAManager.instance.node.on(MWA_DISCONNECTED, () => { ... });
 */

// ─── Connection Events ───────────────────────────────────────────────────────

/** Emitted after successful authorize + biometric sign-in. Data: pubkey (string). */
export const MWA_AUTHORIZED = 'mwa-authorized';

/** Emitted when authorization fails or is rejected. Data: error message (string). */
export const MWA_AUTH_FAILED = 'mwa-auth-failed';

/** Emitted after deauthorize or deleteAccount. No data. */
export const MWA_DISCONNECTED = 'mwa-disconnected';

// ─── Operation Events ────────────────────────────────────────────────────────

/** Emitted after successful message signing. Data: signature (string). */
export const MWA_MESSAGE_SIGNED = 'mwa-message-signed';

/** Emitted after successful transaction signing. Data: signature (string). */
export const MWA_TRANSACTION_SIGNED = 'mwa-transaction-signed';

/** Emitted after successful sign & send. Data: signatures (string[]). */
export const MWA_TRANSACTIONS_SENT = 'mwa-transactions-sent';

/** Emitted after successful get_capabilities. Data: WalletCapabilities. */
export const MWA_CAPABILITIES_RECEIVED = 'mwa-capabilities-received';

// ─── Status Events ───────────────────────────────────────────────────────────

/** Emitted on any status change (for UI updates). Data: message (string). */
export const MWA_STATUS = 'mwa-status';

// ─── Error Codes ─────────────────────────────────────────────────────────────

/** Standard error codes returned by the native bridge. */
export const MWA_ERROR_USER_REJECTED = 'USER_REJECTED';
export const MWA_ERROR_TIMEOUT = 'TIMEOUT';
export const MWA_ERROR_WALLET_ERROR = 'WALLET_ERROR';
export const MWA_ERROR_NOT_CONNECTED = 'NOT_CONNECTED';
export const MWA_ERROR_NO_WALLET = 'NO_WALLET';
export const MWA_ERROR_UNKNOWN_COMMAND = 'UNKNOWN_COMMAND';

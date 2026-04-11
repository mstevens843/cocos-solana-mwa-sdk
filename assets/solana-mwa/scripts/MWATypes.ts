/**
 * MWATypes.ts — All interfaces and types for the Solana MWA SDK.
 * This is the API contract. Everything else imports from here.
 */

// ─── App Identity ────────────────────────────────────────────────────────────

/** Identity sent to wallets during MWA authorization. */
export interface AppIdentity {
    appName: string;
    appUri: string;
    appIconPath: string;
    cluster: SolanaCluster;
}

export type SolanaCluster = 'devnet' | 'testnet' | 'mainnet-beta';

// ─── MWA Results ─────────────────────────────────────────────────────────────

/** Returned by authorize/reauthorize on success. */
export interface AuthorizeResult {
    pubkey: string;         // base58-encoded public key
    authToken: string;      // MWA auth token for session reuse
    walletUriBase: string;  // wallet's URI base (optional)
}

/** Cached authorization for offline reconnection. */
export interface CachedAuth {
    pubkey: string;
    authToken: string;
    walletUriBase: string;
    timestamp: number;      // Unix timestamp (seconds)
}

/** Wallet capabilities returned by get_capabilities. */
export interface WalletCapabilities {
    maxTransactionsPerRequest: number;
    maxMessagesPerRequest: number;
    supportedTransactionVersions: string[];
    features: string[];
}

/** Signature result from sign operations. */
export interface SignResult {
    signatures: string[];   // base64-encoded signatures
}

/** Transaction send result. */
export interface SendResult {
    signatures: string[];   // base58-encoded transaction signatures
}

// ─── Bridge Protocol ─────────────────────────────────────────────────────────

/** Command names supported by the JsbBridge protocol. */
export type MWACommandName =
    | 'authorize'
    | 'reauthorize'
    | 'deauthorize'
    | 'sign_messages'
    | 'sign_and_send'
    | 'get_capabilities'
    | 'is_available';

/** Command sent from TypeScript to Java via JsbBridge. */
export interface MWACommand {
    id: string;             // unique request ID (e.g., "req_001")
    cmd: MWACommandName;    // command name
    params: Record<string, any>;  // command-specific parameters
}

/** Response received from Java via JsbBridge. */
export interface MWAResponse {
    id: string;             // correlates to MWACommand.id
    result?: Record<string, any>;  // success payload
    error?: MWAError;       // error payload (mutually exclusive with result)
}

/** Error returned from the native layer. */
export interface MWAError {
    code: string;           // e.g., "USER_REJECTED", "TIMEOUT", "WALLET_ERROR"
    message: string;        // human-readable error description
}

// ─── Bridge Internal ─────────────────────────────────────────────────────────

/** Pending request tracker for Promise correlation in MWABridge. */
export interface PendingRequest {
    resolve: (result: any) => void;
    reject: (error: MWAError) => void;
    cmd: MWACommandName;
    timestamp: number;      // Date.now() when sent
}

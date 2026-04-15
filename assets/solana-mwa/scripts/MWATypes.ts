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

/** Returned by authorizeSiws on success (MWA 2.0 Sign In With Solana). */
export interface AuthorizeSiwsResult extends AuthorizeResult {
    signInResult?: SignInResult;   // SIWS proof-of-ownership data
    accountLabel?: string;         // wallet-reported account label
    accountChains?: string;        // comma-separated chain IDs (e.g., "solana:mainnet,solana:devnet")
    accountFeatures?: string;      // comma-separated feature IDs
}

/** SIWS sign-in result — proof that the wallet owner authorized this app. */
export interface SignInResult {
    address: string;        // base58 public key (matches pubkey)
    signature: string;      // base64-encoded Ed25519 signature
    signedMessage: string;  // base64-encoded signed message bytes
    signatureType: string;  // usually "ed25519"
}

/** Cached authorization for offline reconnection. */
export interface CachedAuth {
    pubkey: string;
    authToken: string;
    walletUriBase: string;
    walletPackage: string;  // Android package name of wallet used (e.g., "app.phantom", "" for Seed Vault)
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

// ─── Wallet Adapter Types ────────────────────────────────────────────────────

/** Info about a known MWA-compatible wallet, returned by detectWallets(). */
export interface WalletInfo {
    name: string;           // display name (e.g., "Phantom")
    packageName: string;    // Android package (e.g., "app.phantom")
    installed: boolean;     // whether the wallet is installed on this device
    storeUrl: string;       // Play Store URL for installation
}

/** Device detection result, returned by detectDevice(). */
export interface DeviceInfo {
    isSeeker: boolean;      // Solana Mobile Seeker (Chapter2)
    isSaga: boolean;        // Solana Mobile Saga
    isSolanaMobile: boolean; // any Solana Mobile device
    manufacturer: string;   // Build.MANUFACTURER
    model: string;          // Build.MODEL
}

// ─── Bridge Protocol ─────────────────────────────────────────────────────────

/** Command names supported by the JsbBridge protocol. */
export type MWACommandName =
    | 'authorize'
    | 'reauthorize'
    | 'deauthorize'
    | 'authorize_and_sign'
    | 'authorize_siws'
    | 'sign_and_deauthorize'
    | 'sign_messages'
    | 'sign_transactions'
    | 'sign_and_send'
    | 'get_capabilities'
    | 'is_available'
    | 'detect_wallets'
    | 'detect_device'
    | 'open_url';

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

/**
 * Shared backend types.
 *
 * Wire shapes (what goes over HTTP / WS) are kept stable — they're part of
 * the backend↔client contract. Renaming or changing a field is a breaking
 * change; version the endpoint instead.
 */

export interface StartSessionRequest {
    matchPda: string;       // base58
    playerPubkey: string;   // base58
    squadMints: [string, string, string]; // squad at game start
    timeWindow: string;     // '1h' | '1d' | '3d' | '7d' — used to pick the right Birdeye type
}

export interface StartSessionResponse {
    sessionId: string;          // UUID v4
    serverPubkey: string;       // base58 — client verifies this matches RECEIPT_SIGNER_PUBKEY
    wsUrl: string;              // ws(s)://…/session/:id/stream
    expectedWidths: Record<string, number>; // mint → width-modifier used by the physics validator
    startedAt: number;          // unix ms
}

export type WsOutbound =
    | { kind: 'ack'; blockIdx: number }
    | { kind: 'reject'; reason: string; blockIdx?: number }
    | { kind: 'receipt'; ed25519IxDataB64: string; signedAt: number; height: number }
    | { kind: 'fatal'; reason: string };

export type WsInbound =
    | {
          kind: 'drop';
          blockIdx: number;
          tsMs: number;
          xPos: number;
          width: number;
          outcome: 'ok' | 'miss';
      }
    | { kind: 'finalize'; finalHeight: number };

export interface SessionState {
    id: string;
    matchPda: string;
    playerPubkey: string;
    squadMints: [string, string, string];
    timeWindow: string;
    expectedWidths: Record<string, number>;
    drops: BlockDropEvent[];
    startedAt: number;          // unix ms
    lastDropAt: number;         // unix ms — for anti-stall timeout
    rejectedCount: number;
    finalized: boolean;
    receiptSignedAt: number | null;
}

export interface BlockDropEvent {
    blockIdx: number;
    tsMs: number;
    xPos: number;
    width: number;
    outcome: 'ok' | 'miss';
}

export interface PhysicsVerdict {
    ok: boolean;
    reason?: string;
}

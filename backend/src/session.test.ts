/**
 * session.test.ts - end-to-end WS smoke test.
 *
 * Boots the backend in-process, POSTs /session/start, opens a WS, sends 3
 * valid drops + a finalize, and verifies the returned receipt is a valid
 * Ed25519 precompile instruction data blob with the expected message.
 *
 * Run: `npm run test:session` (or `tsx src/session.test.ts`).
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import http from 'http';
import WebSocket from 'ws';

import './server';  // imports the Express + WS listener as a side-effect
import { ReceiptSigner } from './signer';
import nacl from 'tweetnacl';

const TAG = '[session.test]';

function assert(cond: boolean, msg: string): void {
    if (!cond) { console.error(`${TAG} FAIL: ${msg}`); process.exit(1); }
}

async function post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`http://localhost:${process.env.PORT}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

async function main() {
    // Give the server.ts import a moment to bind the port.
    await new Promise((r) => setTimeout(r, 500));

    const playerKp = Keypair.generate();
    const matchKp = Keypair.generate();
    const squadMints: [string, string, string] = [
        Keypair.generate().publicKey.toBase58(),
        Keypair.generate().publicKey.toBase58(),
        Keypair.generate().publicKey.toBase58(),
    ];

    // 1. POST /session/start
    console.log(`${TAG} POST /session/start`);
    const startResp = await post('/session/start', {
        matchPda: matchKp.publicKey.toBase58(),
        playerPubkey: playerKp.publicKey.toBase58(),
        squadMints,
        timeWindow: '1d',
    });
    assert(typeof startResp.sessionId === 'string', 'sessionId returned');
    assert(typeof startResp.wsUrl === 'string', 'wsUrl returned');
    console.log(`${TAG} session=${startResp.sessionId} serverPk=${startResp.serverPubkey}`);

    // 2. Connect WS
    const ws = new WebSocket(startResp.wsUrl);
    const receiptPromise = new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ws timeout')), 8000);
        ws.on('message', (raw) => {
            const msg = JSON.parse(String(raw));
            console.log(`${TAG} ws <- ${JSON.stringify(msg).slice(0, 180)}`);
            if (msg.kind === 'receipt') { clearTimeout(t); resolve(msg); }
            if (msg.kind === 'fatal') { clearTimeout(t); reject(new Error(`fatal: ${msg.reason}`)); }
        });
        ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
    await new Promise((r, rej) => {
        ws.on('open', () => r(null));
        ws.on('error', rej);
    });
    console.log(`${TAG} ws OPEN`);

    // 3. Send 3 valid drops. Backend has no Birdeye key → permissive widths,
    // so any width is OK. tsMs must be ≥ startedAt + MIN_DROP_GAP (150ms).
    const base = startResp.startedAt + 500;
    for (let i = 0; i < 3; i++) {
        ws.send(JSON.stringify({
            kind: 'drop',
            blockIdx: i,
            tsMs: base + i * 800,
            xPos: 0,
            width: 220,
            outcome: 'ok',
        }));
    }

    // 4. Finalize
    ws.send(JSON.stringify({ kind: 'finalize', finalHeight: 3 }));

    // 5. Receive receipt
    const receipt = await receiptPromise;
    assert(typeof receipt.ed25519IxDataB64 === 'string', 'ixData returned');
    assert(receipt.height === 3, `receipt height 3, got ${receipt.height}`);

    // 6. Verify the embedded signature is for the expected message.
    const ixBytes = Buffer.from(receipt.ed25519IxDataB64, 'base64');
    const pkOff = ixBytes.readUInt16LE(6);
    const sigOff = ixBytes.readUInt16LE(2);
    const msgOff = ixBytes.readUInt16LE(10);
    const msgSize = ixBytes.readUInt16LE(12);
    const pk = ixBytes.subarray(pkOff, pkOff + 32);
    const sig = ixBytes.subarray(sigOff, sigOff + 64);
    const msg = ixBytes.subarray(msgOff, msgOff + msgSize);

    assert(
        new PublicKey(pk).toBase58() === startResp.serverPubkey,
        'embedded pubkey matches serverPubkey',
    );
    const parsedMatch = new PublicKey(msg.subarray(0, 32));
    const parsedPlayer = new PublicKey(msg.subarray(32, 64));
    const parsedHeight = msg.readUInt32LE(64);
    const parsedSignedAt = Number(msg.readBigInt64LE(68));
    assert(parsedMatch.equals(matchKp.publicKey), 'match_pda in message');
    assert(parsedPlayer.equals(playerKp.publicKey), 'player in message');
    assert(parsedHeight === 3, 'height in message');
    assert(parsedSignedAt === receipt.signedAt, 'signed_at in message matches receipt');
    assert(nacl.sign.detached.verify(msg, sig, pk), 'signature verifies against embedded pubkey');

    console.log(`${TAG} ALL ASSERTIONS PASSED · receipt len=${ixBytes.length} height=${parsedHeight} signed_at=${parsedSignedAt}`);
    ws.close();
    process.exit(0);
}

process.env.PORT = process.env.PORT || '4201';
main().catch((e) => { console.error(`${TAG} ERROR`, e); process.exit(1); });

/**
 * physics.test.ts - unit tests for the physics validator.
 *
 * Hand-rolled asserts so no test framework needed. Run `npm run test:physics`.
 */

import { Physics } from './physics';
import { BlockDropEvent, SessionState } from './types';

const TAG = '[physics.test]';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error(`${TAG} FAIL: ${msg}`);
        process.exit(1);
    }
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
    return {
        id: 'test-session',
        matchPda: 'match-pda',
        playerPubkey: 'player',
        squadMints: ['mint-A', 'mint-B', 'mint-C'],
        timeWindow: '1d',
        expectedWidths: { 'mint-A': 220, 'mint-B': 176, 'mint-C': 132 },
        drops: [],
        startedAt: 1_000_000,
        lastDropAt: 1_000_000,
        rejectedCount: 0,
        finalized: false,
        receiptSignedAt: null,
        ...overrides,
    };
}

function drop(ix: number, ts: number, width: number, outcome: 'ok' | 'miss' = 'ok'): BlockDropEvent {
    return { blockIdx: ix, tsMs: ts, xPos: 0, width, outcome };
}

function main() {
    // Happy path: 3 sequential drops, honest timing + widths.
    {
        const s = makeSession();
        let v = Physics.validate(s, drop(0, 1_000_500, 220));
        assert(v.ok, `expected ok on block 0, got ${v.reason}`);
        s.drops.push(drop(0, 1_000_500, 220));
        s.lastDropAt = 1_000_500;

        v = Physics.validate(s, drop(1, 1_001_500, 176));
        assert(v.ok, `expected ok on block 1, got ${v.reason}`);
        s.drops.push(drop(1, 1_001_500, 176));
        s.lastDropAt = 1_001_500;

        v = Physics.validate(s, drop(2, 1_002_500, 132));
        assert(v.ok, `expected ok on block 2, got ${v.reason}`);

        console.log(`${TAG} happy path OK`);
    }

    // Out-of-order block idx rejected.
    {
        const s = makeSession();
        const v = Physics.validate(s, drop(1, 1_000_500, 220));
        assert(!v.ok, 'expected reject on block 1 when 0 not yet dropped');
        console.log(`${TAG} OOO idx rejected: ${v.reason}`);
    }

    // Superhuman timing rejected.
    {
        const s = makeSession();
        s.drops.push(drop(0, 1_000_100, 220));
        s.lastDropAt = 1_000_100;
        const v = Physics.validate(s, drop(1, 1_000_200, 176)); // 100ms gap < 150
        assert(!v.ok, 'expected reject on 100ms gap');
        console.log(`${TAG} superhuman timing rejected: ${v.reason}`);
    }

    // Wrong width rejected.
    {
        const s = makeSession();
        const v = Physics.validate(s, drop(0, 1_000_500, 280));
        assert(!v.ok, 'expected reject on width 280 when expected 220');
        console.log(`${TAG} wrong width rejected: ${v.reason}`);
    }

    // Block 0 miss rejected.
    {
        const s = makeSession();
        const v = Physics.validate(s, drop(0, 1_000_500, 220, 'miss'));
        assert(!v.ok, 'expected reject on block-0 miss');
        console.log(`${TAG} block-0 miss rejected: ${v.reason}`);
    }

    // Post-miss drop rejected.
    {
        const s = makeSession();
        s.drops.push(drop(0, 1_000_500, 220, 'miss'));
        s.lastDropAt = 1_000_500;
        const v = Physics.validate(s, drop(1, 1_001_500, 176));
        assert(!v.ok, 'expected reject on drop after miss');
        console.log(`${TAG} post-miss drop rejected: ${v.reason}`);
    }

    // widthFor thresholds.
    assert(Physics.widthFor(10) === 220, 'widthFor(+10%) === 220');
    assert(Physics.widthFor(2) === 176, 'widthFor(+2%) === 176');
    assert(Physics.widthFor(-2) === 132, 'widthFor(-2%) === 132');
    assert(Physics.widthFor(-10) === 88, 'widthFor(-10%) === 88');
    console.log(`${TAG} widthFor thresholds OK`);

    console.log(`${TAG} ALL TESTS PASSED`);
}

main();

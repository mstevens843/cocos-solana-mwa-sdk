/**
 * admin.ts - Part 12 Bundle B.
 *
 * Express mini-router that mounts:
 *   GET /admin/stream    Server-Sent Events - 2s cadence StatsBucket.snapshot()
 *   GET /admin/snapshot  One-shot JSON (for tests + polling clients)
 *
 * Optional auth via `ADMIN_DASHBOARD_TOKEN` env var: if set, clients must
 * pass ?token=<value>. Not set means "open dashboard" (demo mode).
 *
 * Static dashboard HTML/CSS/JS lives in `backend/public/`; server.ts mounts
 * `/admin` with express.static. GET / redirects to /admin for demo convenience.
 */

import { Request, Response, Router } from 'express';

import { StatsBucket } from './stats';

const TAG = '[admin]';
const SSE_TICK_MS = 2_000;

export function adminRouter(): Router {
    const router = Router();

    router.get('/admin/snapshot', (req: Request, res: Response) => {
        if (!checkToken(req, res)) return;
        res.json(StatsBucket.snapshot());
    });

    // Part 13 D: curated public subset for the fees.html marketing page.
    // Intentionally omits server pubkey, session/spectator gauges, reject
    // log, and token-stats mints - just the three numbers judges care about.
    router.get('/fees/snapshot', (_req: Request, res: Response) => {
        const snap = StatsBucket.snapshot();
        res.json({
            rakeAccruedToday: snap.rakeAccruedToday,
            rakeAccruedThisWeek: snap.rakeAccruedThisWeek,
            rakeAccruedAllTime: snap.rakeAccruedAllTime,
            totalMatchesWitnessed: snap.totalMatchesWitnessed,
        });
    });

    router.get('/admin/stream', (req: Request, res: Response) => {
        if (!checkToken(req, res)) return;
        res.set({
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            'connection': 'keep-alive',
            // Helps proxies not buffer SSE (Railway in particular).
            'x-accel-buffering': 'no',
        });
        res.flushHeaders?.();

        // Initial snapshot immediately so the dashboard isn't blank for 2s.
        write(res, StatsBucket.snapshot());
        const timer = setInterval(() => {
            try {
                write(res, StatsBucket.snapshot());
            } catch (e) {
                // Client disconnected - clean up.
                clearInterval(timer);
            }
        }, SSE_TICK_MS);

        req.on('close', () => {
            clearInterval(timer);
            console.log(`${TAG} /admin/stream | CLIENT_DISCONNECT`);
        });
    });

    return router;
}

function write(res: Response, data: unknown): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function checkToken(req: Request, res: Response): boolean {
    const required = process.env.ADMIN_DASHBOARD_TOKEN?.trim();
    if (!required) return true; // demo mode - no gate
    const provided = (req.query.token as string | undefined)?.trim();
    if (!provided || provided !== required) {
        res.status(401).json({ error: 'unauthorized - pass ?token=<ADMIN_DASHBOARD_TOKEN>' });
        return false;
    }
    return true;
}

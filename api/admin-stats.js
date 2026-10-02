import { verifyIdToken } from './_lib/verifyAuth.js';
import { adminAuth, adminDb, SERVICE_ACCOUNT_MISSING } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { buildSummary, mergeSeries, storedSeries } from './_lib/statsSummary.js';
import { backfillCreatedAt } from './_lib/createdAtBackfill.js';
import { isAdmin } from '../src/lib/admins.js';
import { STATS_CACHE_MS } from '../src/lib/statsConstants.js';

// Owner-only. GET -> the stats summary (totals only). POST {action:
// 'backfill'} -> fills users.createdAt for accounts that predate it.
//
// Needs FIREBASE_SERVICE_ACCOUNT in Vercel (the Admin SDK reads Firestore past
// the rules); without it this answers 503 with that message instead of
// crashing. The caller must hold a valid Firebase ID token AND a verified
// email that is on the admin list; everything else is 401 / 403 here, on the
// server -- the page's own admin check is only for show.

let cache = null; // { at, value }
export function _resetStatsCache() {
  cache = null;
}

async function handler(req, res) {
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (!account.emailVerified || !isAdmin(account.email)) {
    res.status(403).json({ error: 'Not allowed.' });
    return;
  }

  try {
    const db = adminDb();
    if (req.method === 'POST') {
      if ((req.body || {}).action !== 'backfill') {
        res.status(400).json({ error: 'Unknown action.' });
        return;
      }
      res.status(200).json(await backfillCreatedAt(db, await adminAuth()));
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const now = Date.now();
    if (!cache || now - cache.at >= STATS_CACHE_MS) {
      const summary = await buildSummary(db, now);
      const { points, days } = await storedSeries(db);
      summary.study.series = mergeSeries(summary.study.series, points);
      summary.study.storedDays = days;
      cache = { at: now, value: summary };
    }
    res.status(200).json(cache.value);
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes(SERVICE_ACCOUNT_MISSING)) {
      res.status(503).json({ error: 'FIREBASE_SERVICE_ACCOUNT is not set in Vercel, so the stats cannot be read yet.' });
      return;
    }
    console.error('admin-stats failed:', msg);
    // Safe to show: only a verified admin reaches this line (401/403 above).
    res.status(500).json({ error: `Could not build the stats: ${msg}` });
  }
}

export default withCors(handler);

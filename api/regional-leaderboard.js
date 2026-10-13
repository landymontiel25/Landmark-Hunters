import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { toMs } from './_lib/time.js';
import { isFirestoreId } from './_lib/tipsServer.js';
import { canonicalRegionId } from '../src/data/regions.js';
import { periodKeysAt } from '../src/lib/periods.js';

// The Profile tab's regional leaderboard: points earned checking in within
// one region this week, month or year. It used to read every check-in in
// the region from the phone; since Phase 2 a phone may read only its own,
// friends' and public profiles' check-ins, so the server adds them up and
// returns only what the board shows (name and points), as the global board
// (leaderboard_entries) already does.
//   GET ?region=&period=weekly|monthly|yearly&tz=<getTimezoneOffset()>

const PERIODS = ['weekly', 'monthly', 'yearly'];
const TOP_N = 100;

export function regionalBoard(rows, { period, nowMs = Date.now(), offsetMin = 0, topN = TOP_N }) {
  const key = periodKeysAt(nowMs, offsetMin)[period];
  const totals = new Map();
  for (const x of rows) {
    const at = toMs(x.createdAt);
    if (at == null || periodKeysAt(at, offsetMin)[period] !== key) continue;
    const cur = totals.get(x.userId) || { id: x.userId, userId: x.userId, userName: x.userName || 'Explorer', points: 0 };
    cur.points += Number(x.points) || 0;
    if (x.userName) cur.userName = x.userName;
    totals.set(x.userId, cur);
  }
  return [...totals.values()].sort((a, b) => b.points - a.points).slice(0, topN);
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return res.status(401).json({ error: 'Sign in first.' });
  if (isRateLimited(req, 'regional-leaderboard', { limit: 120, windowMs: 60 * 60 * 1000, id: account.uid })) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  const region = String(req.query?.region || '');
  const period = String(req.query?.period || '');
  const tz = Number(req.query?.tz);
  if (!isFirestoreId(region) || !PERIODS.includes(period)) return res.status(400).json({ error: 'region and period are required.' });
  const offsetMin = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0;
  try {
    const snap = await adminDb().collection('checkins').where('region', '==', canonicalRegionId(region)).get();
    const rows = snap.docs.map((d) => d.data()).filter((x) => x.ratingOnly !== true && x.visited !== false);
    res.setHeader?.('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ entries: regionalBoard(rows, { period, offsetMin }) });
  } catch (e) {
    console.error('regional-leaderboard failed', e?.message || e);
    return res.status(500).json({ error: 'Could not load the leaderboard.' });
  }
}

export default withCors(handler);

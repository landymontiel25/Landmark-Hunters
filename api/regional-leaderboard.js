import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { toMs } from './_lib/time.js';
import { blockedBetween, isFirestoreId } from './_lib/tipsServer.js';
import { canonicalRegionId, REGION_ALIASES } from '../src/data/regions.js';
import { isRealCheckin } from '../src/lib/realCheckin.js';
import { periodKeysAt, periodKeysInZone } from '../src/lib/periods.js';

// The Profile tab's regional leaderboard: points earned checking in within
// one region this week, month or year. It used to read every check-in in
// the region from the phone; since Phase 2 a phone may read only its own,
// friends' and public profiles' check-ins, so the server adds them up and
// returns only what the board shows (name and points), and only for people
// this viewer may see under the same rule (themself, friends, public
// profiles; no block either way), with points this period.
//   GET ?region=&period=weekly|monthly|yearly&tz=<getTimezoneOffset()>&zone=<IANA zone>

const PERIODS = ['weekly', 'monthly', 'yearly'];
const TOP_N = 100;
// How far back a period can start, with a day to spare for time zones.
const LOOKBACK_DAYS = { weekly: 9, monthly: 33, yearly: 367 };

// A zone this server's Intl knows; an unknown one falls back to the offset.
function knownZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}


// rows: check-ins in the region. canSee(uid): may this viewer see that
// person (themself, a friend, or a public profile, and no block either way).
// Only people with points this period are on the board: a 0-point row would
// only say "was in this region".
export function regionalBoard(rows, { period, nowMs = Date.now(), offsetMin = 0, zone = null, topN = TOP_N, canSee }) {
  // Required: a board without it would show people the viewer may not see.
  if (typeof canSee !== 'function') throw new Error('regionalBoard needs canSee');
  const keysAt = (ms) => (zone ? periodKeysInZone(ms, zone) : periodKeysAt(ms, offsetMin));
  const key = keysAt(nowMs)[period];
  const totals = new Map();
  for (const x of rows) {
    if (!isRealCheckin(x) || !canSee(x.userId)) continue;
    const at = toMs(x.createdAt);
    if (at == null || keysAt(at)[period] !== key) continue;
    const cur = totals.get(x.userId) || { id: x.userId, userId: x.userId, userName: x.userName || 'Explorer', points: 0 };
    cur.points += Number(x.points) || 0;
    if (x.userName) cur.userName = x.userName;
    totals.set(x.userId, cur);
  }
  return [...totals.values()].filter((e) => e.points > 0).sort((a, b) => b.points - a.points).slice(0, topN);
}

// Who this viewer may see among `uids`: the same people the check-in rules
// let them read (checkinOwnerVisible), minus a block either way.
export async function visibleOwners(db, viewerUid, uids) {
  const others = [...new Set(uids)].filter((u) => u && u !== viewerUid);
  const out = new Set([viewerUid]);
  if (!others.length) return out;
  const [users, edges, blocked] = await Promise.all([
    db.getAll(...others.map((u) => db.collection('users').doc(u))),
    db.getAll(...others.map((u) => db.collection('friend_edges').doc(`${viewerUid}_${u}`))),
    blockedBetween(db, viewerUid),
  ]);
  others.forEach((u, i) => {
    if (blocked.has(u)) return;
    if (edges[i].exists || users[i].data()?.public === true) out.add(u);
  });
  return out;
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
  const zoneParam = String(req.query?.zone || '');
  const zone = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zoneParam) && knownZone(zoneParam) ? zoneParam : null;
  try {
    const db = adminDb();
    // The region and any old id folded into it, from a little before the
    // period could start (index: region + createdAt), only the fields the
    // board uses; paid rows only.
    const canonical = canonicalRegionId(region);
    const ids = [canonical, ...Object.keys(REGION_ALIASES).filter((a) => REGION_ALIASES[a] === canonical)];
    const snap = await db
      .collection('checkins')
      .where('region', 'in', ids)
      .where('createdAt', '>=', new Date(Date.now() - LOOKBACK_DAYS[period] * 864e5))
      .select('userId', 'userName', 'points', 'createdAt', 'ratingOnly', 'visited')
      .get();
    const rows = snap.docs.map((d) => d.data()).filter((x) => (Number(x.points) || 0) > 0);
    const visible = await visibleOwners(db, account.uid, rows.map((x) => x.userId));
    res.setHeader?.('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ entries: regionalBoard(rows, { period, offsetMin, zone, canSee: (u) => visible.has(u) }) });
  } catch (e) {
    console.error('regional-leaderboard failed', e?.message || e);
    return res.status(500).json({ error: 'Could not load the leaderboard.' });
  }
}

export default withCors(handler);

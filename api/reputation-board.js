import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { blockedBetween, send } from './_lib/tipsServer.js';
import { canonicalRegionId, getRegion } from '../src/data/regions.js';

// "Trusted in {city}" (docs/discovery-network-plan.md, Phase 4): the
// city's discoverers ranked by local reputation, with their level. Names
// and levels only: points stay on the server (reputation_scores).
//   GET ?region=philly
// Returns { entries: [{ uid, name, level }] }, top 50, minus anyone on the
// other side of a block.

export const BOARD_SIZE = 50;

export async function reputationBoard(db, viewerUid, region, { size = BOARD_SIZE } = {}) {
  const field = `byRegion.${region}.score`;
  const [snap, blocked] = await Promise.all([db.collection('reputation_scores').where(field, '>', 0).orderBy(field, 'desc').limit(size + 20).get(), blockedBetween(db, viewerUid)]);
  const rows = snap.docs.filter((d) => !blocked.has(d.id)).slice(0, size);
  if (!rows.length) return [];
  const [pubs, users] = await Promise.all([db.getAll(...rows.map((d) => db.collection('reputation').doc(d.id))), db.getAll(...rows.map((d) => db.collection('users').doc(d.id)))]);
  return rows
    .map((d, i) => {
      const u = users[i]?.exists ? users[i].data() : null;
      if (!u) return null; // a deleted account
      // The username, the name tips already show; never a display name (it
      // can be a real name).
      return { uid: d.id, name: u.username || 'Explorer', level: pubs[i]?.exists ? pubs[i].data()?.levels?.[region] || null : null };
    })
    .filter(Boolean);
}

async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  if (isRateLimited(req, 'reputation-board', { limit: 120, windowMs: 60 * 60 * 1000, id: account.uid })) return send(res, 429, { error: 'Too many requests. Try again later.' });
  const region = canonicalRegionId(String(req.query?.region || ''));
  if (!getRegion(region)) return send(res, 400, { error: 'region is required.' });
  try {
    const entries = await reputationBoard(adminDb(), account.uid, region);
    res.setHeader?.('Cache-Control', 'private, max-age=300');
    return send(res, 200, { entries });
  } catch (e) {
    console.error('reputation-board failed', e?.message || e);
    return send(res, 500, { error: 'Could not load the board.' });
  }
}

export default withCors(handler);

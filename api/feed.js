import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { send } from './_lib/tipsServer.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { loadServerModels } from './_lib/maprServerModels.js';
import { readDensity } from './_lib/communityDensity.js';
import { canonicalLandmarkId, canonicalRegionId, getLandmark, getRegion } from '../src/data/regions.js';
import { COMMUNITY_REGIONS } from '../src/lib/community.js';
import { rankPlaces } from '../src/lib/maprRank/surfaces.js';
import { finderWhy } from '../src/lib/communityLabels.js';
import { composeFeed, FEED_SIZE } from '../src/lib/feed.js';

// The feed (docs/discovery-network-plan.md, Phase 6), for one launch city.
//   GET ?region=philly            the feed (30 items) and whether the city is open
//   GET ?gate=1                   which launch cities are past the density gate
// Tips come from computeCommunity (live, verified, not yours, no block
// either way), one per place, ordered by Mapr's shared pipeline
// (rankPlaces: taste, kind of place, the community lift); every 6th item is
// one of Mapr's own picks. Places you rated are left out. Never a weight,
// ramp or score.

const TIERS = new Set(['highly-recommend', 'worth-trying', 'probably-skip']);

export async function buildFeed(db, uid, region, { now = Date.now(), models = null } = {}) {
  const [userSnap, reviewsSnap] = await Promise.all([db.collection('users').doc(uid).get(), db.collection('reviews').where('userId', '==', uid).get()]);
  const profile = userSnap.exists ? userSnap.data() : null;
  const myReviews = {};
  for (const d of reviewsSnap.docs) {
    const r = d.data();
    if (r.landmarkId && TIERS.has(r.ratingTier)) myReviews[canonicalLandmarkId(r.landmarkId, r.region ? canonicalRegionId(r.region) : undefined)] = { landmarkId: r.landmarkId, region: r.region || null, ratingTier: r.ratingTier };
  }
  const m = models || (await loadServerModels({ uid, regions: [region], now, db, communityText: true }));
  const places = m?.community?.[region]?.places || {};
  const catalog = (getRegion(region)?.landmarks || []).map((l) => ({ ...l, regionId: region }));
  const tipped = Object.keys(places)
    .map((id) => getLandmark(region, id))
    .filter((l) => l && !myReviews[l.id])
    .map((l) => ({ ...l, regionId: region }));
  const rankedTips = rankPlaces({ places: tipped, uid, profile, myReviews, models: m, now }).ranked;
  const tipIds = new Set(tipped.map((l) => l.id));
  const rankedMapr = rankPlaces({ places: catalog.filter((l) => !tipIds.has(l.id) && !myReviews[l.id]), uid, profile, myReviews, models: m, now }).ranked.slice(0, FEED_SIZE);
  const tipItems = rankedTips.map((p) => {
    const c = places[p.id];
    return { key: `${region}/${p.id}`, finderUid: c.finder?.uid || null, followed: c.finder?.relation === 'follow', place: p, c };
  });
  const maprItems = rankedMapr.map((p) => ({ key: `${region}/${p.id}`, place: p }));
  return composeFeed(tipItems, maprItems).map((x) => {
    const place = { id: x.place.id, region, name: x.place.name, categories: x.place.categories || [], telemetry: x.place.telemetry || null };
    if (x.kind === 'mapr') return { kind: 'mapr', key: x.key, place, reason: "Mapr thinks you'd like" };
    const f = x.c.finder || {};
    return { kind: 'tip', key: x.key, place, tip: { authorUid: f.uid || null, authorName: f.name || 'A verified visitor', text: x.c.tip || '', why: finderWhy(f) } };
  });
}

async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  if (isRateLimited(req, 'feed', { limit: 120, windowMs: 60 * 60 * 1000, id: account.uid })) return send(res, 429, { error: 'Too many requests. Try again later.' });
  try {
    const db = adminDb();
    if (req.query?.gate) {
      const density = await readDensity(db, COMMUNITY_REGIONS);
      res.setHeader?.('Cache-Control', 'private, max-age=600');
      return send(res, 200, { open: Object.fromEntries(Object.entries(density).map(([r, d]) => [r, d.gateOpen === true])) });
    }
    const region = canonicalRegionId(String(req.query?.region || ''));
    if (!COMMUNITY_REGIONS.includes(region)) return send(res, 400, { error: 'The feed is only in launch cities.' });
    const gateOpen = (await readDensity(db, [region]))[region]?.gateOpen === true;
    if (!gateOpen) return send(res, 200, { gateOpen: false, items: [] });
    await ensureServerPlacePacks().catch(() => {});
    const items = await buildFeed(db, account.uid, region);
    res.setHeader?.('Cache-Control', 'private, max-age=300');
    return send(res, 200, { gateOpen: true, items });
  } catch (e) {
    console.error('feed failed', e?.message || e);
    return send(res, 500, { error: 'Could not load the feed.' });
  }
}

export default withCors(handler);

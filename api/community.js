import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { withCors } from './_lib/cors.js';
import { send } from './_lib/tipsServer.js';
import { communityRegionsOf, computeCommunity } from './_lib/communityServer.js';

// Community picks for the signed-in viewer (docs/discovery-network-plan.md,
// Phase 3), read by the phone's Mapr loader (src/lib/maprRank/modelStore.js)
// so every on-device Mapr surface applies the same lift.
//   GET ?regions=philly,villanova
// Returns { regions: { [region]: { gateOpen, places: { [id]: { lift,
// likeYou, finders, finder: { uid, name, relation, match } } } } } }, only
// for launch regions (COMMUNITY_REGIONS). Never the ramp, density numbers,
// anyone's weight or a taste match number.

async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  if (isRateLimited(req, 'community', { limit: 120, windowMs: 60 * 60 * 1000, id: account.uid })) {
    return send(res, 429, { error: 'Too many requests. Try again later.' });
  }
  const regions = communityRegionsOf(String(req.query?.regions || '').split(',').slice(0, 10));
  if (!regions.length) return send(res, 200, { regions: {} });
  try {
    const out = await computeCommunity(adminDb(), account.uid, regions);
    res.setHeader?.('Cache-Control', 'private, max-age=300');
    return send(res, 200, { regions: out });
  } catch (e) {
    console.error('community failed', e?.message || e);
    return send(res, 500, { error: 'Could not load community picks.' });
  }
}

export default withCors(handler);

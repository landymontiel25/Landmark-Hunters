import { adminDb } from './firebaseAdmin.js';

// Admin-SDK duplicate of pairStreaks.js's computeCompatibility -- same
// reasoning as close-streak-day.js's own isRealCheckin duplicate: that
// module imports the client Firebase SDK, which crashes a serverless
// bundle (see _lib/streakDay.js's note). Keep this scoring logic in sync
// with pairStreaks.js's copy if that one ever changes.
const TASTE = { 'highly-recommend': 'love', 'worth-trying': 'unsure', 'probably-skip': 'hate' };
const MATCH_POINTS = {
  'love-love': 1, 'unsure-unsure': 1, 'hate-hate': 1,
  'love-unsure': 0.5, 'unsure-love': 0.5, 'unsure-hate': 0.5, 'hate-unsure': 0.5,
  'love-hate': 0, 'hate-love': 0,
};
const COMPATIBILITY_MIN_SHARED = 10;
const COMPATIBILITY_WINDOW = 50;

export async function computeCompatibilityServer(myUid, partnerUid) {
  const db = adminDb();
  const [mineSnap, theirsSnap] = await Promise.all([
    db.collection('reviews').where('userId', '==', myUid).get(),
    db.collection('reviews').where('userId', '==', partnerUid).get(),
  ]);
  const mineMap = new Map(
    mineSnap.docs.map((d) => d.data()).filter((r) => r.ratingTier && r.landmarkId).map((r) => [r.landmarkId, r])
  );
  const theirsMap = new Map(
    theirsSnap.docs.map((d) => d.data()).filter((r) => r.ratingTier && r.landmarkId).map((r) => [r.landmarkId, r])
  );
  const sharedIds = [...mineMap.keys()].filter((id) => theirsMap.has(id));
  if (sharedIds.length < COMPATIBILITY_MIN_SHARED) return { sharedCount: sharedIds.length, score: null };
  const scored = sharedIds
    .map((id) => {
      const a = mineMap.get(id);
      const b = theirsMap.get(id);
      const atMs = Math.max(a.updatedAt?.seconds || 0, b.updatedAt?.seconds || 0);
      const points = MATCH_POINTS[`${TASTE[a.ratingTier]}-${TASTE[b.ratingTier]}`] ?? 0.5;
      return { atMs, points };
    })
    .sort((x, y) => y.atMs - x.atMs)
    .slice(0, COMPATIBILITY_WINDOW);
  const score = scored.reduce((sum, x) => sum + x.points, 0) / scored.length;
  return { sharedCount: sharedIds.length, score };
}

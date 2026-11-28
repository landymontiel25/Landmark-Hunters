import { verifyIdToken } from './verifyAuth.js';
import { pointsAppCheckGate } from './appCheck.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { awardLeaderboardPointsServer, cleanUserName } from './leaderboardPoints.js';
import { photoShowsPlace } from './photoCheck.js';
import { guardPhoto, isOwnPlacePhoto } from './photoGuard.js';
import { userDayKey } from './streakClock.js';
import { takeDailyQuota } from './usageQuota.js';
import { withCors } from './cors.js';
import { placeInfo, expectedPhoto } from './photoBonus.js';
import { isVerifiedCheckin } from '../../src/lib/realCheckin.js';

// "I'll take another picture" (owner, 2026-11-28): a place with no public
// picture asks the first person who adds a photo to share it. When they say
// no (a selfie, say), they can take another picture of the place instead and
// earn +10 points once that picture is the place's public one. Decided here,
// never on the phone: the photo must be the caller's own photo of the place,
// already saved as the place's public picture (community_photos, which the
// rules only let its owner create), taken on a verified visit, and the photo
// check (photoCheck.js) must say it shows the place. Once per place.
export const COMMUNITY_PHOTO_POINTS = 10;

export async function awardCommunityPhotoBonus(db, uid, { regionId, landmarkId, photoUrl }, { dayId = null, boards = true, check = photoShowsPlace, guard = guardPhoto, quota = takeDailyQuota } = {}) {
  const paidRef = db.collection('community_photo_bonuses').doc(`${uid}_${landmarkId}`);
  if ((await paidRef.get()).exists) return { awarded: 0, reason: 'already' };
  if (!isOwnPlacePhoto(photoUrl, uid, landmarkId)) return { awarded: 0, reason: 'bad-photo' };

  // The picture must be this person's, already the place's public one.
  const shared = await db.collection('community_photos').doc(`${regionId}__${landmarkId}`).get();
  if (!shared.exists || shared.data().photoUid !== uid || shared.data().url !== photoUrl) return { awarded: 0, reason: 'not-shared' };

  // A visit the server verified (any check-in doc for this place).
  const visits = await db.collection('checkins').where('userId', '==', uid).where('landmarkId', '==', landmarkId).get();
  const verified = visits.docs.map((d) => d.data()).find((c) => isVerifiedCheckin(c));
  if (!verified) return { awarded: 0, reason: 'no-checkin' };

  const g = await guard(db, photoUrl, { uid, landmarkId });
  if (!g.ok) return { awarded: 0, reason: 'photo-not-of-place', why: g.reason === 'duplicate-photo' ? 'This photo was already used, by someone else or for another place.' : "This photo couldn't be read." };
  const q = await quota('ai-photo', { uid });
  if (!q.ok) return { awarded: 0, reason: 'check-limit' };

  const place = placeInfo(landmarkId, verified);
  const v = await check({ url: photoUrl, place });
  if (v.failed || v.reason === 'check failed') return { awarded: 0, reason: 'check-failed' };
  if (!v.ok) return { awarded: 0, reason: 'photo-not-of-place', expected: expectedPhoto(place), why: v.reason || null };

  // In a transaction so two quick calls can't both pay.
  const outcome = await db.runTransaction(async (t) => {
    if ((await t.get(paidRef)).exists) return { awarded: 0, reason: 'already' };
    t.create(paidRef, { userId: uid, regionId, landmarkId, dayId, points: COMMUNITY_PHOTO_POINTS, photo: v.reason, createdAt: FieldValue.serverTimestamp() });
    t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(COMMUNITY_PHOTO_POINTS) }, { merge: true });
    return { awarded: COMMUNITY_PHOTO_POINTS, userName: cleanUserName(verified.userName) };
  });
  if (outcome.awarded && boards && dayId) {
    await awardLeaderboardPointsServer(db, uid, outcome.userName, outcome.awarded, dayId).catch((e) => console.error('[community-photo-bonus] leaderboard award failed', e));
  }
  return { awarded: outcome.awarded, reason: outcome.reason || null };
}

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id);

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await pointsAppCheckGate(req, res, 'community-photo-bonus'))) return;
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (isRateLimited(req, 'community-photo-bonus', { limit: 20, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { regionId, landmarkId, photoUrl } = req.body || {};
  if (!validId(regionId) || !validId(landmarkId) || typeof photoUrl !== 'string' || photoUrl.length > 1500) {
    res.status(400).json({ error: 'regionId, landmarkId and photoUrl are required.' });
    return;
  }
  try {
    const db = adminDb();
    const dayId = await userDayKey(db, account.uid);
    const out = await awardCommunityPhotoBonus(db, account.uid, { regionId, landmarkId, photoUrl }, { dayId });
    res.status(200).json({ ok: true, awarded: out.awarded, reason: out.reason || null, expected: out.expected || null, why: out.why || null });
  } catch (e) {
    console.error('[community-photo-bonus] failed', e);
    res.status(500).json({ error: 'Could not check the photo.' });
  }
}

export default withCors(handler);

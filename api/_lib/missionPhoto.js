import { FieldValue } from 'firebase-admin/firestore';
import { cleanUserName, leaderboardPointWrites } from './leaderboardPoints.js';
import { photoMatchesMission, isStoragePhotoUrl } from './photoCheck.js';
import { canonicalRegionId, getLandmark, getRegion } from '../../src/data/regions.js';
import { isVerifiedCheckin } from '../../src/lib/realCheckin.js';
import { MISSION_POINTS } from './missionAnswer.js';

// Photo missions (owner, 2026-11-22). Until now the phone only checked where
// and when a mission photo was taken, so any photo passed (a picture of the
// floor did). Now the photo also has to show what the mission asks for, a
// Claude check of the photo against the mission text (photoCheck.js), and
// only then does it pay +MISSION_POINTS, once per account and place. A
// turned-down photo pays nothing and can be retaken.
//
// The photo must be one of the traveler's own check-in photos at this place
// (uploaded by the app first), so nobody can send in someone else's.

const photosOf = (d) => [...(Array.isArray(d?.photoURLs) ? d.photoURLs : []), ...(d?.photoURL ? [d.photoURL] : [])];

// Pure: whether this photo can be checked at all, before asking Claude.
export function missionPhotoPrecheck({ mission, checkins, photoURL, previous }) {
  if (mission?.type !== 'photo') return { awarded: 0, reason: 'no-photo-mission' };
  if (!checkins.some((c) => isVerifiedCheckin(c))) return { awarded: 0, reason: 'no-checkin' };
  if (previous?.passed) return { awarded: 0, reason: 'already', passed: true };
  if (!isStoragePhotoUrl(photoURL) || !checkins.some((c) => photosOf(c).includes(photoURL))) return { awarded: 0, reason: 'not-your-photo' };
  return null;
}

export async function checkMissionPhoto(db, uid, regionId, landmarkId, photoURL, dayId, { check = photoMatchesMission } = {}) {
  const region = canonicalRegionId(regionId);
  const lm = getLandmark(region, landmarkId);
  const mission = lm?.mission;
  const visits = await db.collection('checkins').where('userId', '==', uid).where('landmarkId', '==', landmarkId).get();
  const checkins = visits.docs.map((d) => d.data());
  const ref = db.collection('mission_photos').doc(`${uid}_${landmarkId}`);
  const prevSnap = await ref.get();
  const pre = missionPhotoPrecheck({ mission, checkins, photoURL, previous: prevSnap.exists ? prevSnap.data() : null });
  if (pre) return pre;

  const verdict = await check({
    url: photoURL,
    place: { name: lm.name, city: getRegion(region)?.name || '', description: lm.whatItIs || lm.summary || '' },
    mission: mission.text,
  });
  if (verdict.failed) return { awarded: 0, reason: 'check-failed' };
  if (!verdict.ok) {
    // Kept for the owner: what was turned down and why. Never pays.
    await ref.set({ userId: uid, regionId: region, landmarkId, passed: false, tries: FieldValue.increment(1), lastPhoto: photoURL, lastWhy: verdict.reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { awarded: 0, reason: 'photo-not-mission', passed: false, why: verdict.reason, mission: mission.text };
  }

  // Pays once, in a transaction so two quick tries can't both count.
  return db.runTransaction(async (t) => {
    const prev = await t.get(ref);
    if (prev.exists && prev.data().passed) return { awarded: 0, reason: 'already', passed: true };
    t.set(ref, { userId: uid, regionId: region, landmarkId, passed: true, photo: photoURL, why: verdict.reason, points: MISSION_POINTS, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(MISSION_POINTS) }, { merge: true });
    const userName = cleanUserName(checkins.find((c) => c.userName)?.userName);
    for (const [r, data] of leaderboardPointWrites(db, uid, userName, MISSION_POINTS, dayId)) t.set(r, data, { merge: true });
    return { awarded: MISSION_POINTS, reason: null, passed: true, why: verdict.reason };
  });
}

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { makeSetId } from './setId';

// Tips shown under "From people who went" (Phase 1), one recommendation_log
// row per tip with surface 'landmark-page' (allowed by firestore.rules). They
// are not Mapr picks: the nightly stats keep them apart (statsData.js
// tipImpressions) and the taste score skips them (no `predicted`).
// Best-effort: a failed write never shows.
export async function logTipImpressions({ uid, landmarkId, region, tipIds = [], nowMs = Date.now() }) {
  if (!db || !uid || !landmarkId || !tipIds.length) return;
  const setId = makeSetId(uid);
  await Promise.all(
    tipIds.slice(0, 50).map((tipId, i) =>
      addDoc(collection(db, 'recommendation_log'), {
        userId: uid,
        landmarkId,
        region: region || null,
        pickType: null,
        surface: 'landmark-page',
        tipId,
        setId,
        rank: i + 1,
        shownAt: nowMs,
        isTest: false,
        createdAt: serverTimestamp(),
      }).catch(() => {})
    )
  );
}

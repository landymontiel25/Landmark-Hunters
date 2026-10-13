import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { makeSetId } from './setId';

// Tips shown under "From people who went" (Phase 1): one recommendation_log
// row per page view, surface 'landmark-page' (allowed by firestore.rules),
// with the shown tips in order, and at most one a day per place on this
// device. Not Mapr picks: the nightly stats keep them apart (statsData.js
// tipImpressions) and the taste score skips them (no `predicted`). The
// server's own tip_views record who saw what for the "went" count.
// Best-effort: a failed write never shows.
const KEY = 'lh-tip-impressions:v1';
// The device's own date, so "once a day" follows the person's day.
const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const readSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};

export async function logTipImpressions({ uid, landmarkId, region, tipIds = [], nowMs = Date.now() }) {
  if (!db || !uid || !landmarkId || !tipIds.length) return;
  const id = `${uid}|${region}|${landmarkId}`;
  const today = localDay(nowMs);
  if (readSeen()[id] === today) return;
  try {
    await addDoc(collection(db, 'recommendation_log'), {
      userId: uid,
      landmarkId,
      region: region || null,
      pickType: null,
      surface: 'landmark-page',
      tipIds: tipIds.slice(0, 50),
      setId: makeSetId(uid, nowMs),
      rank: 1,
      shownAt: nowMs,
      isTest: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    return; // not marked: the next view tries again
  }
  try {
    const kept = Object.fromEntries(Object.entries(readSeen()).filter(([, d]) => d === today));
    localStorage.setItem(KEY, JSON.stringify({ ...kept, [id]: today }));
  } catch {
    /* storage blocked: may log again today */
  }
}

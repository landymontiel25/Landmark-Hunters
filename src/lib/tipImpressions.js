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
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function seenToday(id, nowMs) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    const today = day(nowMs);
    if (all[id] === today) return true;
    const kept = Object.fromEntries(Object.entries(all).filter(([, d]) => d === today));
    kept[id] = today;
    localStorage.setItem(KEY, JSON.stringify(kept));
    return false;
  } catch {
    return false;
  }
}

export async function logTipImpressions({ uid, landmarkId, region, tipIds = [], nowMs = Date.now() }) {
  if (!db || !uid || !landmarkId || !tipIds.length) return;
  if (seenToday(`${uid}|${region}|${landmarkId}`, nowMs)) return;
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
  }).catch(() => {});
}

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { TIP_CHECKIN_MAX_AGE_DAYS } from './tips';

// The check-in a new tip at this place can rest on: your newest real visit
// the server verified (presence written by api/verify-checkin.js) in the
// last 30 days. Null when there is none, so the app doesn't offer a tip it
// would refuse.
const DAY_MS = 24 * 60 * 60 * 1000;
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t?.seconds === 'number' ? t.seconds * 1000 : null);

export function pickTipCheckin(checkins, nowMs = Date.now()) {
  let best = null;
  for (const c of checkins || []) {
    if (!c || c.ratingOnly === true || c.visited === false || c.presence?.verified !== true) continue;
    const at = ms(c.createdAt);
    if (at == null || nowMs - at > TIP_CHECKIN_MAX_AGE_DAYS * DAY_MS) continue;
    if (!best || at > best.at) best = { id: c.id, at };
  }
  return best;
}

export async function findTipCheckin(uid, landmarkId, { nowMs = Date.now() } = {}) {
  if (!db || !uid || !landmarkId) return null;
  try {
    const snap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', uid), where('landmarkId', '==', landmarkId)));
    return pickTipCheckin(snap.docs.map((d) => ({ id: d.id, ...d.data() })), nowMs);
  } catch {
    return null;
  }
}

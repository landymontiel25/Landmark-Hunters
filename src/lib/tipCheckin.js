import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { tipCheckinProblem, tipIdFor } from './tips';

// The check-in a new tip at this place can rest on: your newest real visit
// the server verified (presence written by api/verify-checkin.js) in the
// last 30 days. Null when there is none, so the app doesn't offer a tip it
// would refuse.
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t?.seconds === 'number' ? t.seconds * 1000 : null);

export function pickTipCheckin(checkins, nowMs = Date.now(), uid = null) {
  let best = null;
  for (const c of checkins || []) {
    if (!c) continue;
    const at = ms(c.createdAt);
    // The same rule the server applies (src/lib/tips.js).
    if (tipCheckinProblem({ ...c, createdAtMs: at }, uid ?? c.userId, nowMs)) continue;
    if (!best || at > best.at) best = { id: c.id, at };
  }
  return best;
}

// Do you already have a tip here (any status)? Your own tip doc is the one
// tip a client may read. Null when it can't tell.
export async function hasMyTip(uid, landmarkId) {
  if (!db || !uid || !landmarkId) return null;
  try {
    return (await getDoc(doc(db, 'tips', tipIdFor(uid, landmarkId)))).exists();
  } catch {
    return null;
  }
}

export async function findTipCheckin(uid, landmarkId, { nowMs = Date.now() } = {}) {
  if (!db || !uid || !landmarkId) return null;
  try {
    const snap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', uid), where('landmarkId', '==', landmarkId)));
    return pickTipCheckin(snap.docs.map((d) => ({ id: d.id, ...d.data() })), nowMs, uid);
  } catch {
    return null;
  }
}

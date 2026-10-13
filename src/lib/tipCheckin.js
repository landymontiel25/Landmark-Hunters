import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { tipCheckinProblem, tipIdFor } from './tips';
import { canonicalLandmarkId, legacyLandmarkIds } from '../data/regions';

// The check-in a new tip at this place can rest on: your newest real visit
// the server verified (presence written by api/verify-checkin.js) in the
// last 30 days. Null when there is none, so the app doesn't offer a tip it
// would refuse.
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t?.seconds === 'number' ? t.seconds * 1000 : null);

export function pickTipCheckin(checkins, nowMs, uid) {
  let best = null;
  if (!uid) return null;
  for (const c of checkins || []) {
    if (!c) continue;
    const at = ms(c.createdAt);
    // The same rule the server applies (src/lib/tips.js).
    if (tipCheckinProblem({ ...c, createdAtMs: at }, uid, nowMs)) continue;
    if (!best || at > best.at) best = { id: c.id, at };
  }
  return best;
}

// Do you already have a tip here (any status)? Your own tip doc is the one
// tip a client may read. Null when it can't tell.
// The server files a tip under the place's current id, so look there.
export async function hasMyTip(uid, landmarkId, region) {
  if (!db || !uid || !landmarkId) return null;
  try {
    return (await getDoc(doc(db, 'tips', tipIdFor(uid, canonicalLandmarkId(landmarkId, region))))).exists();
  } catch {
    return null;
  }
}

// Check-ins under the place's current id and any id it had before a rename.
export async function findTipCheckin(uid, landmarkId, region, { nowMs = Date.now() } = {}) {
  if (!db || !uid || !landmarkId) return null;
  try {
    const current = canonicalLandmarkId(landmarkId, region);
    const ids = [...new Set([landmarkId, current, ...legacyLandmarkIds(current, region)])].slice(0, 10);
    const snap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', uid), where('landmarkId', 'in', ids)));
    return pickTipCheckin(snap.docs.map((d) => ({ id: d.id, ...d.data() })), nowMs, uid);
  } catch {
    return null;
  }
}

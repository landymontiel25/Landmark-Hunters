import { doc, addDoc, updateDoc, onSnapshot, collection, query, where, serverTimestamp, runTransaction, increment } from 'firebase/firestore';
import { db, auth } from './firebase';

// In-app notifications -- the part of item i2 this project can actually
// ship right now. Real push (to a lock screen, app closed) needs Firebase
// Cloud Messaging enabled in the Firebase console plus, for iOS, Apple Push
// certificates that require the paid Apple Developer account (item a1,
// not done yet) -- neither is something this session can configure. This
// still gets the useful part in front of people today: a friend's
// submission getting approved shows up the next time they open the app.
// A notice to someone else always says who sent it (fromUid) and counts
// against the sender's 30-an-hour allowance (notify_gates/{uid}, bumped in
// the same transaction; firestore.rules checks both, anti-farming items 8
// and 9). A notice to yourself is a plain write.
export const NOTICE_WINDOW_MS = 60 * 60 * 1000;
export async function notifyUser(
  uid,
  { type, message, landmarkId = null, groupTripId = null, featureRequestId = null, bugReportId = null, maprProjectId = null, regionId = null, fromUid = null }
) {
  const me = auth?.currentUser?.uid || null;
  const data = {
    uid,
    type,
    message,
    landmarkId,
    groupTripId,
    featureRequestId,
    bugReportId,
    ...(maprProjectId ? { maprProjectId } : {}),
    ...(regionId ? { regionId } : {}),
    read: false,
    createdAt: serverTimestamp(),
  };
  if (!me || uid === me) {
    await addDoc(collection(db, 'notifications'), { ...data, ...(fromUid ? { fromUid } : {}) });
    return;
  }
  const gateRef = doc(db, 'notify_gates', me);
  const noticeRef = doc(collection(db, 'notifications'));
  await runTransaction(db, async (tx) => {
    const gate = await tx.get(gateRef);
    const start = gate.exists() ? gate.data().windowStart?.toMillis?.() : null;
    const fresh = !gate.exists() || !Number.isFinite(start) || Date.now() - start >= NOTICE_WINDOW_MS;
    if (fresh) tx.set(gateRef, { windowStart: serverTimestamp(), count: 1, lastAt: serverTimestamp() });
    else tx.update(gateRef, { count: increment(1), lastAt: serverTimestamp() });
    tx.set(noticeRef, { ...data, fromUid: me });
  });
}

// onError (optional) lets a screen tell "couldn't load" apart from "nothing
// here"; without it a failed read still reports an empty list, as before.
export function subscribeMyNotifications(uid, onData, onError) {
  // Single-field query (no composite index needed); sorted client-side,
  // same pattern as getLandmarkReviews/getUserCheckins.
  return onSnapshot(
    query(collection(db, 'notifications'), where('uid', '==', uid)),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      onData(rows.slice(0, 30));
    },
    (err) => (onError ? onError(err) : onData([]))
  );
}

export async function markNotificationRead(id) {
  await updateDoc(doc(db, 'notifications', id), { read: true });
}

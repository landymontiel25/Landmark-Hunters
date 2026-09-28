import { doc, addDoc, updateDoc, onSnapshot, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// In-app notifications -- the part of item i2 this project can actually
// ship right now. Real push (to a lock screen, app closed) needs Firebase
// Cloud Messaging enabled in the Firebase console plus, for iOS, Apple Push
// certificates that require the paid Apple Developer account (item a1,
// not done yet) -- neither is something this session can configure. This
// still gets the useful part in front of people today: a friend's
// submission getting approved shows up the next time they open the app.
export async function notifyUser(
  uid,
  { type, message, landmarkId = null, groupTripId = null, featureRequestId = null, bugReportId = null, maprProjectId = null }
) {
  await addDoc(collection(db, 'notifications'), {
    uid,
    type,
    message,
    landmarkId,
    groupTripId,
    featureRequestId,
    bugReportId,
    ...(maprProjectId ? { maprProjectId } : {}),
    read: false,
    createdAt: serverTimestamp(),
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

import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// The admin's own switches (the admin panel, owner 2026-11-23), in
// admin_settings/{uid}: only that account can read or write it
// (firestore.rules). checkinAnywhere: the "Check-in radius off" switch;
// missing means on.
export function subscribeAdminSettings(uid, onData) {
  if (!db || !uid) return () => {};
  return onSnapshot(
    doc(db, 'admin_settings', uid),
    (snap) => onData({ checkinAnywhere: snap.exists() ? snap.data().checkinAnywhere !== false : true }),
    () => onData({ checkinAnywhere: true })
  );
}

export function setCheckinAnywhere(uid, on) {
  return setDoc(doc(db, 'admin_settings', uid), { checkinAnywhere: !!on, updatedAt: serverTimestamp() });
}

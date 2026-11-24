import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// The admin's own switches (the admin panel, owner 2026-11-23), in
// admin_settings/{uid}: only that account can read or write it
// (firestore.rules), and the server reads it too.
//   adminMode       the master Admin Mode switch; off (or missing) means the
//                   admin is a normal user and nothing in the panel works
//   checkinAnywhere "Check-in radius off": works only with Admin Mode on;
//                   missing means on
export const DEFAULT_ADMIN_SETTINGS = { adminMode: false, checkinAnywhere: true };

export function readAdminSettings(data) {
  return { adminMode: data?.adminMode === true, checkinAnywhere: data?.checkinAnywhere !== false };
}

export function subscribeAdminSettings(uid, onData) {
  if (!db || !uid) return () => {};
  return onSnapshot(
    doc(db, 'admin_settings', uid),
    (snap) => onData(readAdminSettings(snap.exists() ? snap.data() : null)),
    () => onData(DEFAULT_ADMIN_SETTINGS)
  );
}

export function saveAdminSettings(uid, settings) {
  return setDoc(doc(db, 'admin_settings', uid), { adminMode: !!settings.adminMode, checkinAnywhere: !!settings.checkinAnywhere, updatedAt: serverTimestamp() });
}

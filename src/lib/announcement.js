import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// The announcement banner everyone sees at the top of the app (owner,
// 2026-11-23): one message in app_config/announcement, set and cleared
// from the admin panel. An empty message means no banner.
export const ANNOUNCEMENT_MAX = 280;

export function subscribeAnnouncement(onData) {
  if (!db) return () => {};
  return onSnapshot(
    doc(db, 'app_config', 'announcement'),
    (snap) => onData(snap.exists() ? String(snap.data().message || '').trim() : ''),
    () => onData('')
  );
}

export function setAnnouncement(message) {
  const clean = String(message || '').trim().slice(0, ANNOUNCEMENT_MAX);
  return setDoc(doc(db, 'app_config', 'announcement'), { message: clean, updatedAt: serverTimestamp() });
}

export const clearAnnouncement = () => setAnnouncement('');

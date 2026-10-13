import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { ALERT_GROUP_IDS } from './alerts';

// Your switches for discovery alerts (Phase 5), in the owner-only
// users/{uid}/private/main.notificationPrefs. Missing means on.
const ref = (uid) => doc(db, 'users', uid, 'private', 'main');

export async function getAlertPrefs(uid) {
  if (!db || !uid) return {};
  const s = await getDoc(ref(uid));
  const p = s.exists() ? s.data().notificationPrefs : null;
  return p && typeof p === 'object' ? p : {};
}

export async function setAlertPref(uid, group, on) {
  if (!db || !uid || !ALERT_GROUP_IDS.includes(group)) return;
  await setDoc(ref(uid), { notificationPrefs: { [group]: !!on }, updatedAt: serverTimestamp() }, { merge: true });
}

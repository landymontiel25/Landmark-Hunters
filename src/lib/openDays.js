import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

// The daily open record: one tiny doc per user per day the app is opened,
// users/{uid}/open_days/{YYYY-MM-DD} = { userId, date, createdAt }. The date
// is the user's LOCAL day. No location, no device info. It exists so the owner
// can measure retention and sessions (the admin dashboard, admin-dashboard/); firestore.rules
// makes it create-only (a second write for the same day is refused) and
// owner-only, and account deletion removes every one.

export const openDayStorageKey = (uid) => `lh-open-day:${uid}`;

export function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const readLast = (uid) => {
  try {
    return localStorage.getItem(openDayStorageKey(uid));
  } catch {
    return null;
  }
};
const writeLast = (uid, date) => {
  try {
    localStorage.setItem(openDayStorageKey(uid), date);
  } catch {
    /* private mode: the rules still keep it to one per day */
  }
};

// Throttled by device memory: at most one write attempt per day per account.
// Failures are swallowed (and retried on the next open) -- except a refusal
// for a day that already has its doc, which counts as done.
export async function recordOpenDay(uid, now = new Date()) {
  if (!db || !uid) return false;
  const date = localDateKey(now);
  if (readLast(uid) === date) return false;
  try {
    await setDoc(doc(db, 'users', uid, 'open_days', date), { userId: uid, date, createdAt: serverTimestamp() });
    writeLast(uid, date);
    return true;
  } catch (e) {
    if (e?.code === 'permission-denied') writeLast(uid, date);
    return false;
  }
}

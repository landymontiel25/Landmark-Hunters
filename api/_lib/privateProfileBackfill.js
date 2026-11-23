import { FieldValue } from 'firebase-admin/firestore';

// Moves what an old account still keeps on its PUBLIC profile (users/{uid},
// readable by anyone signed in) into the owner-only users/{uid}/private/main
// (anti-farming item 7, owner 2026-11-23). The app does the same for an
// account on its next launch (friends.js migratePrivateProfile); this one
// covers accounts that never open the app again. Run nightly.
export const PRIVATE_PROFILE_FIELDS = ['email', 'homeAddress', 'homeCoords', 'lastKnownLocation', 'pushTokens', 'notificationPrefs'];

// Pure: what to copy into the private doc and what to remove from the public one.
export function splitPrivate(pub) {
  const move = {};
  for (const k of PRIVATE_PROFILE_FIELDS) if (pub?.[k] !== undefined) move[k] = pub[k];
  if (typeof move.email === 'string') move.email = move.email.toLowerCase();
  return Object.keys(move).length ? move : null;
}

export async function backfillPrivateProfiles(db, { limit = 400 } = {}) {
  // One query per field: Firestore returns only docs that have it (orderBy).
  const ids = new Set();
  for (const k of PRIVATE_PROFILE_FIELDS) {
    const snap = await db.collection('users').orderBy(k).limit(limit).select().get().catch(() => null);
    for (const d of snap?.docs || []) ids.add(d.id);
  }
  let moved = 0;
  for (const uid of [...ids].slice(0, limit)) {
    const ref = db.collection('users').doc(uid);
    const done = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const move = snap.exists ? splitPrivate(snap.data()) : null;
      if (!move) return false;
      t.set(ref.collection('private').doc('main'), { ...move, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      t.update(ref, Object.fromEntries(Object.keys(move).map((k) => [k, FieldValue.delete()])));
      return true;
    });
    if (done) moved += 1;
  }
  return { checked: ids.size, moved };
}

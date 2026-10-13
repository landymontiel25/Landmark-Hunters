import { FieldValue } from 'firebase-admin/firestore';

// Nightly check-in upkeep since the Phase 2 read limits (a phone reads only
// its own, friends' and public profiles' check-ins).

// Takes old location numbers off check-ins, `max` a night: the legacy
// distanceMeters / gpsAccuracyMeters some builds wrote, and the distance and
// accuracy on presence version 1 (Phase 0). They stay only in the
// server-only proof. Ordering by a field returns only docs that have it.
export async function scrubCheckinLocation(db, { max = 400 } = {}) {
  const [legacy, presenceV1] = await Promise.all([
    db.collection('checkins').orderBy('distanceMeters').limit(max).get(),
    db.collection('checkins').where('presence.version', '==', 1).limit(max).get(),
  ]);
  const batch = db.batch();
  let n = 0;
  for (const d of legacy.docs) {
    batch.update(d.ref, { distanceMeters: FieldValue.delete(), gpsAccuracyMeters: FieldValue.delete() });
    n++;
  }
  for (const d of presenceV1.docs) {
    if (n >= max) break;
    batch.update(d.ref, { 'presence.distanceMeters': FieldValue.delete(), 'presence.accuracyMeters': FieldValue.delete(), 'presence.version': 2 });
    n++;
  }
  if (n) await batch.commit();
  return n;
}

// leaderboard_entries are public. lastCheckinId proves a payout to the
// rules in the paying write and the app takes it off right after; this
// removes any left behind (old entries, an app that went offline), `max` a
// night, so no entry says where and when someone checked in.
export async function scrubLeaderboardCheckinIds(db, { max = 400 } = {}) {
  const snap = await db.collection('leaderboard_entries').orderBy('lastCheckinId').limit(max).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  for (const d of snap.docs) batch.update(d.ref, { lastCheckinId: FieldValue.delete() });
  await batch.commit();
  return snap.size;
}

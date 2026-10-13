import { FieldValue } from 'firebase-admin/firestore';
import { REGIONS, REGION_ALIASES } from '../../src/data/regions.js';

// Nightly check-in upkeep since the Phase 2 read limits (a phone reads only
// its own, friends' and public profiles' check-ins).

// Fills region_stats (Mapr Picks' cold-start check-in counts) for regions
// that have no backfilled totals yet. A phone did this before Phase 2; it
// can't read other people's check-ins any more, so the server counts them,
// up to `maxRegions` regions a night. Counts real visits only, under the
// region's id and any old id folded into it. A bump that lands between the
// count and the write keeps the larger number per place.
export async function backfillRegionStats(db, { maxRegions = 3 } = {}) {
  const done = new Set((await db.collection('region_stats').select('backfilled').get()).docs.filter((d) => d.data().backfilled === true).map((d) => d.id));
  const todo = REGIONS.map((r) => r.id).filter((id) => !done.has(id)).slice(0, maxRegions);
  let written = 0;
  for (const region of todo) {
    const ids = [region, ...Object.keys(REGION_ALIASES).filter((a) => REGION_ALIASES[a] === region)];
    const snap = await db.collection('checkins').where('region', 'in', ids).select('landmarkId', 'ratingOnly', 'visited').get();
    const counts = {};
    for (const d of snap.docs) {
      const c = d.data();
      if (c.ratingOnly === true || c.visited === false || !c.landmarkId) continue;
      counts[c.landmarkId] = (counts[c.landmarkId] || 0) + 1;
    }
    const ref = db.collection('region_stats').doc(region);
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (cur.exists && cur.data().backfilled === true) return;
      const old = (cur.exists && cur.data().counts) || {};
      const merged = { ...counts };
      for (const [id, n] of Object.entries(old)) merged[id] = Math.max(merged[id] || 0, Number(n) || 0);
      tx.set(ref, { counts: merged, backfilled: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    written++;
  }
  return written;
}

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

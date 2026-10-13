import { FieldValue } from 'firebase-admin/firestore';
import { canonicalRegionId } from '../../src/data/regions.js';
import { isRealCheckin } from '../../src/lib/realCheckin.js';

// Nightly check-in upkeep since the Phase 2 read limits (a phone reads only
// its own, friends' and public profiles' check-ins).

// Fills region_stats (Mapr Picks' cold-start check-in counts) for regions
// that have no backfilled totals yet. A phone did this before Phase 2; it
// can't read other people's check-ins any more, so the nightly job counts
// them from the check-ins it already loaded (ds, statsData.js), up to
// `maxRegions` regions a night, and skips the night when that load was cut
// short. Real visits only, under the region's id and any old id folded into
// it. A bump that lands between the load and the write can go uncounted
// (the larger number per place is kept); that's at most a visit or two.
export async function backfillRegionStats(db, ds, { maxRegions = 3 } = {}) {
  if ((ds?.truncated || []).includes('checkins')) return 0;
  const done = new Set((await db.collection('region_stats').select('backfilled').get()).docs.filter((d) => d.data().backfilled === true).map((d) => d.id));
  const byRegion = new Map();
  for (const c of ds?.checkins || []) {
    if (!c.region || !c.landmarkId || !isRealCheckin(c)) continue;
    const region = canonicalRegionId(c.region);
    if (done.has(region)) continue;
    if (!byRegion.has(region)) byRegion.set(region, {});
    const counts = byRegion.get(region);
    counts[c.landmarkId] = (counts[c.landmarkId] || 0) + 1;
  }
  let written = 0;
  for (const [region, counts] of [...byRegion].slice(0, maxRegions)) {
    const ref = db.collection('region_stats').doc(region);
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (cur.exists && cur.data().backfilled === true) return;
      const merged = { ...counts };
      for (const [id, n] of Object.entries((cur.exists && cur.data().counts) || {})) merged[id] = Math.max(merged[id] || 0, Number(n) || 0);
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
  const [byDistance, byAccuracy, presenceV1] = await Promise.all([
    db.collection('checkins').orderBy('distanceMeters').limit(max).get(),
    db.collection('checkins').orderBy('gpsAccuracyMeters').limit(max).get(),
    db.collection('checkins').where('presence.version', '==', 1).limit(max).get(),
  ]);
  const legacy = new Map([...byDistance.docs, ...byAccuracy.docs].map((d) => [d.ref.path, d]));
  const batch = db.batch();
  let n = 0;
  for (const d of legacy.values()) {
    if (n >= max) break;
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

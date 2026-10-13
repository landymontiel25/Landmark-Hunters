import { FieldValue } from 'firebase-admin/firestore';
import { canonicalRegionId } from '../../src/data/regions.js';

// Nightly check-in upkeep since the Phase 2 read limits (a phone reads only
// its own, friends' and public profiles' check-ins).

// region_stats/{region} (check-ins per place, Mapr's cold start): a phone
// used to build a missing one from every check-in in the region, which it
// can no longer read. The server builds any region not yet backfilled from
// the night's check-ins; the app's +1 bumps carry on after that.
export async function backfillRegionStats(db, ds) {
  if ((ds.truncated || []).includes('checkins')) return 0;
  const byRegion = new Map();
  for (const c of ds.checkins || []) {
    if (c.ratingOnly === true || c.visited === false || !c.region || !c.landmarkId) continue;
    const region = canonicalRegionId(c.region);
    if (!byRegion.has(region)) byRegion.set(region, {});
    const counts = byRegion.get(region);
    counts[c.landmarkId] = (counts[c.landmarkId] || 0) + 1;
  }
  let written = 0;
  for (const [region, counts] of byRegion) {
    const ref = db.collection('region_stats').doc(region);
    const snap = await ref.get();
    if (snap.exists && snap.data().backfilled === true) continue;
    await ref.set({ counts, backfilled: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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

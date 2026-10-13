import { FieldValue } from 'firebase-admin/firestore';
import { REGIONS, canonicalRegionId } from '../../src/data/regions.js';
import { isRealCheckin } from '../../src/lib/realCheckin.js';

// Nightly check-in upkeep since the Phase 2 read limits (a phone reads only
// its own, friends' and public profiles' check-ins).

// Recounts region_stats (Mapr Picks' cold-start check-in counts) for every
// region from the check-ins the nightly job already loaded (ds,
// statsData.js), and skips the night when that load was cut short. Real
// visits only, under the region's id and any old id folded into it. Since
// Phase 2 only the server writes these (phones used to bump them, and a bump
// couldn't be tied to a real visit), so each night overwrites the counts,
// which also wipes any made up before. A doc for an id that isn't a region
// is deleted.
export async function recountRegionStats(db, ds) {
  if ((ds?.truncated || []).includes('checkins')) return 0;
  const known = new Set(REGIONS.map((r) => r.id));
  const byRegion = new Map();
  for (const c of ds?.checkins || []) {
    if (!c.region || !c.landmarkId || !isRealCheckin(c)) continue;
    const region = canonicalRegionId(c.region);
    if (!known.has(region)) continue;
    if (!byRegion.has(region)) byRegion.set(region, {});
    const counts = byRegion.get(region);
    counts[c.landmarkId] = (counts[c.landmarkId] || 0) + 1;
  }
  const existing = (await db.collection('region_stats').select().get()).docs.map((d) => d.id);
  const batch = db.batch();
  let n = 0;
  for (const id of existing) {
    if (known.has(id)) continue;
    batch.delete(db.collection('region_stats').doc(id));
    n++;
  }
  for (const id of new Set([...byRegion.keys(), ...existing.filter((x) => known.has(x))])) {
    batch.set(db.collection('region_stats').doc(id), { counts: byRegion.get(id) || {}, backfilled: true, updatedAt: FieldValue.serverTimestamp() });
    n++;
  }
  if (n) await batch.commit();
  return n;
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

import { FieldValue } from 'firebase-admin/firestore';
import { canonicalLandmarkId, canonicalRegionId, getLandmark } from '../../src/data/regions.js';
import { activeUsers, COMMUNITY_REGIONS } from '../../src/lib/community.js';
import { gateMet, gateOpen, gateStreak, ramp } from '../../src/lib/maprRank/community.js';
import { haversineKm } from '../../src/lib/maprRank/distanceDecay.js';

// Nightly (docs/discovery-network-plan.md, step 7 and the density gate):
// community_density/{region} for each region on COMMUNITY_REGIONS. The
// launch area (Philadelphia plus Villanova) counts as one area, so both
// docs hold the same numbers. Server and dashboard only: no app user reads
// density numbers (api/community.js hands a phone only its own lift).
//
//   ramp            min(1, active users / 100, live tips / 150)
//   activeUsers     rated or checked in there in the last 30 days
//   liveTips        live, verified, unhidden tips there
//   liveTipPlaces   distinct places with one
//   discoverers30   people with a live tip posted in the last 30 days
//   medianNearby    community places within 5 miles of an active person's
//                   latest check-in there, median over active people
//   gateStreakDays  days in a row all three gate numbers held; the feed
//                   opens at 14 (gateOpen)

const DAY_MS = 86400000;
export const NEARBY_KM = 8.05; // 5 miles

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function densityNumbers(ds, { nowMs = Date.now(), regions = COMMUNITY_REGIONS, findLandmark = getLandmark } = {}) {
  const inArea = (r) => !!r && regions.includes(canonicalRegionId(r));
  const tips = (ds.tips || []).filter((t) => t.status === 'live' && !t.hidden && t.verified !== false && inArea(t.region));
  const places = new Map(); // "region/id" -> landmark
  for (const t of tips) {
    const region = canonicalRegionId(t.region);
    const id = canonicalLandmarkId(t.landmarkId, region);
    const key = `${region}/${id}`;
    if (!places.has(key)) places.set(key, findLandmark(region, id) || null);
  }
  const active = activeUsers(ds, { nowMs, regions, canonical: canonicalRegionId });
  // Each active person's latest real check-in in the area.
  const latest = new Map();
  for (const c of ds.checkins || []) {
    if (!active.has(c.userId) || c.ratingOnly === true || c.visited === false || !inArea(c.region) || !Number.isFinite(c.createdAt)) continue;
    if (!latest.has(c.userId) || latest.get(c.userId).createdAt < c.createdAt) latest.set(c.userId, c);
  }
  const coords = [...places.values()].filter((l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lng));
  const nearby = [];
  for (const c of latest.values()) {
    const region = canonicalRegionId(c.region);
    const here = findLandmark(region, canonicalLandmarkId(c.landmarkId, region));
    if (!here || !Number.isFinite(here.lat)) continue;
    nearby.push(coords.filter((l) => haversineKm(here.lat, here.lng, l.lat, l.lng) <= NEARBY_KM).length);
  }
  const discoverers30 = new Set(tips.filter((t) => Number.isFinite(t.createdAt) && t.createdAt >= nowMs - 30 * DAY_MS).map((t) => t.authorUid)).size;
  const out = {
    activeUsers: active.size,
    liveTips: tips.length,
    liveTipPlaces: places.size,
    discoverers30,
    medianNearby: median(nearby),
  };
  return { ...out, ramp: Math.round(ramp(out) * 10000) / 10000, gateMet: gateMet(out) };
}

export async function runCommunityDensity(db, ds, { nowMs = Date.now(), date }) {
  if ((ds.truncated || []).some((t) => t === 'tips' || t === 'checkins' || t === 'reviews')) return { skipped: true };
  const n = densityNumbers(ds, { nowMs });
  const out = {};
  for (const region of COMMUNITY_REGIONS) {
    const ref = db.collection('community_density').doc(region);
    const prev = (await ref.get()).data() || null;
    const streak = gateStreak(prev, n.gateMet, date);
    const doc = { ...n, region, area: COMMUNITY_REGIONS, date, gateStreakDays: streak, gateOpen: gateOpen(streak), updatedAt: FieldValue.serverTimestamp() };
    await ref.set(doc);
    out[region] = doc;
  }
  return out;
}

// Ramp and gate for regions, as the server reads them (api/community.js).
// A region not on COMMUNITY_REGIONS, or with no doc yet, has ramp 0: Mapr
// only.
export async function readDensity(db, regions) {
  const out = {};
  const wanted = [...new Set(regions.map(canonicalRegionId))].filter((r) => COMMUNITY_REGIONS.includes(r));
  const snaps = wanted.length ? await db.getAll(...wanted.map((r) => db.collection('community_density').doc(r))) : [];
  snaps.forEach((s, i) => {
    const d = s.exists ? s.data() : {};
    out[wanted[i]] = { ramp: Number.isFinite(d.ramp) ? d.ramp : 0, gateOpen: d.gateOpen === true };
  });
  return out;
}

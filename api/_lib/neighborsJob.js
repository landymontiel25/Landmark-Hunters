import { FieldValue } from 'firebase-admin/firestore';
import { canonicalRegionId } from '../../src/data/regions.js';
import { activeUsers } from '../../src/lib/community.js';
import { NEIGHBORS_COLLECTION } from '../../src/lib/maprRank/config.js';
import { NEIGHBOR_HIGH, rankNeighbors, tasteVector } from '../../src/lib/maprRank/neighbors.js';

// Nightly (docs/discovery-network-plan.md, Phase 2): each active user's top
// 50 taste neighbors among people with at least one live tip, overall and
// per city, in mapr_neighbors/{uid} (owner-read, server-written). Only a
// neighbor score of 0.3 or more counts (v2). A block either way keeps two
// people out of each other's lists. Docs of people no longer active are
// deleted, so a deleted account's list goes too.

const PROFILE_FIELDS = ['tagScores', 'tagScoresAt', 'capAnswers', 'tagBoosts', 'tagCounts'];

export function buildNeighborDocs({ profiles, reviews, tips, blocks, active, nowMs }) {
  const live = (tips || []).filter((t) => t.status === 'live' && !t.hidden && t.authorUid);
  const finders = [...new Set(live.map((t) => t.authorUid))];
  const findersIn = new Map();
  for (const t of live) {
    const r = canonicalRegionId(t.region || '');
    if (!r) continue;
    if (!findersIn.has(r)) findersIn.set(r, new Set());
    findersIn.get(r).add(t.authorUid);
  }
  const blocked = new Map();
  for (const { blockerUid: a, blockedUid: b } of blocks || []) {
    if (!a || !b) continue;
    if (!blocked.has(a)) blocked.set(a, new Set());
    if (!blocked.has(b)) blocked.set(b, new Set());
    blocked.get(a).add(b);
    blocked.get(b).add(a);
  }
  // Ratings per person: all of them, and per city.
  const tiersAll = new Map();
  const tiersBy = new Map();
  for (const r of reviews || []) {
    if (!r.userId || !r.landmarkId || !r.ratingTier) continue;
    if (!tiersAll.has(r.userId)) tiersAll.set(r.userId, {});
    tiersAll.get(r.userId)[r.landmarkId] = r.ratingTier;
    const region = r.region ? canonicalRegionId(r.region) : null;
    if (!region) continue;
    const k = `${r.userId}|${region}`;
    if (!tiersBy.has(k)) tiersBy.set(k, {});
    tiersBy.get(k)[r.landmarkId] = r.ratingTier;
  }
  const everyone = [...new Set([...active, ...finders])];
  const peopleFor = (region) => {
    const out = {};
    for (const uid of everyone) {
      const profile = profiles.get(uid);
      if (!profile) continue;
      const all = tiersAll.get(uid) || {};
      out[uid] = {
        vector: tasteVector(profile, region, nowMs),
        // Ratings behind the taste (step 2's shrink): every rating, any city.
        ratings: Object.keys(all).length,
        tiers: region ? tiersBy.get(`${uid}|${region}`) || {} : all,
      };
    }
    return out;
  };
  const overall = peopleFor(null);
  const byRegionPeople = new Map([...findersIn.keys()].map((r) => [r, peopleFor(r)]));
  const docs = new Map();
  for (const uid of active) {
    const skip = (c) => blocked.get(uid)?.has(c) === true;
    const global = rankNeighbors(uid, overall, finders, { skip });
    const byRegion = {};
    for (const [region, set] of findersIn) {
      const list = rankNeighbors(uid, byRegionPeople.get(region), [...set], { skip });
      if (list.length) byRegion[region] = list;
    }
    docs.set(uid, { global, byRegion });
  }
  return docs;
}

export async function runNeighbors(db, ds, { nowMs = Date.now() } = {}) {
  if ((ds.truncated || []).some((t) => t === 'reviews' || t === 'tips')) return { skipped: true };
  const active = activeUsers(ds, { nowMs, canonical: canonicalRegionId });
  const finders = new Set((ds.tips || []).filter((t) => t.status === 'live' && !t.hidden).map((t) => t.authorUid));
  const uids = [...new Set([...active, ...finders])];
  const profiles = new Map();
  for (let i = 0; i < uids.length; i += 300) {
    const snaps = await db.getAll(...uids.slice(i, i + 300).map((u) => db.collection('users').doc(u)), { fieldMask: PROFILE_FIELDS });
    for (const s of snaps) if (s.exists) profiles.set(s.id, s.data());
  }
  // Active and still has an account.
  const activeNow = new Set([...active].filter((u) => profiles.has(u)));
  const blocks = (await db.collection('blocks').get()).docs.map((d) => d.data());
  const docs = buildNeighborDocs({ profiles, reviews: ds.reviews, tips: ds.tips, blocks, active: activeNow, nowMs });

  const ts = FieldValue.serverTimestamp();
  const existing = (await db.collection(NEIGHBORS_COLLECTION).select().get()).docs.map((d) => d.id);
  const writes = [...docs].map(([uid, d]) => ['set', uid, { ...d, updatedAt: ts }]);
  for (const id of existing) if (!docs.has(id)) writes.push(['delete', id]);
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [op, id, data] of writes.slice(i, i + 400)) {
      const ref = db.collection(NEIGHBORS_COLLECTION).doc(id);
      if (op === 'set') batch.set(ref, data);
      else batch.delete(ref);
    }
    await batch.commit();
  }
  // Counts for the dashboard: people with any neighbor, and with a High one.
  let withNeighbors = 0;
  let withHigh = 0;
  for (const d of docs.values()) {
    const all = [...d.global, ...Object.values(d.byRegion).flat()];
    if (all.length) withNeighbors++;
    if (all.some((n) => n.score >= NEIGHBOR_HIGH)) withHigh++;
  }
  return { active: activeNow.size, finders: finders.size, withNeighbors, withHigh, deleted: writes.filter((w) => w[0] === 'delete').length };
}

import { canonicalLandmarkId, canonicalRegionId, getRegion, REGION_ALIASES } from '../../src/data/regions.js';
import { reachesEveryone, reputation01 } from '../../src/lib/reputation.js';
import { COMMUNITY_REGIONS } from '../../src/lib/community.js';
import { communityWeight, finderWeight, freshness, placeFinderWeight, visitAgeDays } from '../../src/lib/maprRank/community.js';
import { NEIGHBORS_COLLECTION } from '../../src/lib/maprRank/config.js';
import { neighborScoreOf, neighborsFromDoc, tasteMatchLabel } from '../../src/lib/maprRank/neighbors.js';
import { readDensity } from './communityDensity.js';
import { blockedBetween } from './tipsServer.js';

// Community picks for one viewer (docs/discovery-network-plan.md, Phase 3):
// for each place with live, verified tips in a launch region, the lift
// every Mapr surface multiplies into its score (rank.js scorePicks), and who
// found it, for the reason line. Computed on the server because it reads
// other people's tips, the viewer's neighbors, follows, friends and blocks
// together. A phone gets only its own lifts and finder names
// (api/community.js), never the ramp, density numbers or anyone's weight.

// What each finder is to this viewer: neighbor score, followed, friend.
// Blocks must load (a failure throws: never show a blocked person); the
// rest only order and lift things, so a failed read counts as none.
export async function viewerRelations(db, viewerUid) {
  const soft = (p) => p.catch(() => null);
  const [neighborsSnap, follows, friends, blocked] = await Promise.all([
    soft(db.collection(NEIGHBORS_COLLECTION).doc(viewerUid).get()),
    soft(db.collection('follows').where('followerUid', '==', viewerUid).get()),
    soft(db.collection('friend_edges').where('owner', '==', viewerUid).get()),
    blockedBetween(db, viewerUid),
  ]);
  return {
    neighbors: neighborsSnap?.exists ? neighborsFromDoc(neighborsSnap.data()) : null,
    follows: new Set((follows?.docs || []).map((d) => d.data().followeeUid)),
    friends: new Set((friends?.docs || []).map((d) => d.data().friend).filter(Boolean)),
    blocked,
  };
}

// Each finder's local reputation in one city (Phase 4): the 0-to-1 input to
// finder weight and their level there. Server only (points never leave).
export async function finderReputation(db, uids, region) {
  const out = new Map();
  const list = [...new Set(uids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const [scores, pub] = await Promise.all([
      db.getAll(...part.map((u) => db.collection('reputation_scores').doc(u))),
      db.getAll(...part.map((u) => db.collection('reputation').doc(u))),
    ]);
    part.forEach((u, j) => {
      const score = scores[j]?.exists ? scores[j].data()?.byRegion?.[region]?.score : null;
      const level = pub[j]?.exists ? pub[j].data()?.levels?.[region] || null : null;
      if (score != null || level) out.set(u, { rep: reputation01(score), level });
    });
  }
  return out;
}

// One finder's weight for this viewer, and why ('neighbor', 'follow',
// 'friend', 'trusted' for a Trusted or Insider finder in that city, or null
// for anyone else). rep: { rep (0 to 1), level } from finderReputation.
export function finderFor(rel, uid, region, rep = null) {
  const score = neighborScoreOf(rel.neighbors, uid, region);
  const follows = rel.follows.has(uid);
  const friend = rel.friends.has(uid);
  const weight = finderWeight({ neighborScore: score, follows, friend, reputation: rep?.rep || 0 });
  const match = tasteMatchLabel(score);
  const trusted = reachesEveryone(rep?.level);
  const relation = match ? 'neighbor' : follows ? 'follow' : friend ? 'friend' : trusted ? 'trusted' : null;
  const levelLabel = trusted ? `${rep.level === 'Insider' ? 'Insider' : 'Trusted'} in ${getRegion(region)?.name || region}` : null;
  return { weight, relation, match, ...(levelLabel ? { levelLabel } : {}) };
}

const isLive = (t) => t.status === 'live' && t.hidden !== true && t.verified !== false;

// { [region]: { gateOpen, places: { [landmarkId]: { lift, likeYou, finders,
// finder: { uid, name, relation, match }, tip? } } } }. Regions off
// COMMUNITY_REGIONS are left out (Mapr only there). `withText` adds the
// best finder's tip text (for Mapr chat's prompt; tips are public).
export async function computeCommunity(db, viewerUid, regions, { nowMs = Date.now(), withText = false, rel = null } = {}) {
  const density = await readDensity(db, regions);
  const wanted = Object.keys(density);
  if (!wanted.length) return {};
  const relations = rel || (await viewerRelations(db, viewerUid));
  const out = {};
  const snaps = await Promise.all(
    wanted.map((region) => db.collection('tips').where('region', 'in', [region, ...Object.keys(REGION_ALIASES).filter((a) => REGION_ALIASES[a] === region)]).where('status', '==', 'live').get())
  );
  for (const [i, region] of wanted.entries()) {
    const snap = snaps[i];
    const byPlace = new Map();
    for (const d of snap.docs) {
      const t = d.data();
      if (!isLive(t) || !t.authorUid || t.authorUid === viewerUid || relations.blocked.has(t.authorUid)) continue;
      const id = canonicalLandmarkId(t.landmarkId, region);
      if (!byPlace.has(id)) byPlace.set(id, new Map());
      // One tip per person per place; keep the freshest if ids collide.
      const prev = byPlace.get(id).get(t.authorUid);
      if (!prev || (visitAgeDays(t.visitMonth, nowMs) ?? 1e9) < (visitAgeDays(prev.visitMonth, nowMs) ?? 1e9)) byPlace.get(id).set(t.authorUid, t);
    }
    const reps = await finderReputation(db, [...byPlace.values()].flatMap((m) => [...m.keys()]), region);
    const places = {};
    for (const [id, finders] of byPlace) {
      const rows = [...finders.values()].map((t) => ({ t, ...finderFor(relations, t.authorUid, region, reps.get(t.authorUid)) }));
      rows.sort((a, b) => b.weight - a.weight || (visitAgeDays(a.t.visitMonth, nowMs) ?? 1e9) - (visitAgeDays(b.t.visitMonth, nowMs) ?? 1e9));
      const best = rows[0];
      const lift = communityWeight(placeFinderWeight(rows.map((r) => r.weight)), density[region].ramp, freshness(visitAgeDays(best.t.visitMonth, nowMs)));
      places[id] = {
        lift: Math.round(lift * 10000) / 10000,
        likeYou: rows.some((r) => r.relation),
        finders: rows.length,
        finder: { uid: best.t.authorUid, name: best.t.authorName || 'Explorer', relation: best.relation, match: best.match, ...(best.levelLabel ? { levelLabel: best.levelLabel } : {}) },
        ...(withText ? { tip: String(best.t.text || '').slice(0, 280) } : {}),
      };
    }
    out[region] = { gateOpen: density[region].gateOpen, places };
  }
  return out;
}

export const communityRegionsOf = (regions) => [...new Set((regions || []).map((r) => canonicalRegionId(String(r))))].filter((r) => COMMUNITY_REGIONS.includes(r));

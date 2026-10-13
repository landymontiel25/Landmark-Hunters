import { FieldValue } from 'firebase-admin/firestore';
import { canonicalLandmarkId, canonicalRegionId } from '../../src/data/regions.js';
import { COMMUNITY_REGIONS } from '../../src/lib/community.js';
import { EVENT_WEIGHTS, FOUNDING_LIMIT, LEVEL_RANK, levelsFor, reputationScore, trustOf, WENT_WINDOW_DAYS } from '../../src/lib/reputation.js';

// Nightly (docs/discovery-network-plan.md, Phase 4).
//   influence_events/{tipId}_{actor}_{kind}  server only: helpful, saved,
//       went (a verified check-in at the place within 30 days of seeing the
//       tip) and loved (then rated "I loved it"), by other people, on live
//       tips. Built from tip_reactions, tip_views, check-ins and ratings.
//   reputation_scores/{uid}   server only: score and people per city
//   reputation/{uid}          signed-in read: levels per city and badges,
//       never points
//   community_founding/{region}  server only: the first 25 to reach Local
// Badges: first-find (a live tip), went-10 (10 visits because of your
// tips), trusted-{region} (Trusted or Insider there), founding-{region}.
// first-find, went-10 and founding are kept once earned.

const DAY_MS = 86400000;
const placeKey = (region, landmarkId) => {
  const r = canonicalRegionId(region || '');
  return `${r}/${canonicalLandmarkId(landmarkId, r)}`;
};

// Events from plain rows (testable without Firestore).
export function buildEvents({ tips, reactions, views, checkins, reviews }) {
  const live = new Map(); // tipId -> tip (live and unhidden: removed or held tips earn nothing)
  for (const t of tips || []) if (t.status === 'live' && !t.hidden && t.authorUid) live.set(t.id, t);
  const events = new Map();
  const add = (tip, actorUid, kind, at) => {
    if (!actorUid || actorUid === tip.authorUid || !Number.isFinite(at)) return;
    const id = `${tip.id}_${actorUid}_${kind}`;
    if (!events.has(id)) events.set(id, { id, finderUid: tip.authorUid, actorUid, tipId: tip.id, landmarkId: tip.landmarkId, region: canonicalRegionId(tip.region || ''), kind, weight: EVENT_WEIGHTS[kind], at });
  };
  const sameGen = (x, t) => (x.gen ?? null) === (t.gen ?? null);
  for (const r of reactions || []) {
    const t = live.get(r.tipId);
    if (!t || !sameGen(r, t)) continue;
    if (r.helpful) add(t, r.uid, 'helpful', r.helpfulAt ?? r.firstAt);
    if (r.saved) add(t, r.uid, 'saved', r.savedAt ?? r.firstAt);
  }
  // Verified visits per person per place, oldest first.
  const visits = new Map();
  for (const c of checkins || []) {
    if (!c.userId || c.presence?.verified !== true || !Number.isFinite(c.createdAt)) continue;
    const k = `${c.userId}|${placeKey(c.region, c.landmarkId)}`;
    if (!visits.has(k)) visits.set(k, []);
    visits.get(k).push(c.createdAt);
  }
  for (const v of visits.values()) v.sort((a, b) => a - b);
  const loves = new Map();
  for (const r of reviews || []) {
    if (r.ratingTier !== 'highly-recommend' || !r.userId) continue;
    const at = r.ratedAt ?? r.updatedAt ?? r.createdAt;
    if (Number.isFinite(at)) loves.set(`${r.userId}|${placeKey(r.region, r.landmarkId)}`, at);
  }
  for (const v of views || []) {
    const t = live.get(v.tipId);
    if (!t || !sameGen(v, t) || !Number.isFinite(v.firstAt)) continue;
    const k = `${v.uid}|${placeKey(t.region, t.landmarkId)}`;
    const went = (visits.get(k) || []).find((at) => at >= v.firstAt && at <= v.firstAt + WENT_WINDOW_DAYS * DAY_MS);
    if (went == null) continue;
    add(t, v.uid, 'went', went);
    const loved = loves.get(k);
    if (Number.isFinite(loved) && loved >= went) add(t, v.uid, 'loved', loved);
  }
  return [...events.values()];
}

// Scores, levels and badges per finder from events.
export function buildReputation({ events, tips, verifiedCount, accountAgeDays, friendEdges, nowMs, prevBadges = new Map(), founding = {} }) {
  const byFinderCity = new Map();
  for (const e of events) {
    const k = `${e.finderUid}|${e.region}`;
    if (!byFinderCity.has(k)) byFinderCity.set(k, []);
    byFinderCity.get(k).push(e);
  }
  const scoresByCity = new Map();
  const scores = new Map(); // uid -> { region: { score, people } }
  for (const [k, list] of byFinderCity) {
    const [finderUid, region] = k.split('|');
    const trust = (actor) => trustOf({ isFriend: friendEdges.has(`${finderUid}_${actor}`), verifiedCheckins: verifiedCount.get(actor) || 0, accountAgeDays: accountAgeDays.get(actor) ?? 0 });
    const s = reputationScore(list, { finderUid, nowMs, trust });
    s.score = Math.round(s.score * 100) / 100;
    if (!scores.has(finderUid)) scores.set(finderUid, {});
    scores.get(finderUid)[region] = s;
    if (!scoresByCity.has(region)) scoresByCity.set(region, []);
    scoresByCity.get(region).push({ uid: finderUid, ...s });
  }
  const levels = new Map(); // uid -> { region: level }
  for (const [region, list] of scoresByCity) {
    for (const [uid, level] of levelsFor(list)) {
      if (!levels.has(uid)) levels.set(uid, {});
      levels.get(uid)[region] = level;
    }
  }
  // Founding discoverers: the first 25 to reach Local in a launch city.
  const nextFounding = Object.fromEntries(COMMUNITY_REGIONS.map((r) => [r, [...(founding[r] || [])]]));
  for (const region of COMMUNITY_REGIONS) {
    const reached = [...levels].filter(([, byRegion]) => LEVEL_RANK[byRegion[region]] >= LEVEL_RANK.Local).map(([uid]) => uid);
    // Higher score first when several reach it the same night.
    reached.sort((a, b) => (scores.get(b)?.[region]?.score || 0) - (scores.get(a)?.[region]?.score || 0));
    for (const uid of reached) if (nextFounding[region].length < FOUNDING_LIMIT && !nextFounding[region].includes(uid)) nextFounding[region].push(uid);
  }
  const went = new Map();
  for (const e of events) if (e.kind === 'went') went.set(e.finderUid, (went.get(e.finderUid) || 0) + 1);
  const finders = new Set((tips || []).filter((t) => t.status === 'live' && !t.hidden).map((t) => t.authorUid));
  const people = new Set([...scores.keys(), ...finders, ...prevBadges.keys()]);
  const badges = new Map();
  for (const uid of people) {
    const kept = (prevBadges.get(uid) || []).filter((b) => b === 'first-find' || b === 'went-10' || b.startsWith('founding-'));
    const now = new Set(kept);
    if (finders.has(uid)) now.add('first-find');
    if ((went.get(uid) || 0) >= 10) now.add('went-10');
    for (const [region, level] of Object.entries(levels.get(uid) || {})) if (LEVEL_RANK[level] >= LEVEL_RANK.Trusted) now.add(`trusted-${region}`);
    for (const region of COMMUNITY_REGIONS) if (nextFounding[region].includes(uid)) now.add(`founding-${region}`);
    badges.set(uid, [...now].sort());
  }
  return { scores, levels, badges, founding: nextFounding, went };
}

export async function runReputation(db, ds, { nowMs = Date.now() } = {}) {
  if ((ds.truncated || []).some((t) => ['tips', 'checkins', 'reviews', 'users'].includes(t))) return { skipped: true };
  const [reactionsSnap, viewsSnap, edgesSnap, prevSnap, foundingSnap] = await Promise.all([
    db.collection('tip_reactions').get(),
    db.collection('tip_views').get(),
    db.collection('friend_edges').select().get(),
    db.collection('reputation').get(),
    db.collection('community_founding').get(),
  ]);
  const tips = ds.tips || [];
  const events = buildEvents({ tips, reactions: reactionsSnap.docs.map((d) => d.data()), views: viewsSnap.docs.map((d) => d.data()), checkins: ds.checkins, reviews: ds.reviews });
  const verifiedCount = new Map();
  for (const c of ds.checkins || []) if (c.presence?.verified === true) verifiedCount.set(c.userId, (verifiedCount.get(c.userId) || 0) + 1);
  const accountAgeDays = new Map((ds.users || []).filter((u) => Number.isFinite(u.createdAt)).map((u) => [u.uid, (nowMs - u.createdAt) / DAY_MS]));
  const friendEdges = new Set(edgesSnap.docs.map((d) => d.id));
  const prevBadges = new Map(prevSnap.docs.map((d) => [d.id, Array.isArray(d.data().badges) ? d.data().badges : []]));
  const founding = Object.fromEntries(foundingSnap.docs.map((d) => [d.id, Array.isArray(d.data().uids) ? d.data().uids : []]));
  const rep = buildReputation({ events, tips, verifiedCount, accountAgeDays, friendEdges, nowMs, prevBadges, founding });

  const ts = FieldValue.serverTimestamp();
  const writes = [];
  // New events only (ids are stable).
  const known = new Set((await db.collection('influence_events').select().get()).docs.map((d) => d.id));
  for (const e of events) if (!known.has(e.id)) writes.push(['influence_events', e.id, e]);
  const everyone = new Set([...rep.scores.keys(), ...rep.badges.keys(), ...prevSnap.docs.map((d) => d.id)]);
  for (const uid of everyone) {
    writes.push(['reputation_scores', uid, { byRegion: rep.scores.get(uid) || {}, updatedAt: ts }]);
    writes.push(['reputation', uid, { levels: rep.levels.get(uid) || {}, badges: rep.badges.get(uid) || [], updatedAt: ts }]);
  }
  for (const [region, uids] of Object.entries(rep.founding)) writes.push(['community_founding', region, { uids, updatedAt: ts }]);
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [col, id, data] of writes.slice(i, i + 400)) batch.set(db.collection(col).doc(id), data);
    await batch.commit();
  }
  // Counts for the dashboard.
  const levelCount = {};
  for (const byRegion of rep.levels.values()) for (const [region, level] of Object.entries(byRegion)) levelCount[`${region}_${level}`] = (levelCount[`${region}_${level}`] || 0) + 1;
  let friendHeavy = 0;
  for (const [finder] of rep.scores) {
    const mine = events.filter((e) => e.finderUid === finder);
    const fromFriends = mine.filter((e) => friendEdges.has(`${finder}_${e.actorUid}`)).length;
    if (mine.length >= 3 && fromFriends / mine.length > 0.5) friendHeavy++;
  }
  const weekAgo = nowMs - 7 * DAY_MS;
  return {
    events: events.length,
    newEvents: writes.filter((w) => w[0] === 'influence_events').length,
    wentLast7d: events.filter((e) => e.kind === 'went' && e.at >= weekAgo).length,
    finders: rep.scores.size,
    levels: levelCount,
    friendHeavy,
  };
}

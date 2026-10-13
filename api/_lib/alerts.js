import { FieldValue } from 'firebase-admin/firestore';
import { canonicalLandmarkId, canonicalRegionId, getLandmark, getRegion } from '../../src/data/regions.js';
import { ALERT_GROUPS, alertOn, FOLLOW_TIP_DAILY_MAX, FOLLOWER_PUSH_FIRST, NEARBY_FIND_MILES } from '../../src/lib/alerts.js';
import { effectiveTagScores } from '../../src/lib/tagScores.js';
import { haversineKm } from '../../src/lib/maprRank/distanceDecay.js';
import { LEVEL_RANK, reachesEveryone } from '../../src/lib/reputation.js';
import { sendPushToUser } from './push.js';
import { activeUsers } from '../../src/lib/community.js';

// Discovery alerts (docs/discovery-network-plan.md, Phase 5). All written
// by the server into notifications/ (the app's own inbox), with a push for
// the groups that push. Each group follows its switch in
// users/{uid}/private/main.notificationPrefs (all on by default).
//   tipWent     people went because of your tip      push, once a day
//   tipHelpful  new Helpful marks on your tips        in-app only
//   levelUp     a new level in a city                 push
//   newFollower someone followed you                  in-app; push for your first 10
//   followTip   someone you follow posted near you    push, 2 a day at most
//   nearbyFind  a Trusted find within a mile, your    push, once a week
//               kind of place
// alert_log/{uid} (server only) keeps the per-day and per-week counts.

const DAY_MS = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekKey = (ms) => {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
};
const placeName = (region, id) => getLandmark(canonicalRegionId(region || ''), canonicalLandmarkId(id, canonicalRegionId(region || '')))?.name || 'a place';
const cityName = (region) => getRegion(region)?.name || region;

async function prefsOf(db, uid) {
  const s = await db.doc(`users/${uid}/private/main`).get().catch(() => null);
  return s?.exists ? s.data()?.notificationPrefs || {} : {};
}

// One alert: the inbox row, then a push when asked. Returns true if sent.
export async function sendAlert(db, uid, group, { message, title = 'Landmark Hunters', push = false, landmarkId = null, region = null, nowMs = Date.now(), prefs = null }) {
  if (!ALERT_GROUPS[group]) return false;
  const p = prefs || (await prefsOf(db, uid));
  if (!alertOn(p, group)) return false;
  await db.collection('notifications').add({ uid, type: `discovery_${group}`, message, read: false, createdAt: FieldValue.serverTimestamp(), createdAtMs: nowMs, ...(landmarkId ? { landmarkId } : {}), ...(region ? { region } : {}) });
  if (push) await sendPushToUser(uid, { title, body: message, data: { type: `discovery_${group}`, ...(landmarkId ? { landmarkId } : {}) } }).catch(() => null);
  return true;
}

// Nightly: went, helpful and level-up alerts from the reputation run's new
// events and level changes. events: new influence events; levelUps:
// [{ uid, region, level }].
export async function nightlyAlerts(db, { events = [], levelUps = [], nowMs = Date.now() } = {}) {
  let sent = 0;
  const byFinder = new Map();
  for (const e of events) {
    if (e.kind !== 'went' && e.kind !== 'helpful') continue;
    const k = `${e.finderUid}|${e.kind}`;
    if (!byFinder.has(k)) byFinder.set(k, []);
    byFinder.get(k).push(e);
  }
  for (const [k, list] of byFinder) {
    const [finderUid, kind] = k.split('|');
    const people = new Set(list.map((e) => e.actorUid)).size;
    const first = list[0];
    const where = placeName(first.region, first.landmarkId);
    const more = new Set(list.map((e) => e.tipId)).size > 1 ? ' and your other tips' : '';
    if (kind === 'went') {
      const log = db.collection('alert_log').doc(finderUid);
      const prev = (await log.get()).data() || {};
      if (prev.wentDay === dayKey(nowMs)) continue; // once a day
      const ok = await sendAlert(db, finderUid, 'tipWent', { message: `${people} ${people === 1 ? 'person' : 'people'} went to ${where} because of your tip${more}.`, push: true, landmarkId: first.landmarkId, region: first.region, nowMs });
      if (ok) {
        await log.set({ wentDay: dayKey(nowMs) }, { merge: true });
        sent++;
      }
    } else if (await sendAlert(db, finderUid, 'tipHelpful', { message: `${people} ${people === 1 ? 'person' : 'people'} found your tip at ${where}${more} helpful.`, landmarkId: first.landmarkId, region: first.region, nowMs })) sent++;
  }
  for (const { uid, region, level } of levelUps) {
    if (await sendAlert(db, uid, 'levelUp', { message: `You're now ${level} in ${cityName(region)}. People went to places because of your tips.`, push: true, nowMs })) sent++;
  }
  return sent;
}

// Someone followed `followeeUid` (api/_lib/follows.js). Push only while
// they have 10 followers or fewer.
export async function followerAlert(db, { followerUid, followeeUid, followerCount, nowMs = Date.now() }) {
  const who = (await db.collection('users').doc(followerUid).get()).data();
  const name = who?.username ? `@${who.username}` : 'Someone';
  return sendAlert(db, followeeUid, 'newFollower', { message: `${name} followed you.`, push: followerCount <= FOLLOWER_PUSH_FIRST, nowMs });
}

// A tip went live (api/post-tip.js): its author's followers who have been
// to that city hear about it, at most 2 a day each.
export async function followTipAlerts(db, { tip, nowMs = Date.now() }) {
  if (!tip?.authorUid || tip.status !== 'live') return 0;
  const region = canonicalRegionId(tip.region || '');
  // A block removes follows both ways, so followers never include one.
  const followers = await db.collection('follows').where('followeeUid', '==', tip.authorUid).get();
  let sent = 0;
  for (const d of followers.docs) {
    const uid = d.data().followerUid;
    if (!uid) continue;
    // Near their cities: they checked in somewhere in this region before.
    const been = await db.collection('checkins').where('userId', '==', uid).where('region', '==', region).limit(1).get();
    if (been.empty) continue;
    const log = db.collection('alert_log').doc(uid);
    const prev = (await log.get()).data() || {};
    const today = dayKey(nowMs);
    const count = prev.followTipDay === today ? prev.followTipCount || 0 : 0;
    if (count >= FOLLOW_TIP_DAILY_MAX) continue;
    const ok = await sendAlert(db, uid, 'followTip', { message: `${tip.authorName || 'Someone you follow'} shared a tip at ${placeName(tip.region, tip.landmarkId)}.`, push: true, landmarkId: tip.landmarkId, region, nowMs });
    if (ok) {
      await log.set({ followTipDay: today, followTipCount: count + 1 }, { merge: true });
      sent++;
    }
  }
  return sent;
}

// Weekly per person: one Trusted or Insider find within a mile of where
// they last were, of a kind they like, that they haven't rated.
export async function nearbyFindAlerts(db, ds, { nowMs = Date.now(), reputation = new Map() } = {}) {
  const week = weekKey(nowMs);
  const finds = [];
  for (const t of ds.tips || []) {
    if (t.status !== 'live' || t.hidden || t.verified === false) continue;
    const region = canonicalRegionId(t.region || '');
    if (!reachesEveryone(reputation.get(t.authorUid)?.[region])) continue;
    const l = getLandmark(region, canonicalLandmarkId(t.landmarkId, region));
    if (l && Number.isFinite(l.lat)) finds.push({ t, l, region });
  }
  if (!finds.length) return 0;
  const rated = new Set((ds.reviews || []).map((r) => `${r.userId}|${r.landmarkId}`));
  // People active in the last 30 days whose phone shared a location this
  // week (users/{uid}/private/main, owner-only; read here by the server).
  const uids = [...activeUsers(ds, { nowMs })];
  let sent = 0;
  for (let i = 0; i < uids.length; i += 200) {
    const part = uids.slice(i, i + 200);
    const privs = await db.getAll(...part.map((u) => db.doc(`users/${u}/private/main`)));
    for (const [j, p] of privs.entries()) {
      const uid = part[j];
      const loc = p.exists ? p.data().lastKnownLocation : null;
      if (!loc || !Number.isFinite(loc.lat) || !(Number(loc.at) > nowMs - 7 * DAY_MS)) continue;
      if (await nearbyFor(db, { uid, p, loc, finds, rated, week, nowMs })) sent++;
    }
  }
  return sent;
}

// One person's weekly nearby find, if any.
async function nearbyFor(db, { uid, p, loc, finds, rated, week, nowMs }) {
  if (!alertOn(p.data().notificationPrefs || {}, 'nearbyFind')) return false;
  const log = db.collection('alert_log').doc(uid);
  const prev = (await log.get()).data() || {};
  if (prev.nearbyWeek === week) return false;
  const near = finds.filter((f) => f.t.authorUid !== uid && !rated.has(`${uid}|${f.l.id}`) && haversineKm(loc.lat, loc.lng, f.l.lat, f.l.lng) <= NEARBY_FIND_MILES * 1.609);
  if (!near.length) return false;
  const profile = (await db.collection('users').doc(uid).get()).data() || null;
  const liked = near.find((f) => {
    const s = profile ? effectiveTagScores(profile, f.region, nowMs) : {};
    return (f.l.categories || []).some((c) => (s[c] || 0) > 0);
  });
  if (!liked) return false;
  const ok = await sendAlert(db, uid, 'nearbyFind', { message: `A Trusted find near you: ${liked.l.name}. ${liked.t.authorName || 'A discoverer'} shared a tip after a verified visit.`, push: true, landmarkId: liked.l.id, region: liked.region, nowMs, prefs: p.data().notificationPrefs || {} });
  if (ok) await log.set({ nearbyWeek: week }, { merge: true });
  return ok;
}

// Level changes between last night's public reputation and tonight's:
// only a rise counts.
export function levelUpsOf(prevLevels, nextLevels) {
  const out = [];
  for (const [uid, byRegion] of nextLevels) {
    for (const [region, level] of Object.entries(byRegion || {})) {
      const before = prevLevels.get(uid)?.[region];
      if ((LEVEL_RANK[level] || 0) > (LEVEL_RANK[before] || 0)) out.push({ uid, region, level });
    }
  }
  return out;
}

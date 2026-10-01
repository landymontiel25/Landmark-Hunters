import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  runTransaction,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  writeBatch,
  arrayUnion,
  arrayRemove,
  Timestamp,
} from 'firebase/firestore';
import { updateDoc as _updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { distanceMeters } from './geo';
import { getUserProfile } from './friends';
import { REGIONS } from '../data/regions';

export { distanceMeters };

export const POINTS_PER_CHECKIN = 100;
// Default "you're here" radius -- tightened down from an initial 150m
// during build/testing to balance real-world GPS accuracy against making
// the claim meaningful. Individual landmarks can widen this via
// `checkInRadiusMeters` (malls, parks, beaches, national parks, etc.).
export const CHECKIN_RADIUS_METERS = 30;
// A landmark within this of the user's home address earns 0 points no
// matter what -- otherwise a landmark right next to home would be free
// points on demand (and blocks the obvious exploit of self-submitting a
// custom landmark, like a water tower, next door). The visit still logs in
// full either way; only the payout is zeroed.
export const HOME_RADIUS_METERS = 804.672; // 0.5 miles
// Toggled off for now (turned out not worth it in practice) -- the radius
// math and the `insideHomeRadius` field on every check-in stay in place
// (still useful data for Mapr either way), this just stops it from zeroing
// anyone's payout. Flip back to true to re-enable the exclusion.
export const HOME_RADIUS_EXCLUSION_ENABLED = false;

// Payout taper for repeat visits to the same landmark: full the first time,
// a light nudge for a handful of return trips, then nothing -- repeat
// visits keep logging in full for Mapr either way (see claimCheckIn), this
// only governs what pays out.
export function taperedPoints(basePoints, visitNumber) {
  if (visitNumber <= 1) return basePoints;
  if (visitNumber <= 5) return Math.round(basePoints * 0.2);
  return 0;
}

// "Why do you love this place" fires on the 3rd visit, then every 10th
// visit after that (13th, 23rd, 33rd, ...) -- frequent enough to build a
// real picture of what keeps someone coming back, not so often it feels
// like an interrogation every time they check in.
export function shouldPromptLoveReason(visitNumber) {
  return visitNumber === 3 || (visitNumber > 3 && (visitNumber - 3) % 10 === 0);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// ISO-8601 week number
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(weekNo)}`;
}

export function periodKeys(date = new Date()) {
  return {
    weekly: isoWeekKey(date),
    monthly: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
    yearly: `${date.getFullYear()}`,
  };
}

export const PERIODS = ['weekly', 'monthly', 'yearly'];

/**
 * Claims a check-in. No longer one-and-done per landmark -- every visit
 * gets its own doc (visit #1 keeps the original uid_landmarkId id, so every
 * check-in that predates this change stays valid untouched; visit #2
 * onward is uid_landmarkId_<visitNumber>), so re-checking in somewhere is
 * always allowed and always logged with its own timestamp. What pays out
 * is a separate question from what gets logged: payout tapers with repeat
 * visits (see taperedPoints), and would also be 0 inside the user's home
 * radius if HOME_RADIUS_EXCLUSION_ENABLED were on (it's currently off) --
 * but the visit itself is always recorded in full regardless, since Mapr
 * should learn from every visit whether or not it paid out.
 * Returns { claimed, alreadyClaimed, visitNumber?, payout?, checkinId? }.
 */
export async function claimCheckIn({
  userId,
  userName,
  landmarkId,
  landmarkName,
  region,
  points = POINTS_PER_CHECKIN,
  ratingOnly = false,
  homeCoords = null,
  landmarkCoords = null,
}) {
  // Visit numbering needs a count of this user's prior check-ins here -- a
  // query, which a transaction can't run (only reads by reference). This
  // happens just before the transaction; the transaction's own existence
  // check on the resulting doc id is what actually guards against a real
  // race (two taps landing on the same visit number), the same protection
  // the original single-checkin version always had.
  const priorSnap = await getDocs(
    query(collection(db, 'checkins'), where('userId', '==', userId), where('landmarkId', '==', landmarkId))
  );
  // The doc id counts every prior doc (a "Rate a Landmark" claim occupies an
  // id too), but the visit number -- which drives the payout taper and the
  // love-reason prompt -- counts only real visits. Otherwise rating a place
  // first made your first real check-in there pay as a 20% "repeat".
  const docNumber = priorSnap.size + 1;
  const realPrior = priorSnap.docs.filter((d) => isRealCheckin(d.data())).length;
  const visitNumber = realPrior + 1;
  const checkinId = docNumber === 1 ? `${userId}_${landmarkId}` : `${userId}_${landmarkId}_${docNumber}`;
  const checkinRef = doc(db, 'checkins', checkinId);
  const keys = periodKeys();

  const insideHomeRadius =
    !!homeCoords &&
    !!landmarkCoords &&
    distanceMeters(homeCoords.lat, homeCoords.lng, landmarkCoords.lat, landmarkCoords.lng) <= HOME_RADIUS_METERS;
  const payout =
    ratingOnly || (HOME_RADIUS_EXCLUSION_ENABLED && insideHomeRadius) ? 0 : taperedPoints(points, visitNumber);

  const result = await runTransaction(db, async (tx) => {
    const existing = await tx.get(checkinRef);
    if (existing.exists()) {
      return { claimed: false, alreadyClaimed: true };
    }

    tx.set(checkinRef, {
      userId,
      userName,
      landmarkId,
      landmarkName,
      region,
      points: payout,
      basePoints: points,
      visitNumber,
      ratingOnly,
      // Explicit, so isRealCheckin never has to infer "was this a real
      // visit" from the points value alone -- a home-radius or
      // fully-tapered repeat visit is still real, at 0 points.
      visited: !ratingOnly,
      insideHomeRadius,
      createdAt: serverTimestamp(),
    });

    if (payout > 0) {
      for (const period of PERIODS) {
        const entryRef = doc(db, 'leaderboard_entries', `${period}_${keys[period]}_${userId}`);
        tx.set(
          entryRef,
          {
            userId,
            userName,
            period,
            periodKey: keys[period],
            points: increment(payout),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    return { claimed: true, alreadyClaimed: false, visitNumber, payout, checkinId };
  });

  // Outside the transaction on purpose: a failed counter write must never
  // block the check-in itself.
  if (result.claimed && !ratingOnly) bumpRegionCheckinCount(region, landmarkId).catch(() => {});

  return result;
}

/**
 * Adds points to a user's CURRENT weekly/monthly/yearly leaderboard entries
 * only -- for anything that awards points outside a check-in (referral and
 * onboarding bonuses), so they count toward rank the same way check-in
 * points do, without retroactively touching periods that had already closed
 * by the time the bonus was earned.
 */
export async function awardLeaderboardPoints(userId, userName, points) {
  if (!db || !userId || !points) return;
  const keys = periodKeys();
  const batch = writeBatch(db);
  for (const period of PERIODS) {
    const entryRef = doc(db, 'leaderboard_entries', `${period}_${keys[period]}_${userId}`);
    batch.set(
      entryRef,
      { userId, userName, period, periodKey: keys[period], points: increment(points), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }
  await batch.commit();
}

/**
 * Rewrites the display name on every existing check-in and leaderboard entry for
 * a user — used when they set/change their username so past scores stop showing
 * an email (or an old handle) on the public board.
 */
export async function backfillUserName(userId, userName) {
  if (!db || !userId || !userName) return;
  const batch = writeBatch(db);
  const [checkins, entries] = await Promise.all([
    getDocs(query(collection(db, 'checkins'), where('userId', '==', userId))),
    getDocs(query(collection(db, 'leaderboard_entries'), where('userId', '==', userId))),
  ]);
  checkins.docs.forEach((d) => batch.update(d.ref, { userName }));
  entries.docs.forEach((d) => batch.update(d.ref, { userName }));
  await batch.commit();
}

/**
 * Saves a photo on the check-in itself (checkins/{uid}_{landmarkId}.photoURL),
 * for check-ins that carry no rating (a dorm, a campus spot, or a rating
 * that didn't save) -- those never get a review doc to hang the photo on.
 * Storage path checkin_photos/{landmarkId}/{uid}.jpg; the Firestore rule
 * lets an owner update photoURL on their own check-in.
 */
export async function attachCheckinPhoto(userId, landmarkId, file) {
  if (!db || !storage || !userId || !landmarkId || !file) return null;
  const storageRef = ref(storage, `checkin_photos/${landmarkId}/${userId}.jpg`);
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
  const photoURL = await getDownloadURL(storageRef);
  await _updateDoc(doc(db, 'checkins', `${userId}_${landmarkId}`), { photoURL });
  return photoURL;
}

/**
 * Admin Mode only -- corrects when a check-in happened (checkins/{checkinId}
 * .createdAt), on ANY check-in, not just the admin's own. Firestore rules
 * enforce this server-side against the same allow-listed admin email
 * (src/lib/admins.js); a non-admin write attempt is rejected there
 * regardless of what the client sends.
 */
export async function updateCheckinTimestamp(checkinId, date) {
  if (!db || !checkinId || !date) return;
  await _updateDoc(doc(db, 'checkins', checkinId), { createdAt: Timestamp.fromDate(date) });
}

// How many personal photos a check-in's own gallery can hold, independent of
// (and on top of) any photos attached to a review.
export const MAX_CHECKIN_PHOTOS = 9;

/**
 * Adds one photo to the check-in's own gallery
 * (checkins/{uid}_{landmarkId}.photoURLs) -- unlike attachCheckinPhoto above
 * (a single photo, meant for the check-in moment itself), this accumulates:
 * you can come back anytime after checking in and add more. Independent of
 * any rating, so it works for every landmark, rateable or not. Storage path
 * checkin_photos/{landmarkId}/{uid}_{timestamp}.jpg keeps each upload its
 * own file instead of overwriting the last one.
 */
export async function addCheckinPhoto(userId, landmarkId, file) {
  if (!db || !storage || !userId || !landmarkId || !file) return null;
  const storageRef = ref(storage, `checkin_photos/${landmarkId}/${userId}_${Date.now()}.jpg`);
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
  const photoURL = await getDownloadURL(storageRef);
  await _updateDoc(doc(db, 'checkins', `${userId}_${landmarkId}`), { photoURLs: arrayUnion(photoURL) });
  return photoURL;
}

/** Removes one photo from the check-in's gallery, and its file in Storage. */
export async function removeCheckinPhoto(userId, landmarkId, photoURL) {
  if (!db || !userId || !landmarkId || !photoURL) return;
  await _updateDoc(doc(db, 'checkins', `${userId}_${landmarkId}`), { photoURLs: arrayRemove(photoURL) });
  if (storage) {
    try {
      await deleteObject(ref(storage, photoURL));
    } catch {
      // Already gone, or the URL didn't parse to a Storage ref -- the
      // Firestore removal above is what actually controls visibility, so
      // this is best-effort cleanup only.
    }
  }
}

/** The user's own check-in doc for a landmark (createdAt, points, photo), or null. */
export async function getMyCheckin(userId, landmarkId) {
  if (!db || !userId || !landmarkId) return null;
  const snap = await getDoc(doc(db, 'checkins', `${userId}_${landmarkId}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function hasClaimedLandmark(userId, landmarkId) {
  const snap = await getDoc(doc(db, 'checkins', `${userId}_${landmarkId}`));
  return snap.exists();
}

/** How many times a user has visited this landmark (real visits, not ratingOnly claims). */
export async function getVisitCount(userId, landmarkId) {
  if (!db || !userId || !landmarkId) return 0;
  const snap = await getDocs(
    query(collection(db, 'checkins'), where('userId', '==', userId), where('landmarkId', '==', landmarkId))
  );
  return snap.docs.map((d) => d.data()).filter(isRealCheckin).length;
}

/**
 * Real check-ins per landmark across every user in one region, as
 * { [landmarkId]: count }. Repeat visits count: they're real demand too.
 * Reads one running counter doc, region_stats/{region}, that claimCheckIn
 * bumps on every real visit. The first read for a region with no
 * backfilled counter counts its check-ins once and saves the totals;
 * two clients racing that both write the same totals, so it's safe.
 * Cached for 10 minutes per region.
 */
const regionCountsCache = new Map();
export async function getRegionCheckinCounts(region) {
  if (!db || !region) return {};
  const hit = regionCountsCache.get(region);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.counts;
  const statsRef = doc(db, 'region_stats', region);
  const stats = await getDoc(statsRef).catch(() => null);
  let counts;
  if (stats?.exists() && stats.data().backfilled) {
    counts = stats.data().counts || {};
  } else {
    const snap = await getDocs(query(collection(db, 'checkins'), where('region', '==', region)));
    counts = {};
    for (const d of snap.docs) {
      const x = d.data();
      if (isRealCheckin(x)) counts[x.landmarkId] = (counts[x.landmarkId] || 0) + 1;
    }
    setDoc(statsRef, { counts, backfilled: true, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  }
  regionCountsCache.set(region, { at: Date.now(), counts });
  return counts;
}

/**
 * Real check-ins per landmark across every region combined, for Mapr Picks
 * when there's no region to score in yet. Reads the region_stats counter
 * docs (one per region, so this stays a handful of reads); a region with no
 * backfilled counter yet gets counted once through getRegionCheckinCounts.
 * Cached for 10 minutes.
 */
let globalCountsCache = null;
export async function getGlobalCheckinCounts() {
  if (!db) return {};
  if (globalCountsCache && Date.now() - globalCountsCache.at < 10 * 60 * 1000) return globalCountsCache.counts;
  const counts = {};
  const add = (map) => {
    for (const [id, n] of Object.entries(map || {})) counts[id] = (counts[id] || 0) + (Number(n) || 0);
  };
  const snap = await getDocs(collection(db, 'region_stats')).catch(() => null);
  const done = new Set();
  for (const d of snap?.docs || []) {
    if (!d.data().backfilled) continue;
    done.add(d.id);
    add(d.data().counts);
  }
  const missing = REGIONS.map((r) => r.id).filter((id) => !done.has(id));
  (await Promise.all(missing.map((id) => getRegionCheckinCounts(id).catch(() => ({}))))).forEach(add);
  globalCountsCache = { at: Date.now(), counts };
  return counts;
}

async function bumpRegionCheckinCount(region, landmarkId) {
  if (!db || !region || !landmarkId) return;
  await setDoc(
    doc(db, 'region_stats', region),
    { counts: { [landmarkId]: increment(1) }, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/**
 * Sums a user's all-time points across every landmark they've checked into.
 * A single-field equality query, so no composite index is needed.
 */
export async function getUserTotalPoints(userId) {
  const snap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', userId)));
  return snap.docs.reduce((sum, d) => sum + (d.data().points || 0), 0);
}

/**
 * One-query rollup of a user's all-time stats: total points, number of
 * check-ins, and how many distinct cities/regions they've visited.
 */
// A real, physical check-in -- excludes the 0-point claims "Rate a
// Landmark" makes (see CheckInContext's ratingOnly flag). Its checkins doc
// is real (Firestore rules require one to exist before its review can be
// written), but it isn't a visit, so it shouldn't count toward check-in/city
// stats, badges, or "already been here" map state. Checked via the
// explicit `visited`/`ratingOnly` fields claimCheckIn now writes on every
// check-in, not `points !== 0` -- a repeat visit inside the home radius or
// past the taper cutoff is still a real, physical visit at 0 payout, so
// points alone can no longer tell "real but unpaid" apart from
// "ratingOnly, never a visit at all". Data written before those fields
// existed has neither, so it falls back to the old points-based rule,
// which was always correct for that older data (no 0-payout reals existed
// yet). Same rule as streaks.js' isRealCheckin -- shared here, not
// duplicated, so every caller (leaderboard, streaks, check-in galleries,
// friend stats, Mapr ratings) agrees on what counts as a real visit.
export function isRealCheckin(x) {
  if (x.ratingOnly) return false;
  if (typeof x.visited === 'boolean') return x.visited;
  return x.points !== 0;
}

export async function getUserStats(userId) {
  const [snap, profile] = await Promise.all([
    getDocs(query(collection(db, 'checkins'), where('userId', '==', userId))),
    getUserProfile(userId).catch(() => null),
  ]);
  let totalPoints = profile?.bonusPoints || 0;
  const regions = new Set();
  const cityLastVisit = {}; // regionId -> most recent check-in, in epoch seconds
  const cityPoints = {}; // regionId -> points earned there
  let checkinsCount = 0;
  snap.docs.forEach((d) => {
    const x = d.data();
    totalPoints += x.points || 0;
    if (!isRealCheckin(x)) return;
    checkinsCount += 1;
    if (x.region) {
      regions.add(x.region);
      const sec = x.createdAt?.seconds || 0;
      if (sec > (cityLastVisit[x.region] || 0)) cityLastVisit[x.region] = sec;
      cityPoints[x.region] = (cityPoints[x.region] || 0) + (x.points || 0);
    }
  });
  // Most-recently-visited city first, same ordering as the check-ins list.
  const cityIds = [...regions].sort((a, b) => (cityLastVisit[b] || 0) - (cityLastVisit[a] || 0));
  return { totalPoints, checkins: checkinsCount, cities: regions.size, cityIds, cityLastVisit, cityPoints };
}

/**
 * Full check-in history for a user (newest first) — id, landmark, region,
 * points, timestamp. Single-field query; sorted client-side. Includes
 * 0-point ratingOnly claims (streaks.js needs those for the daily
 * votes/ratings tally) -- callers that mean "real visits" should filter by
 * points, same as getUserStats/getUserCheckedInLandmarkIds do.
 */
export async function getUserCheckins(userId) {
  if (!db || !userId) return [];
  const snap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', userId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

/**
 * Returns the set of landmark IDs a user has really (physically) checked
 * into -- excludes 0-point ratingOnly claims, so a landmark you've only
 * rated via "Rate a Landmark" doesn't show as already-visited on the map
 * or block the real "Check In" button/points once you actually go.
 */
export async function getUserCheckedInLandmarkIds(userId) {
  const snap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', userId)));
  return snap.docs.map((d) => d.data()).filter(isRealCheckin).map((x) => x.landmarkId);
}

/**
 * Subscribes to the top entries for a leaderboard period. Calls onData with a sorted array.
 * Returns an unsubscribe function.
 */
// Never render a raw email on the public board (privacy). Falls back to the
// part before the "@" for any legacy entry that predates usernames.
export function cleanName(name) {
  if (!name) return 'Explorer';
  return /@.+\./.test(name) ? name.split('@')[0] : name;
}

/**
 * Friends-scoped leaderboard: you plus everyone you follow, ranked by this
 * period's points. Unlike subscribeLeaderboard (top 50 worldwide, real-time),
 * this is a one-shot fetch by uid -- a friend outside the global top 50
 * would never show up there, so this queries leaderboard_entries directly
 * by userId instead of filtering the global top 50 client-side.
 */
export async function getFriendsLeaderboard(period, friendUids, myUid) {
  if (!db) return [];
  const keys = periodKeys();
  const ids = [...new Set([myUid, ...friendUids])].filter(Boolean);
  if (ids.length === 0) return [];
  // Firestore's `in` operator caps at 30 values -- chunk for anyone with an
  // unusually large friends list.
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const results = await Promise.all(
    chunks.map((chunk) =>
      getDocs(
        query(
          collection(db, 'leaderboard_entries'),
          where('period', '==', period),
          where('periodKey', '==', keys[period]),
          where('userId', 'in', chunk)
        )
      )
    )
  );
  return results
    .flatMap((snap) => snap.docs.map((d) => d.data()))
    .sort((a, b) => b.points - a.points);
}

/**
 * Regional leaderboard: ranked by points earned checking in within one
 * curated region (Miami, Milan, etc.) during the current period. There's no
 * per-region leaderboard_entries doc, so this aggregates directly from
 * checkins -- a single-field query (region ==) filtered to this period's
 * check-ins client-side, then summed per user. Fine at this app's current
 * scale; would need a denormalized per-region entry (written alongside the
 * existing per-period ones in claimCheckIn) if a region's check-in volume
 * ever gets large enough to make this slow.
 */
export async function getRegionalLeaderboard(period, regionId, topN = 100) {
  if (!db || !regionId) return [];
  const keys = periodKeys();
  const key = keys[period];
  const snap = await getDocs(query(collection(db, 'checkins'), where('region', '==', regionId)));
  const totals = new Map(); // userId -> { userId, userName, points }
  for (const d of snap.docs) {
    const x = d.data();
    const sec = x.createdAt?.seconds;
    if (!sec) continue;
    if (periodKeys(new Date(sec * 1000))[period] !== key) continue;
    const cur = totals.get(x.userId) || { userId: x.userId, userName: x.userName, points: 0 };
    cur.points += x.points || 0;
    cur.userName = x.userName || cur.userName;
    totals.set(x.userId, cur);
  }
  return [...totals.values()].sort((a, b) => b.points - a.points).slice(0, topN);
}

/**
 * One-shot: is this user currently in the top N of a leaderboard period?
 * Feeds the "Competitor" badge. Rank isn't stored anywhere (see
 * subscribeLeaderboard below) so this is a live snapshot, not a historical
 * guarantee -- it only catches "reached top 10" if the app happens to check
 * while it's still true. Once it does, BadgesContext's badgeEarnedAt makes
 * that permanent, same as every other badge here.
 */
export async function isInTopLeaderboard(userId, period = 'weekly', topN = 10) {
  if (!db || !userId) return false;
  const keys = periodKeys();
  const snap = await getDocs(
    query(
      collection(db, 'leaderboard_entries'),
      where('period', '==', period),
      where('periodKey', '==', keys[period]),
      orderBy('points', 'desc'),
      limit(topN)
    )
  );
  return snap.docs.some((d) => d.data().userId === userId);
}

/**
 * Best-effort "Tag Team" check: did a friend check in to the same landmark
 * as you within 24 hours? Bounded to your 10 most recently first-visited
 * distinct landmarks (checkins is expected newest-first) to keep this to
 * one query instead of scanning your whole history -- a real joint visit
 * is almost always recent, and once earned this badge is permanent (see
 * BadgesContext), so it doesn't need to re-scan everything on every load.
 */
export async function hasFriendTagTeam(userId, friendUids, checkins) {
  if (!db || !userId || !friendUids?.length || !checkins?.length) return false;
  const byLandmark = new Map(); // landmarkId -> my createdAt seconds
  for (const c of checkins) {
    if (!c.landmarkId || !c.createdAt?.seconds) continue;
    if (!byLandmark.has(c.landmarkId)) byLandmark.set(c.landmarkId, c.createdAt.seconds);
  }
  const landmarkIds = [...byLandmark.keys()].slice(0, 10);
  if (!landmarkIds.length) return false;
  const snap = await getDocs(query(collection(db, 'checkins'), where('landmarkId', 'in', landmarkIds)));
  const friendSet = new Set(friendUids);
  return snap.docs.some((d) => {
    const x = d.data();
    if (!friendSet.has(x.userId) || !x.createdAt?.seconds) return false;
    const mySec = byLandmark.get(x.landmarkId);
    return mySec != null && Math.abs(x.createdAt.seconds - mySec) <= 86400;
  });
}

// onError (optional): called if the listener fails (offline too long,
// permission change), so callers can show "couldn't load" instead of an
// endless skeleton.
export function subscribeLeaderboard(period, onData, topN = 50, onError) {
  const keys = periodKeys();
  const q = query(
    collection(db, 'leaderboard_entries'),
    where('period', '==', period),
    where('periodKey', '==', keys[period]),
    orderBy('points', 'desc'),
    limit(topN)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => onError?.(err)
  );
}

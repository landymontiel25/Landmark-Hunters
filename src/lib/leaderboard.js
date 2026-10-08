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
  deleteField,
  writeBatch,
  arrayUnion,
  arrayRemove,
  Timestamp,
} from 'firebase/firestore';
import { sharedRead, invalidating } from './sharedRead';
import { updateDoc as _updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { isOffline, OFFLINE_MESSAGE } from './friendlyError';
import { distanceMeters } from './geo';
import { getUserProfile } from './friends';
import { REGIONS, canonicalLandmarkId } from '../data/regions';
import { CHECKIN_RULE_METERS } from './maprConstants';

export { distanceMeters };

export const POINTS_PER_CHECKIN = 100;
// Default "you're here" radius -- tightened down from an initial 150m
// during build/testing to balance real-world GPS accuracy against making
// the claim meaningful. Individual landmarks can widen this via
// `checkInRadiusMeters` (malls, parks, beaches, national parks, etc.).
export const CHECKIN_RADIUS_METERS = CHECKIN_RULE_METERS; // see maprConstants.js
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

// Points only pay on a user's very first check-in, ever. Check-ins are for
// Mapr (every one keeps logging in full, see claimCheckIn); claimCheckIn
// zeroes the payout once the account has any real check-in anywhere. This
// per-place helper is the second guard: a repeat visit to the same place
// never pays either. firestore.rules still allows the old taper (20 on
// visits 2-5) so older app builds keep working.
export function taperedPoints(basePoints, visitNumber) {
  return visitNumber <= 1 ? basePoints : 0;
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
// Whether this account already has a real (physical) check-in anywhere. The
// cheap path is an indexed equality query on the explicit `visited` flag;
// older docs (before that flag existed) fall back to a full read, which is
// empty for a brand-new account.
async function hasAnyRealCheckin(userId) {
  const flagged = await getDocs(
    query(collection(db, 'checkins'), where('userId', '==', userId), where('visited', '==', true), limit(1))
  );
  if (flagged.docs.some((d) => isRealCheckin(d.data()))) return true;
  const all = await getDocs(query(collection(db, 'checkins'), where('userId', '==', userId)));
  return all.docs.some((d) => isRealCheckin(d.data()));
}

async function _claimCheckIn({
  userId,
  userName,
  landmarkId,
  landmarkName,
  region,
  points = POINTS_PER_CHECKIN,
  ratingOnly = false,
  homeCoords = null,
  landmarkCoords = null,
  // { distanceMeters?, gpsAccuracyMeters?, verification } from
  // checkinLocationFields. Saved on real check-ins only; a rating-only claim
  // is not a visit and stays untagged.
  location = null,
}) {
  // A check-in is a server transaction, so it can't be queued offline; without
  // this it spent ~25s on "Posting..." (transaction retries) before failing.
  if (isOffline()) throw Object.assign(new Error(OFFLINE_MESSAGE), { userMessage: OFFLINE_MESSAGE });
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
  // Highest existing visit index, not the doc count: deleting a check-in
  // leaves a gap, and count+1 would then collide with a surviving doc id.
  const base = `${userId}_${landmarkId}`;
  let maxIdx = 0;
  for (const d of priorSnap.docs) {
    if (d.id === base) maxIdx = Math.max(maxIdx, 1);
    else if (d.id?.startsWith(`${base}_`) && /^\d+$/.test(d.id.slice(base.length + 1))) {
      maxIdx = Math.max(maxIdx, Number(d.id.slice(base.length + 1)));
    }
  }
  const docNumber = Math.max(priorSnap.size, maxIdx) + 1;
  const realPrior = priorSnap.docs.filter((d) => isRealCheckin(d.data())).length;
  const visitNumber = realPrior + 1;
  const checkinId = docNumber === 1 ? `${userId}_${landmarkId}` : `${userId}_${landmarkId}_${docNumber}`;
  const checkinRef = doc(db, 'checkins', checkinId);
  const keys = periodKeys();

  const insideHomeRadius =
    !!homeCoords &&
    !!landmarkCoords &&
    distanceMeters(homeCoords.lat, homeCoords.lng, landmarkCoords.lat, landmarkCoords.lng) <= HOME_RADIUS_METERS;
  // Only the account's first real check-in pays. Any earlier real check-in,
  // at this place or any other, means this one is just for Mapr.
  const hadEarlierCheckin = ratingOnly ? false : await hasAnyRealCheckin(userId);
  const payout =
    ratingOnly || hadEarlierCheckin || (HOME_RADIUS_EXCLUSION_ENABLED && insideHomeRadius)
      ? 0
      : taperedPoints(points, visitNumber);

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
      ...(!ratingOnly && location ? location : {}),
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
  const batch = writeBatch(db);
  addLeaderboardPointsToBatch(batch, userId, userName, points);
  await batch.commit();
}

/**
 * The same award, added to a caller's batch -- so a bonus can commit in ONE
 * atomic write with the bonusPoints bump and the flag that earns it (the
 * rules check those together; see referrals.js).
 */
export function addLeaderboardPointsToBatch(batch, userId, userName, points) {
  const keys = periodKeys();
  for (const period of PERIODS) {
    const entryRef = doc(db, 'leaderboard_entries', `${period}_${keys[period]}_${userId}`);
    batch.set(
      entryRef,
      { userId, userName, period, periodKey: keys[period], points: increment(points), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }
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
 * Saves a photo from the check-in moment onto the check-in
 * (checkins/{uid}_{landmarkId}), for check-ins that carry no rating (a dorm,
 * a campus spot, or a rating that didn't save). It adds to the same gallery
 * as addCheckinPhoto, each in its own Storage file, so a second photo (or a
 * later visit's) never overwrites the first.
 */
async function _attachCheckinPhoto(userId, landmarkId, file) {
  return addCheckinPhoto(userId, landmarkId, file);
}

/**
 * Admin Mode only -- corrects when a check-in happened (checkins/{checkinId}
 * .createdAt), on ANY check-in, not just the admin's own. Firestore rules
 * enforce this server-side against the same allow-listed admin email
 * (src/lib/admins.js); a non-admin write attempt is rejected there
 * regardless of what the client sends.
 */
async function _updateCheckinTimestamp(checkinId, date) {
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
async function _addCheckinPhoto(userId, landmarkId, file) {
  if (!db || !storage || !userId || !landmarkId || !file) return null;
  // The gallery holds MAX_CHECKIN_PHOTOS. The check-in popup adds up to 3
  // per visit, so without this a few visits filled it past the cap (and the
  // landmark page then hid "Add photo" with no word why).
  const existing = await getDoc(doc(db, 'checkins', `${userId}_${landmarkId}`)).catch(() => null);
  const data = existing?.exists() ? existing.data() : null;
  const have = (data?.photoURLs?.length || 0) + (data?.photoURL && !(data.photoURLs || []).includes(data.photoURL) ? 1 : 0);
  if (have >= MAX_CHECKIN_PHOTOS) {
    const err = new Error(`This check-in already has ${MAX_CHECKIN_PHOTOS} photos, the most it can hold.`);
    err.userMessage = err.message;
    throw err;
  }
  const storageRef = ref(storage, `checkin_photos/${landmarkId}/${userId}_${Date.now()}${Math.floor(Math.random() * 1000)}.jpg`);
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
  const photoURL = await getDownloadURL(storageRef);
  await _updateDoc(doc(db, 'checkins', `${userId}_${landmarkId}`), { photoURLs: arrayUnion(photoURL) });
  return photoURL;
}

/** Removes one photo from the check-in's gallery, and its file in Storage. */
async function _removeCheckinPhoto(userId, landmarkId, photoURL) {
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
  if (!snap.exists()) return null;
  const base = { id: snap.id, ...snap.data() };
  // The first doc id is taken by a "Rate a Landmark" claim if you rated a
  // place before ever visiting it -- its date is when you RATED, not when you
  // checked in. Show the first real visit's date instead (photos and other
  // fields stay on the first doc, which is where they're written).
  if (!isRealCheckin(base)) {
    try {
      const all = await getDocs(
        query(collection(db, 'checkins'), where('userId', '==', userId), where('landmarkId', '==', landmarkId))
      );
      const real = all.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(isRealCheckin)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))[0];
      if (real?.createdAt) return { ...base, createdAt: real.createdAt, visitDocId: real.id };
    } catch {
      /* fall back to the rating claim's own date */
    }
  }
  return base;
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
    // check-ins need a signed-in user; signed out, there is nothing to count.
    const snap = await getDocs(query(collection(db, 'checkins'), where('region', '==', region))).catch(() => null);
    if (!snap) return {};
    counts = {};
    for (const d of snap.docs) {
      const x = d.data();
      if (isRealCheckin(x)) counts[x.landmarkId] = (counts[x.landmarkId] || 0) + 1;
    }
    setDoc(statsRef, { counts, backfilled: true, lastBump: deleteField(), updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
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
    // lastBump names the one landmark being bumped -- firestore.rules allows
    // exactly +1 on that key (and only for someone who has checked in there).
    { counts: { [landmarkId]: increment(1) }, lastBump: landmarkId, updatedAt: serverTimestamp() },
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
  return sharedRead(`checkins:${userId}`, async () => {
    const snap = await getDocs(query(collection(db, 'checkins'), where('userId', '==', userId)));
    return snap.docs
      .map((d) => {
        const c = { id: d.id, ...d.data() };
        return { ...c, landmarkId: canonicalLandmarkId(c.landmarkId, c.region) };
      })
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  });
}

/**
 * Returns the set of landmark IDs a user has really (physically) checked
 * into -- excludes 0-point ratingOnly claims, so a landmark you've only
 * rated via "Rate a Landmark" doesn't show as already-visited on the map
 * or block the real "Check In" button/points once you actually go.
 */
export async function getUserCheckedInLandmarkIds(userId) {
  // Shares the one check-ins read getUserCheckins already makes at startup.
  const rows = await getUserCheckins(userId);
  return rows.filter(isRealCheckin).map((x) => canonicalLandmarkId(x.landmarkId, x.region));
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
    // `id` matters: the board rows are keyed on it (the global listener
    // path adds it too), and without it every row's key is undefined.
    .flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    .sort((a, b) => b.points - a.points);
}

/**
 * Competition ("1224") rank of entries[idx] on a points-sorted board: people
 * on the same points share a rank, so a tie never shows one of them a worse
 * number than the other.
 */
export function rankOf(entries, idx) {
  if (idx < 0 || idx >= entries.length) return null;
  return entries.findIndex((x) => x.points === entries[idx].points) + 1;
}

/**
 * Your own entry for this period, wherever you rank -- the global board only
 * lists the top N, so someone further down would otherwise look like they
 * have no points at all.
 */
export async function getMyLeaderboardEntry(period, userId) {
  if (!db || !userId) return null;
  const keys = periodKeys();
  const snap = await getDoc(doc(db, 'leaderboard_entries', `${period}_${keys[period]}_${userId}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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

export const claimCheckIn = invalidating(_claimCheckIn);

export const attachCheckinPhoto = invalidating(_attachCheckinPhoto);

export const updateCheckinTimestamp = invalidating(_updateCheckinTimestamp);

export const addCheckinPhoto = invalidating(_addCheckinPhoto);

export const removeCheckinPhoto = invalidating(_removeCheckinPhoto);

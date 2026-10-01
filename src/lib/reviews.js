import {
  doc,
  getDoc,
  getDocs,
  runTransaction,
  collection,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc,
  addDoc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';
import { tierStars, COMMENT_MAX } from './ratingFlow';
import { applyRating, revertRating } from './tagScores';

// An Error whose message was written for travelers, not developers --
// friendlyError() shows `userMessage` as-is instead of a generic fallback.
function userError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

// `visibility` and `hidden` are copies kept on every review so a landmark's
// Comments can be listed at all: Firestore refuses any list query it can't
// prove safe, and it can't look up each author's privacy setting mid-query
// (see the reviews list rule in firestore.rules). visibility mirrors the
// author's users/{uid}.public; hidden is "reported by 2+ people".
const visibilityFor = (userData) => (userData?.public ? 'public' : 'private');
const hiddenFor = (reviewData) => (reviewData?.reportedBy?.length || 0) >= 2;

// localStorage key for a rating that's been started but not saved yet
// (see RatingFlow's draftKey) -- per account AND landmark, so a shared
// device never shows one person's half-finished rating to another.
export function ratingDraftKey(userId, landmarkId) {
  return userId && landmarkId ? `rating.${userId}.${landmarkId}` : null;
}

// Reject after `ms` so a stalled Storage upload (bucket not enabled, blocked by
// rules, CORS, or just slow) can never hang the whole save forever.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timed out')), ms)),
  ]);
}


// Moves the user's per-region tag scores from `prev` rating (if any) to
// `next` rating (if any): the old rating's effect is taken back out before
// the new one goes in, and an unchanged rating touches nothing. Returns the
// fields to merge into users/{uid}, or null for no change.
function tagScoreUpdate(userData, prev, next, nowMs) {
  const same =
    prev && next && prev.region === next.region && prev.tier === next.tier &&
    (prev.visitFrequency || null) === (next.visitFrequency || null) &&
    JSON.stringify([...(prev.categories || [])].sort()) === JSON.stringify([...(next.categories || [])].sort());
  if (same) return null;
  const maps = {};
  const get = (region) =>
    (maps[region] ||= {
      scores: { ...(userData?.tagScores?.[region] || {}) },
      at: { ...(userData?.tagScoresAt?.[region] || {}) },
      counts: { ...(userData?.tagCounts?.[region] || {}) },
    });
  let touched = false;
  if (prev?.region && prev.tier) {
    const m = get(prev.region);
    const r = revertRating(m, prev.categories, prev.tier, prev.visitFrequency);
    Object.assign(m.scores, r.scores);
    Object.assign(m.counts, r.counts);
    touched = Object.keys(r.scores).length > 0;
  }
  if (next?.region && next.tier) {
    const m = get(next.region);
    const r = applyRating(m, next.categories, next.tier, nowMs, next.visitFrequency);
    Object.assign(m.scores, r.scores);
    Object.assign(m.at, r.at);
    Object.assign(m.counts, r.counts);
    touched = touched || Object.keys(r.scores).length > 0;
  }
  if (!touched) return null;
  const out = { tagScores: {}, tagScoresAt: {}, tagCounts: {} };
  for (const [region, m] of Object.entries(maps)) {
    out.tagScores[region] = m.scores;
    out.tagScoresAt[region] = m.at;
    out.tagCounts[region] = m.counts;
  }
  return out;
}

/**
 * Submit (or update) a user's rating for a landmark. `rating` is the
 * RatingFlow payload: { tier, highlights, lovedOrder, dislikedOrder }. Gated
 * on having a check-in for that landmark. Keeps a running aggregate in
 * `landmark_ratings` so average + count are cheap to read -- `stars` is
 * derived from the tier (5/3/1) purely to feed that aggregate, which every
 * card's star display and the Top Rated sort are built on. Editing your
 * rating adjusts the sum by the delta rather than double-counting. Optional
 * photos are uploaded to Storage and their URLs saved on the review.
 */
export async function submitReview({ userId, userName, landmark, rating, photoFiles, photoFile }) {
  const landmarkId = landmark.id;
  // stars is derived from the tier (I loved it / It was okay / Not for me)
  // for the landmark_ratings aggregate's math -- the UI only ever picks a
  // tier now. The plain rating.stars fallback below is just for any
  // leftover pre-tier data, not a live input path.
  const stars = rating?.tier ? tierStars(rating.tier) : Number(rating?.stars) || 0;
  if (!stars) throw userError('Pick a rating first.');

  // Must have checked in here first.
  const checkin = await getDoc(doc(db, 'checkins', `${userId}_${landmarkId}`));
  if (!checkin.exists()) {
    throw userError('Check in at this landmark first to leave a rating.');
  }

  // Up to 3 photos. Accepts an array (photoFiles) or a single file (photoFile).
  const files = (photoFiles && photoFiles.length ? photoFiles : photoFile ? [photoFile] : [])
    .filter(Boolean)
    .slice(0, 3);
  const photoURLs = [];
  let photoFailed = false;
  if (files.length && storage) {
    for (let i = 0; i < files.length; i++) {
      try {
        // Unique name per upload (rules allow {uid}_{digits}.jpg): a later photo
        // must never overwrite an earlier one's file.
        const path = `review_photos/${landmarkId}/${userId}_${Date.now()}${i}.jpg`;
        const storageRef = ref(storage, path);
        await withTimeout(uploadBytes(storageRef, files[i], { contentType: files[i].type || 'image/jpeg' }), 20000);
        photoURLs.push(await withTimeout(getDownloadURL(storageRef), 10000));
      } catch {
        // A stalled/failed upload never blocks the rating from saving.
        photoFailed = true;
      }
    }
  }

  const reviewRef = doc(db, 'reviews', `${userId}_${landmarkId}`);
  const aggRef = doc(db, 'landmark_ratings', landmarkId);
  const userRef = doc(db, 'users', userId);

  const writeReview = () =>
    runTransaction(db, async (tx) => {
      const prev = await tx.get(reviewRef);
      const agg = await tx.get(aggRef);
      const userSnap = await tx.get(userRef);
      // Copied up front: everything below reads the pre-edit review.
      const pd = prev.exists() ? { ...prev.data() } : null;
      const prevStars = prev.exists() ? prev.data().stars || 0 : 0;
      // A doc that only holds a comment or love note has no stars and was
      // never counted in the aggregate, so rating it adds to the count.
      const hadReview = prev.exists() && prevStars > 0;
      const curSum = agg.exists() ? agg.data().sum || 0 : 0;
      const curCount = agg.exists() ? agg.data().count || 0 : 0;
      const newSum = curSum - prevStars + stars;
      const newCount = curCount + (hadReview ? 0 : 1);

      tx.set(
        aggRef,
        { landmarkId, sum: newSum, count: newCount, avg: newCount ? newSum / newCount : 0, updatedAt: serverTimestamp() },
        { merge: true }
      );
      tx.set(
        reviewRef,
        {
          userId,
          userName,
          landmarkId,
          landmarkName: landmark.name,
          region: landmark.region,
          stars,
          // null (not undefined -- the SDK rejects that) in star mode, so a
          // saved review unambiguously says which flow it came from.
          ratingTier: rating.tier || null,
          highlights: rating.highlights || [],
          lovedOrder: rating.lovedOrder || [],
          dislikedOrder: rating.dislikedOrder || [],
          // How often they visit (FREQUENCIES in ratingFlow.js) -- optional,
          // scales how hard this rating moves tagScores (applyRating).
          visitFrequency: rating.visitFrequency || null,
          // Only a comment the caller actually sent changes it: a form that
          // never loaded the saved one must not blank it.
          comment: rating.comment === undefined && prev.exists() ? prev.data().comment || '' : (rating.comment || '').slice(0, COMMENT_MAX),
          // Denormalized (like landmarkName/region above) so the taste card
          // can tally categories without a read per review.
          categories: landmark.categories || [],
          ...(photoURLs.length ? { photoURLs: [...(prev.exists() ? prev.data().photoURLs || [] : []), ...photoURLs] } : {}),
          visibility: visibilityFor(userSnap.exists() ? userSnap.data() : null),
          hidden: hiddenFor(prev.exists() ? prev.data() : null),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Mapr Picks' per-region tag scores (see tagScores.js). Inside this
      // transaction so a retried save never counts the same rating twice;
      // an edit swaps the old rating's effect for the new one.
      const upd = tagScoreUpdate(
        userSnap.exists() ? userSnap.data() : {},
        pd?.ratingTier ? { region: pd.region, tier: pd.ratingTier, categories: pd.categories, visitFrequency: pd.visitFrequency } : null,
        landmark.region && rating.tier
          ? { region: landmark.region, tier: rating.tier, categories: landmark.categories, visitFrequency: rating.visitFrequency }
          : null,
        Date.now()
      );
      if (upd) tx.set(userRef, upd, { merge: true });
    });

  // The review's create rule checks `exists(checkins/...)` for the check-in
  // we just wrote a moment ago. Firestore explicitly does NOT guarantee
  // strong consistency for a security rule's own get()/exists() calls
  // against other documents (unlike direct reads/writes to the target doc
  // itself), so that check can occasionally see stale data and wrongly deny
  // this write right after a fresh check-in. Retry through that brief
  // window instead of surfacing a permission error for something that
  // legitimately just happened.
  for (let attempt = 1; ; attempt++) {
    try {
      await writeReview();
      break;
    } catch (e) {
      if (e.code !== 'permission-denied' || attempt >= 3) throw e;
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }

  return { photoURLs, photoFailed };
}

/** All of a user's review photos, as { [landmarkId]: [photoURL, ...] }. */
export async function getUserReviewPhotos(userId) {
  if (!db || !userId) return {};
  const snap = await getDocs(query(collection(db, 'reviews'), where('userId', '==', userId)));
  const map = {};
  snap.docs.forEach((d) => {
    const x = d.data();
    const photos = x.photoURLs?.length ? x.photoURLs : x.photoURL ? [x.photoURL] : [];
    if (photos.length) map[x.landmarkId] = photos;
  });
  return map;
}

/** Every review a user has written, raw. Feeds ratingsCount and the taste card. */
export async function getUserReviews(userId) {
  if (!db || !userId) return [];
  const snap = await getDocs(query(collection(db, 'reviews'), where('userId', '==', userId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getMyReview(userId, landmarkId) {
  if (!db || !userId) return null;
  const snap = await getDoc(doc(db, 'reviews', `${userId}_${landmarkId}`));
  return snap.exists() ? snap.data() : null;
}

/** Load every landmark's aggregate rating as { [landmarkId]: { avg, count } }. */
export async function getAllRatings() {
  if (!db) return {};
  const snap = await getDocs(collection(db, 'landmark_ratings'));
  const map = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    map[d.id] = { avg: data.avg || 0, count: data.count || 0 };
  });
  return map;
}

/**
 * A landmark's comments you're allowed to see: public ones, your own, and
 * your friends' (friends-only accounts) -- only reviews with written text. Three queries because Firestore
 * only runs a list query its rules can prove safe -- a plain "every review
 * of this landmark" query is always refused (see firestore.rules). Single-
 * or equality-only filters, so no composite index is needed.
 */
export async function getLandmarkReviews(landmarkId, { uid = null, friendUids = [] } = {}) {
  if (!db) return [];
  const col = collection(db, 'reviews');
  const publicQ = getDocs(
    query(col, where('landmarkId', '==', landmarkId), where('visibility', '==', 'public'), where('hidden', '==', false), limit(100))
  );
  const mineQ = uid ? getDoc(doc(db, 'reviews', `${uid}_${landmarkId}`)).catch(() => null) : Promise.resolve(null);
  const friendChunks = [];
  const friends = [...new Set(friendUids)].filter((f) => f && f !== uid);
  for (let i = 0; i < friends.length; i += 10) friendChunks.push(friends.slice(i, i + 10));
  const friendQs = friendChunks.map((chunk) =>
    getDocs(query(col, where('landmarkId', '==', landmarkId), where('userId', 'in', chunk), where('hidden', '==', false))).catch(() => null)
  );
  const [pub, mine, ...friendSnaps] = await Promise.all([publicQ, mineQ, ...friendQs]);
  const byId = new Map();
  for (const d of pub.docs) byId.set(d.id, { id: d.id, ...d.data() });
  for (const snap of friendSnaps) snap?.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  if (mine?.exists()) byId.set(mine.id, { id: mine.id, ...mine.data() });
  return [...byId.values()]
    // A rating on its own isn't a comment -- only reviews with written text show.
    .filter((r) => (r.comment || '').trim())
    .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
}

/**
 * Brings your own reviews' visibility/hidden copies in line with your
 * profile privacy -- after flipping Public/Private, and once per session
 * for reviews saved before those fields existed. Best effort per review.
 */
export async function syncMyReviewVisibility(uid, isPublic) {
  if (!db || !uid) return 0;
  const want = isPublic ? 'public' : 'private';
  const snap = await getDocs(query(collection(db, 'reviews'), where('userId', '==', uid)));
  const stale = snap.docs.filter((d) => d.data().visibility !== want || d.data().hidden !== hiddenFor(d.data()));
  await Promise.allSettled(stale.map((d) => updateDoc(d.ref, { visibility: want, hidden: hiddenFor(d.data()) })));
  return stale.length;
}

/**
 * Flag a review. Appends the reporter's uid to the review's own `reportedBy`
 * array -- firestore.rules independently enforces that each uid can only be
 * added once and only by someone other than the review's author, so once
 * REPORT_HIDE_THRESHOLD distinct people have reported it, the read rule
 * hides it from everyone but the author and admins. No separate "reports"
 * collection needed; this is the actual enforcement, not just a client-side
 * filter.
 */
export async function reportReview({ reporterUid, review }) {
  const ref = doc(db, 'reviews', review.id);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists()) return;
    const reportedBy = cur.data().reportedBy || [];
    if (reportedBy.includes(reporterUid)) return;
    const next = [...reportedBy, reporterUid];
    // `hidden` has to flip in the same write as the 2nd report (the rules check it).
    tx.update(ref, { reportedBy: next, hidden: next.length >= 2 });
  });
}

/** Delete your own review and roll its stars back out of the aggregate. */
export async function deleteMyReview(userId, landmarkId) {
  const reviewRef = doc(db, 'reviews', `${userId}_${landmarkId}`);
  const aggRef = doc(db, 'landmark_ratings', landmarkId);
  const userRef = doc(db, 'users', userId);
  await runTransaction(db, async (tx) => {
    const prev = await tx.get(reviewRef);
    if (!prev.exists()) return;
    const s = prev.data().stars || 0;
    const userSnap = await tx.get(userRef);
    // A comment-only doc was never counted in the aggregate; just delete it.
    if (!s) {
      tx.delete(reviewRef);
      return;
    }
    const agg = await tx.get(aggRef);
    // Roll the rating back out of Mapr's taste profile too.
    const pd = prev.data();
    const upd = tagScoreUpdate(
      userSnap.exists() ? userSnap.data() : {},
      pd.ratingTier ? { region: pd.region, tier: pd.ratingTier, categories: pd.categories, visitFrequency: pd.visitFrequency } : null,
      null,
      Date.now()
    );
    if (upd) tx.set(userRef, upd, { merge: true });
    const curSum = agg.exists() ? agg.data().sum || 0 : 0;
    const curCount = agg.exists() ? agg.data().count || 0 : 0;
    const newCount = Math.max(0, curCount - 1);
    const newSum = Math.max(0, curSum - s);
    tx.set(aggRef, { sum: newSum, count: newCount, avg: newCount ? newSum / newCount : 0, updatedAt: serverTimestamp() }, { merge: true });
    tx.delete(reviewRef);
  });
}

/**
 * Adds or edits just the comment on your check-in, any time after -- with
 * or without a rating. Lives on the same reviews/{uid}_{landmarkId} doc a
 * rating does (a merge, so tier, photos and love notes are untouched), and
 * firestore.rules only allows it once you've checked in there.
 */
export async function saveMyComment({ userId, landmark, comment }) {
  const text = (comment || '').trim().slice(0, COMMENT_MAX);
  const ref = doc(db, 'reviews', `${userId}_${landmark.id}`);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const user = await tx.get(doc(db, 'users', userId));
    const username = user.exists() ? user.data().username : null;
    tx.set(
      ref,
      {
        userId,
        userName: username || (cur.exists() ? cur.data().userName : null) || 'Explorer',
        landmarkId: landmark.id,
        landmarkName: landmark.name,
        region: landmark.region ?? landmark.regionId,
        comment: text,
        visibility: visibilityFor(user.exists() ? user.data() : null),
        hidden: hiddenFor(cur.exists() ? cur.data() : null),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
  return text;
}

/**
 * Stores the answer to "why do you love this place" (the repeat-visit
 * prompt at visit 3, 13, 23, ... -- see shouldPromptLoveReason in
 * leaderboard.js) on the same reviews/{uid}_{landmarkId} doc a rating
 * lives on, so maprPicks/plan-ai's trait matching -- which already reads a
 * review's `comment` -- picks it up for free by joining it in with any
 * loveNotes. Doesn't require a rating to already exist (checking in 3
 * times without ever tapping a tier is possible), so this is a merge, not
 * an update -- the create-or-update case is identical here since the only
 * field touched either way is loveNotes.
 */
export async function appendLoveNote(userId, landmarkId, landmark, note) {
  const text = (note || '').trim().slice(0, 280);
  if (!db || !userId || !landmarkId || !text) return;
  const reviewRef = doc(db, 'reviews', `${userId}_${landmarkId}`);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(reviewRef);
    const user = await tx.get(doc(db, 'users', userId));
    tx.set(
      reviewRef,
      {
        userId,
        landmarkId,
        landmarkName: landmark?.name,
        region: landmark?.region ?? landmark?.regionId,
        loveNotes: arrayUnion(text),
        visibility: visibilityFor(user.exists() ? user.data() : null),
        hidden: hiddenFor(cur.exists() ? cur.data() : null),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/** The most recent "why do you love this place" answer for a landmark, or null. */
export async function getLoveNote(userId, landmarkId) {
  if (!db || !userId || !landmarkId) return null;
  const snap = await getDoc(doc(db, 'reviews', `${userId}_${landmarkId}`));
  const notes = snap.exists() ? snap.data().loveNotes : null;
  return notes?.length ? notes[notes.length - 1] : null;
}

/** One reply level on a review -- see firestore.rules for who can read/write. */
export async function getReplies(reviewId) {
  if (!db) return [];
  const snap = await getDocs(
    query(collection(db, 'reviews', reviewId, 'replies'), orderBy('createdAt', 'asc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addReply(reviewId, { uid, userName, text }) {
  await addDoc(collection(db, 'reviews', reviewId, 'replies'), {
    uid,
    userName,
    text: text.slice(0, 500),
    createdAt: serverTimestamp(),
  });
}

export async function deleteReply(reviewId, replyId) {
  await deleteDoc(doc(db, 'reviews', reviewId, 'replies', replyId));
}

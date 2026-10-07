import {
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { sharedRead, invalidating } from './sharedRead';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';
import { settleWrite } from './offlineWrite';
import { tierStars, isValidTier, COMMENT_MAX } from './ratingFlow';
import { planLearning } from './maprLearning';
import { disagreementCheck, isDisagreementReason, ratedAtMs, reasonFromComment } from './rerating';
import { pickMarkFields } from './pickMarks';
import { scheduleTasteRecompute } from './tasteScoreStore';
import { canonicalLandmarkId } from '../data/regions';

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

export const MAX_REVIEW_PHOTOS = 3;

// Reject after `ms` so a stalled Storage upload (bucket not enabled, blocked by
// rules, CORS, or just slow) can never hang the whole save forever.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timed out')), ms)),
  ]);
}


// Mapr's learning for one place (maprLearning.js), run inside the caller's
// transaction: moves the type score (tag scores on users/{uid}) and the place
// score (users/{uid}/place_scores/{landmarkId}) from what was applied before
// to what the new answers say, taking the old effect out first. `legacyRating`
// is a review saved before place_scores existed.
const placeScoresRef = (uid, landmarkId) => doc(db, 'users', uid, 'place_scores', landmarkId);

function legacyRatingOf(pd) {
  return pd?.ratingTier
    ? { tier: pd.ratingTier, frequency: pd.visitFrequency || null, region: pd.region, categories: pd.categories || [] }
    : null;
}

function writeLearning(tx, { userRef, placeRef, userSnap, placeSnap, pd, landmark, next, nowMs }) {
  const { userPatch, ledger } = planLearning({
    user: userSnap?.exists() ? userSnap.data() : {},
    prev: placeSnap?.exists() ? placeSnap.data() : null,
    legacy: { rating: legacyRatingOf(pd) },
    landmark,
    next,
    nowMs,
  });
  if (userPatch) tx.set(userRef, userPatch, { merge: true });
  if (ledger) tx.set(placeRef, { ...ledger, updatedAt: serverTimestamp() });
  else if (placeSnap?.exists()) tx.delete(placeRef);
}

/**
 * Submit (or update) a user's rating for a landmark. `rating` is the
 * RatingFlow payload: { tier, highlights, lovedOrder, dislikedOrder }. The
 * tier (I loved it / Ok / I didn't like it) is mandatory: every review has
 * one, and a comment is only ever saved together with it (firestore.rules
 * enforces the same). No check-in is needed -- rating a place you haven't
 * been to helps Mapr learn; a later real check-in prompts a fresh rating
 * that replaces this one. Keeps a running aggregate in `landmark_ratings`
 * so average + count are cheap to read -- `stars` is derived from the tier
 * (5/3/1) purely to feed that aggregate, which every card's star display and
 * the Top Rated sort are built on. Editing your rating adjusts the sum by
 * the delta rather than double-counting. Optional photos are uploaded to
 * Storage and their URLs saved on the review.
 */
async function _submitReview({ userId, userName, landmark, rating, photoFiles, photoFile, disagreement }) {
  const landmarkId = landmark.id;
  if (!isValidTier(rating?.tier)) throw userError('Pick how it was first: I loved it, Ok, or I didn\'t like it.');
  const stars = tierStars(rating.tier);

  // Up to 3 photos. Accepts an array (photoFiles) or a single file (photoFile).
  const files = (photoFiles && photoFiles.length ? photoFiles : photoFile ? [photoFile] : [])
    .filter(Boolean)
    .slice(0, 3);
  const photoURLs = [];
  let photoFailed = false;
  if (files.length) {
    // A review holds at most 3 photos in total; an edit appends to what's there.
    const existing = await getDoc(doc(db, 'reviews', `${userId}_${landmarkId}`)).catch(() => null);
    const have = existing?.exists() ? existing.data().photoURLs?.length || 0 : 0;
    if (have + files.length > MAX_REVIEW_PHOTOS) {
      const over = have + files.length - MAX_REVIEW_PHOTOS;
      throw userError(
        have >= MAX_REVIEW_PHOTOS
          ? `Your rating already has ${MAX_REVIEW_PHOTOS} photos, the most it can hold. Remove the new photo${files.length === 1 ? '' : 's'} to save.`
          : `A rating holds up to ${MAX_REVIEW_PHOTOS} photos and yours already has ${have}. Remove ${over} new photo${over === 1 ? '' : 's'} to save.`
      );
    }
  }
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

  // Present only if this place was shown as a Mapr pick recently; {} otherwise
  // so an existing mark on an edited review is never wiped.
  const pickMarks = pickMarkFields(userId, landmarkId);
  const reviewRef = doc(db, 'reviews', `${userId}_${landmarkId}`);
  const aggRef = doc(db, 'landmark_ratings', landmarkId);
  const userRef = doc(db, 'users', userId);

  const writeReview = () =>
    runTransaction(db, async (tx) => {
      const prev = await tx.get(reviewRef);
      const agg = await tx.get(aggRef);
      const userSnap = await tx.get(userRef);
      const placeRef = placeScoresRef(userId, landmarkId);
      const placeSnap = await tx.get(placeRef);
      // Copied up front: everything below reads the pre-edit review.
      const pd = prev.exists() ? { ...prev.data() } : null;
      const placeData = placeSnap.exists() ? placeSnap.data() : null;
      const nowMs = Date.now();

      // Re-rating and "your answer changed a lot" (docs/rerating.md). The first
      // rating's time is kept forever (ratedAt); a re-rating to a different
      // level keeps the old level and when it was given (priorTier/priorRatedAt).
      const hadTier = !!pd?.ratingTier;
      const ratedAt = pd?.ratedAt ?? (hadTier ? ratedAtMs(pd) : null) ?? nowMs;
      const tierChanged = hadTier && pd.ratingTier !== rating.tier;
      const priorFields = tierChanged ? { priorTier: pd.ratingTier, priorRatedAt: placeData?.ratingAt || ratedAtMs(pd) || ratedAt } : {};
      // Two levels apart from the user's own earlier answer: how the new
      // answer counts comes from what they said (asked), else from their
      // comment; with neither, it just replaces the old one as before.
      const check = disagreementCheck({ prev: pd, place: placeData, newTier: rating.tier });
      const commentText = rating.comment === undefined ? pd?.comment || '' : rating.comment || '';
      let resolution = null;
      let disagreementDoc = null;
      if (check.needed) {
        let reason = null;
        let note = '';
        let source = 'asked';
        if (disagreement && isDisagreementReason(disagreement.reason)) {
          reason = disagreement.reason;
          note = String(disagreement.comment || '').trim().slice(0, COMMENT_MAX);
        } else {
          reason = reasonFromComment(commentText);
          note = commentText.trim().slice(0, COMMENT_MAX);
          source = 'comment';
        }
        if (reason) {
          resolution = { reason, oldLevel: check.oldLevel, oldKind: check.oldKind };
          disagreementDoc = { reason, comment: note, at: nowMs, source };
        }
      }
      const prevStars = prev.exists() ? prev.data().stars || 0 : 0;
      // A legacy doc that only holds a comment or love note has no stars and
      // was never counted in the aggregate, so rating it adds to the count.
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
          ratingTier: rating.tier,
          highlights: rating.highlights || [],
          lovedOrder: rating.lovedOrder || [],
          dislikedOrder: rating.dislikedOrder || [],
          // How often they visit (FREQUENCIES in ratingFlow.js) -- optional,
          // scales how hard this rating moves tagScores (applyRating).
          visitFrequency: rating.visitFrequency || null,
          ratedAt,
          // Given during sign-up onboarding: the taste score learns from it
          // but never counts it as a guess (tasteEstimate.js). A later
          // change of answer is an ordinary rating.
          fromOnboarding: tierChanged ? false : hadTier ? pd.fromOnboarding === true : rating.fromOnboarding === true,
          ...priorFields,
          // A new answer that moved two levels says why; a re-rating without
          // such a change clears the old answer's explanation.
          ...(disagreementDoc ? { disagreement: disagreementDoc } : tierChanged ? { disagreement: null } : {}),
          // Only a comment the caller actually sent changes it: a form that
          // never loaded the saved one must not blank it.
          comment:
            rating.comment === undefined && prev.exists()
              ? prev.data().comment || ''
              : (rating.comment || '').slice(0, COMMENT_MAX),
          // Denormalized (like landmarkName/region above) so the taste card
          // can tally categories without a read per review. A caller that
          // doesn't know them (a comment edit) keeps what's on file.
          categories: landmark.categories?.length ? landmark.categories : prev.exists() ? prev.data().categories || [] : [],
          ...(photoURLs.length ? { photoURLs: [...(prev.exists() ? prev.data().photoURLs || [] : []), ...photoURLs] } : {}),
          visibility: visibilityFor(userSnap.exists() ? userSnap.data() : null),
          hidden: hiddenFor(prev.exists() ? prev.data() : null),
          ...pickMarks,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Mapr's learning from this rating and its comment (maprLearning.js):
      // type score (per-region tag scores) and place score. Inside this
      // transaction so a retried save never counts the same rating twice; an
      // edit swaps the old answer's effect for the new one. A check-in rating
      // counts the same whether the visit was solo or with a group.
      writeLearning(tx, {
        uid: userId,
        userRef,
        placeRef,
        userSnap,
        placeSnap,
        pd,
        landmark: { ...landmark, region: landmark.region ?? landmark.regionId },
        next: {
          rating: { tier: rating.tier, frequency: rating.visitFrequency || null },
          // A caller that sent no comment (undefined) keeps what's on file.
          comment: rating.comment === undefined ? undefined : (rating.comment || '').slice(0, COMMENT_MAX),
          ...(resolution ? { resolution } : {}),
        },
        nowMs,
      });
    });

  await writeReview();
  // The taste score follows the newest answer (tasteScore.js).
  scheduleTasteRecompute(userId);

  return { photoURLs, photoFailed };
}

/**
 * Read-only: would saving this rating be a big change from the user's own
 * earlier answer on the place (two levels apart)? The UI calls this before
 * submitReview so it can ask "What happened?" first. `needsAsk` is false when
 * the comment already says (reasonFromComment) or no question is due.
 */
export async function previewDisagreement({ userId, landmark, tier, comment }) {
  if (!db || !userId || !landmark?.id) return { needed: false, needsAsk: false };
  const [rv, ps] = await Promise.all([
    getDoc(doc(db, 'reviews', `${userId}_${landmark.id}`)).catch(() => null),
    getDoc(placeScoresRef(userId, landmark.id)).catch(() => null),
  ]);
  const prev = rv?.exists() ? rv.data() : null;
  const check = disagreementCheck({ prev, place: ps?.exists() ? ps.data() : null, newTier: tier });
  if (!check.needed) return { ...check, needsAsk: false };
  const text = comment === undefined ? prev?.comment || '' : comment || '';
  const auto = reasonFromComment(text);
  return { ...check, auto, needsAsk: !auto };
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
export async function getUserReviews(userId, { other = false } = {}) {
  if (!db || !userId) return [];
  return sharedRead(`reviews:${userId}${other ? ':other' : ''}`, async () => {
    // Someone else's reviews (a friend's, for compatibility): firestore.rules
    // only accepts a list query that proves `hidden == false` for them -- a
    // bare userId filter is rejected whole with permission-denied. Your own
    // need no such filter (and must keep your reported-hidden ones).
    const snap = await getDocs(
      other
        ? query(collection(db, 'reviews'), where('userId', '==', userId), where('hidden', '==', false))
        : query(collection(db, 'reviews'), where('userId', '==', userId))
    );
    return snap.docs.map((d) => {
      const r = { id: d.id, ...d.data() };
      // rawLandmarkId is what the doc id (`${uid}_${id}`) and aggregate were
      // written under -- deletes must target that, not the canonical id.
      return { ...r, rawLandmarkId: r.landmarkId, landmarkId: canonicalLandmarkId(r.landmarkId, r.region) };
    });
  });
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
async function _syncMyReviewVisibility(uid, isPublic) {
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
async function _reportReview({ reporterUid, review }) {
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
async function _deleteMyReview(userId, landmarkId) {
  const reviewRef = doc(db, 'reviews', `${userId}_${landmarkId}`);
  const aggRef = doc(db, 'landmark_ratings', landmarkId);
  const userRef = doc(db, 'users', userId);
  await runTransaction(db, async (tx) => {
    const prev = await tx.get(reviewRef);
    if (!prev.exists()) return;
    const s = prev.data().stars || 0;
    const userSnap = await tx.get(userRef);
    const placeRef = placeScoresRef(userId, landmarkId);
    const placeSnap = await tx.get(placeRef);
    // A comment-only doc was never counted in the aggregate; just delete it.
    if (!s) {
      tx.delete(reviewRef);
      return;
    }
    const agg = await tx.get(aggRef);
    // Roll the rating (and its comment) back out of Mapr's taste profile too;
    // a tap on the same place stays.
    const pd = prev.data();
    writeLearning(tx, {
      uid: userId,
      userRef,
      placeRef,
      userSnap,
      placeSnap,
      pd,
      landmark: { id: landmarkId, region: pd.region, categories: pd.categories },
      next: { rating: null },
      nowMs: Date.now(),
    });
    const curSum = agg.exists() ? agg.data().sum || 0 : 0;
    const curCount = agg.exists() ? agg.data().count || 0 : 0;
    const newCount = Math.max(0, curCount - 1);
    const newSum = Math.max(0, curSum - s);
    tx.set(aggRef, { sum: newSum, count: newCount, avg: newCount ? newSum / newCount : 0, updatedAt: serverTimestamp() }, { merge: true });
    tx.delete(reviewRef);
  });
}

/**
 * Adds or edits the comment on your review of a place. A comment is never
 * saved on its own: it always rides with one of the three tiers. If your
 * review already has a tier this only changes the comment (a merge, so tier,
 * photos and love notes are untouched). If it has none -- a legacy
 * comment-only review, or no review yet -- `tier` is required and the save
 * goes through the full rating path so the tier, the stars and the
 * landmark_ratings aggregate stay consistent. Doesn't need a check-in.
 */
async function _saveMyComment({ userId, userName, landmark, comment, tier }) {
  const text = (comment || '').trim().slice(0, COMMENT_MAX);
  const ref = doc(db, 'reviews', `${userId}_${landmark.id}`);
  const cur = await getDoc(ref).catch(() => null);
  const curData = cur?.exists() ? cur.data() : null;
  if (!curData?.ratingTier) {
    if (!isValidTier(tier)) throw userError("Pick how it was (I loved it, Ok, or I didn't like it) to save a comment.");
    await _submitReviewSerial({
      userId,
      userName: userName || curData?.userName || 'Explorer',
      landmark: { ...landmark, region: landmark.region ?? landmark.regionId },
      rating: { tier, comment: text },
    });
    return text;
  }
  await runTransaction(db, async (tx) => {
    const latest = await tx.get(ref);
    const userRef = doc(db, 'users', userId);
    const user = await tx.get(userRef);
    const placeRef = placeScoresRef(userId, landmark.id);
    const placeSnap = await tx.get(placeRef);
    const username = user.exists() ? user.data().username : null;
    // A changed comment changes what Mapr learned from it: the old comment's
    // effect comes out, the new one goes in (the rating itself is untouched).
    const lm = { ...landmark, region: landmark.region ?? landmark.regionId };
    if (!lm.categories?.length) lm.categories = latest.exists() ? latest.data().categories || [] : [];
    writeLearning(tx, {
      uid: userId,
      userRef,
      placeRef,
      userSnap: user,
      placeSnap,
      pd: latest.exists() ? latest.data() : null,
      landmark: lm,
      next: { comment: text },
      nowMs: Date.now(),
    });
    tx.set(
      ref,
      {
        userId,
        userName: username || (latest.exists() ? latest.data().userName : null) || 'Explorer',
        landmarkId: landmark.id,
        landmarkName: landmark.name,
        region: landmark.region ?? landmark.regionId,
        comment: text,
        visibility: visibilityFor(user.exists() ? user.data() : null),
        hidden: hiddenFor(latest.exists() ? latest.data() : null),
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
 * loveNotes. Only saved onto a review that already has a tier: a review
 * never exists without one (firestore.rules), so with no rating on file the
 * note is skipped (returns false) rather than creating a tier-less doc.
 */
async function _appendLoveNote(userId, landmarkId, landmark, note) {
  const text = (note || '').trim().slice(0, 280);
  if (!db || !userId || !landmarkId || !text) return false;
  const reviewRef = doc(db, 'reviews', `${userId}_${landmarkId}`);
  let saved = false;
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(reviewRef);
    if (!cur.exists() || !cur.data().ratingTier) return;
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
        hidden: hiddenFor(cur.data()),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    saved = true;
  });
  return saved;
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
  // The id is minted locally so a reply written offline (queued on this
  // device) still has one, instead of waiting for an addDoc that never ends.
  const replyRef = doc(collection(db, 'reviews', reviewId, 'replies'));
  await settleWrite(
    setDoc(replyRef, {
      uid,
      userName,
      text: text.slice(0, 500),
      createdAt: serverTimestamp(),
    })
  );
  return replyRef.id;
}

export async function deleteReply(reviewId, replyId) {
  await settleWrite(deleteDoc(doc(db, 'reviews', reviewId, 'replies', replyId)));
}

// One save at a time per review: a double tap would otherwise run two
// read-modify-write passes over the same review and aggregate at once.
const submitQueue = new Map();
function _submitReviewSerial(args) {
  const k = `${args.userId}_${args.landmark?.id}`;
  const run = (submitQueue.get(k) || Promise.resolve()).catch(() => {}).then(() => _submitReview(args));
  submitQueue.set(k, run);
  const clear = () => submitQueue.get(k) === run && submitQueue.delete(k);
  run.then(clear, clear);
  return run;
}
export const submitReview = invalidating(_submitReviewSerial);

export const syncMyReviewVisibility = invalidating(_syncMyReviewVisibility);

export const reportReview = invalidating(_reportReview);

export const deleteMyReview = invalidating(_deleteMyReview);

export const saveMyComment = invalidating(_saveMyComment);

export const appendLoveNote = invalidating(_appendLoveNote);

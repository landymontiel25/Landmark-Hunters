import { verifyIdToken } from './verifyAuth.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { validClientDayKey } from './streakDay.js';
import { awardLeaderboardPointsServer, cleanUserName } from './leaderboardPoints.js';
import { photoShowsPlace } from './photoCheck.js';
import { withCors } from './cors.js';
import { INTERESTS, getLandmark, getRegion } from '../../src/data/regions.js';
import { isRealCheckin } from '../../src/lib/realCheckin.js';

// Bonus points for a photo (owner, 2026-10-21): +10 the first time you add
// a photo at a place you really checked in to, once per place, at most 5
// places a day, and only when the photo shows the place or the visit (a
// Claude check, photoCheck.js: no black screens, screenshots or random
// photos). Decided here, not on the phone: the rules let no client write
// raise points (firestore.rules). Small next to a first check-in (100,
// leaderboard.js) and a solo streak day (20): it nudges people to add
// photos without making photos worth farming.
export const PHOTO_BONUS_POINTS = 10;
export const PHOTO_BONUSES_PER_DAY = 5;
// Photos checked per place per try, newest first, so one call can't run up
// a long bill on a place with many photos.
export const PHOTOS_CHECKED_PER_TRY = 3;

const photosOf = (d) => [...(Array.isArray(d?.photoURLs) ? d.photoURLs : []), ...(d?.photoURL ? [d.photoURL] : [])].filter((u) => typeof u === 'string');
const hasPhoto = (d) => photosOf(d).length > 0;

// A real visit, the same test the rest of the app uses (realCheckin.js):
// not a rating-only "Rate a Landmark" entry.
const realVisit = (c) => !!c && isRealCheckin(c);

// Pure: whether this place can earn the bonus (before the photo check), and
// why not when it can't. checkin: checkins/{uid}_{landmarkId}; review:
// reviews/{uid}_{landmarkId} (photos taken while rating at check-in land
// there); paid: the ledger doc already exists; today: bonuses paid so far
// on this day (null skips the daily limit, for the one-time back-pay);
// visited: a real visit here on any check-in doc, when the first doc (where
// photos are kept) is a rating-only one (defaults to that doc's own answer).
export function photoBonusDecision({ uid, checkin, review, paid, today, visited }) {
  if (!checkin || checkin.userId !== uid || !(visited ?? realVisit(checkin))) return { awarded: 0, reason: 'no-checkin' };
  if (!hasPhoto(checkin) && !(review && review.userId === uid && hasPhoto(review))) return { awarded: 0, reason: 'no-photo' };
  if (paid) return { awarded: 0, reason: 'already' };
  if (today != null && today >= PHOTO_BONUSES_PER_DAY) return { awarded: 0, reason: 'daily-limit' };
  return { awarded: PHOTO_BONUS_POINTS };
}

// The photos to check: the newest first (the one just added), skipping any
// checked before, a few at most.
export function photosToCheck({ uid, checkin, review, checked = [] }) {
  const mine = review && review.userId === uid ? photosOf(review) : [];
  const seen = new Set(checked);
  return [...new Set([...photosOf(checkin).reverse(), ...mine.reverse()])].filter((u) => !seen.has(u)).slice(0, PHOTOS_CHECKED_PER_TRY);
}

const kindLabel = (id) => INTERESTS.find((i) => i.id === id)?.label || id;

function placeInfo(landmarkId, checkin) {
  const lm = getLandmark(checkin.region, landmarkId);
  return {
    name: lm?.name || checkin.landmarkName || landmarkId,
    kinds: (lm?.categories || []).map(kindLabel).join(', '),
    city: getRegion(checkin.region)?.name || '',
  };
}

// One place, start to end: the checks, the photo check, then the payout in
// a transaction. Used by the endpoint (daily limit and the weekly/monthly/
// yearly boards on) and by the one-time back-pay (both off).
export async function awardPhotoBonus(db, uid, landmarkId, { dayId = null, dailyLimit = true, boards = true, check = photoShowsPlace } = {}) {
  const docId = `${uid}_${landmarkId}`;
  const checkinRef = db.collection('checkins').doc(docId);
  const reviewRef = db.collection('reviews').doc(docId);
  // Server-only (firestore.rules): one doc per place paid, a per-day count,
  // and the photos already checked for a place (never checked twice).
  const paidRef = db.collection('photo_bonuses').doc(docId);
  const dayRef = dayId ? db.collection('photo_bonus_days').doc(`${uid}_${dayId}`) : null;
  const checksRef = db.collection('photo_bonus_checks').doc(docId);

  const read = async (get) => {
    const [c, r, p, d] = await Promise.all([get(checkinRef), get(reviewRef), get(paidRef), dayRef ? get(dayRef) : null]);
    return {
      checkin: c.exists ? c.data() : null,
      review: r.exists ? r.data() : null,
      paid: p.exists,
      today: dailyLimit ? (d?.exists ? Number(d.data().count) || 0 : 0) : null,
    };
  };

  const first = await read((ref) => ref.get());
  // Photos live on the first check-in doc. If that one was a rating-only
  // entry, a later real visit (doc _2, _3...) still counts.
  let visited;
  if (first.checkin && !realVisit(first.checkin)) {
    const all = await db.collection('checkins').where('userId', '==', uid).where('landmarkId', '==', landmarkId).get();
    visited = all.docs.some((d) => isRealCheckin(d.data()));
  }
  const pre = photoBonusDecision({ uid, ...first, visited });
  if (!pre.awarded) return pre;

  // Does a photo show the place? Newest first; the first yes is enough.
  const checksSnap = await checksRef.get();
  const checked = checksSnap.exists ? checksSnap.data().urls || [] : [];
  const urls = photosToCheck({ uid, checkin: first.checkin, review: first.review, checked });
  if (!urls.length) return { awarded: 0, reason: 'photo-not-of-place' };
  const place = placeInfo(landmarkId, first.checkin);
  let verdict = null;
  const tried = [];
  for (const url of urls) {
    const v = await check({ url, place });
    // A failed call isn't a verdict: that photo can be checked again later.
    if (v.reason !== 'check failed') tried.push(url);
    if (v.ok) {
      verdict = v;
      break;
    }
  }
  if (tried.length) await checksRef.set({ userId: uid, urls: FieldValue.arrayUnion(...tried) }, { merge: true });
  if (!verdict) return { awarded: 0, reason: 'photo-not-of-place' };

  // In a transaction so two quick calls can't both pay for the same place,
  // or both slip under the daily limit.
  const outcome = await db.runTransaction(async (t) => {
    const now = await read((ref) => t.get(ref));
    const decision = photoBonusDecision({ uid, ...now, visited });
    if (!decision.awarded) return decision;
    t.create(paidRef, { userId: uid, landmarkId, dayId, points: decision.awarded, photo: verdict.reason, createdAt: FieldValue.serverTimestamp() });
    if (dayRef) t.set(dayRef, { userId: uid, dayId, count: FieldValue.increment(1) }, { merge: true });
    // In lifetime totals and levels (getUserStats adds bonusPoints).
    t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(decision.awarded) }, { merge: true });
    return { ...decision, userName: cleanUserName(now.checkin.userName) };
  });
  if (outcome.awarded && boards && dayId) {
    // The weekly, monthly and yearly boards, on the caller's own day.
    await awardLeaderboardPointsServer(db, uid, outcome.userName, outcome.awarded, dayId).catch((e) =>
      console.error('[photo-bonus] leaderboard award failed', e)
    );
  }
  return { awarded: outcome.awarded, reason: outcome.reason };
}

const validLandmarkId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id);

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (isRateLimited(req, 'photo-bonus', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { landmarkId, dayId } = req.body || {};
  if (!validLandmarkId(landmarkId) || !validClientDayKey(dayId)) {
    res.status(400).json({ error: 'landmarkId and dayId are required.' });
    return;
  }
  try {
    const out = await awardPhotoBonus(adminDb(), account.uid, landmarkId, { dayId });
    res.status(200).json({ ok: true, awarded: out.awarded, reason: out.reason || null });
  } catch (e) {
    console.error('[photo-bonus] failed', e);
    res.status(500).json({ error: 'Could not check the photo bonus.' });
  }
}

export default withCors(handler);

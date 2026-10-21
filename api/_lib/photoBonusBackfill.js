import { awardPhotoBonus } from './photoBonus.js';

// The one-time back-pay (owner, 2026-10-21): +10 per place for everyone who
// added a photo before the photo bonus existed, with the same rules and the
// same photo check as a new photo (photoBonus.js). Run from the admin
// dashboard's Tools page (api/admin-jobs.js action 'photo-bonus-backfill'),
// one batch per press, until it says nothing is left. Safe to press again:
// a place that already paid, or whose photos were all checked, is skipped.
// No daily limit, and the points go to lifetime totals (bonusPoints) only,
// not this week's or month's board, so standings don't jump overnight.
export const BACKFILL_PLACES_PER_RUN = 20;
const CONCURRENCY = 4;

const photosOf = (d) => [...(Array.isArray(d?.photoURLs) ? d.photoURLs : []), ...(d?.photoURL ? [d.photoURL] : [])];

// Pure: every (user, place) with a photo on a real check-in, or on a rating
// of a place the user really checked in to, minus places already paid, in a
// stable order.
export function backfillCandidates({ checkins, reviews, paidIds }) {
  const real = (c) => !c.ratingOnly && c.visited !== false;
  const visited = new Set(checkins.filter(real).map((c) => `${c.userId}_${c.landmarkId}`));
  const keys = new Map();
  const add = (userId, landmarkId) => {
    if (typeof userId !== 'string' || typeof landmarkId !== 'string' || !userId || !landmarkId) return;
    const id = `${userId}_${landmarkId}`;
    if (!paidIds.has(id)) keys.set(id, { userId, landmarkId });
  };
  for (const c of checkins) if (real(c) && photosOf(c).length) add(c.userId, c.landmarkId);
  for (const r of reviews) if (photosOf(r).length && visited.has(`${r.userId}_${r.landmarkId}`)) add(r.userId, r.landmarkId);
  return [...keys.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
}

export async function runPhotoBonusBackfill(db, { limit = BACKFILL_PLACES_PER_RUN, award = awardPhotoBonus } = {}) {
  const [checkinSnap, reviewSnap, paidSnap, checkSnap] = await Promise.all([
    db.collection('checkins').select('userId', 'landmarkId', 'photoURLs', 'photoURL', 'ratingOnly', 'visited').get(),
    db.collection('reviews').select('userId', 'landmarkId', 'photoURLs', 'photoURL').get(),
    db.collection('photo_bonuses').select().get(),
    db.collection('photo_bonus_checks').get(),
  ]);
  const paidIds = new Set(paidSnap.docs.map((d) => d.id));
  // Places whose every photo was already checked and turned down: nothing
  // new to check until someone adds another photo.
  const checked = new Map(checkSnap.docs.map((d) => [d.id, new Set(d.data().urls || [])]));
  const all = backfillCandidates({
    checkins: checkinSnap.docs.map((d) => d.data()),
    reviews: reviewSnap.docs.map((d) => d.data()),
    paidIds,
  });
  const photosByPlace = new Map();
  for (const d of [...checkinSnap.docs, ...reviewSnap.docs]) {
    const x = d.data();
    const id = `${x.userId}_${x.landmarkId}`;
    photosByPlace.set(id, [...(photosByPlace.get(id) || []), ...photosOf(x)]);
  }
  const open = all.filter(({ userId, landmarkId }) => {
    const id = `${userId}_${landmarkId}`;
    const seen = checked.get(id);
    return !seen || (photosByPlace.get(id) || []).some((u) => !seen.has(u));
  });

  const batch = open.slice(0, limit);
  const out = { paid: 0, points: 0, turnedDown: 0, skipped: 0, checkedThisRun: batch.length, leftAfterThisRun: open.length - batch.length };
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const results = await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(({ userId, landmarkId }) =>
        award(db, userId, landmarkId, { dailyLimit: false, boards: false }).catch(() => ({ awarded: 0, reason: 'error' }))
      )
    );
    for (const r of results) {
      if (r.awarded) {
        out.paid += 1;
        out.points += r.awarded;
      } else if (r.reason === 'photo-not-of-place') out.turnedDown += 1;
      else out.skipped += 1;
    }
  }
  out.done = out.leftAfterThisRun === 0;
  return out;
}

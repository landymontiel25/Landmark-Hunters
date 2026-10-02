import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { BACKFILL_MAX_USERS, STATS_PAGE_SIZE } from '../../src/lib/statsConstants.js';

// createdAt for accounts made before the field existed.
//
// Source order: the Firebase Auth account creation time
// (metadata.creationTime) when there is one -- it is the real sign-up moment
// -- and only if Auth has no such account/time, the user's earliest rating
// (min of reviews.ratedAt / updatedAt / createdAt), which is only an upper
// bound on when they joined.
export function chooseCreatedAt({ authCreationTime, firstRatingMs }) {
  const auth = typeof authCreationTime === 'string' ? Date.parse(authCreationTime) : authCreationTime;
  if (Number.isFinite(auth)) return { ms: auth, source: 'auth' };
  if (Number.isFinite(firstRatingMs)) return { ms: firstRatingMs, source: 'first-rating' };
  return null;
}

const tms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);

export async function firstRatingMs(db, uid) {
  const snap = await db.collection('reviews').where('userId', '==', uid).get();
  let min = null;
  for (const d of snap.docs) {
    const x = d.data();
    for (const v of [x.ratedAt, x.updatedAt, x.createdAt]) {
      const t = tms(v);
      if (t != null && (min === null || t < min)) min = t;
    }
  }
  return min;
}

// Fills users/{uid}.createdAt where it is missing, up to `max` users per call
// (call again until `done`). Never overwrites an existing createdAt.
export async function backfillCreatedAt(db, auth, { max = BACKFILL_MAX_USERS } = {}) {
  const todo = [];
  let scanned = 0;
  let last = null;
  let exhausted = false;
  while (todo.length < max) {
    let q = db.collection('users').orderBy(FieldPath.documentId()).limit(STATS_PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) {
      scanned += 1;
      if (d.data().createdAt == null && todo.length < max) todo.push(d);
    }
    if (snap.docs.length < STATS_PAGE_SIZE) {
      exhausted = true;
      break;
    }
    last = snap.docs[snap.docs.length - 1];
  }

  const authTime = new Map();
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    try {
      const res = await auth.getUsers(chunk.map((d) => ({ uid: d.id })));
      for (const u of res.users || []) authTime.set(u.uid, u.metadata?.creationTime);
    } catch {
      /* Auth unavailable for this chunk: fall back to first ratings below */
    }
  }

  const result = { scanned, updated: 0, fromAuth: 0, fromFirstRating: 0, noSource: 0, done: false };
  for (const d of todo) {
    const pick = chooseCreatedAt({
      authCreationTime: authTime.get(d.id),
      firstRatingMs: authTime.get(d.id) ? null : await firstRatingMs(db, d.id),
    });
    if (!pick) {
      result.noSource += 1;
      continue;
    }
    await d.ref.set({ createdAt: Timestamp.fromMillis(pick.ms) }, { merge: true });
    result.updated += 1;
    if (pick.source === 'auth') result.fromAuth += 1;
    else result.fromFirstRating += 1;
  }
  // Users with no source (no Auth account, no ratings) can never be filled, so they
  // must not keep the job "not done" forever.
  result.done = exhausted && todo.length < max;
  return result;
}

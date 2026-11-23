import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// A rating someone just gave must never be lost (owner, 2026-11-22). Every
// rating save goes through saveRating (reviews.js), which:
//   1. tries the save, then retries it after each of RATING_RETRY_DELAYS_MS,
//   2. records each failure's real error in `save_errors` (admin-only), so
//      the cause shows up there instead of behind a generic message,
//   3. if every try fails, keeps the rating on this device and returns
//      { queued: true }. flushRatingQueue sends it again when the app opens,
//      comes back online or comes back to the front, until it saves.
// A mistake only the person can fix (an error with userMessage, like too
// many photos) is never retried or queued: it goes straight back to them.

export const RATING_RETRY_DELAYS_MS = [1000, 3000, 9000];
export const RATING_QUEUED_MESSAGE = "Your rating's saved on this phone. It'll finish saving on its own as soon as it can.";
export const RATING_QUEUED_PHOTOS_MESSAGE =
  "Your rating's saved on this phone and will finish saving on its own. Your photos couldn't come along, so add them again from the landmark page.";

const QUEUE_KEY = (uid) => `lh.ratingQueue.${uid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const isUserFixable = (e) => !!e?.userMessage;

// Runs `run(attempt)`, retrying after each delay. onError sees every failure.
export async function withRetries(run, { delays = RATING_RETRY_DELAYS_MS, onError, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt);
    } catch (e) {
      try {
        onError?.(e, attempt);
      } catch {
        /* a broken logger never changes what the save does */
      }
      if (isUserFixable(e) || attempt >= delays.length) throw e;
      await wait(delays[attempt]);
    }
  }
}

// The real error, written where the owner can read it. Best effort: logging
// never gets in the way of the save itself.
export function logSaveError({ uid, landmark, attempt, error, source }) {
  try {
    console.error(`[rating] save failed (${source}, try ${attempt + 1})`, error);
  } catch {
    /* no console */
  }
  if (!db || !uid) return;
  const text = (v, n) => String(v ?? '').slice(0, n);
  const entry = {
    uid,
    kind: 'rating',
    source: text(source, 40),
    landmarkId: text(landmark?.id, 200),
    region: text(landmark?.region ?? landmark?.regionId, 60),
    code: text(error?.code || error?.name || 'unknown', 100),
    message: text(error?.message || error, 500),
    attempt,
    online: typeof navigator === 'undefined' ? null : navigator.onLine !== false,
    createdAt: serverTimestamp(),
  };
  Promise.resolve()
    .then(() => addDoc(collection(db, 'save_errors'), entry))
    .catch(() => {});
}

function readQueue(uid) {
  try {
    const raw = localStorage.getItem(QUEUE_KEY(uid));
    const q = raw ? JSON.parse(raw) : {};
    return q && typeof q === 'object' ? q : {};
  } catch {
    return {};
  }
}

function writeQueue(uid, q) {
  try {
    if (Object.keys(q).length) localStorage.setItem(QUEUE_KEY(uid), JSON.stringify(q));
    else localStorage.removeItem(QUEUE_KEY(uid));
  } catch {
    /* storage full or blocked */
  }
}

// Only what the save reads from a landmark; photos (File objects) can't be
// kept, so a queued rating goes without them.
export function enqueueRating({ userId, userName, landmark, rating, disagreement }) {
  if (!userId || !landmark?.id) return;
  const q = readQueue(userId);
  q[landmark.id] = {
    userId,
    userName,
    landmark: {
      id: landmark.id,
      name: landmark.name,
      region: landmark.region ?? landmark.regionId ?? null,
      regionId: landmark.regionId ?? landmark.region ?? null,
      categories: landmark.categories || [],
    },
    rating: JSON.parse(JSON.stringify(rating ?? null)),
    disagreement: disagreement ? JSON.parse(JSON.stringify(disagreement)) : undefined,
    queuedAt: Date.now(),
  };
  writeQueue(userId, q);
}

export function dequeueRating(userId, landmarkId) {
  const q = readQueue(userId);
  if (!(landmarkId in q)) return;
  delete q[landmarkId];
  writeQueue(userId, q);
}

export function queuedRatings(userId) {
  return userId ? Object.values(readQueue(userId)) : [];
}

// Sends every rating waiting on this device. `send(args)` is saveRating with
// queueing off (a failure leaves the entry where it is). Returns how many saved.
let flushing = null;
export function flushRatingQueue(userId, send) {
  if (!userId || flushing) return flushing || Promise.resolve(0);
  flushing = (async () => {
    let saved = 0;
    for (const entry of queuedRatings(userId)) {
      try {
        await send({ ...entry, photoFiles: [] });
        dequeueRating(userId, entry.landmark.id);
        saved++;
      } catch (e) {
        // A rating that can never save as it is (refused as invalid) would
        // otherwise retry forever: it's dropped only then, and logged.
        if (isUserFixable(e)) dequeueRating(userId, entry.landmark.id);
      }
    }
    return saved;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

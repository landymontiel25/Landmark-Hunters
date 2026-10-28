import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// A place with no picture of its own, and none Google can match, takes its
// public picture from the first user who agrees to share one (owner,
// 2026-10-28). community_photos/{region}__{landmarkId} holds that one photo:
// a Firebase Storage URL of the user's own check-in or rating photo. It is
// created once and never replaced; firestore.rules allow the create only when
// no doc exists, so a user who says no leaves the place open for the next
// person who submits a photo.

const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // docId -> { value, expires } | { promise }

export const communityPhotoId = (region, id) => (region && id ? `${region}__${id}` : null);

/** The public photo { url, photoUid } for a place, or null. Never rejects. */
export function getCommunityPhoto(region, id) {
  const key = communityPhotoId(region, id);
  if (!key || !db) return Promise.resolve(null);
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  const promise = getDoc(doc(db, 'community_photos', key))
    .then((snap) => {
      const d = snap.exists() ? snap.data() : null;
      const value = d && typeof d.url === 'string' && /^https:\/\//.test(d.url) ? { url: d.url, photoUid: d.photoUid || null } : null;
      cache.set(key, { value, expires: Date.now() + TTL_MS });
      return value;
    })
    .catch(() => {
      cache.delete(key);
      return null;
    });
  cache.set(key, { promise });
  return promise;
}

/**
 * Makes `url` (one of the user's own photos of this place) its public picture.
 * Resolves true on success and false when someone else's photo got there first.
 */
export async function shareCommunityPhoto({ region, id, url, uid }) {
  const key = communityPhotoId(region, id);
  if (!key || !db || !uid || !url) throw new Error('Could not share that photo.');
  try {
    await setDoc(doc(db, 'community_photos', key), { region, id, url, photoUid: uid, createdAt: serverTimestamp() });
  } catch (e) {
    cache.delete(key);
    if (e?.code === 'permission-denied') return false;
    throw e;
  }
  cache.set(key, { value: { url, photoUid: uid }, expires: Date.now() + TTL_MS });
  return true;
}

/** Takes the place's public photo down when it was this user's and this URL. Best-effort. */
export async function removeCommunityPhotoIfMine({ region, id, uid, url = null, urlIncludes = null }) {
  const key = communityPhotoId(region, id);
  if (!key || !db || !uid) return;
  try {
    const snap = await getDoc(doc(db, 'community_photos', key));
    const d = snap.exists() ? snap.data() : null;
    if (!d || d.photoUid !== uid || (url && d.url !== url) || (urlIncludes && !d.url.includes(urlIncludes))) return;
    await deleteDoc(snap.ref);
    cache.delete(key);
  } catch {
    /* best-effort: a dead photo just falls back to "No image available" */
  }
}

// "No thanks" is remembered on this device so the same person is not asked
// again about the same place; the next person to submit a photo is.
const answerKey = (uid, region, id) => `lh.photoOffer.${uid}.${region}.${id}`;
export function photoOfferDeclined(uid, region, id) {
  try {
    return localStorage.getItem(answerKey(uid, region, id)) === 'no';
  } catch {
    return false;
  }
}
export function rememberPhotoOfferDeclined(uid, region, id) {
  try {
    localStorage.setItem(answerKey(uid, region, id), 'no');
  } catch {
    /* private mode: they may be asked again */
  }
}

// Only the user's own check-in or rating photo can become the public picture
// (firestore.rules checks the same shape): checkin_photos or review_photos,
// file named <uid>_<digits>.jpg.
export const isSharablePhotoUrl = (url, uid) =>
  typeof url === 'string' &&
  !!uid &&
  new RegExp(`^https://firebasestorage[.]googleapis[.]com/v0/b/[^/]+/o/(checkin|review)_photos%2F[^/?]+%2F${uid}_[0-9]+[.]jpg`).test(url);

export function resetCommunityPhotoCache() {
  cache.clear();
}

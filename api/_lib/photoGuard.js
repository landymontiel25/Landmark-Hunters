import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

// Checks on a photo before any payout looks at it (anti-farming item 4,
// owner 2026-11-23):
//   - it must be one of this project's Storage files, in the caller's own
//     folder for that place (checkin_photos/{landmarkId}/{uid}_... or
//     review_photos/{landmarkId}/{uid}_...). Before, any https Storage URL
//     written onto your own check-in counted, someone else's photo included.
//   - its bytes are hashed, and a photo already used by another account or
//     at another place is turned down (photo_hashes/{sha256}).

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'landmark-hunters-284ab';
const BUCKETS = new Set([`${PROJECT_ID}.firebasestorage.app`, `${PROJECT_ID}.appspot.com`]);
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

// The Storage object path of a download URL, or null when it isn't one of
// this project's.
export function storageObjectPath(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    let bucket;
    let object;
    if (u.hostname === 'firebasestorage.googleapis.com') {
      const m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(u.pathname);
      if (!m) return null;
      [, bucket, object] = m;
    } else if (BUCKETS.has(u.hostname)) {
      bucket = u.hostname;
      const m = /^\/v0\/b\/[^/]+\/o\/(.+)$/.exec(u.pathname) || /^\/(.+)$/.exec(u.pathname);
      object = m?.[1];
    } else return null;
    if (!BUCKETS.has(bucket) || !object) return null;
    return decodeURIComponent(object);
  } catch {
    return null;
  }
}

// Is this the caller's own photo, of this place?
export function isOwnPlacePhoto(url, uid, landmarkId) {
  const path = storageObjectPath(url);
  if (!path || !uid || !landmarkId) return false;
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(checkin_photos|review_photos)/${esc(landmarkId)}/${esc(uid)}_[^/]+$`).test(path);
}

// sha256 of the photo's bytes, or null when it can't be read (too big, gone).
export async function hashPhoto(url, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const len = Number(r.headers?.get?.('content-length'));
    if (Number.isFinite(len) && len > MAX_PHOTO_BYTES) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

// Claims a photo's hash for (uid, landmarkId). { ok: true } when it's new or
// already this account's photo of this place; { ok: false, reason } when
// someone else used it, or this account used it at another place.
export async function claimPhotoHash(db, hash, { uid, landmarkId, url }) {
  if (!hash) return { ok: false, reason: 'unreadable-photo' };
  const ref = db.collection('photo_hashes').doc(hash);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (snap.exists) {
      const d = snap.data();
      if (d.uid === uid && d.landmarkId === landmarkId) return { ok: true };
      return { ok: false, reason: 'duplicate-photo' };
    }
    t.set(ref, { uid, landmarkId, url, createdAt: FieldValue.serverTimestamp() });
    return { ok: true };
  });
}

// Both checks in one: own photo of this place, and not a duplicate.
export async function guardPhoto(db, url, { uid, landmarkId, fetchImpl = fetch }) {
  if (!isOwnPlacePhoto(url, uid, landmarkId)) return { ok: false, reason: 'not-your-photo' };
  const hash = await hashPhoto(url, fetchImpl);
  return claimPhotoHash(db, hash, { uid, landmarkId, url });
}

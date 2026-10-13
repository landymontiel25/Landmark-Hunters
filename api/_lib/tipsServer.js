import { adminBucket } from './firebaseAdmin.js';

// Server helpers shared by api/post-tip.js, api/tips.js and the admin
// Content page actions (api/admin-jobs.js).

export const toMs = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v.seconds === 'number') return v.seconds * 1000;
  if (v && typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
};

// Everyone on the other side of a block from `uid`, either direction.
export async function blockedBetween(db, uid) {
  const [out, inc] = await Promise.all([
    db.collection('blocks').where('blockerUid', '==', uid).get(),
    db.collection('blocks').where('blockedUid', '==', uid).get(),
  ]);
  const set = new Set();
  for (const d of out.docs) if (d.data()?.blockedUid) set.add(d.data().blockedUid);
  for (const d of inc.docs) if (d.data()?.blockerUid) set.add(d.data().blockerUid);
  return set;
}

// A Firebase Storage download URL for a file in tip_photos/{uid}/, and its
// path. Anything else (another host, another folder, someone else's photo)
// is null.
const PHOTO_PATH_RE = /^tip_photos\/([A-Za-z0-9]{1,128})\/[A-Za-z0-9_-]{1,80}\.jpg$/;
export function tipPhotoPath(url, uid, bucket = process.env.VITE_FIREBASE_STORAGE_BUCKET) {
  if (typeof url !== 'string' || url.length > 2000) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return null;
  const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!m) return null;
  if (bucket && decodeURIComponent(m[1]) !== bucket) return null;
  let path;
  try {
    path = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  const pm = path.match(PHOTO_PATH_RE);
  return pm && pm[1] === uid ? path : null;
}

// Best effort: a tip's photo goes with the tip (removed by moderation or by
// its author). A failure leaves an orphan file, never a failed request.
export async function deleteTipPhoto(path) {
  if (typeof path !== 'string' || !path.startsWith('tip_photos/')) return false;
  try {
    const bucket = await adminBucket();
    if (!bucket) return false;
    await bucket.file(path).delete({ ignoreNotFound: true });
    return true;
  } catch (e) {
    console.error('tip photo delete failed', e?.message || e);
    return false;
  }
}

// What a viewer gets for one tip. No reporters, no held reason, no who
// marked it: counts only.
export function tipForViewer(id, tip, viewerUid) {
  return {
    id,
    authorUid: tip.authorUid,
    authorName: tip.authorName || 'Explorer',
    landmarkId: tip.landmarkId,
    region: tip.region,
    text: tip.text,
    tags: Array.isArray(tip.tags) ? tip.tags : [],
    photoURL: tip.photoURL || null,
    visitAt: toMs(tip.visitAt),
    createdAt: toMs(tip.createdAt) ?? tip.createdAtMs ?? null,
    verified: tip.verified === true,
    counts: { helpful: tip.counts?.helpful || 0, saved: tip.counts?.saved || 0 },
    mine: tip.authorUid === viewerUid,
  };
}

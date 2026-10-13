import { adminBucket } from './firebaseAdmin.js';
import { toMs } from './time.js';
import { regionTimezone } from '../../src/lib/timezones.js';

// Server helpers shared by api/post-tip.js and api/tips.js.

export const HOUR_MS = 60 * 60 * 1000;
export const ID_RE = /^[\w.-]{1,300}$/;
export const send = (res, code, body) => res.status(code).json(body);

// The month of a visit ("2026-10"), all a tip keeps: the tip doc is
// readable by anyone who can see the tip, so it never holds the day or
// time someone stood at a place.
// In the place's own time zone, so a late-evening visit on the 31st stays
// in its month.
export function visitMonthOf(ms, region) {
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: regionTimezone(region), year: 'numeric', month: '2-digit' }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}`;
}
//
// A tip's id is {authorUid}_{landmarkId}, so one person has one tip per
// place, and an id comes back when a tip is deleted and posted again. Each
// post gets its own `gen` (a random id), and every mark, report and view
// records the gen of the tip it was made on: one from an older post at the
// same id never counts, whatever the clocks say.

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

// Is there a block between a and b, either way? Two direct gets, the same
// ids the rules check.
export async function blockedEitherWay(db, a, b) {
  const [x, y] = await Promise.all([db.collection('blocks').doc(`${a}_${b}`).get(), db.collection('blocks').doc(`${b}_${a}`).get()]);
  return x.exists || y.exists;
}

// Deletes refs in batches (Firestore takes up to 500 writes per batch).
export async function deleteRefs(db, refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = db.batch();
    for (const r of refs.slice(i, i + 400)) b.delete(r);
    await b.commit();
  }
}

// Was this mark, report or view made on this post of the tip?
export const madeOnThisPost = (child, tip) => !!child && !!tip && child.gen === tip.gen;

// The marks, reports and views of one post of a tip (by its gen), removed
// with it. A newer post at the same id keeps its own.
// (Equality filters only, so no composite index.)
export async function deleteTipChildren(db, tipId, gen) {
  const of = (col) => db.collection(col).where('tipId', '==', tipId).where('gen', '==', gen ?? null).get();
  const [reactions, reports, views] = await Promise.all([of('tip_reactions'), of('tip_reports'), of('tip_views')]);
  const refs = [...reactions.docs, ...reports.docs, ...views.docs].map((d) => d.ref);
  await deleteRefs(db, refs);
}

// A Firebase Storage download URL for a file in tip_photos/{uid}/, and its
// path. Anything else (another host, another folder, someone else's photo,
// or no bucket configured) is null.
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
  let path;
  try {
    // No configured bucket: no photo (any Firebase project's URL would pass).
    if (!bucket || decodeURIComponent(m[1]) !== bucket) return null;
    path = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  const pm = path.match(PHOTO_PATH_RE);
  return pm && pm[1] === uid ? path : null;
}

// The doc that says a photo is taken (tip_photo_claims/{this}): one photo,
// one tip, ever.
export const photoClaimId = (path) => String(path).replace(/\//g, '__');

// Is the file there now? A tip may only point at an uploaded photo (the
// Storage rules then stop it changing); a URL for a file uploaded later
// would let a live tip's image appear after posting.
export async function tipPhotoExists(path) {
  try {
    const bucket = await adminBucket();
    if (!bucket) return false;
    const [exists] = await bucket.file(path).exists();
    return exists === true;
  } catch (e) {
    console.error('tip photo check failed', e?.message || e);
    return false;
  }
}

// Best effort: a tip's photo goes with the tip. A failure leaves an orphan
// file, never a failed request.
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

// Account deletion: every file under tip_photos/{uid}/ but `keep` (photos
// of tips kept for the owner's review).
export async function deleteTipPhotoFolder(uid, { keep = new Set() } = {}) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(uid)) return false;
  // Throws on a Storage failure, so account deletion reports it and retries.
  const bucket = await adminBucket();
  if (!bucket) return false;
  const [files] = await bucket.getFiles({ prefix: `tip_photos/${uid}/` });
  await Promise.all(files.filter((f) => !keep.has(f.name)).map((f) => f.delete({ ignoreNotFound: true })));
  return true;
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
    visitMonth: typeof tip.visitMonth === 'string' ? tip.visitMonth : null,
    createdAt: toMs(tip.createdAt) ?? tip.createdAtMs ?? null,
    verified: tip.verified === true,
    counts: { helpful: tip.counts?.helpful || 0, saved: tip.counts?.saved || 0 },
    mine: tip.authorUid === viewerUid,
  };
}

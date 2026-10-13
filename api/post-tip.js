import { randomUUID } from 'node:crypto';
import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { withCors } from './_lib/cors.js';
import { toMs } from './_lib/time.js';
import {
  deleteRefs,
  deleteTipChildren,
  deleteTipPhoto,
  deleteTipPhotoFolder,
  madeOnThisPost,
  photoClaimId,
  tipPhotoExists,
  tipPhotoPath,
} from './_lib/tipsServer.js';
import { canonicalLandmarkId } from '../src/data/regions.js';
import { cleanTipText, tipCheckinProblem, tipIdFor, tipInputProblem, TIP_RATE_LIMIT } from '../src/lib/tips.js';
import { filterTipText } from '../src/lib/tipFilter.js';

// Tips (docs/discovery-network-plan.md, Phase 1). The only way a tip is
// created or deleted: the rules forbid any client write to tips/.
//   POST { checkinId, text, tags?, photoURL? }   share a tip
//   POST { action: 'delete', landmarkId, region } delete your own tip there
//   POST { action: 'delete-mine' }               account deletion
// A tip needs a verified email and a verified check-in (presence written by
// api/verify-checkin.js) under 30 days old. 10 tips an hour, one per person
// per place (the id is {uid}_{landmarkId}), at most 2 links and none in an
// account's first week. The word filter (src/lib/tipFilter.js) holds a
// flagged tip for the owner's review instead of refusing it.
//
// Server-only collections behind it (no rule matches them, so clients are
// denied): tip_post_log/{uid} (the hourly count, which deleting a tip does
// not reset) and tip_photo_claims/{path} (one photo, one tip, ever).

const HOUR_MS = 60 * 60 * 1000;
const send = (res, code, body) => res.status(code).json(body);
const ID_RE = /^[\w.-]{1,300}$/;

const EXISTS_ERRORS = {
  removed: [409, { error: 'Your tip here was removed by a moderator, so you cannot post another one here.', code: 'removed' }],
  withdrawn: [409, { error: 'Your earlier tip here is waiting for review. You can post again once it is reviewed.', code: 'withdrawn' }],
  default: [409, { error: 'You already shared a tip here. Delete it to write a new one.', code: 'exists' }],
};

async function postTip(db, account, body) {
  const { checkinId, text, tags = [], photoURL = null } = body;
  if (typeof checkinId !== 'string' || !ID_RE.test(checkinId) || typeof text !== 'string' || text.length > 2000) {
    return [400, { error: 'checkinId and text are required.' }];
  }
  const nowMs = Date.now();
  const [checkinSnap, userSnap] = await Promise.all([db.collection('checkins').doc(checkinId).get(), db.collection('users').doc(account.uid).get()]);
  const checkin = checkinSnap.exists ? { ...checkinSnap.data(), createdAtMs: toMs(checkinSnap.data().createdAt) } : null;
  const visitProblem = tipCheckinProblem(checkin, account.uid, nowMs);
  if (visitProblem) return [visitProblem.code === 'not-yours' ? 403 : 400, { error: visitProblem.message, code: visitProblem.code }];

  const user = userSnap.exists ? userSnap.data() : {};
  const createdAtMs = toMs(user.createdAt);
  const inputProblem = tipInputProblem({ text, tags }, { accountAgeMs: createdAtMs == null ? null : nowMs - createdAtMs });
  if (inputProblem) return [400, { error: inputProblem.message, code: inputProblem.code }];

  let photoPath = null;
  if (photoURL != null) {
    photoPath = tipPhotoPath(photoURL, account.uid);
    if (!photoPath || !(await tipPhotoExists(photoPath))) return [400, { error: 'That photo could not be used.', code: 'bad-photo' }];
  }

  const clean = cleanTipText(text);
  const filtered = filterTipText(clean);
  const status = filtered.flagged ? 'held' : 'live';
  // The place's current id (a renamed landmark keeps old check-ins under
  // its old id), so the tip shows on the page and stays one per place.
  const landmarkId = canonicalLandmarkId(checkin.landmarkId, checkin.region);
  const tipId = tipIdFor(account.uid, landmarkId);
  const ref = db.collection('tips').doc(tipId);
  const logRef = db.collection('tip_post_log').doc(account.uid);
  const claimRef = photoPath ? db.collection('tip_photo_claims').doc(photoClaimId(photoPath)) : null;
  const tip = {
    authorUid: account.uid,
    authorName: String(user.username || user.displayName || 'Explorer').slice(0, 60),
    landmarkId,
    landmarkName: String(checkin.landmarkName || '').slice(0, 200),
    region: checkin.region || null,
    checkinId,
    visitAt: checkin.createdAtMs,
    text: clean,
    tags,
    photoURL: photoPath ? photoURL : null,
    photoPath,
    status,
    heldReasons: filtered.reasons,
    hidden: false,
    reportCount: 0,
    counts: { helpful: 0, saved: 0 },
    verified: true,
    gen: randomUUID(),
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // One transaction: one tip per place, 10 an hour across every server
  // instance, one tip per photo.
  const outcome = await db.runTransaction(async (tx) => {
    const [existing, log, claim] = await Promise.all([tx.get(ref), tx.get(logRef), claimRef ? tx.get(claimRef) : null]);
    if (existing.exists) return `exists:${existing.data().status}`;
    const recent = (log.exists && Array.isArray(log.data().at) ? log.data().at : []).filter((t) => typeof t === 'number' && t > nowMs - HOUR_MS);
    if (recent.length >= TIP_RATE_LIMIT.limit) return 'rate';
    if (claim?.exists) return 'photo-used';
    tx.set(ref, tip);
    tx.set(logRef, { at: [...recent, nowMs] });
    if (claimRef) tx.set(claimRef, { uid: account.uid, tipId, at: nowMs });
    return 'ok';
  });
  if (outcome === 'rate') return [429, { error: 'That is a lot of tips in one hour. Try again later.', code: 'rate' }];
  if (outcome === 'photo-used') return [400, { error: 'Add a new photo for this tip.', code: 'photo-used' }];
  if (outcome.startsWith('exists')) return EXISTS_ERRORS[outcome.slice(7)] || EXISTS_ERRORS.default;
  return [200, { ok: true, tipId, status }];
}

// Takes a tip of yours down, in one transaction so a report landing
// meanwhile is either counted or refused because the tip is gone:
//   removed by a moderator    left as it is (the lock on the place holds)
//   reported (even once)      withdrawn: hidden from everyone, kept with its
//                             reports for the owner's review; no new tip
//                             there until the owner clears it
//   otherwise                 deleted (live, or held by the filter and
//                             never public)
// forAccount (account deletion) also strips a kept tip's text, name and
// photo, leaving an empty marker.
async function retireTip(db, ref, uid, { forAccount = false } = {}) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().authorUid !== uid) return { code: 'missing' };
    const t = snap.data();
    const kept = t.status === 'removed' || t.status === 'withdrawn' || (t.reportCount || 0) > 0;
    if (!kept) {
      tx.delete(ref);
      return { code: 'deleted', tip: t };
    }
    const status = t.status === 'removed' ? 'removed' : 'withdrawn';
    const changes = {
      ...(t.status !== status ? { status, withdrawnAt: Date.now() } : {}),
      ...(forAccount ? { text: '', tags: [], authorName: 'Deleted account', photoURL: null, photoPath: null, accountDeletedAt: Date.now() } : {}),
    };
    if (Object.keys(changes).length) tx.update(ref, { ...changes, updatedAt: FieldValue.serverTimestamp() });
    return { code: status, tip: t };
  });
}

async function deleteTip(db, account, body) {
  const { landmarkId } = body;
  if (typeof landmarkId !== 'string' || !ID_RE.test(landmarkId)) return [400, { error: 'landmarkId is required.' }];
  const tipId = tipIdFor(account.uid, canonicalLandmarkId(landmarkId, typeof body.region === 'string' ? body.region : undefined));
  const out = await retireTip(db, db.collection('tips').doc(tipId), account.uid);
  if (out.code === 'missing') return [404, { error: 'No tip of yours here.' }];
  if (out.code === 'removed') return [403, { error: 'This tip was removed by a moderator.', code: 'removed' }];
  if (out.code === 'withdrawn') return [200, { ok: true, withdrawn: true }];
  // After the tip is gone, best effort: what it leaves carries its gen, so
  // it never counts on a newer post at the same id.
  try {
    await Promise.all([deleteTipChildren(db, tipId, out.tip.gen), deleteTipPhoto(out.tip.photoPath)]);
  } catch (e) {
    console.error('tip cleanup failed', e?.message || e);
  }
  return [200, { ok: true }];
}

// Account deletion (src/lib/accountDeletion.js): every tip of yours goes
// through retireTip (kept ones become empty markers, so this can't lift a
// moderation lock or erase what the owner is reviewing), your marks on
// others' tips go (and come off their counts), with the record of what you
// viewed, who viewed your tips, your photo claims and your photos. Your
// reports on others' tips and your hourly post log stay: deleting them
// would let a live account report a tip twice or post past the limit.
async function deleteMine(db, account) {
  const uid = account.uid;
  const [tips, reactions, views, authorViews, claims] = await Promise.all([
    db.collection('tips').where('authorUid', '==', uid).get(),
    db.collection('tip_reactions').where('uid', '==', uid).get(),
    db.collection('tip_views').where('uid', '==', uid).get(),
    db.collection('tip_views').where('authorUid', '==', uid).get(),
    db.collection('tip_photo_claims').where('uid', '==', uid).get(),
  ]);
  // In parallel: account deletion runs under the function's time limit.
  await Promise.all([
    ...tips.docs.map(async (d) => {
      const out = await retireTip(db, d.ref, uid, { forAccount: true });
      if (out.code === 'deleted') await deleteTipChildren(db, d.id, out.tip.gen);
    }),
    ...reactions.docs.map((d) => {
      const r = d.data();
      const tipRef = db.collection('tips').doc(r.tipId);
      return db.runTransaction(async (tx) => {
        const t = await tx.get(tipRef);
        // A mark from an older post at the same id was never counted.
        if (t.exists && madeOnThisPost(r, t.data())) {
          const dec = {};
          if (r.helpful === true) dec['counts.helpful'] = FieldValue.increment(-1);
          if (r.saved === true) dec['counts.saved'] = FieldValue.increment(-1);
          if (Object.keys(dec).length) tx.update(tipRef, dec);
        }
        tx.delete(d.ref);
      });
    }),
    // Every photo in the folder, on a tip or not (an upload whose post
    // failed): the folder is theirs alone.
    deleteTipPhotoFolder(uid),
  ]);
  await deleteRefs(db, [...views.docs, ...authorViews.docs, ...claims.docs].map((d) => d.ref));
  return [200, { ok: true, tips: tips.size, reactions: reactions.size }];
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  const body = (req.body && typeof req.body === 'object' ? req.body : null) || {};
  const action = body.action || 'post';
  if (!['post', 'delete', 'delete-mine'].includes(action)) return send(res, 400, { error: 'Unknown action.' });
  // Account deletion is never limited or gated: it must always run.
  if (action === 'post') {
    if (!account.emailVerified) return send(res, 403, { error: 'Verify your email to share tips.', code: 'email' });
    // Attempts, not tips: a few retries after a refused tip must not lock
    // anyone out. The 10-tips-an-hour count is tip_post_log (postTip).
    if (isRateLimited(req, 'post-tip', { limit: TIP_RATE_LIMIT.limit * 3, windowMs: TIP_RATE_LIMIT.windowMs, id: account.uid })) {
      return send(res, 429, { error: 'That is a lot of tips in one hour. Try again later.', code: 'rate' });
    }
  } else if (action === 'delete' && isRateLimited(req, 'post-tip-delete', { limit: 60, windowMs: HOUR_MS, id: account.uid })) {
    return send(res, 429, { error: 'Too many requests. Try again later.' });
  }
  try {
    const db = adminDb();
    const [code, out] =
      action === 'post' ? await postTip(db, account, body) : action === 'delete' ? await deleteTip(db, account, body) : await deleteMine(db, account);
    return send(res, code, out);
  } catch (err) {
    console.error('post-tip failed', err?.message || err);
    return send(res, 500, { error: 'Could not save the tip. Try again.' });
  }
}

export default withCors(handler);

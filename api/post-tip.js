import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { withCors } from './_lib/cors.js';
import { deleteTipPhoto, tipPhotoPath, toMs } from './_lib/tipsServer.js';
import { cleanTipText, tipCheckinProblem, tipIdFor, tipInputProblem, TIP_RATE_LIMIT } from '../src/lib/tips.js';
import { filterTipText } from '../src/lib/tipFilter.js';

// Tips (docs/discovery-network-plan.md, Phase 1). The only way a tip is
// created or deleted: the rules forbid any client write to tips/.
//   POST { checkinId, text, tags?, photoURL? }   share a tip
//   POST { action: 'delete', landmarkId }       delete your own tip there
//   POST { action: 'delete-mine' }              account deletion: every tip
//                                               and helpful/saved mark of yours
// A tip needs a verified email and a verified check-in (presence written by
// api/verify-checkin.js) under 30 days old. 10 tips an hour, one per person
// per place (the id is {uid}_{landmarkId}), at most 2 links and none in an
// account's first week. The word filter (src/lib/tipFilter.js) holds a
// flagged tip for the owner's review instead of refusing it.

const HOUR_MS = 60 * 60 * 1000;
const send = (res, code, body) => res.status(code).json(body);

async function postTip(db, account, body) {
  const { checkinId, text, tags = [], photoURL = null } = body;
  if (typeof checkinId !== 'string' || !/^[\w.-]{1,300}$/.test(checkinId) || typeof text !== 'string' || text.length > 2000) {
    return [400, { error: 'checkinId and text are required.' }];
  }
  const nowMs = Date.now();
  const [checkinSnap, userSnap, mineSnap] = await Promise.all([
    db.collection('checkins').doc(checkinId).get(),
    db.collection('users').doc(account.uid).get(),
    db.collection('tips').where('authorUid', '==', account.uid).get(),
  ]);
  const checkin = checkinSnap.exists ? { ...checkinSnap.data(), createdAtMs: toMs(checkinSnap.data().createdAt) } : null;
  const visitProblem = tipCheckinProblem(checkin, account.uid, nowMs);
  if (visitProblem) return [visitProblem.code === 'not-yours' ? 403 : 400, { error: visitProblem.message, code: visitProblem.code }];

  const user = userSnap.exists ? userSnap.data() : {};
  const createdAtMs = toMs(user.createdAt);
  const inputProblem = tipInputProblem({ text, tags }, { accountAgeMs: createdAtMs == null ? null : nowMs - createdAtMs });
  if (inputProblem) return [400, { error: inputProblem.message, code: inputProblem.code }];

  // The per-instance limiter in the handler is best effort; this one counts
  // the account's own tips, so it holds across instances.
  const lastHour = mineSnap.docs.filter((d) => (d.data().createdAtMs ?? toMs(d.data().createdAt) ?? 0) > nowMs - HOUR_MS).length;
  if (lastHour >= TIP_RATE_LIMIT.limit) return [429, { error: 'That is a lot of tips in one hour. Try again later.', code: 'rate' }];

  let photoPath = null;
  if (photoURL != null) {
    photoPath = tipPhotoPath(photoURL, account.uid);
    if (!photoPath) return [400, { error: 'That photo could not be used.', code: 'bad-photo' }];
  }

  const clean = cleanTipText(text);
  const filtered = filterTipText(clean);
  const status = filtered.flagged ? 'held' : 'live';
  const tipId = tipIdFor(account.uid, checkin.landmarkId);
  const ref = db.collection('tips').doc(tipId);
  const tip = {
    authorUid: account.uid,
    authorName: String(user.username || user.displayName || 'Explorer').slice(0, 60),
    landmarkId: checkin.landmarkId,
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
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return false;
    tx.set(ref, tip);
    return true;
  });
  if (!created) return [409, { error: 'You already shared a tip here. Delete it to write a new one.', code: 'exists' }];
  return [200, { ok: true, tipId, status }];
}

// Removes one tip's helpful/saved marks (anyone's) with it.
async function deleteReactionsFor(db, tipId) {
  const snap = await db.collection('tip_reactions').where('tipId', '==', tipId).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    for (const d of snap.docs.slice(i, i + 400)) b.delete(d.ref);
    await b.commit();
  }
}

async function deleteTip(db, account, body) {
  const { landmarkId } = body;
  if (typeof landmarkId !== 'string' || !/^[\w.-]{1,300}$/.test(landmarkId)) return [400, { error: 'landmarkId is required.' }];
  const tipId = tipIdFor(account.uid, landmarkId);
  const ref = db.collection('tips').doc(tipId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().authorUid !== account.uid) return [404, { error: 'No tip of yours here.' }];
  // A tip the owner removed stays, so its author can't post it again.
  if (snap.data().status === 'removed') return [403, { error: 'This tip was removed by a moderator.', code: 'removed' }];
  await ref.delete();
  await deleteReactionsFor(db, tipId);
  await deleteTipPhoto(snap.data().photoPath);
  return [200, { ok: true }];
}

// Account deletion (src/lib/accountDeletion.js): the caller's tips (removed
// ones too: the account is going), their marks on others' tips (and those
// tips' counts), and the server's record of what they viewed.
async function deleteMine(db, account) {
  const uid = account.uid;
  const [tips, reactions, views] = await Promise.all([
    db.collection('tips').where('authorUid', '==', uid).get(),
    db.collection('tip_reactions').where('uid', '==', uid).get(),
    db.collection('tip_views').where('uid', '==', uid).get(),
  ]);
  for (const d of tips.docs) {
    await d.ref.delete();
    await deleteReactionsFor(db, d.id);
    await deleteTipPhoto(d.data().photoPath);
  }
  for (const d of reactions.docs) {
    const r = d.data();
    const tipRef = db.collection('tips').doc(r.tipId);
    await db.runTransaction(async (tx) => {
      const t = await tx.get(tipRef);
      if (t.exists) {
        const dec = {};
        if (r.helpful === true) dec['counts.helpful'] = FieldValue.increment(-1);
        if (r.saved === true) dec['counts.saved'] = FieldValue.increment(-1);
        if (Object.keys(dec).length) tx.update(tipRef, dec);
      }
      tx.delete(d.ref);
    });
  }
  for (let i = 0; i < views.docs.length; i += 400) {
    const b = db.batch();
    for (const d of views.docs.slice(i, i + 400)) b.delete(d.ref);
    await b.commit();
  }
  return [200, { ok: true, tips: tips.size, reactions: reactions.size }];
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  const body = (req.body && typeof req.body === 'object' ? req.body : null) || {};
  const action = body.action || 'post';
  if (!['post', 'delete', 'delete-mine'].includes(action)) return send(res, 400, { error: 'Unknown action.' });
  // Deleting is always allowed (account deletion must never be blocked).
  if (action === 'post') {
    if (!account.emailVerified) return send(res, 403, { error: 'Verify your email to share tips.', code: 'email' });
    if (isRateLimited(req, 'post-tip', { ...TIP_RATE_LIMIT, id: account.uid })) {
      return send(res, 429, { error: 'That is a lot of tips in one hour. Try again later.', code: 'rate' });
    }
  } else if (isRateLimited(req, 'post-tip-delete', { limit: 60, windowMs: HOUR_MS, id: account.uid })) {
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

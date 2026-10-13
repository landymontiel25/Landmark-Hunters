import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { withCors } from './_lib/cors.js';
import { deleteTipChildren, deleteTipPhoto, deleteTipPhotoFolder, reactionIsFresh, tipPhotoPath } from './_lib/tipsServer.js';
import { toMs } from './_lib/time.js';
import { canonicalLandmarkId } from '../src/data/regions.js';
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
    if (!photoPath) return [400, { error: 'That photo could not be used.', code: 'bad-photo' }];
  }

  const clean = cleanTipText(text);
  const filtered = filterTipText(clean);
  const status = filtered.flagged ? 'held' : 'live';
  // The place's current id (a renamed landmark keeps old check-ins under
  // its old id), so the tip shows on the page and stays one per place.
  const landmarkId = canonicalLandmarkId(checkin.landmarkId, checkin.region);
  const tipId = tipIdFor(account.uid, landmarkId);
  const ref = db.collection('tips').doc(tipId);
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
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // 10 tips an hour, across every server instance: tip_post_log/{uid}
  // (server-only) keeps the last hour's post times, and deleting a tip
  // doesn't take its post back off the log.
  const logRef = db.collection('tip_post_log').doc(account.uid);
  const outcome = await db.runTransaction(async (tx) => {
    const [existing, log] = await Promise.all([tx.get(ref), tx.get(logRef)]);
    if (existing.exists) return `exists:${existing.data().status}`;
    const recent = (log.exists && Array.isArray(log.data().at) ? log.data().at : []).filter((t) => typeof t === 'number' && t > nowMs - HOUR_MS);
    if (recent.length >= TIP_RATE_LIMIT.limit) return 'rate';
    tx.set(ref, tip);
    tx.set(logRef, { at: [...recent, nowMs] });
    return 'ok';
  });
  if (outcome === 'rate') return [429, { error: 'That is a lot of tips in one hour. Try again later.', code: 'rate' }];
  if (outcome === 'exists:removed') return [409, { error: 'Your tip here was removed by a moderator, so you cannot post another one here.', code: 'removed' }];
  if (outcome === 'exists:withdrawn') return [409, { error: 'Your earlier tip here is waiting for review. You can post again once it is reviewed.', code: 'withdrawn' }];
  if (outcome.startsWith('exists')) return [409, { error: 'You already shared a tip here. Delete it to write a new one.', code: 'exists' }];
  return [200, { ok: true, tipId, status }];
}

async function deleteTip(db, account, body) {
  const { landmarkId } = body;
  if (typeof landmarkId !== 'string' || !/^[\w.-]{1,300}$/.test(landmarkId)) return [400, { error: 'landmarkId is required.' }];
  const tipId = tipIdFor(account.uid, canonicalLandmarkId(landmarkId, typeof body.region === 'string' ? body.region : undefined));
  const ref = db.collection('tips').doc(tipId);
  const deletedAt = Date.now();
  // One transaction, so a report landing meanwhile is either counted (and
  // the tip withdrawn) or refused because the tip is gone.
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().authorUid !== account.uid) return { code: 'missing' };
    const t = snap.data();
    if (t.status === 'removed' || t.status === 'withdrawn') return { code: t.status };
    // A reported tip is withdrawn, not deleted: nobody sees it any more,
    // but it and its reports stay for the owner's review (the dashboard's
    // Content page), and a fresh copy can't be posted over the reports.
    if ((t.reportCount || 0) > 0) {
      tx.update(ref, { status: 'withdrawn', withdrawnAt: Date.now(), updatedAt: FieldValue.serverTimestamp() });
      return { code: 'withdrawn-now' };
    }
    // An unreported tip (live, or held by the filter and never public)
    // goes for good.
    tx.delete(ref);
    return { code: 'deleted', tip: t };
  });
  if (outcome.code === 'missing') return [404, { error: 'No tip of yours here.' }];
  if (outcome.code === 'removed') return [403, { error: 'This tip was removed by a moderator.', code: 'removed' }];
  if (outcome.code === 'withdrawn') return [200, { ok: true, withdrawn: true }];
  if (outcome.code === 'withdrawn-now') return [200, { ok: true, withdrawn: true }];
  // Cleanup after the tip is gone is best effort: anything it leaves is
  // older than a re-posted tip, and marks from before a tip was posted
  // never count (reactionIsFresh).
  try {
    // Only what is older than this delete: a tip re-posted at the same id
    // meanwhile keeps its own fresh marks.
    await deleteTipChildren(db, tipId, { beforeMs: deletedAt });
    await deleteTipPhotoIfUnused(db, account.uid, outcome.tip.photoPath);
  } catch (e) {
    console.error('tip cleanup failed', e?.message || e);
  }
  return [200, { ok: true }];
}

// A photo can sit on two tips (one upload, two places); it goes only when
// no other tip of yours shows it.
async function deleteTipPhotoIfUnused(db, uid, path) {
  if (!path) return;
  const others = await db.collection('tips').where('authorUid', '==', uid).where('photoPath', '==', path).limit(1).get();
  if (others.empty) await deleteTipPhoto(path);
}

// Account deletion (src/lib/accountDeletion.js): the caller's tips (removed
// ones too: the account is going), their marks on others' tips (and those
// tips' counts), their reports, and the server's record of what they viewed
// and who viewed their tips.
async function deleteMine(db, account) {
  const uid = account.uid;
  const [tips, reactions, views, authorViews, reports] = await Promise.all([
    db.collection('tips').where('authorUid', '==', uid).get(),
    db.collection('tip_reactions').where('uid', '==', uid).get(),
    db.collection('tip_views').where('uid', '==', uid).get(),
    db.collection('tip_views').where('authorUid', '==', uid).get(),
    db.collection('tip_reports').where('uid', '==', uid).get(),
  ]);
  // In parallel: account deletion runs under the function's time limit.
  // (Photos go with the folder below.)
  await Promise.all(tips.docs.map((d) => Promise.all([d.ref.delete(), deleteTipChildren(db, d.id)])));
  // Every photo in their folder, on a tip or not (an upload whose post
  // failed): the folder is theirs alone.
  await deleteTipPhotoFolder(uid);
  const reportsOnTheirTips = await db.collection('tip_reports').where('authorUid', '==', uid).get();
  await Promise.all(reactions.docs.map((d) => {
    const r = d.data();
    const tipRef = db.collection('tips').doc(r.tipId);
    return db.runTransaction(async (tx) => {
      const t = await tx.get(tipRef);
      // A mark left from a deleted tip with the same id was never counted.
      if (t.exists && reactionIsFresh(r, t.data())) {
        const dec = {};
        if (r.helpful === true) dec['counts.helpful'] = FieldValue.increment(-1);
        if (r.saved === true) dec['counts.saved'] = FieldValue.increment(-1);
        if (Object.keys(dec).length) tx.update(tipRef, dec);
      }
      tx.delete(d.ref);
    });
  }));
  // Their reports go (who reported), the counts they added stay: a hide
  // from reports must not lift because a reporter left.
  const rest = [...views.docs, ...authorViews.docs, ...reports.docs, ...reportsOnTheirTips.docs, db.collection('tip_post_log').doc(uid)].map((d) => d.ref || d);
  for (let i = 0; i < rest.length; i += 400) {
    const b = db.batch();
    for (const r of rest.slice(i, i + 400)) b.delete(r);
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
  // Account deletion is never limited or gated: it must always run.
  if (action === 'post') {
    if (!account.emailVerified) return send(res, 403, { error: 'Verify your email to share tips.', code: 'email' });
    // Attempts, not tips: a few retries after a refused tip must not lock
    // anyone out. The 10-tips-an-hour count is the account's own saved
    // tips (postTip).
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

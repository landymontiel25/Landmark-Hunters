import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { withCors } from './_lib/cors.js';
import { toMs } from './_lib/time.js';
import { blockedBetween, blockedEitherWay, HOUR_MS, isFirestoreId, madeOnThisPost, send, tipForViewer } from './_lib/tipsServer.js';
import { canonicalLandmarkId, canonicalRegionId } from '../src/data/regions.js';
import { tipIsPublic, TIP_REPORT_HIDE } from '../src/lib/tips.js';

// Reading tips and reacting to them (docs/discovery-network-plan.md,
// Phase 1). Tips of other people are read here, not straight from
// Firestore, because only the server can hide tips across a block in both
// directions (a client can't see who blocked it).
//   GET  ?region=&landmarkId=              your own tip there (any status)
//                                          first, then live tips, newest
//                                          first, plus your helpful/saved marks
//   POST { action: 'react', tipId, kind: 'helpful' | 'saved', on }
//   POST { action: 'report', tipId, reason }
//   POST { action: 'seen', tipIds }        tips that reached your screen
//                                          (tip_views, server-only), for the
//                                          "went because of a tip" count Nobody ever sees who viewed,
// marked or reported a tip: counts only. Every mark, report and view
// carries the tip's `gen` (see api/_lib/tipsServer.js).

const MAX_TIPS = 50;
// A view's lastAt moves at most this often, so a reload writes nothing.
const VIEW_REFRESH_MS = 12 * 60 * 60 * 1000;
export const REPORT_REASONS = ['spam', 'offensive', 'false', 'private-info', 'other'];

export async function listTips(db, viewerUid, { region, landmarkId }) {
  // The place's live tips (two equality filters, no composite index), plus
  // your own tip by its id whatever its status, so the page can say it is
  // waiting for review or was removed. Sorted here, newest first.
  const id = canonicalLandmarkId(landmarkId, region);
  const ownId = `${viewerUid}_${id}`;
  const [snap, ownSnap, blocked] = await Promise.all([
    db.collection('tips').where('landmarkId', '==', id).where('status', '==', 'live').get(),
    db.collection('tips').doc(ownId).get(),
    blockedBetween(db, viewerUid),
  ]);
  const want = canonicalRegionId(region);
  const visible = [];
  const candidates = [];
  for (const d of snap.docs) {
    const t = d.data();
    if (d.id === ownId || canonicalRegionId(t.region) !== want) continue;
    if (!tipIsPublic(t) || blocked.has(t.authorUid)) continue;
    candidates.push([d.id, t]);
  }
  // Newest first. One read for the first page's reports, your marks and
  // your views; a tip you reported stays hidden for you (with a little room
  // for the ones it drops).
  const at = (t) => toMs(t.createdAt) ?? t.createdAtMs ?? 0;
  candidates.sort((a, b) => at(b[1]) - at(a[1]));
  // Pages of 60 until 50 are kept: each page in one read of its reports
  // and your marks.
  const ref = (col, id) => db.collection(col).doc(id);
  const reactionOf = new Map();
  for (let start = 0; start < candidates.length && visible.length < MAX_TIPS; start += MAX_TIPS + 10) {
    const page = candidates.slice(start, start + MAX_TIPS + 10);
    const refs = page.flatMap(([tipId, t]) => [ref('tip_reports', `${tipId}_${t.gen ?? 'nogen'}_${viewerUid}`), ref('tip_reactions', `${viewerUid}_${tipId}`)]);
    const snaps = await db.getAll(...refs);
    page.forEach((c, i) => {
      if (snaps[i * 2]?.exists || visible.length >= MAX_TIPS) return;
      visible.push(c);
      reactionOf.set(c[0], snaps[i * 2 + 1]);
    });
  }
  const own = ownSnap.exists && canonicalRegionId(ownSnap.data().region) === want ? [[ownId, ownSnap.data()]] : [];
  const others = visible;
  const shown = [...own, ...others];
  const mine = {};
  for (const [tipId, t] of others) {
    const r = reactionOf.get(tipId);
    if (r?.exists && madeOnThisPost(r.data(), t)) mine[tipId] = { helpful: r.data().helpful === true, saved: r.data().saved === true };
  }

  return {
    tips: shown.map(([tipId, t]) => ({ ...tipForViewer(tipId, t, viewerUid), ...(t.authorUid === viewerUid ? { status: t.status, hidden: t.hidden === true } : {}) })),
    reactions: mine,
  };
}

// Tips that reached your screen (the app calls this when the list scrolls
// into view): one tip_views doc per tip, per post (gen), for the Phase 4
// "went because of a tip" count. firstAt never moves; lastAt at most twice
// a day. Other people's live tips you may see only, verified accounts only.
export async function markSeen(db, viewerUid, tipIds, { nowMs = Date.now() } = {}) {
  const ids = [...new Set((Array.isArray(tipIds) ? tipIds : []).filter(isFirestoreId))].slice(0, MAX_TIPS);
  if (!ids.length) return [200, { ok: true, recorded: 0 }];
  const [tipSnaps, blocked] = await Promise.all([db.getAll(...ids.map((id) => db.collection('tips').doc(id))), blockedBetween(db, viewerUid)]);
  const seen = tipSnaps.filter((s) => s.exists && s.data().authorUid !== viewerUid && tipIsPublic(s.data()) && !blocked.has(s.data().authorUid));
  if (!seen.length) return [200, { ok: true, recorded: 0 }];
  const viewRefs = seen.map((s) => db.collection('tip_views').doc(`${viewerUid}_${s.id}`));
  const before = await db.getAll(...viewRefs);
  const batch = db.batch();
  let writes = 0;
  seen.forEach((s, i) => {
    const t = s.data();
    const prev = before[i].exists && madeOnThisPost(before[i].data(), t) ? before[i].data() : null;
    if (prev && nowMs - (prev.lastAt || 0) < VIEW_REFRESH_MS) return;
    writes++;
    batch.set(viewRefs[i], { uid: viewerUid, tipId: s.id, gen: t.gen ?? null, authorUid: t.authorUid, landmarkId: t.landmarkId, region: t.region || null, firstAt: prev?.firstAt ?? nowMs, lastAt: nowMs });
  });
  if (writes) await batch.commit();
  return [200, { ok: true, recorded: writes }];
}

// The tip, if this viewer may act on it: someone else's, live, unhidden,
// no block either way.
async function actionableTip(db, uid, tipId) {
  const ref = db.collection('tips').doc(tipId);
  const snap = await ref.get();
  if (!snap.exists) return { error: [404, { error: 'No such tip.' }] };
  const tip = snap.data();
  if (tip.authorUid === uid) return { error: [400, { error: 'That is your own tip.' }] };
  if (!tipIsPublic(tip)) return { error: [404, { error: 'No such tip.' }] };
  if (await blockedEitherWay(db, uid, tip.authorUid)) return { error: [404, { error: 'No such tip.' }] };
  return { ref, tip };
}

export async function reactToTip(db, uid, { tipId, kind, on }) {
  if (!['helpful', 'saved'].includes(kind) || typeof on !== 'boolean') return [400, { error: 'kind and on are required.' }];
  // Adding a mark needs a tip you can see; taking one back works on any
  // tip you marked, even one hidden or blocked since.
  let tipRef = db.collection('tips').doc(tipId);
  let seenGen = null;
  if (on) {
    const found = await actionableTip(db, uid, tipId);
    if (found.error) return found.error;
    tipRef = found.ref;
    seenGen = found.tip.gen ?? null;
  }
  const reactionRef = db.collection('tip_reactions').doc(`${uid}_${tipId}`);
  const out = await db.runTransaction(async (tx) => {
    const [tipSnap, rSnap] = await Promise.all([tx.get(tipRef), tx.get(reactionRef)]);
    const tip = tipSnap.exists ? tipSnap.data() : null;
    // Still the post you saw, and still public.
    if (on && (!tip || !tipIsPublic(tip) || (tip.gen ?? null) !== seenGen)) return null;
    // Taking a mark back on a tip that no longer exists: the mark just goes.
    if (!tip) {
      if (rSnap.exists) tx.delete(reactionRef);
      return { reaction: { helpful: false, saved: false }, counts: null };
    }
    // A mark from an older post at the same id counts as no mark.
    const prev = rSnap.exists && madeOnThisPost(rSnap.data(), tip) ? rSnap.data() : { helpful: false, saved: false };
    const next = { helpful: prev.helpful === true, saved: prev.saved === true, [kind]: on };
    const changed = (prev[kind] === true) !== on;
    if (changed) tx.update(tipRef, { [`counts.${kind}`]: FieldValue.increment(on ? 1 : -1) });
    if (!next.helpful && !next.saved) {
      if (rSnap.exists) tx.delete(reactionRef);
    } else {
      tx.set(reactionRef, {
        uid,
        tipId,
        gen: tip.gen ?? null,
        authorUid: tip.authorUid,
        landmarkId: tip.landmarkId,
        region: tip.region || null,
        helpful: next.helpful,
        saved: next.saved,
        firstAt: prev.firstAt ?? Date.now(),
        ...(on ? { [`${kind}At`]: Date.now() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const counts = { helpful: tip.counts?.helpful || 0, saved: tip.counts?.saved || 0 };
    if (changed) counts[kind] = Math.max(0, counts[kind] + (on ? 1 : -1));
    return { reaction: next, counts: tipIsPublic(tip) ? counts : null };
  });
  if (!out) return [404, { error: 'No such tip.' }];
  return [200, { ok: true, reaction: out.reaction, counts: out.counts }];
}

// Two distinct reporters hide a tip until the owner reviews it. Who
// reported stays in server-only tip_reports/{tipId}_{gen}_{uid} (no rule matches
// it, so clients are denied), never on the tip, which its author can read.
export async function reportTip(db, uid, { tipId, reason }) {
  if (!REPORT_REASONS.includes(reason)) return [400, { error: 'Pick a reason.' }];
  const found = await actionableTip(db, uid, tipId);
  if (found.error) return found.error;
  // One doc per person per post of the tip, so a report on a later post
  // never overwrites the record of an earlier one.
  const reportRef = db.collection('tip_reports').doc(`${tipId}_${found.tip.gen ?? 'nogen'}_${uid}`);
  const ok = await db.runTransaction(async (tx) => {
    const [tipSnap, rSnap] = await Promise.all([tx.get(found.ref), tx.get(reportRef)]);
    const tip = tipSnap.exists ? tipSnap.data() : null;
    // Still the post you saw, and still public.
    if (!tip || !tipIsPublic(tip) || (tip.gen ?? null) !== (found.tip.gen ?? null)) return false;
    // One report per person per post (the doc id holds the post's gen).
    if (rSnap.exists) return true;
    const next = (tip.reportCount || 0) + 1;
    tx.set(reportRef, { uid, tipId, gen: tip.gen ?? null, authorUid: tip.authorUid, reason, at: Date.now() });
    // No report time on the tip: its author can read it, and a time could
    // point at who reported.
    tx.update(found.ref, { reportCount: next, hidden: next >= TIP_REPORT_HIDE });
    return true;
  });
  if (!ok) return [404, { error: 'No such tip.' }];
  return [200, { ok: true }];
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const account = await verifyIdToken(req);
  if (!account) return send(res, 401, { error: 'Sign in first.' });
  try {
    const db = adminDb();
    if (req.method === 'GET') {
      if (isRateLimited(req, 'tips-read', { limit: 600, windowMs: HOUR_MS, id: account.uid })) return send(res, 429, { error: 'Too many requests. Try again later.' });
      const region = String(req.query?.region || '');
      const landmarkId = String(req.query?.landmarkId || '');
      if (!isFirestoreId(region) || !isFirestoreId(landmarkId)) return send(res, 400, { error: 'region and landmarkId are required.' });
      res.setHeader?.('Cache-Control', 'private, no-store');
      return send(res, 200, await listTips(db, account.uid, { region, landmarkId }));
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : null) || {};
    if (body.action === 'seen') {
      // Views count toward "went because of a tip": verified accounts only.
      if (!account.emailVerified) return send(res, 200, { ok: true, recorded: 0 });
      if (isRateLimited(req, 'tips-seen', { limit: 600, windowMs: HOUR_MS, id: account.uid })) return send(res, 429, { error: 'Too many requests. Try again later.' });
      const [code, out] = await markSeen(db, account.uid, body.tipIds);
      return send(res, code, out);
    }
    if (typeof body.tipId !== 'string' || !isFirestoreId(body.tipId)) return send(res, 400, { error: 'tipId is required.' });
    // Marks and reports move counts and hide tips, so they take a verified
    // email, like posting: a throwaway account can't hide a tip.
    if (!account.emailVerified) return send(res, 403, { error: 'Verify your email first.', code: 'email' });
    if (body.action === 'react') {
      if (isRateLimited(req, 'tips-react', { limit: 200, windowMs: HOUR_MS, id: account.uid })) return send(res, 429, { error: 'Too many requests. Try again later.' });
      const [code, out] = await reactToTip(db, account.uid, body);
      return send(res, code, out);
    }
    if (body.action === 'report') {
      if (isRateLimited(req, 'tips-report', { limit: 30, windowMs: HOUR_MS, id: account.uid })) return send(res, 429, { error: 'Too many reports. Try again later.' });
      const [code, out] = await reportTip(db, account.uid, body);
      return send(res, code, out);
    }
    return send(res, 400, { error: 'Unknown action.' });
  } catch (err) {
    console.error('tips failed', err?.message || err);
    return send(res, 500, { error: 'Could not load tips. Try again.' });
  }
}

export default withCors(handler);

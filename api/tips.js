import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { withCors } from './_lib/cors.js';
import { blockedBetween, blockedEitherWay, reactionIsFresh, tipForViewer, toMs } from './_lib/tipsServer.js';
import { canonicalLandmarkId, canonicalRegionId } from '../src/data/regions.js';
import { tipIsPublic, TIP_REPORT_HIDE } from '../src/lib/tips.js';

// Reading tips and reacting to them (docs/discovery-network-plan.md,
// Phase 1). Tips of other people are read here, not straight from
// Firestore, because only the server can hide tips across a block in both
// directions (a client can't see who blocked it).
//   GET  ?region=&landmarkId=              live tips at a place, newest first,
//                                          plus your own helpful/saved marks
//   POST { action: 'react', tipId, kind: 'helpful' | 'saved', on }
//   POST { action: 'report', tipId, reason? }
// Each GET records which tips you were shown (tip_views, server-only) for
// the "went because of a tip" count later. Nobody ever sees who viewed,
// marked or reported a tip: counts only.

const HOUR_MS = 60 * 60 * 1000;
const MAX_TIPS = 50;
const VIEW_REFRESH_MS = 12 * 60 * 60 * 1000;
const ID_RE = /^[\w.-]{1,300}$/;
const REPORT_REASONS = ['spam', 'offensive', 'false', 'private-info', 'other'];
const send = (res, code, body) => res.status(code).json(body);

export async function listTips(db, viewerUid, { region, landmarkId }, { nowMs = Date.now() } = {}) {
  // Every tip at the place (one per person per place keeps this small),
  // sorted here: a query limit without an order would cut by author id.
  const id = canonicalLandmarkId(landmarkId, region);
  const [snap, blocked] = await Promise.all([db.collection('tips').where('landmarkId', '==', id).get(), blockedBetween(db, viewerUid)]);
  const want = canonicalRegionId(region);
  const visible = [];
  for (const d of snap.docs) {
    const t = d.data();
    if (canonicalRegionId(t.region) !== want) continue;
    // Your own tip always comes back, with its status, so the page can say
    // it is waiting for review or was removed.
    if (t.authorUid !== viewerUid && (!tipIsPublic(t) || blocked.has(t.authorUid))) continue;
    visible.push([d.id, t]);
  }
  visible.sort((a, b) => (toMs(b[1].createdAt) ?? b[1].createdAtMs ?? 0) - (toMs(a[1].createdAt) ?? a[1].createdAtMs ?? 0));
  const shown = visible.slice(0, MAX_TIPS);
  const reactionRefs = shown.map(([tipId]) => db.collection('tip_reactions').doc(`${viewerUid}_${tipId}`));
  const reactionSnaps = reactionRefs.length ? await db.getAll(...reactionRefs) : [];
  const mine = {};
  reactionSnaps.forEach((s, i) => {
    if (s.exists && reactionIsFresh(s.data(), shown[i][1])) mine[shown[i][0]] = { helpful: s.data().helpful === true, saved: s.data().saved === true };
  });
  // Views: other people's live tips only. firstAt (when you first saw it)
  // never moves; lastAt moves at most twice a day, so a reload writes
  // nothing.
  const viewed = shown.filter(([, t]) => t.authorUid !== viewerUid && t.status === 'live');
  if (viewed.length) {
    const viewRefs = viewed.map(([tipId]) => db.collection('tip_views').doc(`${viewerUid}_${tipId}`));
    const before = await db.getAll(...viewRefs);
    const batch = db.batch();
    let writes = 0;
    viewed.forEach(([tipId, t], i) => {
      if (before[i].exists && nowMs - (before[i].data().lastAt || 0) < VIEW_REFRESH_MS) return;
      writes++;
      batch.set(viewRefs[i], {
        uid: viewerUid,
        tipId,
        authorUid: t.authorUid,
        landmarkId: t.landmarkId,
        region: t.region || null,
        firstAt: before[i].exists ? (before[i].data().firstAt ?? nowMs) : nowMs,
        lastAt: nowMs,
      });
    });
    if (writes) await batch.commit();
  }
  return {
    tips: shown.map(([id, t]) => ({ ...tipForViewer(id, t, viewerUid), ...(t.authorUid === viewerUid ? { status: t.status } : {}) })),
    reactions: mine,
  };
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
  // Taking a mark back works on any tip you marked, even one that has since
  // been hidden or blocked; adding one needs a tip you can see.
  let tipRef = db.collection('tips').doc(tipId);
  if (on) {
    const found = await actionableTip(db, uid, tipId);
    if (found.error) return found.error;
    tipRef = found.ref;
  }
  const reactionRef = db.collection('tip_reactions').doc(`${uid}_${tipId}`);
  const out = await db.runTransaction(async (tx) => {
    const [tipSnap, rSnap] = await Promise.all([tx.get(tipRef), tx.get(reactionRef)]);
    if (!on && !rSnap.exists) return { helpful: false, saved: false };
    if (!tipSnap.exists) {
      if (!on) tx.delete(reactionRef);
      return on ? null : { helpful: false, saved: false };
    }
    if (on && !tipIsPublic(tipSnap.data())) return null;
    // A mark from before this tip was posted belongs to a deleted tip that
    // had the same id: it counts as no mark.
    const fresh = rSnap.exists && reactionIsFresh(rSnap.data(), tipSnap.data());
    const prev = fresh ? rSnap.data() : { helpful: false, saved: false };
    const next = { helpful: prev.helpful === true, saved: prev.saved === true, [kind]: on };
    if ((prev[kind] === true) !== on) tx.update(tipRef, { [`counts.${kind}`]: FieldValue.increment(on ? 1 : -1) });
    if (!next.helpful && !next.saved) tx.delete(reactionRef);
    else {
      tx.set(reactionRef, {
        uid,
        tipId,
        authorUid: tipSnap.data().authorUid,
        landmarkId: tipSnap.data().landmarkId,
        region: tipSnap.data().region || null,
        helpful: next.helpful,
        saved: next.saved,
        ...(on && !fresh ? { firstAt: Date.now() } : {}),
        ...(on ? { [`${kind}At`]: Date.now() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return next;
  });
  if (!out) return [404, { error: 'No such tip.' }];
  return [200, { ok: true, reaction: out }];
}

// Two distinct reporters hide a tip until the owner reviews it. Who
// reported stays in server-only tip_reports/{tipId}_{uid} (no rule lets a
// client read it), never on the tip, which its author can read.
export async function reportTip(db, uid, { tipId, reason = 'other' }) {
  if (!REPORT_REASONS.includes(reason)) return [400, { error: 'Pick a reason.' }];
  const found = await actionableTip(db, uid, tipId);
  if (found.error) return found.error;
  const reportRef = db.collection('tip_reports').doc(`${tipId}_${uid}`);
  const exists = await db.runTransaction(async (tx) => {
    const [tipSnap, rSnap] = await Promise.all([tx.get(found.ref), tx.get(reportRef)]);
    if (!tipSnap.exists) return false;
    // A report from before this tip was posted (a deleted tip with the same
    // id) doesn't stop a new one.
    if (rSnap.exists && (rSnap.data().at ?? 0) >= (tipSnap.data().createdAtMs ?? 0)) return true;
    const next = (tipSnap.data().reportCount || 0) + 1;
    tx.set(reportRef, { uid, tipId, authorUid: tipSnap.data().authorUid, reason, at: Date.now() });
    tx.update(found.ref, { reportCount: next, hidden: next >= TIP_REPORT_HIDE, lastReportedAt: Date.now() });
    return true;
  });
  if (!exists) return [404, { error: 'No such tip.' }];
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
      if (!ID_RE.test(region) || !ID_RE.test(landmarkId)) return send(res, 400, { error: 'region and landmarkId are required.' });
      res.setHeader?.('Cache-Control', 'private, no-store');
      return send(res, 200, await listTips(db, account.uid, { region, landmarkId }));
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : null) || {};
    if (typeof body.tipId !== 'string' || !ID_RE.test(body.tipId)) return send(res, 400, { error: 'tipId is required.' });
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

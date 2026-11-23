import { verifyIdToken } from './verifyAuth.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { validClientDayKey } from './streakDay.js';
import { cleanUserName, leaderboardPointWrites } from './leaderboardPoints.js';
import { withCors } from './cors.js';
import { userDayKey } from './streakClock.js';
import { canonicalRegionId, getLandmark } from '../../src/data/regions.js';
import { isVerifiedCheckin } from '../../src/lib/realCheckin.js';

// Trivia missions (owner, 2026-11-16): a landmark's `mission` of type
// 'trivia' asks a four-option question after you check in there. One answer
// per account and place; the right one pays +10 points, a wrong one 0. The
// answer is checked here against the catalog, never taken from the app, and
// the payout follows api/_lib/landmarkBonus.js (the rules cap a client's own
// points write, so points are only ever added here).
export const MISSION_POINTS = 10;

// Pure: what this answer earns.
export function missionAnswerDecision({ mission, answer, checkins, previous }) {
  if (mission?.type !== 'trivia' || !Array.isArray(mission.options)) return { awarded: 0, reason: 'no-trivia' };
  if (!checkins.some((c) => isVerifiedCheckin(c))) return { awarded: 0, reason: 'no-checkin' };
  if (previous) return { awarded: 0, reason: 'already', correct: !!previous.correct, answer: mission.answer, picked: previous.answer };
  if (!Number.isInteger(answer) || answer < 0 || answer >= mission.options.length) return { awarded: 0, reason: 'bad-answer' };
  const correct = answer === mission.answer;
  return { awarded: correct ? MISSION_POINTS : 0, correct, answer: mission.answer, picked: answer };
}

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id);

export async function answerMission(db, uid, regionId, landmarkId, answer, dayId) {
  const region = canonicalRegionId(regionId);
  const mission = getLandmark(region, landmarkId)?.mission;
  if (mission?.type !== 'trivia') return { awarded: 0, reason: 'no-trivia' };
  const visits = await db.collection('checkins').where('userId', '==', uid).where('landmarkId', '==', landmarkId).get();
  const checkins = visits.docs.map((d) => d.data());
  const ref = db.collection('mission_answers').doc(`${uid}_${landmarkId}`);
  // In a transaction so two quick taps can't both count.
  return db.runTransaction(async (t) => {
    const prev = await t.get(ref);
    const decision = missionAnswerDecision({ mission, answer, checkins, previous: prev.exists ? prev.data() : null });
    if (decision.reason) return decision;
    t.create(ref, { userId: uid, regionId: region, landmarkId, answer, correct: decision.correct, points: decision.awarded, createdAt: FieldValue.serverTimestamp() });
    if (decision.awarded) {
      t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(decision.awarded) }, { merge: true });
      const userName = cleanUserName(checkins.find((c) => c.userName)?.userName);
      for (const [r, data] of leaderboardPointWrites(db, uid, userName, decision.awarded, dayId)) t.set(r, data, { merge: true });
    }
    return decision;
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (isRateLimited(req, 'mission-answer', { limit: 30, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many answers in a row. Wait a bit and try again.' });
    return;
  }
  const { regionId, landmarkId, answer, dayId, photoURL } = req.body || {};
  // A photo mission's photo (missionPhoto.js): checked against the mission.
  if (typeof photoURL === 'string') {
    if (!validId(regionId) || !validId(landmarkId) || !validClientDayKey(dayId) || photoURL.length > 2000) {
      res.status(400).json({ error: 'regionId, landmarkId, photoURL and dayId are required.' });
      return;
    }
    try {
      const { checkMissionPhoto } = await import('./missionPhoto.js');
      const db = adminDb();
      const out = await checkMissionPhoto(db, account.uid, regionId, landmarkId, photoURL, await userDayKey(db, account.uid));
      res.status(200).json({ ok: true, awarded: out.awarded, passed: out.passed ?? false, reason: out.reason || null, why: out.why || null, mission: out.mission || null });
    } catch (e) {
      console.error('[mission-photo] failed', e);
      res.status(500).json({ error: "Couldn't check your photo." });
    }
    return;
  }
  if (!validId(regionId) || !validId(landmarkId) || !Number.isInteger(answer) || !validClientDayKey(dayId)) {
    res.status(400).json({ error: 'regionId, landmarkId, answer and dayId are required.' });
    return;
  }
  try {
    const db = adminDb();
    const out = await answerMission(db, account.uid, regionId, landmarkId, answer, await userDayKey(db, account.uid));
    res.status(200).json({ ok: true, awarded: out.awarded, correct: out.correct ?? null, answer: out.answer ?? null, picked: out.picked ?? null, reason: out.reason || null });
  } catch (e) {
    console.error('[mission-answer] failed', e);
    res.status(500).json({ error: "Couldn't check your answer." });
  }
}

export default withCors(handler);

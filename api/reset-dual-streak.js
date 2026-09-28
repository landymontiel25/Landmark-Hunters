import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { monthKey } from './_lib/streakDay.js';

const FREEZES_PER_MONTH = 2;

// One-off correction, not a normal user-facing capability -- count/best/
// lastCompletedDay are deliberately server-authority everywhere else in
// this app (firestore.rules denies any client write touching them) so a
// streak means something real. This exists to fix a specific case where a
// pair's count went wrong for reasons outside their control (the
// FIREBASE_SERVICE_ACCOUNT outage that broke every admin-SDK streak
// endpoint for a while -- see api/ensure-solo-streak.js's history) and
// they want it back to a real, honest 0 rather than a number neither of
// them actually earned. Resets everything BUT the pairing itself
// (memberIds/memberNames/cityId/mode/createdAt untouched) -- either member
// can call it for their own pair.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  if (isRateLimited(req, 'reset-dual-streak', { limit: 5, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { pairId } = req.body || {};
  if (!pairId || typeof pairId !== 'string') {
    res.status(400).json({ error: 'pairId is required.' });
    return;
  }

  try {
    const db = adminDb();
    const streakRef = db.collection('streaks').doc(pairId);
    const streakSnap = await streakRef.get();
    if (!streakSnap.exists) {
      res.status(404).json({ error: 'No such streak.' });
      return;
    }
    const streak = streakSnap.data();
    if (streak.mode !== 'dual' || !(streak.memberIds || []).includes(account.uid)) {
      res.status(403).json({ error: "That's not your streak." });
      return;
    }

    await streakRef.update({
      count: 0,
      best: 0,
      lastCompletedDay: null,
      freezesLeft: FREEZES_PER_MONTH,
      freezeMonth: monthKey(new Date()),
      frozenDays: [],
      recoveryOpenUntil: FieldValue.delete(),
      recoveryPriorCount: FieldValue.delete(),
      recoveryUsedMonth: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Could not reset that streak.' });
  }
}

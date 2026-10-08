import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { dayKey, monthKey, validClientDayKey, monthKeyOfDay } from './_lib/streakDay.js';
import { withCors } from './_lib/cors.js';

// 1 personal freeze per month for a solo streak -- half the dual streak's
// 2 shared ones (use-streak-freeze.js), since there's no partner to share
// the cost with. Spending it holds TODAY specifically -- if today's 3
// don't get rated, close-solo-streak-day.js sees today in frozenDays and
// bridges the gap instead of resetting the count.
export const SOLO_FREEZES_PER_MONTH = 1;

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
  if (isRateLimited(req, 'use-solo-streak-freeze', { limit: 10, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }

  try {
    const db = adminDb();
    const streakRef = db.collection('streaks').doc(account.uid);
    const streakSnap = await streakRef.get();
    if (!streakSnap.exists) {
      res.status(404).json({ error: 'No such streak.' });
      return;
    }
    const streak = streakSnap.data();
    if (streak.mode !== 'solo' || !(streak.memberIds || []).includes(account.uid)) {
      res.status(403).json({ error: "That's not your streak." });
      return;
    }

    // The caller's own local day (see validClientDayKey) -- falls back to the
    // server's clock only for an old client that doesn't send one.
    const now = new Date();
    const clientDay = validClientDayKey(req.body?.dayId, now);
    const today = clientDay || dayKey(now);
    const thisMonth = clientDay ? monthKeyOfDay(clientDay) : monthKey(now);
    const carryingOver = streak.freezeMonth !== thisMonth;
    const freezesLeft = carryingOver ? SOLO_FREEZES_PER_MONTH : streak.freezesLeft ?? SOLO_FREEZES_PER_MONTH;
    const frozenDays = carryingOver ? [] : streak.frozenDays || [];

    if (frozenDays.includes(today)) {
      res.status(200).json({ ok: true, alreadyFrozen: true, freezesLeft });
      return;
    }
    if (freezesLeft <= 0) {
      res.status(200).json({ ok: false, error: 'No freezes left this month.' });
      return;
    }

    await streakRef.update({
      freezeMonth: thisMonth,
      freezesLeft: freezesLeft - 1,
      frozenDays: [...frozenDays, today],
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ ok: true, freezesLeft: freezesLeft - 1 });
  } catch (e) {
    console.error('[use-solo-streak-freeze]', e);
    res.status(500).json({ error: 'Could not use a freeze.' });
  }
}

export default withCors(handler);

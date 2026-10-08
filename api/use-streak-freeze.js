import { verifyIdToken } from './_lib/verifyAuth.js';
import { isRateLimited } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { dayKey, monthKey, validClientDayKey, monthKeyOfDay } from './_lib/streakDay.js';
import { withCors } from './_lib/cors.js';

// Shared freezes (item 5): 2 per pair per month, resets on the 1st, either
// member can spend one. Spending one holds TODAY specifically -- if neither
// of you finishes today's quota, close-streak-day.js sees today in
// frozenDays and bridges the gap instead of resetting the count. It never
// adds a day on its own.
//
// FREEZES_PER_MONTH is duplicated here (also in pairStreaks.js and
// firestore.rules' create rule) rather than imported -- pairStreaks.js
// pulls in the client Firebase SDK (firebase/firestore via ./firebase.js),
// which this serverless function shouldn't load at all (see
// _lib/streakDay.js's own comment for why that crashes here).
const FREEZES_PER_MONTH = 2;
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
  if (isRateLimited(req, 'use-streak-freeze', { limit: 10, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const { pairId } = req.body || {};
  if (!pairId || typeof pairId !== 'string' || !/^[\w-]{1,128}$/.test(pairId)) {
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
    // A solo streak's doc id is the uid, so it could be passed as a pairId;
    // only pair streaks belong here (an old pair doc may predate `mode`).
    if (streak.mode === 'solo' || !(streak.memberIds || []).includes(account.uid)) {
      res.status(403).json({ error: "That's not your streak." });
      return;
    }

    // The caller's own local day (see validClientDayKey) -- falls back to the
    // server's clock only for an old client that doesn't send one.
    const now = new Date();
    const clientDay = validClientDayKey(req.body?.dayId, now);
    const today = clientDay || dayKey(now);
    const thisMonth = clientDay ? monthKeyOfDay(clientDay) : monthKey(now);
    // Roll over into a fresh month's allowance the moment anyone touches
    // freezes after the 1st -- no separate scheduled reset needed.
    const carryingOver = streak.freezeMonth !== thisMonth;
    const freezesLeft = carryingOver ? FREEZES_PER_MONTH : streak.freezesLeft ?? FREEZES_PER_MONTH;
    const frozenDays = carryingOver ? [] : streak.frozenDays || [];

    if (frozenDays.includes(today)) {
      res.status(200).json({ ok: true, alreadyFrozen: true, freezesLeft });
      return;
    }
    if (freezesLeft <= 0) {
      res.status(200).json({ ok: false, error: "No freezes left this month." });
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
    console.error('[use-streak-freeze]', e);
    res.status(500).json({ error: 'Could not use a freeze.' });
  }
}

export default withCors(handler);

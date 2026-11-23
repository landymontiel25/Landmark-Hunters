import { verifyIdToken } from './verifyAuth.js';
import { isRateLimited } from './rateLimit.js';
import { adminDb, adminAuth } from './firebaseAdmin.js';
import { validClientDayKey } from './streakDay.js';
import { withCors } from './cors.js';
import { payReferral } from './referralBonus.js';

// POST /api/referral-claim { dayId }: pays whatever referrals of the caller's
// can pay now -- the one that brought the caller in, and any the caller
// brought in -- and says why the others can't yet (needs-phone,
// needs-verified-checkin, phone-used, referrer caps).
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
  if (isRateLimited(req, 'referral-claim', { limit: 20, windowMs: 10 * 60 * 1000, id: account.uid })) {
    res.status(429).json({ error: 'Too many requests -- wait a bit and try again.' });
    return;
  }
  const dayId = validClientDayKey(req.body?.dayId);
  try {
    const db = adminDb();
    const auth = await adminAuth();
    const authUser = (uid) => auth.getUser(uid);
    const results = [];
    const mine = await db.collection('referrals').doc(account.uid).get();
    if (mine.exists) results.push({ referredUid: account.uid, side: 'referred', ...(await payReferral(db, account.uid, { authUser, dayId })) });
    const brought = await db.collection('referrals').where('referrerUid', '==', account.uid).get();
    for (const d of brought.docs.slice(0, 50)) {
      if (d.data().referrerClaimed) continue;
      results.push({ referredUid: d.id, side: 'referrer', ...(await payReferral(db, d.id, { authUser, dayId })) });
    }
    res.status(200).json({ ok: true, results });
  } catch (e) {
    console.error('[referral-claim] failed', e);
    res.status(500).json({ error: 'Could not check referral bonuses.' });
  }
}

export default withCors(handler);

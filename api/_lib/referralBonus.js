import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { cleanUserName, leaderboardPointWrites } from './leaderboardPoints.js';
import { isVerifiedCheckin } from '../../src/lib/realCheckin.js';

// Referral bonuses are paid here, on the server (anti-farming item 3, owner
// 2026-11-23). Until then each side's phone paid itself +50 once the new
// account had a verified email, so a throwaway inbox and a second account
// earned both sides 50. Now a referral pays only when:
//   - the new (referred) account has a verified phone number (Firebase Auth
//     phone sign-in, linked to the account), and that number has never paid
//     a referral before (referral_phones/{sha256(number)}),
//   - the new account has made at least one server-verified check-in,
//   - the referrer is under REFERRALS_PER_MONTH this month and
//     REFERRALS_LIFETIME in all.
// Then both sides are paid in one transaction, and the referral's two
// claimed flags (server-written now) say so.

export const REFERRAL_BONUS_POINTS = 50;
export const REFERRALS_PER_MONTH = 5;
export const REFERRALS_LIFETIME = 20;

export const phoneKey = (phone) => createHash('sha256').update(String(phone)).digest('hex');
const monthOf = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// Pure: can this referral pay now?
export function referralDecision({ referral, phone, phoneUsedBy, verifiedVisit, referrerStats, month }) {
  if (!referral) return { pay: false, reason: 'no-referral' };
  if (referral.referredClaimed && referral.referrerClaimed) return { pay: false, reason: 'already' };
  if (!phone) return { pay: false, reason: 'needs-phone' };
  if (phoneUsedBy && phoneUsedBy !== referral.referredUid) return { pay: false, reason: 'phone-used' };
  if (!verifiedVisit) return { pay: false, reason: 'needs-verified-checkin' };
  const thisMonth = referrerStats?.month === month ? referrerStats.monthCount || 0 : 0;
  if ((referrerStats?.total || 0) >= REFERRALS_LIFETIME) return { pay: false, reason: 'referrer-cap' };
  if (thisMonth >= REFERRALS_PER_MONTH) return { pay: false, reason: 'referrer-month-cap' };
  return { pay: true };
}

// Tries to pay one referral (doc id = the referred account's uid).
// authUser(uid) resolves to the Auth user (phoneNumber), dayId names the
// boards' day for both sides.
export async function payReferral(db, referredUid, { authUser, dayId = null, now = new Date() }) {
  const refRef = db.collection('referrals').doc(referredUid);
  const snap = await refRef.get();
  if (!snap.exists) return { paid: false, reason: 'no-referral' };
  const referral = snap.data();
  const user = await Promise.resolve()
    .then(() => authUser(referredUid))
    .catch(() => null);
  const phone = user?.phoneNumber || null;
  const visits = await db.collection('checkins').where('userId', '==', referredUid).get();
  const verifiedVisit = visits.docs.some((d) => isVerifiedCheckin(d.data()));
  const phoneRef = phone ? db.collection('referral_phones').doc(phoneKey(phone)) : null;
  const statsRef = db.collection('referral_stats').doc(referral.referrerUid);
  const month = monthOf(now);

  return db.runTransaction(async (t) => {
    const [fresh, phoneSnap, statsSnap, referredUser, referrerUser] = await Promise.all([
      t.get(refRef),
      phoneRef ? t.get(phoneRef) : null,
      t.get(statsRef),
      t.get(db.collection('users').doc(referredUid)),
      t.get(db.collection('users').doc(referral.referrerUid)),
    ]);
    const r = fresh.data();
    const decision = referralDecision({
      referral: r,
      phone,
      phoneUsedBy: phoneSnap?.exists ? phoneSnap.data().referredUid : null,
      verifiedVisit,
      referrerStats: statsSnap.exists ? statsSnap.data() : null,
      month,
    });
    if (!decision.pay) return { paid: false, reason: decision.reason };
    const stats = statsSnap.exists ? statsSnap.data() : {};
    t.set(phoneRef, { referredUid, referrerUid: r.referrerUid, createdAt: FieldValue.serverTimestamp() });
    t.set(statsRef, {
      total: (stats.total || 0) + 1,
      month,
      monthCount: (stats.month === month ? stats.monthCount || 0 : 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    t.update(refRef, { referredClaimed: true, referrerClaimed: true, paidAt: FieldValue.serverTimestamp() });
    const pay = (uid, userSnap) => {
      t.set(db.collection('users').doc(uid), { bonusPoints: FieldValue.increment(REFERRAL_BONUS_POINTS) }, { merge: true });
      const name = cleanUserName(userSnap.exists ? userSnap.data().username : null);
      for (const [ref, data] of leaderboardPointWrites(db, uid, name, REFERRAL_BONUS_POINTS, dayId)) t.set(ref, data, { merge: true });
    };
    pay(referredUid, referredUser);
    pay(r.referrerUid, referrerUser);
    return { paid: true, points: REFERRAL_BONUS_POINTS };
  });
}

import { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { findUserByUsername } from './friends';
// Dynamic, not static: this file is reachable from AuthContext (eager,
// app-wide) via recordReferralIfPending, while awardLeaderboardPoints is
// only ever needed by claimMyReferralBonuses (called from Profile, already
// lazy). A static import here would drag leaderboard.js -- and, through it,
// geo.js's REGIONS catalog -- into the eager bundle for every page load.

// A flat bonus for both sides once a referred friend signs up. Stored on
// the user's own bonusPoints field (folded into their all-time total by
// getUserStats) and also added to the current week/month/year leaderboard
// entries, so it counts toward rank the same way check-in points do.
export const REFERRAL_BONUS_POINTS = 50;

const STORAGE_KEY = 'landmarkhunters.pendingReferral';

// Call once at app boot. First touch wins -- doesn't overwrite a code
// already waiting from an earlier visit, in case someone clicks an invite
// link, browses a while, then signs up later without the link still
// being the current URL.
export function capturePendingReferralFromUrl() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && !localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, ref.trim().toLowerCase());
    }
  } catch {
    /* localStorage/URL unavailable -- referral just doesn't get credited */
  }
}

function takePendingReferral() {
  try {
    const ref = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    return ref;
  } catch {
    return null;
  }
}

/**
 * Called right after a brand-new account is created. Best-effort -- any
 * failure here (bad/unknown code, no referral pending, offline) should
 * never break signup itself, so every step is guarded.
 */
export async function recordReferralIfPending(newUser) {
  if (!db) return;
  const refUsername = takePendingReferral();
  if (!refUsername) return;
  try {
    const referrer = await findUserByUsername(refUsername);
    if (!referrer || referrer.uid === newUser.uid) return;
    // Doc id is the referred user's own uid -- at most one referral can
    // ever be recorded per account, so nobody can rack up bonuses by
    // "signing up" under the same referrer's link repeatedly.
    await setDoc(doc(db, 'referrals', newUser.uid), {
      referrerUid: referrer.uid,
      referrerUsername: refUsername,
      referredUid: newUser.uid,
      referredClaimed: false,
      referrerClaimed: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    /* invalid/unknown code, or offline -- just skip */
  }
}

/**
 * Claims whatever referral bonuses this signed-in user is owed: as the
 * person who was referred (immediate, one-time), and/or as someone whose
 * own invite link brought in a new signup (checked periodically -- see
 * call site). Each side can only ever write its own uid's fields, per
 * firestore.rules, so this never touches another account's points.
 */
// One run per uid at a time. Profile re-runs its claim effect whenever the
// `user` object changes (and twice on mount in StrictMode), and each run
// reads "not claimed yet" before the first one has written the flag, so two
// overlapping runs both paid out the same +50.
const claimsInFlight = new Map();
export function claimMyReferralBonuses(uid, userName) {
  if (!db || !uid) return Promise.resolve();
  if (claimsInFlight.has(uid)) return claimsInFlight.get(uid);
  const run = claimBonuses(uid, userName).finally(() => claimsInFlight.delete(uid));
  claimsInFlight.set(uid, run);
  return run;
}

async function claimBonuses(uid, userName) {
  if (!db || !uid) return;
  const { awardLeaderboardPoints } = await import('./leaderboard');

  try {
    const mine = await getDoc(doc(db, 'referrals', uid));
    if (mine.exists() && !mine.data().referredClaimed) {
      await updateDoc(doc(db, 'users', uid), { bonusPoints: increment(REFERRAL_BONUS_POINTS) });
      await awardLeaderboardPoints(uid, userName, REFERRAL_BONUS_POINTS);
      await updateDoc(mine.ref, { referredClaimed: true });
    }
  } catch {
    /* best-effort */
  }

  try {
    // Single-field query (no composite index needed) -- filter the
    // already-claimed ones client-side instead.
    const snap = await getDocs(query(collection(db, 'referrals'), where('referrerUid', '==', uid)));
    for (const d of snap.docs) {
      if (d.data().referrerClaimed) continue;
      await updateDoc(doc(db, 'users', uid), { bonusPoints: increment(REFERRAL_BONUS_POINTS) });
      await awardLeaderboardPoints(uid, userName, REFERRAL_BONUS_POINTS);
      await updateDoc(d.ref, { referrerClaimed: true });
    }
  } catch {
    /* best-effort */
  }
}

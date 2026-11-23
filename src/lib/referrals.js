import { doc, setDoc, serverTimestamp, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { findUserByUsername } from './friends';
// The claim's helpers are imported on demand: this file is reachable from
// AuthContext (eager, app-wide) via recordReferralIfPending.

// A flat bonus for both sides once a referred friend has verified a phone
// number and made a verified check-in, paid by the server
// (api/_lib/referralBonus.js) onto bonusPoints and the boards.
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

/**
 * Call once at app boot, after capturePendingReferralFromUrl. An invite link
 * (?ref=name) that opens on the home route sends the visitor to Profile,
 * where a signed-out visitor sees the sign-up form (?signup=1). A link that
 * already names a screen in the # part is left alone.
 */
export function routeReferralLinkToSignup() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    const hash = window.location.hash;
    if (!ref || (hash && hash !== '#' && hash !== '#/')) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/profile?signup=1`);
  } catch {
    /* URL unavailable -- they just land on the home screen */
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
 * Asks the server to pay whatever referral bonuses can pay now
 * (api/referral-claim, anti-farming item 3): the new account needs a
 * verified phone number and a verified check-in, and each referrer is
 * capped. Resolves to the server's per-referral results ([{ side, paid,
 * reason }]) or [] when it can't be reached. Best effort, never throws.
 */
const claimsInFlight = new Map();
export function claimMyReferralBonuses(uid) {
  if (!uid) return Promise.resolve([]);
  if (claimsInFlight.has(uid)) return claimsInFlight.get(uid);
  const run = (async () => {
    try {
      const { authHeaders } = await import('./apiAuth');
      const { API_BASE } = await import('./apiBase');
      const { dayKey } = await import('./streaks');
      const r = await fetch(`${API_BASE}/api/referral-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ dayId: dayKey(new Date()) }),
      });
      const data = await r.json().catch(() => null);
      return Array.isArray(data?.results) ? data.results : [];
    } catch {
      return [];
    }
  })().finally(() => claimsInFlight.delete(uid));
  claimsInFlight.set(uid, run);
  return run;
}

// What the referred side still needs, from the server's answer, in words.
export function referralNeed(results = []) {
  const mine = results.find((r) => r.side === 'referred' && !r.paid);
  if (!mine) return null;
  if (mine.reason === 'needs-phone') return 'phone';
  if (mine.reason === 'needs-verified-checkin') return 'checkin';
  if (mine.reason === 'phone-used') return 'phone-used';
  return null;
}

/** The link a friend opens to sign up under this username. */
export function referralLink(username) {
  return username ? `https://landmarkhunters.com/?ref=${encodeURIComponent(username)}` : 'https://landmarkhunters.com';
}

/**
 * How many friends signed up through this user's link, and how many of those
 * have paid out (the friend verified their email). Zeros when offline.
 */
export async function countMyReferrals(uid) {
  if (!db || !uid) return { joined: 0, paid: 0 };
  try {
    const snap = await getDocs(query(collection(db, 'referrals'), where('referrerUid', '==', uid)));
    let paid = 0;
    snap.docs.forEach((d) => {
      if (d.data().referrerClaimed) paid += 1;
    });
    return { joined: snap.docs.length, paid };
  } catch {
    return { joined: 0, paid: 0 };
  }
}

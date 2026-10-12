import { doc, writeBatch, increment } from 'firebase/firestore';
import { db } from './firebase';
import { addLeaderboardPointsToBatch } from './leaderboard';

// A one-time reward for finishing the post-signup onboarding flow
// (preferences + the first-check-in prompt). Stored on the user's own
// bonusPoints field (folded into their all-time total by getUserStats) and
// also added to the current week/month/year leaderboard entries, same as
// referral bonuses, so it counts toward rank the same way check-in points do.
export const ONBOARDING_BONUS_POINTS = 10;

// Guarded by the caller checking myProfile.onboardingCompleted first (see
// Profile's FirstCheckInStep) -- this only ever runs once per account.
//
// A merged set rather than updateDoc: updateDoc rejects outright if
// users/{uid} doesn't exist yet, which silently ate this write (the caller's
// .catch swallowed it) whenever it raced upsertUserProfile's own fire-and-
// forget doc creation on the same page load -- the flag then read back as
// unset on the next load, resetting Profile to "Finish Onboarding" even
// though the in-session UI had already moved past it.
//
// One batch: firestore.rules only lets a leaderboard entry rise by a
// bonusPoints rise made in the same write.
export async function completeOnboarding(uid, userName) {
  if (!db || !uid) return;
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'users', uid),
    {
      onboardingCompleted: true,
      bonusPoints: increment(ONBOARDING_BONUS_POINTS),
    },
    { merge: true }
  );
  addLeaderboardPointsToBatch(batch, uid, userName, ONBOARDING_BONUS_POINTS);
  await batch.commit();
}

// Belt-and-suspenders against onboardingCompleted not sticking past a
// reload for reasons the Firestore write itself doesn't explain (same
// unresolved class of bug as the badge-repeat one in BadgesContext) --
// once this device has ever seen completeOnboarding succeed for this
// account, "Finish Onboarding" must never show again here, independent of
// whatever myProfile reads back as. Deliberately per-device (localStorage,
// not Firestore), same tradeoff as the badge guard.
const COMPLETED_PREFIX = 'landmarkhunters.onboarded.';
export function hasCompletedOnboardingLocally(uid) {
  try {
    return localStorage.getItem(`${COMPLETED_PREFIX}${uid}`) === '1';
  } catch {
    return false;
  }
}
export function markOnboardingCompletedLocally(uid) {
  try {
    localStorage.setItem(`${COMPLETED_PREFIX}${uid}`, '1');
  } catch {
    /* storage full/disabled -- non-fatal, this guard just gets skipped */
  }
}

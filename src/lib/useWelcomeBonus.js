import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { getUserProfile } from './friends';
import { friendlyError } from './friendlyError';
import { completeOnboarding, hasCompletedOnboardingLocally, markOnboardingCompletedLocally } from './onboarding';

// The one-time Welcome bonus (+10) and the onboardingCompleted flag it hangs
// on. Runs once `enabled` turns true and the account has never received it;
// accounts that already have it (every account from before the versioned
// onboarding) do nothing. Moved here unchanged from Profile's old
// FirstCheckInStep, including the read-back and the per-device guard that
// stops "Finish Onboarding" from ever reappearing.
export function useWelcomeBonus(enabled) {
  const { user } = useAuth();
  const { myProfile, myUsername, reload: reloadFriends } = useFriends();
  const [saveError, setSaveError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !user || myProfile?.onboardingCompleted || hasCompletedOnboardingLocally(user.uid)) return;
    setSaveError(null);
    completeOnboarding(user.uid, myUsername || user.displayName || 'Explorer')
      .then(async () => {
        markOnboardingCompletedLocally(user.uid);
        await reloadFriends();
        const fresh = await getUserProfile(user.uid);
        if (!fresh?.onboardingCompleted) {
          console.error('[Onboarding] wrote onboardingCompleted but read-back shows it unset:', fresh);
          setSaveError("Saved, but it didn't stick server-side -- please screenshot this and send it over.");
        }
      })
      .catch((err) => {
        console.error('[Onboarding] completeOnboarding failed:', err);
        setSaveError(friendlyError(err, "Couldn't finish setting up your account. Try again."));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user, myProfile?.onboardingCompleted, attempt]);

  return { saveError, retry: () => setAttempt((n) => n + 1) };
}

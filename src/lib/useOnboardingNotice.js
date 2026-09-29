import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { needsOnboardingNotice } from './onboardingVersion';
import { sendOnboardingNotice } from './onboardingSave';

// Mounted once near the app root (see App.jsx). When an account's onboarding
// is missing or older than ONBOARDING_VERSION, drops one in-app notification
// ("Onboarding has been updated...") into Notifications; the Header's red
// badge counts it like any other unread one. Runs after the server copy of
// the profile has loaded, at most once per session, and the profile's
// onboardingNoticeVersion keeps it from repeating in later sessions.
export function useOnboardingNotice() {
  const { user } = useAuth();
  const { myProfile, profileFresh } = useFriends();
  const triedFor = useRef(null);

  useEffect(() => {
    if (!user || !profileFresh || !myProfile) return;
    if (!needsOnboardingNotice(myProfile) || triedFor.current === user.uid) return;
    triedFor.current = user.uid;
    sendOnboardingNotice(user.uid).catch(() => {});
  }, [user, profileFresh, myProfile]);
}

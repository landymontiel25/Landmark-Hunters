import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { noticeAction } from './onboardingVersion';
import { sendOnboardingNotice, resurfaceOnboardingNotice } from './onboardingSave';

// Mounted once near the app root (see App.jsx). When an account's onboarding
// is missing or older than ONBOARDING_VERSION, drops one in-app notification
// ("Onboarding has been updated...") into Notifications; the Header's red
// badge counts it like any other unread one. It keeps coming back: every
// session it's unread again until the flow is finished. Runs after the
// server copy of the profile has loaded, once per session.
export function useOnboardingNotice() {
  const { user } = useAuth();
  const { myProfile, profileFresh } = useFriends();
  const triedFor = useRef(null);

  useEffect(() => {
    if (!user || !profileFresh || !myProfile || triedFor.current === user.uid) return;
    const action = noticeAction(myProfile);
    if (!action) return;
    triedFor.current = user.uid;
    (action === 'send' ? sendOnboardingNotice : resurfaceOnboardingNotice)(user.uid).catch((err) =>
      console.error(`[Onboarding] notice ${action} failed:`, err)
    );
  }, [user, profileFresh, myProfile]);
}

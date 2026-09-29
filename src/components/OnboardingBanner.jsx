import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { readPersisted, writePersisted } from '../lib/usePersistentState';
import { ONBOARDING_VERSION, onboardingStatus } from '../lib/onboardingVersion';

// Dismissed for this version on this device. Bumping ONBOARDING_VERSION
// brings the banner back for everyone still unfinished.
const dismissKey = (uid) => `onboardingBanner.${uid}`;
const isDismissed = (uid) => (Number(readPersisted(dismissKey(uid), 0)) || 0) >= ONBOARDING_VERSION;

// Shown on the Map and Mapr tabs until onboarding is finished. A nudge, never a
// lock: the rest of the app stays open. variant "fixed" floats under the
// header on the full-screen map and pushes the map's own buttons down by its
// height (--banner-h, read by --header-h); "inline" sits at the top of a
// normal page.
export default function OnboardingBanner({ variant = 'inline' }) {
  const { user } = useAuth();
  const { myProfile, profileFresh } = useFriends();
  const navigate = useNavigate();
  const [dismissedNow, setDismissedNow] = useState(false);

  const show =
    !!user && profileFresh && onboardingStatus(myProfile) !== 'complete' && !dismissedNow && !isDismissed(user.uid);

  useEffect(() => {
    if (variant !== 'fixed' || !show) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--banner-h', '56px');
    return () => root.style.removeProperty('--banner-h');
  }, [variant, show]);

  if (!show) return null;

  const dismiss = () => {
    writePersisted(dismissKey(user.uid), ONBOARDING_VERSION);
    setDismissedNow(true);
  };

  return (
    <div className={`onboarding-banner ${variant === 'fixed' ? 'onboarding-banner-fixed' : ''}`} role="region" aria-label="Finish onboarding">
      <button type="button" className="onboarding-banner-main" onClick={() => navigate('/onboarding')}>
        <span aria-hidden="true">{'\u{2728}'}</span> Finish onboarding to get better picks from Mapr {'\u{2192}'}
      </button>
      <button type="button" className="onboarding-banner-close" aria-label="Dismiss" onClick={dismiss}>
        {'\u{2715}'}
      </button>
    </div>
  );
}

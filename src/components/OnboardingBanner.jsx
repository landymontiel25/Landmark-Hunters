import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { onboardingStatus } from '../lib/onboardingVersion';
import { useSessionState } from '../lib/usePersistentState';

// Shown on the Map and Mapr tabs until the swipe cards are finished. The X
// hides it for this session only (held in memory, so nothing is stored and
// it is back the next time the app opens); finishing the cards is what clears
// it for good, and the bell alert (useOnboardingNotice) stays until then too.
// It's a nudge, never a lock, so the rest of the app stays open. Variant "fixed"
// floats right under the header pill on the full-screen map and pushes the
// map's own buttons down by its height (--banner-h, read by --header-h);
// "inline" sits at the top of a normal page.
//
// The dismissal is per account: keyed by uid, and the inner component is
// remounted on an account switch so the next account doesn't inherit it.
export default function OnboardingBanner({ variant = 'inline' }) {
  const { user } = useAuth();
  if (!user) return null;
  return <Banner key={user.uid} uid={user.uid} variant={variant} />;
}

function Banner({ uid, variant }) {
  const { myProfile, profileFresh } = useFriends();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useSessionState(`onboarding.bannerDismissed.${uid}`, false);

  const show = profileFresh && !dismissed && onboardingStatus(myProfile) !== 'complete';

  useEffect(() => {
    if (variant !== 'fixed' || !show) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--banner-h', '56px');
    return () => root.style.removeProperty('--banner-h');
  }, [variant, show]);

  if (!show) return null;

  return (
    <div className={`onboarding-banner ${variant === 'fixed' ? 'onboarding-banner-fixed' : ''}`} role="region" aria-label="Finish the swipe cards">
      <button type="button" className="onboarding-banner-main" onClick={() => navigate('/onboarding')}>
        <span aria-hidden="true">{'\u{2728}'}</span> Finish the swipe cards to get better picks from Mapr {'\u{2192}'}
      </button>
      <button type="button" className="onboarding-banner-dismiss" aria-label="Dismiss for now" onClick={() => setDismissed(true)}>
        <span aria-hidden="true">{'\u{00D7}'}</span>
      </button>
    </div>
  );
}

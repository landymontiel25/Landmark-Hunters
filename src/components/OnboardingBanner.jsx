import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { onboardingStatus } from '../lib/onboardingVersion';

// Shown on the Map and Mapr tabs until onboarding is finished, and it can't
// be dismissed: the only way to clear it is to do the onboarding. It's a
// nudge, never a lock, so the rest of the app stays open. Variant "fixed"
// floats right under the header pill on the full-screen map and pushes the
// map's own buttons down by its height (--banner-h, read by --header-h);
// "inline" sits at the top of a normal page.
export default function OnboardingBanner({ variant = 'inline' }) {
  const { user } = useAuth();
  const { myProfile, profileFresh } = useFriends();
  const navigate = useNavigate();

  const show = !!user && profileFresh && onboardingStatus(myProfile) !== 'complete';

  useEffect(() => {
    if (variant !== 'fixed' || !show) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--banner-h', '56px');
    return () => root.style.removeProperty('--banner-h');
  }, [variant, show]);

  if (!show) return null;

  return (
    <div className={`onboarding-banner ${variant === 'fixed' ? 'onboarding-banner-fixed' : ''}`} role="region" aria-label="Finish onboarding">
      <button type="button" className="onboarding-banner-main" onClick={() => navigate('/onboarding')}>
        <span aria-hidden="true">{'\u{2728}'}</span> Finish onboarding to get better picks from Mapr {'\u{2192}'}
      </button>
    </div>
  );
}

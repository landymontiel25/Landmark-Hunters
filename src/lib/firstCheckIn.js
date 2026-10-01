import { useEffect, useState } from 'react';
import { getUserCheckedInLandmarkIds } from './leaderboard';
import { ONBOARDING_FIRST_CHECKIN } from './maprConstants';
import { measureCheckin, isNearEnough } from './checkinRules';

// The optional first check-in after the 10 onboarding ratings. Switch it off
// with ONBOARDING_FIRST_CHECKIN in maprConstants.js; delete this file,
// src/components/OnboardingCheckinStep.jsx and the 'checkin' lines in
// src/screens/Onboarding.jsx to remove it for good. Nothing else reads it.

// "Existing" means the account already has a real check-in in Firestore (a
// rating-only claim is not one: getUserCheckedInLandmarkIds filters those
// out), not how old it is. `null` = still loading or the read failed, which
// is never treated as zero.
export function needsFirstCheckIn(checkinCount, enabled = ONBOARDING_FIRST_CHECKIN) {
  return !!enabled && checkinCount === 0;
}

// Counts the account's real check-ins. `count` stays null while loading and
// if the read fails. `loading` covers only the wait.
export function useCheckinCount(uid) {
  const active = !!uid && ONBOARDING_FIRST_CHECKIN;
  const [state, setState] = useState({ count: null, loading: active });
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    getUserCheckedInLandmarkIds(uid)
      .then((ids) => !cancelled && setState({ count: ids.length, loading: false }))
      .catch(() => !cancelled && setState({ count: null, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [uid, active]);
  return state;
}

// Places the user is actually at: inside each place's own check-in radius,
// with a GPS fix good enough to say so (the same test the GPS rule uses).
// Nearest first, at most `limit`. Never offers a place farther than its
// radius, however empty the list is.
export function placesNearby(coords, landmarks, limit = 3) {
  if (!coords) return [];
  return landmarks
    .filter((l) => isNearEnough(coords, l))
    .map((l) => ({ landmark: l, meters: measureCheckin(coords, l).distanceMeters }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

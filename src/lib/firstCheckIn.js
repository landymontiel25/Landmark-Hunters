import { useEffect, useState } from 'react';
import { getUserCheckedInLandmarkIds } from './leaderboard';

// The required first check-in at the end of onboarding. To remove it, delete
// this file, its test, and src/components/FirstCheckInStep.jsx, then drop the
// lines in src/screens/Onboarding.jsx that mention firstCheckIn,
// FirstCheckInStep or CHECKIN_STEP (and the matching cases in
// Onboarding.test.jsx). Nothing else reads it: the onboarding version, the
// notification and the banner never look at check-ins.
export const REQUIRE_FIRST_CHECKIN = true;

// "Existing" means the account already has a real check-in in Firestore, not
// how old it is.
export function needsFirstCheckIn(checkinCount, required = REQUIRE_FIRST_CHECKIN) {
  return !!required && checkinCount === 0;
}

// Counts the account's real check-ins from Firestore. `count` stays null
// while loading and if the read fails, so callers never treat "unknown" as
// zero (needsFirstCheckIn(null) is false). `loading` covers only the wait.
export function useCheckinCount(uid) {
  const active = !!uid && REQUIRE_FIRST_CHECKIN;
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

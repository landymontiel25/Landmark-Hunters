import { useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useTrip } from './TripContext';

// The trip (itineraries, "My Preferences" chips, active city...) lives in this
// device's localStorage, not under the account. Without this, signing out and
// into a different account on the same phone handed the next person the
// previous one's itineraries and saved preferences.
export const TRIP_OWNER_KEY = 'landmarkhunters.trip.owner';

// What to do given who last owned the stored trip and who is signed in now:
// 'reset' wipes it, 'claim' records the current account as the owner (adopting
// a trip built while signed out or before this guard existed), 'keep' is a no-op.
export function tripOwnerAction(owner, uid) {
  if (uid) {
    if (!owner) return 'claim';
    return owner === uid ? 'keep' : 'reset-and-claim';
  }
  return owner ? 'reset' : 'keep';
}

function readOwner() {
  try {
    return localStorage.getItem(TRIP_OWNER_KEY) || null;
  } catch {
    return null;
  }
}
function writeOwner(uid) {
  try {
    if (uid) localStorage.setItem(TRIP_OWNER_KEY, uid);
    else localStorage.removeItem(TRIP_OWNER_KEY);
  } catch {
    /* storage unavailable -- nothing to guard */
  }
}

export function useTripAccountGuard() {
  const { user, loading } = useAuth();
  const { resetTrip } = useTrip();
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (loading) return;
    const action = tripOwnerAction(readOwner(), uid);
    if (action === 'reset' || action === 'reset-and-claim') resetTrip();
    if (action === 'claim' || action === 'reset-and-claim') writeOwner(uid);
    if (action === 'reset') writeOwner(null);
    // resetTrip is a fresh closure every render; only an account change matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, loading]);
}

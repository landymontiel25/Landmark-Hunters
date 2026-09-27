import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { startBackgroundLocation, stopBackgroundLocation } from './backgroundLocation';
import { saveLastKnownLocation } from './friends';
import { cacheLastFix } from './GeoContext';

// Firestore write per fix would be excessive at a 150m distanceFilter over a
// whole day of walking around a city -- this caps it to once every 5 min,
// which is still often enough for Mapr to notice "you're in a new city now"
// well before you'd open the app there anyway.
const MIN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

// Mounted once near the app root (see App.jsx). Starts/stops the real
// background watcher (backgroundLocation.js) to match the traveler's own
// saved choice (Settings, or the onboarding step that first asks for it) --
// never runs without that opt-in, and stops the moment they turn it off.
export function useBackgroundLocationSync() {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const lastWriteRef = useRef(0);
  const enabled = !!myProfile?.backgroundLocationEnabled;

  useEffect(() => {
    if (!user || !enabled) {
      stopBackgroundLocation();
      return undefined;
    }
    startBackgroundLocation((coords) => {
      cacheLastFix(coords);
      const now = Date.now();
      if (now - lastWriteRef.current < MIN_WRITE_INTERVAL_MS) return;
      lastWriteRef.current = now;
      saveLastKnownLocation(user.uid, coords).catch(() => {});
    });
    return () => {
      stopBackgroundLocation();
    };
  }, [user, enabled]);
}

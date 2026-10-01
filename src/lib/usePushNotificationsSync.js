import { useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { requestPushPermission, getPushToken, listenForTokenRefresh, removePushListeners } from './pushNotifications';
import { savePushToken } from './friends';

// Mounted once near the app root (see App.jsx). Registers this device for
// push the moment the traveler's own saved preference (Settings) turns on,
// and tears the listeners down the moment it turns off. Never runs without
// that opt-in -- requesting push permission is its own OS prompt, same as
// background location.
export function usePushNotificationsSync() {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const enabled = !!myProfile?.pushNotificationsEnabled;
  const uid = user?.uid || null;

  // Keyed on the uid, not the user object: Firebase hands back a new user
  // object whenever e.g. email verification flips, and re-running (and
  // cleaning up) the effect then would silence the token-refresh listener
  // for the rest of the session.
  useEffect(() => {
    if (!uid || !enabled) {
      removePushListeners();
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const granted = await requestPushPermission().catch(() => false);
      if (!granted || cancelled) return;
      const token = await getPushToken().catch(() => null);
      if (token && !cancelled) savePushToken(uid, token, 'ios').catch(() => {});
      if (cancelled) return;
      listenForTokenRefresh((t) => {
        if (!cancelled) savePushToken(uid, t, 'ios').catch(() => {});
      });
    })();
    return () => {
      cancelled = true;
      removePushListeners();
    };
  }, [uid, enabled]);
}

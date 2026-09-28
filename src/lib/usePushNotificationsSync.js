import { useEffect, useRef } from 'react';
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
  const startedForRef = useRef(null);

  useEffect(() => {
    if (!user || !enabled) {
      removePushListeners();
      startedForRef.current = null;
      return undefined;
    }
    // Registering again on every re-render (e.g. an unrelated profile field
    // changing) would pile up duplicate listeners -- only (re)register when
    // the account actually changes.
    if (startedForRef.current === user.uid) return undefined;
    startedForRef.current = user.uid;
    let cancelled = false;
    (async () => {
      const granted = await requestPushPermission().catch(() => false);
      if (!granted || cancelled) return;
      const token = await getPushToken().catch(() => null);
      if (token && !cancelled) savePushToken(user.uid, token, 'ios').catch(() => {});
      listenForTokenRefresh((t) => {
        if (!cancelled) savePushToken(user.uid, t, 'ios').catch(() => {});
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, enabled]);
}

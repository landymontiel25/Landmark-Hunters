// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('usePushNotificationsSync', () => {
  it('keeps saving refreshed tokens after the user object is replaced (same account)', async () => {
    let user = { uid: 'u1', emailVerified: false };
    let refresh;
    const savePushToken = vi.fn(async () => {});
    vi.doMock('./AuthContext', () => ({ useAuth: () => ({ user }) }));
    vi.doMock('./FriendsContext', () => ({ useFriends: () => ({ myProfile: { pushNotificationsEnabled: true } }) }));
    vi.doMock('./friends', () => ({ savePushToken }));
    vi.doMock('./pushNotifications', () => ({
      requestPushPermission: async () => true,
      getPushToken: async () => 'tok1',
      listenForTokenRefresh: async (cb) => {
        refresh = cb;
      },
      removePushListeners: async () => {},
    }));
    const { usePushNotificationsSync } = await import('./usePushNotificationsSync.js');
    function Probe() {
      usePushNotificationsSync();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Probe />));
    expect(savePushToken).toHaveBeenCalledWith('u1', 'tok1', 'ios');

    // Email gets verified -> AuthContext swaps in a new user object, same uid.
    user = { uid: 'u1', emailVerified: true };
    await act(async () => root.render(<Probe />));

    refresh('tok2');
    expect(savePushToken).toHaveBeenCalledWith('u1', 'tok2', 'ios');
  });
});

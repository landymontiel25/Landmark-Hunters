// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('BadgesProvider switching accounts', () => {
  it("drops a load started for the previous account instead of showing its stats to the next one", async () => {
    const state = { user: { uid: 'A' } };
    let resolveA;
    const getUserStats = vi.fn((uid) =>
      uid === 'A' ? new Promise((r) => (resolveA = r)) : new Promise(() => {})
    );
    const updateDoc = vi.fn(async () => {});
    vi.doMock('firebase/firestore', () => ({ doc: (...p) => p.join('/'), updateDoc, serverTimestamp: () => 'ts' }));
    vi.doMock('./firebase', () => ({ db: 'db' }));
    vi.doMock('./AuthContext', () => ({ useAuth: () => ({ user: state.user, firebaseEnabled: true }) }));
    vi.doMock('./FriendsContext', () => ({
      useFriends: () => ({ myProfile: { badgeEarnedAt: {} }, profileFresh: true, friendUids: new Set(), reload: () => {} }),
    }));
    vi.doMock('./useCheckIn', () => ({ useCheckIn: () => ({ claimedMap: {} }) }));
    vi.doMock('./TripContext', () => ({ useTrip: () => ({ trip: { byRegion: {} } }) }));
    vi.doMock('./leaderboard', () => ({
      getUserStats,
      getUserCheckins: async () => [],
      isInTopLeaderboard: async () => false,
      hasFriendTagTeam: async () => false,
      isRealCheckin: () => true,
    }));
    vi.doMock('./pickFeedback', () => ({ getPickFeedback: async () => ({}) }));
    vi.doMock('./reviews', () => ({ getUserReviews: async () => [] }));
    vi.doMock('./customLandmarks', () => ({ getCustomLandmarks: async () => [] }));
    vi.doMock('./placePacks', () => ({ ensurePlacePacks: async () => {}, isPlacePackId: () => false }));

    const { BadgesProvider, useBadges } = await import('./BadgesContext.jsx');
    const probe = {};
    function Probe() {
      probe.ctx = useBadges();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    const render = () =>
      act(async () =>
        root.render(
          <BadgesProvider>
            <Probe />
          </BadgesProvider>
        )
      );
    await render();
    let pendingA;
    act(() => {
      pendingA = probe.ctx.reload();
    });

    state.user = { uid: 'B' };
    await render();
    await act(async () => {
      resolveA({ totalPoints: 50, checkins: 5, cities: 2, cityIds: [], cityLastVisit: {}, cityPoints: {} });
      await pendingA;
    });

    expect(probe.ctx.stats).toBeNull();
    expect(probe.ctx.badges).toEqual([]);
    expect(updateDoc).not.toHaveBeenCalled();
    root.unmount();
  });
});

describe('BadgesProvider trip edits', () => {
  it('updates the trip landmark count without rerunning the Firestore badge pass', async () => {
    const state = { byRegion: { r1: ['a'] } };
    const getCustomLandmarks = vi.fn(async () => []);
    const getUserStats = vi.fn(async () => ({ totalPoints: 0, checkins: 1, cities: 1, cityIds: [], cityLastVisit: {}, cityPoints: {} }));
    const friendUids = new Set();
    vi.doMock('firebase/firestore', () => ({ doc: (...p) => p.join('/'), updateDoc: async () => {}, serverTimestamp: () => 'ts' }));
    vi.doMock('./firebase', () => ({ db: 'db' }));
    const user = { uid: 'A' };
    vi.doMock('./AuthContext', () => ({ useAuth: () => ({ user, firebaseEnabled: true }) }));
    vi.doMock('./FriendsContext', () => ({
      useFriends: () => ({ myProfile: { badgeEarnedAt: {} }, profileFresh: false, friendUids, reload: () => {} }),
    }));
    const claimedMap = {};
    vi.doMock('./useCheckIn', () => ({ useCheckIn: () => ({ claimedMap }) }));
    vi.doMock('./TripContext', () => ({ useTrip: () => ({ trip: { byRegion: state.byRegion } }) }));
    vi.doMock('../data/regions', () => ({
      getRegion: () => ({ landmarks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
      getLandmark: () => null,
    }));
    vi.doMock('./leaderboard', () => ({
      getUserStats,
      getUserCheckins: async () => [],
      isInTopLeaderboard: async () => false,
      hasFriendTagTeam: async () => false,
      isRealCheckin: () => true,
    }));
    vi.doMock('./pickFeedback', () => ({ getPickFeedback: async () => ({}) }));
    vi.doMock('./reviews', () => ({ getUserReviews: async () => [] }));
    vi.doMock('./customLandmarks', () => ({ getCustomLandmarks }));
    vi.doMock('./placePacks', () => ({ ensurePlacePacks: async () => {}, isPlacePackId: () => false }));

    const { BadgesProvider, useBadges } = await import('./BadgesContext.jsx');
    const probe = {};
    function Probe() {
      probe.ctx = useBadges();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    const render = () =>
      act(async () =>
        root.render(
          <BadgesProvider>
            <Probe />
          </BadgesProvider>
        )
      );
    await render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(getCustomLandmarks).toHaveBeenCalledTimes(1);
    expect(probe.ctx.badgeCounts.tripLandmarks).toBe(1);

    state.byRegion = { r1: ['a', 'b', 'c'] };
    await render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(probe.ctx.badgeCounts.tripLandmarks).toBe(3);
    expect(getCustomLandmarks).toHaveBeenCalledTimes(1);
    expect(getUserStats).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let authState = { user: { uid: 'a' }, firebaseEnabled: true };
const loads = {};
let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  vi.clearAllMocks();
});

async function setup() {
  vi.doMock('./AuthContext', () => ({ useAuth: () => authState }));
  vi.doMock('./FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me', myProfile: {} }) }));
  vi.doMock('./leaderboard', () => ({
    claimCheckIn: vi.fn(async () => ({ claimed: true, alreadyClaimed: false, payout: 100, visitNumber: 1 })),
    getUserCheckedInLandmarkIds: (uid) => loads[uid](),
    subscribeLeaderboard: () => () => {},
    shouldPromptLoveReason: () => false,
    POINTS_PER_CHECKIN: 100,
  }));
  const { CheckInProvider } = await import('./CheckInContext.jsx');
  const { useCheckIn } = await import('./useCheckIn');
  const ref = {};
  function Probe() {
    ref.api = useCheckIn();
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = () =>
    act(async () => {
      root.render(
        <CheckInProvider>
          <Probe />
        </CheckInProvider>
      );
    });
  await render();
  return { ref, render };
}

describe('CheckInProvider claimedMap across accounts', () => {
  it("drops the last account's check-ins even when the next account's read fails", async () => {
    authState = { user: { uid: 'a' }, firebaseEnabled: true };
    loads.a = async () => ['lm-a'];
    loads.b = async () => {
      throw new Error('offline');
    };
    const { ref, render } = await setup();
    expect(ref.api.claimedMap).toEqual({ 'lm-a': true });
    authState = { user: { uid: 'b' }, firebaseEnabled: true };
    await render();
    expect(ref.api.claimedMap).toEqual({});
    expect(ref.api.claimedLoaded).toBe(true);
  });

  it('keeps a check-in posted while the first read is still in flight', async () => {
    authState = { user: { uid: 'c' }, firebaseEnabled: true };
    let finish;
    loads.c = () => new Promise((r) => (finish = r));
    const { ref } = await setup();
    await act(async () => ref.api.checkIn({ id: 'new', name: 'N', regionId: 'miami' }, { ratingOnly: false }));
    await act(async () => {
      await ref.api.commitCheckIn(null);
    });
    expect(ref.api.claimedMap.new).toBe(true);
    await act(async () => finish(['old']));
    expect(ref.api.claimedMap).toEqual({ old: true, new: true });
  });
});

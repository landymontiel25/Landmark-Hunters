// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const place = { id: 'lm', name: 'LM', lat: 25.0, lng: -80.0, regionId: 'miami', points: 100 };
const near = { lat: 25.0 + 10 / 111195, lng: -80.0, accuracy: 9 };
const far = { lat: 25.0 + 500 / 111195, lng: -80.0, accuracy: 9 };

const authState = { user: { uid: 'u' }, firebaseEnabled: true };
const friendsState = { myUsername: 'me', myProfile: {} };
let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('./maprConstants');
});

// Renders the real CheckInProvider, taps Check In then Post with `fix`.
async function post({ rule, fix, ratingOnly = false }) {
  const claim = vi.fn(async () => ({ claimed: true, alreadyClaimed: false, payout: 100, visitNumber: 1 }));
  vi.doMock('./maprConstants', async () => ({ ...(await vi.importActual('./maprConstants')), REQUIRE_GPS_CHECKIN: rule }));
  vi.doMock('./AuthContext', () => ({ useAuth: () => authState }));
  vi.doMock('./FriendsContext', () => ({ useFriends: () => friendsState }));
  vi.doMock('./leaderboard', () => ({
    claimCheckIn: claim,
    getUserCheckedInLandmarkIds: async () => [],
    subscribeLeaderboard: () => () => {},
    shouldPromptLoveReason: () => false,
    POINTS_PER_CHECKIN: 100,
  }));
  const { CheckInProvider } = await import('./CheckInContext.jsx');
  const { useCheckIn } = await import('./useCheckIn');
  let api;
  function Probe() {
    api = useCheckIn();
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <CheckInProvider>
        <Probe />
      </CheckInProvider>
    );
  });
  await act(async () => api.checkIn(place, { ratingOnly }));
  let error = null;
  await act(async () => {
    try {
      await api.commitCheckIn(fix);
    } catch (e) {
      error = e;
    }
  });
  return { claim, error };
}

describe('commitCheckIn location evidence', () => {
  it('rule OFF: saves distance + accuracy, tagged unverified, even from far away or with no fix', async () => {
    const a = await post({ rule: false, fix: far });
    expect(a.error).toBeNull();
    expect(a.claim.mock.calls[0][0].location).toMatchObject({ distanceMeters: 500, gpsAccuracyMeters: 9, verification: 'unverified' });
    container.remove();
    vi.resetModules();
    const b = await post({ rule: false, fix: null });
    expect(b.error).toBeNull();
    expect(b.claim.mock.calls[0][0].location).toEqual({ verification: 'unverified' });
  });

  it('rule ON: a fix within 30 m is saved as verified', async () => {
    const { claim, error } = await post({ rule: true, fix: near });
    expect(error).toBeNull();
    expect(claim.mock.calls[0][0].location.verification).toBe('verified');
  });

  it('rule ON: a fix farther than 30 m, or no fix, is refused and nothing is claimed', async () => {
    const a = await post({ rule: true, fix: far });
    expect(a.error?.code).toBe('checkin/too-far');
    expect(a.claim).not.toHaveBeenCalled();
    container.remove();
    vi.resetModules();
    const b = await post({ rule: true, fix: null });
    expect(b.error?.code).toBe('checkin/no-location');
    expect(b.claim).not.toHaveBeenCalled();
  });

  it('a rating-only claim is never refused and is saved untagged', async () => {
    const { claim, error } = await post({ rule: true, fix: far, ratingOnly: true });
    expect(error).toBeNull();
    expect(claim.mock.calls[0][0].ratingOnly).toBe(true);
    expect(claim.mock.calls[0][0].location).toBeNull();
  });
});

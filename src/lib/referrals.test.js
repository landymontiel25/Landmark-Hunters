import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: Profile's claim effect re-runs when the `user` object changes
// (and twice on mount in StrictMode). Overlapping runs both saw
// referrerClaimed === false and each paid the referrer +50 (found driving
// the real app against the Firestore emulator: one referral, 100 bonus).
const updateDocMock = vi.fn(() => Promise.resolve());
const getDocMock = vi.fn(() => Promise.resolve({ exists: () => false }));
let releaseQuery;
const getDocsMock = vi.fn(
  () =>
    new Promise((resolve) => {
      releaseQuery = () => resolve({ docs: [{ ref: 'refDoc', data: () => ({ referrerClaimed: false }) }] });
    })
);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...a) => a.join('/')),
  getDoc: (...a) => getDocMock(...a),
  setDoc: vi.fn(),
  updateDoc: (...a) => updateDocMock(...a),
  increment: vi.fn((n) => ({ inc: n })),
  serverTimestamp: vi.fn(),
  getDocs: (...a) => getDocsMock(...a),
  collection: vi.fn((...a) => a.join('/')),
  query: vi.fn((...a) => a),
  where: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./friends', () => ({ findUserByUsername: vi.fn() }));
vi.mock('./leaderboard', () => ({ awardLeaderboardPoints: vi.fn(() => Promise.resolve()) }));

const { claimMyReferralBonuses } = await import('./referrals');
const { awardLeaderboardPoints } = await import('./leaderboard');

describe('claimMyReferralBonuses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pays a referral once even when called twice before the first run finishes', async () => {
    const a = claimMyReferralBonuses('u1', 'Ann');
    const b = claimMyReferralBonuses('u1', 'Ann');
    expect(a).toBe(b);
    await vi.waitFor(() => expect(getDocsMock).toHaveBeenCalled());
    releaseQuery();
    await a;
    expect(awardLeaderboardPoints).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh claim once the previous one has settled', async () => {
    const first = claimMyReferralBonuses('u2', 'Bo');
    await vi.waitFor(() => expect(getDocsMock).toHaveBeenCalled());
    releaseQuery();
    await first;
    getDocsMock.mockClear();
    const second = claimMyReferralBonuses('u2', 'Bo');
    await vi.waitFor(() => expect(getDocsMock).toHaveBeenCalled());
    releaseQuery();
    await second;
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });
});

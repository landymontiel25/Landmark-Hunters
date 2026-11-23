import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: Profile's claim effect re-runs when the `user` object changes
// (and twice on mount in StrictMode). Overlapping runs both saw
// referrerClaimed === false and each paid the referrer +50 (found driving
// the real app against the Firestore emulator: one referral, 100 bonus).
const batchCommit = vi.fn(() => Promise.resolve());
const batch = { set: vi.fn(), update: vi.fn(), commit: (...a) => batchCommit(...a) };
const getDocMock = vi.fn(() => Promise.resolve({ exists: () => false }));
let releaseQuery;
const getDocsMock = vi.fn(
  () =>
    new Promise((resolve) => {
      releaseQuery = () =>
        resolve({ docs: [{ id: 'new1', ref: 'refDoc', data: () => ({ referrerClaimed: false, referredClaimed: true }) }] });
    })
);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...a) => a.join('/')),
  getDoc: (...a) => getDocMock(...a),
  setDoc: vi.fn(),
  writeBatch: vi.fn(() => batch),
  increment: vi.fn((n) => ({ inc: n })),
  serverTimestamp: vi.fn(),
  getDocs: (...a) => getDocsMock(...a),
  collection: vi.fn((...a) => a.join('/')),
  query: vi.fn((...a) => a),
  where: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./friends', () => ({ findUserByUsername: vi.fn() }));
vi.mock('./leaderboard', () => ({ addLeaderboardPointsToBatch: vi.fn() }));

const { claimMyReferralBonuses, referralNeed } = await import('./referrals');
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({}) }));
vi.mock('./apiBase', () => ({ API_BASE: '' }));
vi.mock('./streaks', () => ({ dayKey: () => '2026-10-23' }));
const { addLeaderboardPointsToBatch } = await import('./leaderboard');

describe('claimMyReferralBonuses (paid by the server since 2026-11-23)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the server, once at a time, and never writes points or claimed flags from the phone', async () => {
    let release;
    const fetchMock = vi.fn(
      () =>
        new Promise((res) => {
          release = () => res({ json: async () => ({ ok: true, results: [{ side: 'referred', paid: false, reason: 'needs-phone' }] }) });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = claimMyReferralBonuses('u1');
    const b = claimMyReferralBonuses('u1');
    expect(a).toBe(b);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/referral-claim$/);
    release();
    expect(referralNeed(await a)).toBe('phone');
    expect(batchCommit).not.toHaveBeenCalled();
    expect(addLeaderboardPointsToBatch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('says what the referred side still needs', () => {
    expect(referralNeed([{ side: 'referred', paid: false, reason: 'needs-verified-checkin' }])).toBe('checkin');
    expect(referralNeed([{ side: 'referred', paid: true }])).toBe(null);
    expect(referralNeed([])).toBe(null);
  });
});


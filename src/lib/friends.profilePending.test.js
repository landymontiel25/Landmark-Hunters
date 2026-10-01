import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real-emulator finding: right after sign-in the app writes to users/{uid}
// (touchLastActive, upsertUserProfile) before the first read lands. With
// nothing cached, getDoc answers from those pending merges alone (5 fields,
// fromCache false). FriendsContext took that for the real profile, so
// onboarding looked unfinished and "Onboarding has been updated" was re-sent
// on every sign-in.
const state = { local: null, server: null, serverFails: false, pendingStalls: false };

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./reviews', () => ({ syncMyReviewVisibility: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ col, id }),
  getDoc: async () => state.local,
  waitForPendingWrites: async () => {
    if (state.pendingStalls) await new Promise(() => {});
  },
  getDocFromServer: async () => {
    if (state.serverFails) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    return state.server;
  },
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  writeBatch: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
  deleteField: vi.fn(),
  serverTimestamp: () => 'ts',
  limit: vi.fn(),
  orderBy: vi.fn(),
}));

const { getUserProfile } = await import('./friends');

const snap = (data, hasPendingWrites) => ({
  exists: () => !!data,
  data: () => data,
  metadata: { fromCache: false, hasPendingWrites },
});

describe('getUserProfile with pending local writes', () => {
  beforeEach(() => {
    state.serverFails = false;
    state.pendingStalls = false;
  });

  it('returns the doc as-is when nothing is pending', async () => {
    state.local = snap({ uid: 'u', onboardingVersion: 1 }, false);
    expect(await getUserProfile('u')).toEqual({ uid: 'u', onboardingVersion: 1 });
  });

  it('asks the server instead of trusting a doc made only of pending writes', async () => {
    state.local = snap({ uid: 'u', lastActiveAt: 'ts' }, true);
    state.server = snap({ uid: 'u', lastActiveAt: 'ts', onboardingVersion: 1 }, true);
    expect(await getUserProfile('u')).toMatchObject({ onboardingVersion: 1 });
  });

  it('rejects (so the caller retries or uses its cache) when the server cannot be reached', async () => {
    state.local = snap({ uid: 'u', lastActiveAt: 'ts' }, true);
    state.serverFails = true;
    await expect(getUserProfile('u')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects instead of hanging when the pending writes never land (offline)', async () => {
    vi.useFakeTimers();
    try {
      state.local = snap({ uid: 'u', lastActiveAt: 'ts' }, true);
      state.pendingStalls = true;
      const result = expect(getUserProfile('u')).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(9000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});

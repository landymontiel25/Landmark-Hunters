// @vitest-environment jsdom
// Regression test: setPickFeedback's Firestore write is best-effort and can
// silently fail (offline, rules not deployed yet -- see that function's own
// comment), leaving a real vote living ONLY in this device's localStorage.
// The old, purely live-computed solo streak read that local+Firestore merge
// (getPickFeedback), so it never noticed; api/ensure-solo-streak.js's
// server-side seed can only see Firestore, so a streak day resting on a
// local-only vote was invisible to it and could wrongly look broken.
// syncLocalFeedbackToFirestore re-attempts each local entry's write so the
// server has a real chance to see it before seeding/repairing a streak.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn(async () => {});
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((...args) => args.join('/')),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: (...args) => setDocMock(...args),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  where: vi.fn(),
  query: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));

const { syncLocalFeedbackToFirestore } = await import('./pickFeedback');

const KEY = (uid) => `lh-pick-feedback:${uid}`;
const FLAG = (uid) => `landmarkhunters.pickFeedbackSynced.${uid}`;

beforeEach(() => {
  localStorage.clear();
  setDocMock.mockClear();
});

describe('syncLocalFeedbackToFirestore', () => {
  it('re-writes every locally-held vote to Firestore', async () => {
    localStorage.setItem(
      KEY('me'),
      JSON.stringify({
        a: { landmarkId: 'a', verdict: 'yes', at: 1 },
        b: { landmarkId: 'b', verdict: 'unsure', at: 2 },
      })
    );
    await syncLocalFeedbackToFirestore('me');
    expect(setDocMock).toHaveBeenCalledTimes(2);
    const landmarkIds = setDocMock.mock.calls.map(([, data]) => data.landmarkId).sort();
    expect(landmarkIds).toEqual(['a', 'b']);
  });

  it('only ever syncs once per device -- a second call is a no-op', async () => {
    localStorage.setItem(KEY('me'), JSON.stringify({ a: { landmarkId: 'a', verdict: 'yes', at: 1 } }));
    await syncLocalFeedbackToFirestore('me');
    expect(setDocMock).toHaveBeenCalledTimes(1);
    setDocMock.mockClear();
    await syncLocalFeedbackToFirestore('me');
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('sets the per-device flag even with nothing local to sync, so it never re-checks needlessly', async () => {
    await syncLocalFeedbackToFirestore('me');
    expect(localStorage.getItem(FLAG('me'))).toBe('1');
  });

  it('is a no-op without a uid', async () => {
    await syncLocalFeedbackToFirestore(undefined);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

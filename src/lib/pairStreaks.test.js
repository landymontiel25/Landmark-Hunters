import { describe, it, expect, vi } from 'vitest';

// Regression test for a real production bug: submitCardRating/
// submitCardGuess used to write `{ [`ratings.${id}`]: verdict }` to
// setDoc(..., {merge:true}). setDoc does NOT interpret a dotted STRING KEY
// as a nested field path the way updateDoc does -- it creates one literal
// top-level field named "ratings.landmarkId". Verified against the real
// Firestore emulator: every vote silently "saved" (no error, ever) into a
// field no read in the app ever looked at, so nothing ever appeared to
// register, and a reload showed nothing saved -- while offline/optimistic
// UI made it look like it worked. Mocking firebase/firestore here and
// asserting the actual SHAPE of what gets written catches this class of
// mistake without needing a live emulator for every run; the emulator
// check that caught the real bug isn't repeatable in CI without Java +
// firebase-tools, which this repo doesn't otherwise depend on.
const setDocMock = vi.fn(async () => {});
const getDocMock = vi.fn(async () => ({ data: () => ({}) }));
let getDocsResult = { docs: [] };
let lastOnSnapshotCallback = null;
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((...args) => args.join('/')),
  getDoc: (...args) => getDocMock(...args),
  getDocs: vi.fn(async () => getDocsResult),
  setDoc: (...args) => setDocMock(...args),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn((q, onNext) => {
    lastOnSnapshotCallback = onNext;
    return () => {};
  }),
  query: vi.fn(),
  where: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));
vi.mock('./firebase', () => ({ db: {} }));

const { pairIdOf, submitCardRating, submitCardGuess, subscribeMyStreaks, myStreakCount } = await import('./pairStreaks');

// A solo streak doc has memberIds: [uid] too (see soloStreaks.js), so it
// matches the same array-contains query dual streaks are fetched with --
// snapDoc mirrors what a real snapshot doc looks like for either shape.
const snapDoc = (id, data) => ({ id, data: () => data });

describe('pairIdOf', () => {
  it('is order-independent, so either member computes the same doc id', () => {
    expect(pairIdOf('a', 'b')).toBe(pairIdOf('b', 'a'));
    expect(pairIdOf('uid1', 'uid2')).toBe('uid1_uid2');
  });
});

describe('submitCardRating / submitCardGuess writes', () => {
  it('writes ratings as a nested object, not a dotted top-level field name', async () => {
    setDocMock.mockClear();
    await submitCardRating('pair1', 'me', 'landmarkA', 'no');
    const [, data] = setDocMock.mock.calls[0];
    expect(data.ratings).toEqual({ landmarkA: 'no' });
    // toHaveProperty treats a dotted string as a path, not a literal key --
    // checking Object.keys directly is what actually catches the bug (a
    // flat top-level key literally named "ratings.landmarkA").
    expect(Object.keys(data)).not.toContain('ratings.landmarkA');
  });

  it('writes guesses as a nested object, not a dotted top-level field name', async () => {
    setDocMock.mockClear();
    getDocMock.mockResolvedValueOnce({ data: () => ({ ratings: {}, guesses: {} }) });
    await submitCardGuess('pair1', 'me', 'landmarkA', 'yes', ['landmarkA']);
    const [, data] = setDocMock.mock.calls[0];
    expect(data.guesses).toEqual({ landmarkA: 'yes' });
    expect(Object.keys(data)).not.toContain('guesses.landmarkA');
  });

  it("writes to the day whose deck was shown when one is passed (rated just after midnight)", async () => {
    setDocMock.mockClear();
    await submitCardRating('pair1', 'me', 'landmarkA', 'no', '2026-9-6');
    expect(setDocMock.mock.calls[0][0]).toContain('days/2026-9-6/entries/me');
    getDocMock.mockResolvedValueOnce({ data: () => ({}) });
    await submitCardGuess('pair1', 'me', 'landmarkA', 'yes', ['landmarkA'], '2026-9-6');
    expect(setDocMock.mock.calls[1][0]).toContain('days/2026-9-6/entries/me');
  });
});

// Regression test for a real production bug: subscribeMyStreaks/
// myStreakCount queried streaks/ with only where('memberIds',
// 'array-contains', uid), with nothing excluding a solo streak doc (which
// also has memberIds: [uid]) -- so a solo streak showed up in the "dual
// streaks" list as a phantom row with no real partner, and "leave streak"
// on it deleted the solo doc entirely (its own id is just the uid).
describe('subscribeMyStreaks / myStreakCount exclude solo streaks', () => {
  it('filters a solo streak doc out of the live dual-streaks list', () => {
    const onStreaks = vi.fn();
    subscribeMyStreaks('me', onStreaks, () => {});
    lastOnSnapshotCallback({
      docs: [
        snapDoc('me', { mode: 'solo', memberIds: ['me'], count: 6 }),
        snapDoc('friend_me', { mode: 'dual', memberIds: ['friend', 'me'], count: 2 }),
      ],
    });
    const result = onStreaks.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('friend_me');
  });

  it('still includes a dual streak doc predating the mode field (mode undefined, not "solo")', () => {
    const onStreaks = vi.fn();
    subscribeMyStreaks('me', onStreaks, () => {});
    lastOnSnapshotCallback({
      docs: [snapDoc('friend_me', { memberIds: ['friend', 'me'], count: 4 })],
    });
    const result = onStreaks.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('friend_me');
  });

  it('does not count a solo streak toward the MAX_ACTIVE_STREAKS cap', async () => {
    getDocsResult = {
      docs: [
        snapDoc('me', { mode: 'solo', memberIds: ['me'] }),
        snapDoc('friend_me', { mode: 'dual', memberIds: ['friend', 'me'] }),
      ],
    };
    await expect(myStreakCount('me')).resolves.toBe(1);
  });
});

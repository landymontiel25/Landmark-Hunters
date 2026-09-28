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
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((...args) => args.join('/')),
  getDoc: (...args) => getDocMock(...args),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: (...args) => setDocMock(...args),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(),
  where: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));
vi.mock('./firebase', () => ({ db: {} }));

const { pairIdOf, submitCardRating, submitCardGuess } = await import('./pairStreaks');

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
});

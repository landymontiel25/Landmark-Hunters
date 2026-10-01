// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PICK_MARK_LIMIT, PICK_MARK_WINDOW_MS } from './maprConstants';

const store = new Map();
const setDocMock = vi.fn(async (ref, data) => {
  store.set(ref.path, data);
});
vi.mock('firebase/firestore', () => {
  const snap = (path) => ({ exists: () => store.has(path), data: () => store.get(path) });
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    getDoc: async (ref) => snap(ref.path),
    runTransaction: async (_db, fn) => {
      const writes = [];
      await fn({
        get: async (ref) => snap(ref.path),
        set: (ref, data, opts) => writes.push([ref.path, data, opts]),
        delete: () => {},
      });
      for (const [p, d, o] of writes) store.set(p, o?.merge ? { ...(store.get(p) || {}), ...d } : d);
    },
    setDoc: (...a) => setDocMock(...a),
    serverTimestamp: () => 0,
    arrayUnion: (x) => x,
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(async () => ({ docs: [] })),
    updateDoc: vi.fn(),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
  };
});
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('./firebase', () => ({ db: {}, storage: null }));

const { rememberShownPicks, pickMarkFields } = await import('./pickMarks');
const { logShownPicks, resetShownMemory } = await import('./recommendationLog');
const { setPickFeedback } = await import('./pickFeedback');
const { submitReview } = await import('./reviews');

const T = 1_800_000_000_000;
const lm = { id: 'lm1', name: 'Cafe', region: 'r', categories: ['food'] };

beforeEach(() => {
  localStorage.clear();
  store.clear();
  setDocMock.mockClear();
  resetShownMemory();
});

describe('pickMarkFields', () => {
  it('returns the set, surface and time for a place shown as a pick', () => {
    rememberShownPicks({ uid: 'u', setId: 's1', surface: 'chat', stops: [{ id: 'a' }], at: T });
    expect(pickMarkFields('u', 'a', { now: T + 1000 })).toEqual({ pickSetId: 's1', pickSurface: 'chat', pickShownAt: T });
  });
  it('returns nothing for a place never shown, another user, or a bad surface mapped to null', () => {
    rememberShownPicks({ uid: 'u', setId: 's1', surface: 'nope', stops: [{ id: 'a' }], at: T });
    expect(pickMarkFields('u', 'b', { now: T })).toEqual({});
    expect(pickMarkFields('other', 'a', { now: T })).toEqual({});
    expect(pickMarkFields('u', 'a', { now: T })).toEqual({ pickSetId: 's1', pickSurface: null, pickShownAt: T });
  });
  it('expires after the window', () => {
    rememberShownPicks({ uid: 'u', setId: 's1', surface: 'chat', stops: [{ id: 'a' }], at: T });
    expect(pickMarkFields('u', 'a', { now: T + PICK_MARK_WINDOW_MS }).pickSetId).toBe('s1');
    expect(pickMarkFields('u', 'a', { now: T + PICK_MARK_WINDOW_MS + 1 })).toEqual({});
  });
  it('the latest showing wins', () => {
    rememberShownPicks({ uid: 'u', setId: 's1', surface: 'chat', stops: [{ id: 'a' }], at: T });
    rememberShownPicks({ uid: 'u', setId: 's2', surface: 'map-sheet', stops: [{ id: 'a' }], at: T + 5 });
    expect(pickMarkFields('u', 'a', { now: T + 10 })).toMatchObject({ pickSetId: 's2', pickSurface: 'map-sheet' });
  });
  it('is bounded, dropping the oldest', () => {
    const stops = Array.from({ length: PICK_MARK_LIMIT + 5 }, (_, i) => ({ id: `p${i}` }));
    stops.forEach((s, i) => rememberShownPicks({ uid: 'u', setId: 's', surface: 'chat', stops: [s], at: T + i }));
    const kept = Object.keys(JSON.parse(localStorage.getItem('lh-pick-marks:u')));
    expect(kept).toHaveLength(PICK_MARK_LIMIT);
    expect(kept).not.toContain('p0');
    expect(kept).toContain(`p${PICK_MARK_LIMIT + 4}`);
  });
  it('survives corrupt storage', () => {
    localStorage.setItem('lh-pick-marks:u', '{not json');
    expect(pickMarkFields('u', 'a')).toEqual({});
  });
});

describe('marking real taps and ratings', () => {
  it('logShownPicks remembers fresh stops (not test ones)', async () => {
    const log = vi.fn(async () => 1);
    await logShownPicks({ uid: 'u', setId: 's1', stops: [{ id: 'lm1', region: 'r' }], surface: 'mapr-tab', log });
    expect(pickMarkFields('u', 'lm1')).toMatchObject({ pickSetId: 's1', pickSurface: 'mapr-tab' });
    expect(log.mock.calls[0][0].at).toBe(pickMarkFields('u', 'lm1').pickShownAt);
    await logShownPicks({ uid: 'u', setId: 's2', stops: [{ id: 'lm9', region: 'r' }], surface: 'chat', isTest: true, log });
    expect(pickMarkFields('u', 'lm9')).toEqual({});
  });

  it('a tap on a shown pick carries the marks; a tap on any other place does not', async () => {
    rememberShownPicks({ uid: 'u', setId: 's1', surface: 'map-sheet', stops: [{ id: 'lm1' }], at: Date.now() - 1000 });
    const e = await setPickFeedback({ uid: 'u', landmark: lm, verdict: 'yes' });
    expect(e).toMatchObject({ pickSetId: 's1', pickSurface: 'map-sheet' });
    expect(store.get('pick_feedback/u_lm1')).toMatchObject({ pickSetId: 's1', pickShownAt: e.pickShownAt });
    const e2 = await setPickFeedback({ uid: 'u', landmark: { ...lm, id: 'lm2' }, verdict: 'no' });
    expect('pickSetId' in e2).toBe(false);
    expect('pickSetId' in store.get('pick_feedback/u_lm2')).toBe(false);
  });

  it('a rating (with or without a check-in) carries the marks, and an edit that is not from a pick keeps them', async () => {
    rememberShownPicks({ uid: 'u', setId: 's1', surface: 'chat', stops: [{ id: 'lm1' }], at: Date.now() - 1000 });
    await submitReview({ userId: 'u', userName: 'u', landmark: lm, rating: { tier: 'highly-recommend' } });
    expect(store.get('reviews/u_lm1')).toMatchObject({ pickSetId: 's1', pickSurface: 'chat' });
    localStorage.clear();
    await submitReview({ userId: 'u', userName: 'u', landmark: lm, rating: { tier: 'worth-trying' } });
    expect(store.get('reviews/u_lm1')).toMatchObject({ ratingTier: 'worth-trying', pickSetId: 's1' });
    await submitReview({ userId: 'u', userName: 'u', landmark: { ...lm, id: 'lm3' }, rating: { tier: 'probably-skip' } });
    expect('pickSetId' in store.get('reviews/u_lm3')).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PICK_VOTE_PENDING_LIMIT, PICK_VOTE_RETRY_BASE_MS, PICK_VOTE_SAVE_ATTEMPTS } from './maprConstants';

const store = new Map();
const h = vi.hoisted(() => ({ setDoc: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  setDoc: (...a) => h.setDoc(...a),
  serverTimestamp: () => 0,
  runTransaction: async () => {},
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
}));
vi.mock('./firebase', () => ({ db: {}, storage: null }));

const { setPickFeedback, flushPendingPickVotes, readPendingPickVotes, readLocalFeedback, clearLocalPickFeedback } = await import('./pickFeedback');
const { rememberShownPicks } = await import('./pickMarks');

const lm = { id: 'lm1', region: 'r', name: 'Cafe', categories: ['food'] };
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
let sleeps;
const sleep = async (ms) => {
  sleeps.push(ms);
};

beforeEach(() => {
  store.clear();
  sleeps = [];
  localStorage.clear();
  setOnline(true);
  h.setDoc.mockReset();
  h.setDoc.mockImplementation(async (ref, data) => {
    store.set(ref.path, data);
  });
});
afterEach(() => setOnline(true));

describe('setPickFeedback saves to the database first', () => {
  it('writes pick_feedback, then the device copy; carries pick marks and requestFor', async () => {
    rememberShownPicks({ uid: 'u', setId: 's1', surface: 'chat', stops: [{ id: 'lm1' }], at: Date.now() - 1000 });
    const order = [];
    h.setDoc.mockImplementation(async (ref, data) => {
      order.push(['db', Object.keys(readLocalFeedback('u')).length]);
      store.set(ref.path, data);
    });
    const res = await setPickFeedback({ uid: 'u', landmark: lm, verdict: 'unsure', requestFor: 'group', sleep });
    expect(res.status).toBe('saved');
    expect(order).toEqual([['db', 0]]); // the device copy was still empty when the database write ran
    expect(store.get('pick_feedback/u_lm1')).toMatchObject({ userId: 'u', verdict: 'unsure', pickSetId: 's1', pickSurface: 'chat', requestFor: 'group' });
    expect(readLocalFeedback('u').lm1.verdict).toBe('unsure');
  });

  it('ignores a requestFor that is not solo or group', async () => {
    await setPickFeedback({ uid: 'u', landmark: lm, verdict: 'yes', requestFor: 'everyone', sleep });
    expect('requestFor' in store.get('pick_feedback/u_lm1')).toBe(false);
  });

  it('retries with doubling backoff and then succeeds', async () => {
    h.setDoc.mockRejectedValueOnce(new Error('x')).mockImplementation(async (ref, data) => void store.set(ref.path, data));
    const res = await setPickFeedback({ uid: 'u', landmark: lm, verdict: 'yes', sleep });
    expect(res.status).toBe('saved');
    expect(h.setDoc).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([PICK_VOTE_RETRY_BASE_MS]);
  });

  it('gives up after PICK_VOTE_SAVE_ATTEMPTS, rejects, and keeps nothing on the phone', async () => {
    h.setDoc.mockRejectedValue(new Error('down'));
    await expect(setPickFeedback({ uid: 'u', landmark: lm, verdict: 'no', sleep })).rejects.toThrow('down');
    expect(h.setDoc).toHaveBeenCalledTimes(PICK_VOTE_SAVE_ATTEMPTS);
    expect(sleeps).toEqual([PICK_VOTE_RETRY_BASE_MS, PICK_VOTE_RETRY_BASE_MS * 2]);
    expect(readLocalFeedback('u')).toEqual({});
    expect(readPendingPickVotes('u')).toEqual({});
  });
});

describe('offline taps are a pending retry, not a vote', () => {
  it('queues without touching the database or the saved copy, then flushes when back online', async () => {
    setOnline(false);
    const res = await setPickFeedback({ uid: 'u', landmark: lm, verdict: 'no', requestFor: 'solo', sleep });
    expect(res.status).toBe('pending');
    expect(h.setDoc).not.toHaveBeenCalled();
    expect(readLocalFeedback('u')).toEqual({});
    expect(readPendingPickVotes('u').lm1).toMatchObject({ verdict: 'no', requestFor: 'solo' });
    expect(await flushPendingPickVotes('u', { sleep })).toEqual([]); // still offline
    setOnline(true);
    const saved = await flushPendingPickVotes('u', { sleep });
    expect(saved).toHaveLength(1);
    expect(store.get('pick_feedback/u_lm1')).toMatchObject({ verdict: 'no', requestFor: 'solo' });
    expect(readPendingPickVotes('u')).toEqual({});
    expect(readLocalFeedback('u').lm1.verdict).toBe('no');
  });

  it('a tap that still fails stays pending', async () => {
    setOnline(false);
    await setPickFeedback({ uid: 'u', landmark: lm, verdict: 'yes', sleep });
    setOnline(true);
    h.setDoc.mockRejectedValue(new Error('down'));
    expect(await flushPendingPickVotes('u', { sleep })).toEqual([]);
    expect(readPendingPickVotes('u').lm1).toBeTruthy();
    expect(readLocalFeedback('u')).toEqual({});
  });

  it('keeps at most PICK_VOTE_PENDING_LIMIT, newest first kept', async () => {
    setOnline(false);
    for (let i = 0; i < PICK_VOTE_PENDING_LIMIT + 3; i++) await setPickFeedback({ uid: 'u', landmark: { ...lm, id: `p${i}` }, verdict: 'yes', sleep });
    const ids = Object.keys(readPendingPickVotes('u'));
    expect(ids).toHaveLength(PICK_VOTE_PENDING_LIMIT);
    expect(ids).toContain(`p${PICK_VOTE_PENDING_LIMIT + 2}`);
  });

  it('account deletion clears the saved copy and the pending queue', async () => {
    await setPickFeedback({ uid: 'u', landmark: lm, verdict: 'yes', sleep });
    setOnline(false);
    await setPickFeedback({ uid: 'u', landmark: { ...lm, id: 'lm2' }, verdict: 'no', sleep });
    clearLocalPickFeedback('u');
    expect(readLocalFeedback('u')).toEqual({});
    expect(readPendingPickVotes('u')).toEqual({});
  });
});

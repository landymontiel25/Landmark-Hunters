// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addDoc = vi.fn(() => Promise.resolve());
vi.mock('firebase/firestore', () => ({ addDoc: (...a) => addDoc(...a), collection: () => 'save_errors', serverTimestamp: () => 'now' }));
vi.mock('./firebase', () => ({ db: {} }));

const { withRetries, enqueueRating, queuedRatings, dequeueRating, flushRatingQueue, logSaveError, RATING_RETRY_DELAYS_MS } = await import('./ratingQueue.js');

const noWait = () => Promise.resolve();
const landmark = { id: 'abaco-beach-resort', name: 'Abaco Beach Resort', regionId: 'abacos', categories: ['food'], lat: 1, missions: [{}] };

beforeEach(() => {
  localStorage.clear();
  addDoc.mockClear();
});

describe('withRetries', () => {
  it('retries at least 3 times with growing waits, then gives up', async () => {
    const run = vi.fn(() => Promise.reject(new Error('unavailable')));
    const waits = [];
    await expect(withRetries(run, { wait: (ms) => (waits.push(ms), Promise.resolve()) })).rejects.toThrow('unavailable');
    expect(run).toHaveBeenCalledTimes(RATING_RETRY_DELAYS_MS.length + 1);
    expect(RATING_RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(3);
    expect(waits).toEqual(RATING_RETRY_DELAYS_MS);
    expect([...waits].sort((a, b) => a - b)).toEqual(waits);
  });
  it('stops as soon as a try works', async () => {
    let n = 0;
    const run = vi.fn(() => (++n < 3 ? Promise.reject(new Error('blip')) : Promise.resolve('ok')));
    await expect(withRetries(run, { wait: noWait })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('never retries a mistake only the person can fix', async () => {
    const run = vi.fn(() => Promise.reject(Object.assign(new Error('too many'), { userMessage: 'Too many photos.' })));
    await expect(withRetries(run, { wait: noWait })).rejects.toThrow('too many');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('reports every failure with its try number', async () => {
    const seen = [];
    await withRetries(() => Promise.reject(new Error('x')), { wait: noWait, onError: (e, a) => seen.push(a) }).catch(() => {});
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

describe('the queue on this device', () => {
  it('keeps a rating with only what the save needs, one per place', () => {
    const rating = { tier: 'highly-recommend', wouldReturn: 'yes', comment: 'Great' };
    enqueueRating({ userId: 'u1', userName: 'u', landmark, rating });
    enqueueRating({ userId: 'u1', userName: 'u', landmark, rating: { ...rating, tier: 'worth-trying' } });
    const q = queuedRatings('u1');
    expect(q).toHaveLength(1);
    expect(q[0].rating.tier).toBe('worth-trying');
    expect(q[0].landmark).toEqual({ id: 'abaco-beach-resort', name: 'Abaco Beach Resort', region: 'abacos', regionId: 'abacos', categories: ['food'] });
    expect(queuedRatings('someone-else')).toEqual([]);
    dequeueRating('u1', 'abaco-beach-resort');
    expect(queuedRatings('u1')).toEqual([]);
  });
  it('a flush sends each one, removes what saved, keeps what failed', async () => {
    enqueueRating({ userId: 'u1', landmark, rating: { tier: 'highly-recommend' } });
    enqueueRating({ userId: 'u1', landmark: { ...landmark, id: 'other' }, rating: { tier: 'worth-trying' } });
    const send = vi.fn((e) => (e.landmark.id === 'other' ? Promise.reject(new Error('offline')) : Promise.resolve()));
    await expect(flushRatingQueue('u1', send)).resolves.toBe(1);
    expect(send.mock.calls[0][0].photoFiles).toEqual([]);
    expect(queuedRatings('u1').map((e) => e.landmark.id)).toEqual(['other']);
  });
});

describe('logSaveError', () => {
  it('records the real code and message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    logSaveError({ uid: 'u1', landmark, attempt: 2, error, source: 'checkin' });
    await Promise.resolve();
    expect(addDoc.mock.calls[0][1]).toMatchObject({ uid: 'u1', kind: 'rating', source: 'checkin', landmarkId: 'abaco-beach-resort', region: 'abacos', code: 'permission-denied', message: 'Missing or insufficient permissions.', attempt: 2 });
  });
});

import { describe, it, expect, vi } from 'vitest';

// Regression test for a real bug: a custom landmark whose Firestore
// document id doesn't match its own `id` field (an old record predating
// the create rule in firestore.rules that now enforces docId === id)
// rendered fine as a map pin (getCustomLandmarks, an unfiltered read) but
// its own detail page always 404'd -- getCustomLandmark looked it up by
// treating the route's id as the document id directly, which only works
// when the two happen to match. A pin like that could never be opened to
// edit or delete.
const getDocMock = vi.fn();
const getDocsMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args) => args.join('/')),
  getDoc: (...args) => getDocMock(...args),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDocs: (...args) => getDocsMock(...args),
  collection: vi.fn((...args) => args.join('/')),
  arrayUnion: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {}, storage: {} }));
vi.mock('../data/regions', () => ({ normalizeCategories: (c) => c, canonicalRegionId: (r) => r }));

const { getCustomLandmark } = await import('./customLandmarks');

describe('getCustomLandmark', () => {
  it('finds a record directly when its document id matches its id field', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => true, id: 'custom-1', data: () => ({ id: 'custom-1', name: 'A' }) });
    const result = await getCustomLandmark('custom-1');
    expect(result).toMatchObject({ docId: 'custom-1', id: 'custom-1', name: 'A' });
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('falls back to a bulk lookup when the document id does not match the id field', async () => {
    // The direct doc-id get misses (this record's real key differs from its own `id` field).
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    getDocsMock.mockResolvedValueOnce({
      docs: [
        { id: 'legacy-doc-key', data: () => ({ id: 'custom-mismatched', name: 'The Refectory Restaurant' }) },
        { id: 'custom-2', data: () => ({ id: 'custom-2', name: 'Other Place' }) },
      ],
    });
    const result = await getCustomLandmark('custom-mismatched');
    expect(result).toMatchObject({ docId: 'legacy-doc-key', id: 'custom-mismatched', name: 'The Refectory Restaurant' });
  });

  it('returns null when neither the direct lookup nor the bulk fallback finds it', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    getDocsMock.mockResolvedValueOnce({ docs: [] });
    const result = await getCustomLandmark('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getCustomLandmark on a reported (hidden) landmark', () => {
  it('treats the rules\' permission-denied as "not found", not an error', async () => {
    getDocMock.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    expect(await getCustomLandmark('custom-hidden')).toBeNull();
  });

  it('still throws other read failures', async () => {
    getDocMock.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(getCustomLandmark('custom-x')).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('region-less custom landmarks', () => {
  it('saves a stable "custom" region instead of null, and reads legacy null/"null" the same way', async () => {
    const { setDoc } = await import('firebase/firestore');
    const { addCustomLandmark, getCustomLandmarks } = await import('./customLandmarks');
    await addCustomLandmark({ region: null, name: 'Far Spot', lat: 1, lng: 2, userId: 'u' });
    expect(setDoc.mock.calls.at(-1)[1].region).toBe('custom');
    getDocsMock.mockResolvedValueOnce({
      docs: [
        { id: 'a', data: () => ({ id: 'a', name: 'A', region: null }) },
        { id: 'b', data: () => ({ id: 'b', name: 'B', region: 'null' }) },
        { id: 'c', data: () => ({ id: 'c', name: 'C', region: 'nyc' }) },
      ],
    });
    const all = await getCustomLandmarks();
    expect(all.map((l) => l.region)).toEqual(['custom', 'custom', 'nyc']);
  });

  it('hides a landmark reported by two people (the list rule cannot enforce it)', async () => {
    const { getCustomLandmarks } = await import('./customLandmarks');
    getDocsMock.mockResolvedValueOnce({
      docs: [
        { id: 'a', data: () => ({ id: 'a', name: 'A', reportedBy: ['x', 'y'] }) },
        { id: 'b', data: () => ({ id: 'b', name: 'B', reportedBy: ['x'] }) },
      ],
    });
    expect((await getCustomLandmarks()).map((l) => l.id)).toEqual(['b']);
  });
});

describe('addCustomLandmark topic', () => {
  it('saves a researched topic, and leaves the field off when there is none', async () => {
    const { setDoc } = await import('firebase/firestore');
    const { addCustomLandmark } = await import('./customLandmarks');
    await addCustomLandmark({ region: 'r', name: 'Inka Grill', lat: 1, lng: 2, userId: 'u', topic: 'Peruvian restaurant' });
    expect(setDoc.mock.calls.at(-1)[1].topic).toBe('Peruvian restaurant');
    await addCustomLandmark({ region: 'r', name: 'Somewhere', lat: 1, lng: 2, userId: 'u' });
    expect('topic' in setDoc.mock.calls.at(-1)[1]).toBe(false);
  });
});

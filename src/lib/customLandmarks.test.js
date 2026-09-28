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
vi.mock('../data/regions', () => ({ normalizeCategories: (c) => c }));

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

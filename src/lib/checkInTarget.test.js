import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  getDocs: vi.fn(), collection: vi.fn(), arrayUnion: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {}, storage: {} }));

const { checkInTarget } = await import('./customLandmarks');
const { isRateable, tierQuestion } = await import('./ratingFlow');

// Regression: adding a landmark while standing on it opened the check-in
// sheet with only id/name, so it skipped the rating questions entirely.
describe('checkInTarget', () => {
  const created = {
    id: 'custom-1', name: 'Tapia Peruvian Restaurant', region: 'miami', lat: 1, lng: 2,
    categories: ['food'], topic: 'Peruvian restaurant', images: [], summary: 'x',
  };

  it('keeps categories and topic so the rating flow runs with its own question', () => {
    const t = checkInTarget(created);
    expect(isRateable(t)).toBe(true);
    expect(tierQuestion(t)).toBe('Do you like Peruvian food?');
  });

  it('tolerates a landmark with no category or topic', () => {
    const t = checkInTarget({ id: 'a', name: 'A', region: 'custom', lat: 1, lng: 2 });
    expect(t.categories).toEqual([]);
    expect(t.topic).toBeNull();
    expect(isRateable(t)).toBe(false);
  });
});

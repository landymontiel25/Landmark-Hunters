import { describe, it, expect, vi } from 'vitest';

const addCustomLandmark = vi.fn(async (d) => ({ docId: 'x', id: 'custom-1', ...d }));
vi.mock('./firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'tok' } }, db: null }));
vi.mock('./customLandmarks', () => ({ getCustomLandmarks: vi.fn(async () => []), addCustomLandmark: (d) => addCustomLandmark(d) }));
vi.mock('./places', () => ({ makeSessionToken: () => 't', searchPlaces: vi.fn(), getPlaceDetails: vi.fn() }));
vi.mock('./friendlyError', () => ({
  fetchJson: vi.fn(async () => ({ ok: true, category: 'food', topic: 'Peruvian restaurant', summary: 's', facts: [], free: true })),
}));

const { createLandmarkFromPlace } = await import('./placeLandmarks');

// Regression: a landmark made from a Google place (Mapr's rate card, Rate a
// Landmark) dropped the AI's "topic", so its rating question lost the
// specific wording ("Do you like Peruvian food?") that Add Landmark gives.
describe('createLandmarkFromPlace', () => {
  it('keeps the researched topic on the saved landmark', async () => {
    await createLandmarkFromPlace({
      details: { primary: 'Tapia', lat: 25.8, lng: -80.3 },
      fallbackName: 'Tapia',
      user: { uid: 'me' },
      resendVerification: vi.fn(),
    });
    expect(addCustomLandmark).toHaveBeenCalledWith(expect.objectContaining({ topic: 'Peruvian restaurant', categories: ['food'] }));
  });
});

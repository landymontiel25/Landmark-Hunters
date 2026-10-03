import { describe, it, expect, vi } from 'vitest';

vi.mock('./customLandmarks', () => ({
  getCustomLandmarks: async () => [
    { id: 'custom-artisans', region: 'villanova', name: 'Artisans', lat: 40.037, lng: -75.342, categories: ['food'], images: [] },
  ],
}));
vi.mock('./placePacks', () => ({ ensurePlacePacks: async () => true }));

const { directionsStopFor } = await import('./directionsStop');

describe('directionsStopFor', () => {
  it('finds a place someone added in the app', async () => {
    const stop = await directionsStopFor('How do I get to Artisans?');
    expect(stop).toMatchObject({ region: 'villanova', id: 'custom-artisans', name: 'Artisans', lat: 40.037, lng: -75.342 });
  });

  it('finds a built-in landmark', async () => {
    expect((await directionsStopFor('How do I get to Hillstone?'))?.name).toBe('Hillstone Restaurant');
  });

  it('adds nothing for other questions or unknown places', async () => {
    expect(await directionsStopFor('Is Artisans good?')).toBeNull();
    expect(await directionsStopFor('How do I get to Zzyzx Bakery?')).toBeNull();
  });
});

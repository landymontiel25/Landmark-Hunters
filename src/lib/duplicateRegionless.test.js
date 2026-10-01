import { describe, it, expect, vi } from 'vitest';

vi.mock('./customLandmarks', () => ({
  CUSTOM_REGION: 'custom',
  getCustomLandmarks: async () => [{ id: 'custom-1', name: 'Joes Diner', region: 'custom', lat: 10, lng: 10 }],
}));
vi.mock('../data/regions', () => ({ ALL_LANDMARKS: [] }));

const { findPossibleDuplicate } = await import('./duplicateLandmarkCheck');

describe('findPossibleDuplicate with a region-less custom landmark', () => {
  it('flags a nearby same-name region-less pin', async () => {
    const m = await findPossibleDuplicate({ name: 'Joes Diner', regionId: 'nyc', lat: 10.01, lng: 10.01 });
    expect(m?.id).toBe('custom-1');
  });
  it('ignores a far-away one', async () => {
    expect(await findPossibleDuplicate({ name: 'Joes Diner', regionId: 'nyc', lat: 40, lng: -74 })).toBeNull();
  });
});

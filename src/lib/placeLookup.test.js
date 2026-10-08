import { describe, it, expect } from 'vitest';
import { nearestRegionId } from './placeLookup';
import { REGIONS } from '../data/regions';

describe('nearestRegionId (placeLookup)', () => {
  it('never snaps a point into a worldwide catalog region', () => {
    const catalog = REGIONS.find((r) => r.worldwide);
    expect(catalog).toBeTruthy();
    expect(nearestRegionId(catalog.center.lat, catalog.center.lng)).not.toBe(catalog.id);
  });
});

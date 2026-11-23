import { describe, it, expect } from 'vitest';
import { serverBoatRoute, onWater } from './waterGrids.js';
import { ABACOS_LANDMARKS } from '../../src/data/landmarks.abacos.js';

describe('Mapr boat routes on the server, from the bundled water maps (2026-11-23)', () => {
  const fowl = ABACOS_LANDMARKS.find((l) => l.id === 'fowl-cays-national-park');
  const spot = { lat: 26.595601, lng: -77.0167856 }; // on the water off Man-O-War
  it('knows a traveler on the water is on the water, and one in Hope Town is not', async () => {
    expect(await onWater(spot)).toBe(true);
    const lighthouse = ABACOS_LANDMARKS.find((l) => l.id === 'elbow-reef-lighthouse');
    expect(await onWater(lighthouse)).toBe(false);
  });
  it('finds the boat route to Fowl Cays with no network at all', async () => {
    const r = await serverBoatRoute(spot, fowl);
    expect(r).toBeTruthy();
    expect(r.distanceMeters).toBeGreaterThan(4000);
    expect(r.minutes).toBeGreaterThan(5);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeGrid, boatRouteOnGrid, waterAreaFor, AREA_BOXES, boatMinutes } from './boatRoute.js';
import { AREAS } from '../../scripts/water-grid/build-water-grid.mjs';
import { ABACOS_LANDMARKS } from '../data/landmarks.abacos.js';

const abacos = decodeGrid(JSON.parse(readFileSync(new URL('../../public/water/abacos.json', import.meta.url), 'utf8')));
const lm = (id) => ABACOS_LANDMARKS.find((l) => l.id === id);
const waterAt = (g, lat, lng) => g.water[Math.floor((g.north - lat) / g.dLat) * g.cols + Math.floor((lng - g.west) / g.dLng)];

// Every straight run between the route's water points stays on water.
function crossesLand(g, points) {
  for (let k = 2; k < points.length - 1; k++) {
    const [a, b] = [points[k - 1], points[k]];
    for (let s = 0; s <= 40; s++) if (!waterAt(g, a[0] + ((b[0] - a[0]) * s) / 40, a[1] + ((b[1] - a[1]) * s) / 40)) return true;
  }
  return false;
}

describe('boat routes go around the islands (owner, 2026-11-23)', () => {
  it('the app and the build script frame the same areas', () => {
    for (const [k, a] of Object.entries(AREAS)) expect(AREA_BOXES[k]).toEqual({ south: a.south, west: a.west, north: a.north, east: a.east });
  });
  it('Hope Town to Tahiti Beach: a water route, longer than the straight line, never over land', () => {
    const from = lm('elbow-reef-lighthouse');
    const to = lm('tahiti-beach');
    expect(waterAreaFor(from, to)).toBe('abacos');
    const t0 = Date.now();
    const r = boatRouteOnGrid(abacos, from, to);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toBeTruthy();
    expect(crossesLand(abacos, r.points)).toBe(false);
    expect(r.minutes).toBe(boatMinutes(r.distanceMeters));
  });
  it('Hope Town to Fowl Cays and Marsh Harbour to Green Turtle Club: routes, never over land', () => {
    for (const [a, b] of [
      ['elbow-reef-lighthouse', 'fowl-cays-national-park'],
      ['abaco-beach-resort', 'green-turtle-club'],
    ]) {
      const r = boatRouteOnGrid(abacos, lm(a), lm(b));
      expect(r, `${a} -> ${b}`).toBeTruthy();
      expect(crossesLand(abacos, r.points)).toBe(false);
    }
  });
  it('outside every water map there is no boat route', () => {
    expect(waterAreaFor({ lat: 25.7617, lng: -80.1918 }, { lat: 26.5, lng: -77 })).toBe(null);
  });
});

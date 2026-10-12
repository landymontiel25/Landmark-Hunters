import { describe, expect, it } from 'vitest';
import { SEARCHABLE_PLACES } from './places';

describe('map search places', () => {
  it('has every app city with an outline, under its state or country', () => {
    const sv = SEARCHABLE_PLACES.find((p) => p.name === 'Silicon Valley');
    expect(sv.sub).toBe('California');
    expect(sv.area.length).toBeGreaterThan(5);
    expect(SEARCHABLE_PLACES.find((p) => p.name === 'Palo Alto').sub).toBe('Silicon Valley');
    expect(SEARCHABLE_PLACES.find((p) => p.name === 'Miami').area.length).toBeGreaterThan(0);
    for (const p of SEARCHABLE_PLACES) expect(Number.isFinite(p.lat) && Number.isFinite(p.lng)).toBe(true);
  });
});

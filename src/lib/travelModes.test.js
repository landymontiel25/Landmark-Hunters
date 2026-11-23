import { describe, it, expect } from 'vitest';
import { travelModesFor, effectiveMode, legMinutes, legLabel } from './travelModes';

const at = (id, lat, lng, extra = {}) => ({ id, lat, lng, region: 'miami', ...extra });
// Brickell: three stops a few hundred meters apart.
const brickell = [at('a', 25.7617, -80.1918), at('b', 25.765, -80.1935), at('c', 25.7585, -80.1905)];
// Miami to Key West, about 250 km.
const keyWest = [at('kw', 24.5551, -81.78)];
// The Abacos: Marsh Harbour to Hope Town by water.
const abacos = [at('abaco-beach-resort', 26.5462, -77.0464, { region: 'abacos' }), at('hope-town-harbour', 26.5409, -76.9592, { region: 'abacos' })];

describe('travel modes that fit the trip', () => {
  it('Brickell to Brickell: walk, drive, bus, bike, never boat', () => {
    const { modes, suggested } = travelModesFor({ origin: { lat: 25.763, lng: -80.192 }, stops: brickell });
    expect(modes).toEqual(['walk', 'car', 'bus', 'bike']);
    expect(modes).not.toContain('boat');
    expect(suggested).toBe('walk');
  });
  it('Miami to Key West: drive, bus or fly; no walking, biking or boat', () => {
    const { modes, suggested } = travelModesFor({ origin: { lat: 25.7617, lng: -80.1918 }, stops: keyWest });
    expect(modes).toEqual(['car', 'bus', 'plane']);
    expect(suggested).toBe('car');
  });
  it('island to island in the Abacos: boat, suggested', () => {
    const { modes, suggested } = travelModesFor({ origin: { lat: 26.5462, lng: -77.0464 }, stops: abacos });
    expect(modes).toContain('boat');
    expect(modes).not.toContain('bus');
    expect(suggested).toBe('boat');
  });
  it('a pick that no longer fits falls back to the suggestion', () => {
    const choice = { modes: ['walk', 'car'], suggested: 'walk' };
    expect(effectiveMode('car', choice)).toBe('car');
    expect(effectiveMode('boat', choice)).toBe('walk');
    expect(effectiveMode(null, choice)).toBe('walk');
  });
  it('each mode has its own pace', () => {
    const km5 = 5000;
    expect(legMinutes(km5, 'walk')).toBeGreaterThan(legMinutes(km5, 'bike'));
    expect(legMinutes(km5, 'bike')).toBeGreaterThan(legMinutes(km5, 'car'));
    expect(legMinutes(250000, 'plane')).toBeLessThan(legMinutes(250000, 'car'));
    expect(legLabel(12, 'boat')).toBe('12 min by boat');
    expect(legLabel(75, 'car')).toBe('1 h 15 min drive');
  });
});

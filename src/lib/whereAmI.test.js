import { describe, it, expect } from 'vitest';
import { isMoving, nearestPlace, placeAt, shortAddress } from './whereAmI';

// About 111 m per 0.001 degree of latitude.
const fix = (t, dLat, accuracy = 10) => ({ lat: 25.76 + dLat, lng: -80.2, accuracy, t: t * 1000 });

describe('isMoving', () => {
  it('sees walking and driving', () => {
    expect(isMoving([fix(0, 0), fix(20, 0.0003)], 20_000)).toBe(true); // ~33 m in 20 s
    expect(isMoving([fix(0, 0), fix(10, 0.002)], 10_000)).toBe(true); // ~220 m in 10 s
  });

  it('ignores GPS drift while standing still', () => {
    expect(isMoving([fix(0, 0), fix(15, 0.0001), fix(25, -0.0001)], 25_000)).toBe(false); // ~11-22 m
    // A rough fix can jump 60 m without you moving.
    expect(isMoving([fix(0, 0, 50), fix(20, 0.0005, 50)], 20_000)).toBe(false);
  });

  it('needs at least 10 s between fixes and forgets fixes older than 30 s', () => {
    expect(isMoving([fix(0, 0), fix(5, 0.001)], 5_000)).toBe(false);
    expect(isMoving([fix(0, 0), fix(20, 0.001)], 60_000)).toBe(false);
  });
});

describe('placeAt', () => {
  const places = [
    { id: 'a', name: 'Budare Bistro', lat: 25.76, lng: -80.2 },
    { id: 'b', name: 'Next Door', lat: 25.7603, lng: -80.2 }, // ~33 m north
  ];
  it('picks the nearest place within 40 m', () => {
    expect(placeAt({ lat: 25.76001, lng: -80.2 }, places)?.id).toBe('a');
    expect(placeAt({ lat: 25.7603, lng: -80.2 }, places)?.id).toBe('b');
  });
  it('returns nothing when you are not at a place', () => {
    expect(placeAt({ lat: 25.77, lng: -80.2 }, places)).toBeNull();
  });
});

describe('shortAddress', () => {
  it('keeps the first two parts', () => {
    expect(shortAddress('1801 SW 3rd Avenue, Miami, Florida')).toBe('1801 SW 3rd Avenue, Miami');
    expect(shortAddress('')).toBe('');
  });
});

describe('nearestPlace', () => {
  it('finds the closest place within 500 m only', () => {
    const places = [{ id: 'a', name: 'A', lat: 25.76, lng: -80.2 }];
    expect(nearestPlace({ lat: 25.763, lng: -80.2 }, places)?.id).toBe('a'); // ~330 m
    expect(nearestPlace({ lat: 25.77, lng: -80.2 }, places)).toBeNull(); // ~1.1 km
  });
});

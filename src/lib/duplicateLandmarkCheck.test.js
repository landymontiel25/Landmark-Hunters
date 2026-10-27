import { describe, expect, it } from 'vitest';
import { findPossibleDuplicate } from './duplicateLandmarkCheck';
import { ALL_LANDMARKS } from '../data/regions';

// A one-word landmark name with a map point, like "Cocoplum".
const core1 = (n) => /^[A-Za-z]{6,}$/.test(n);

describe('findPossibleDuplicate', () => {
  it('finds a built-in landmark by exact name in the same region', async () => {
    const match = await findPossibleDuplicate({ name: 'Lincoln Road', regionId: 'miami' });
    expect(match).toEqual({ name: 'Lincoln Road', region: 'miami', id: expect.any(String) });
  });

  it('is case-insensitive and tolerant of partial names', async () => {
    const match = await findPossibleDuplicate({ name: 'lincoln road', regionId: 'miami' });
    expect(match?.name).toBe('Lincoln Road');
  });

  it('does not match the same name in a different region', async () => {
    const match = await findPossibleDuplicate({ name: 'Lincoln Road', regionId: 'nyc' });
    expect(match).toBeNull();
  });

  it('returns null for an unrelated name', async () => {
    const match = await findPossibleDuplicate({ name: 'Definitely Not A Real Place Xyz', regionId: 'miami' });
    expect(match).toBeNull();
  });

  it('catches a plain typo of an existing landmark', async () => {
    const match = await findPossibleDuplicate({ name: 'Versailes', regionId: 'miami' });
    expect(match?.name).toBe('Versailles Restaurant');
  });

  it('does not flag a genuinely different, similarly-short name', async () => {
    const match = await findPossibleDuplicate({ name: 'Quailridge Diner', regionId: 'miami' });
    expect(match).toBeNull();
  });

  it('returns null for a name shorter than 2 characters or a missing region', async () => {
    expect(await findPossibleDuplicate({ name: 'S', regionId: 'miami' })).toBeNull();
    expect(await findPossibleDuplicate({ name: 'South Beach', regionId: null })).toBeNull();
  });

  it('does not flag a place whose name only starts with a neighborhood landmark', async () => {
    // Any city: Miami has no one-word landmark since its top-100 cut.
    const hood = ALL_LANDMARKS.find((l) => core1(l.name));
    expect(hood).toBeTruthy();
    const far = { lat: hood.lat + 0.01, lng: hood.lng };
    expect(await findPossibleDuplicate({ name: `${hood.name} Yacht Club`, regionId: hood.regionId, ...far })).toBeNull();
  });

  it('flags a longer name at the very same spot', async () => {
    const hood = ALL_LANDMARKS.find((l) => core1(l.name));
    const match = await findPossibleDuplicate({ name: `${hood.name} Yacht Club`, regionId: hood.regionId, lat: hood.lat, lng: hood.lng });
    expect(match?.id).toBe(hood.id);
  });
});

describe('namesMatch', () => {
  it('does not mix up different names that only look alike (owner report: Budare Bistro vs Bugatti Bistro)', async () => {
    const { namesMatch } = await import('./duplicateLandmarkCheck.js');
    expect(namesMatch('Budare Bistro', 'Bugatti Bistro')).toBe(false);
    expect(namesMatch('La Mar', 'La Mer')).toBe(false);
    expect(namesMatch('Pizza Cafe', 'Pizza Bar')).toBe(true); // filler words only
  });

  it('still catches real typos and spacing slips', async () => {
    const { namesMatch } = await import('./duplicateLandmarkCheck.js');
    expect(namesMatch('Helstone', 'Hillstone Restaurant')).toBe(true);
    expect(namesMatch('Vizcaya Musuem', 'Vizcaya Museum')).toBe(true);
    expect(namesMatch('Versailes', 'Versailles')).toBe(true);
    expect(namesMatch("Joes Stone Crab", "Joe's Stone Crab")).toBe(true);
  });
});

describe('findPossibleDuplicate with a location', () => {
  it('ignores a look-alike name far away', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const h = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && l.name === 'Versailles Restaurant');
    const far = { lat: h.lat + 0.1, lng: h.lng };
    expect(await findPossibleDuplicate({ name: 'Versailes', regionId: 'miami', ...far })).toBeNull();
    expect(await findPossibleDuplicate({ name: 'Versailes', regionId: 'miami', lat: h.lat, lng: h.lng })).toMatchObject({ name: 'Versailles Restaurant' });
  });
});

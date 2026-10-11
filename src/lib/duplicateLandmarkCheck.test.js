import { describe, expect, it } from 'vitest';
import { findPossibleDuplicate } from './duplicateLandmarkCheck';
import { ALL_LANDMARKS } from '../data/regions';

// A one-word landmark name with a map point, like "Cocoplum".
const core1 = (n) => /^[A-Za-z]{6,}$/.test(n);

describe('findPossibleDuplicate', () => {
  it('finds a built-in landmark by exact name in the same region', async () => {
    const match = await findPossibleDuplicate({ name: 'South Beach', regionId: 'miami' });
    expect(match).toEqual({ name: 'South Beach', region: 'miami', id: expect.any(String) });
  });

  it('is case-insensitive and tolerant of partial names', async () => {
    const match = await findPossibleDuplicate({ name: 'south beach', regionId: 'miami' });
    expect(match?.name).toBe('South Beach');
  });

  it('does not match the same name in a different region', async () => {
    const match = await findPossibleDuplicate({ name: 'South Beach', regionId: 'nyc' });
    expect(match).toBeNull();
  });

  it('returns null for an unrelated name', async () => {
    const match = await findPossibleDuplicate({ name: 'Definitely Not A Real Place Xyz', regionId: 'miami' });
    expect(match).toBeNull();
  });

  it('catches a plain typo of an existing landmark', async () => {
    const match = await findPossibleDuplicate({ name: 'Helstone', regionId: 'miami' });
    expect(match?.name).toBe('Hillstone Restaurant');
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
    const hood = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && core1(l.name));
    expect(hood).toBeTruthy();
    const far = { lat: hood.lat + 0.01, lng: hood.lng };
    expect(await findPossibleDuplicate({ name: `${hood.name} Yacht Club`, regionId: 'miami', ...far })).toBeNull();
  });

  it('flags a longer name at the very same spot', async () => {
    const hood = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && core1(l.name));
    const match = await findPossibleDuplicate({ name: `${hood.name} Yacht Club`, regionId: 'miami', lat: hood.lat, lng: hood.lng });
    expect(match?.id).toBe(hood.id);
  });
});

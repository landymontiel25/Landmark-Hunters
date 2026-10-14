import { describe, it, expect, vi } from 'vitest';
import { fakeDb } from './fakeDb.testutil.js';
import { customGooglePlaceId, RETRY_MS } from './customRatingMatch.js';

const ID = 'custom-1760000000000-abc123';
const PLACE = { id: ID, name: "Joe's Taco Stand", lat: 25.77, lng: -80.19, categories: ['food'], createdBy: 'u1' };
const near = (over = {}) => ({ id: 'ChIJtaco', name: "Joe's Taco Stand", lat: 25.7701, lng: -80.1901, ...over });

describe('customGooglePlaceId (Google ratings for user-added landmarks)', () => {
  it('finds the Google listing once and saves only its place ID', async () => {
    const db = fakeDb({ [`custom_landmarks/${ID}`]: { ...PLACE } });
    const search = vi.fn(async () => [near()]);
    expect(await customGooglePlaceId(db, ID, { search, now: 1000 })).toBe('ChIJtaco');
    expect(db.docs[`custom_landmarks/${ID}`]).toMatchObject({ googlePlaceId: 'ChIJtaco', googleMatchAt: 1000 });
    // Saved: the next view makes no search.
    expect(await customGooglePlaceId(db, ID, { search, now: 2000 })).toBe('ChIJtaco');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('saves nothing but the attempt when no result is surely the same place, and retries later', async () => {
    const db = fakeDb({ [`custom_landmarks/${ID}`]: { ...PLACE } });
    const search = vi.fn(async () => [near({ name: 'Taco Bell', lat: 25.78 })]);
    expect(await customGooglePlaceId(db, ID, { search, now: 1000 })).toBeNull();
    expect(db.docs[`custom_landmarks/${ID}`].googlePlaceId).toBeUndefined();
    expect(await customGooglePlaceId(db, ID, { search, now: 1000 + RETRY_MS - 1 })).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
    await customGooglePlaceId(db, ID, { search, now: 1000 + RETRY_MS });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('ignores catalog places and missing docs', async () => {
    const db = fakeDb({});
    const search = vi.fn();
    expect(await customGooglePlaceId(db, 'liberty-bell-center', { search })).toBeNull();
    expect(await customGooglePlaceId(db, ID, { search })).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('throws when Google fails, so the app never says "No ratings available" by mistake', async () => {
    const db = fakeDb({ [`custom_landmarks/${ID}`]: { ...PLACE } });
    await expect(customGooglePlaceId(db, ID, { search: async () => { throw new Error('google search 503'); } })).rejects.toThrow();
    expect(db.docs[`custom_landmarks/${ID}`].googleMatchAt).toBeUndefined();
  });
});

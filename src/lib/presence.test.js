import { describe, it, expect } from 'vitest';
import {
  PRESENCE_LIMITS,
  placeTypeFor,
  presenceLimitsFor,
  checkPresence,
  validFix,
  presenceLabel,
  PRESENCE_CHECKIN_MAX_AGE_MS,
  PRESENCE_FIX_MAX_AGE_MS,
} from './presence';

// 1 degree of latitude is about 111195 m.
const NOW = 1_800_000_000_000;
const statue = { id: 's', name: 'Liberty Bell', lat: 39.9496, lng: -75.1503, categories: ['history-culture'] };
const north = (place, m) => place.lat + m / 111195;
const fix = (over = {}) => ({ lat: statue.lat, lng: statue.lng, accuracy: 10, timestamp: NOW - 5000, ...over });
const run = (over = {}) => checkPresence({ place: statue, fix: fix(), nowMs: NOW, checkinAtMs: NOW - 60000, ...over });

describe('place types (plan v2 table)', () => {
  it('ships the starting radius and accuracy values', () => {
    expect(PRESENCE_LIMITS).toEqual({
      landmark: { radiusMeters: 30, maxAccuracyMeters: 50 },
      indoor: { radiusMeters: 60, maxAccuracyMeters: 100 },
      area: { radiusMeters: 150, maxAccuracyMeters: 100 },
    });
  });
  it('sorts places by topic, then name, then category', () => {
    expect(placeTypeFor(statue)).toBe('landmark');
    expect(placeTypeFor({ name: 'Philadelphia Museum of Art', categories: ['art-museums'] })).toBe('indoor');
    expect(placeTypeFor({ name: 'Joe’s', topic: 'pizza restaurant', categories: ['food'] })).toBe('indoor');
    expect(placeTypeFor({ name: 'Joe’s', categories: ['food'] })).toBe('indoor');
    expect(placeTypeFor({ name: 'Fairmount', topic: 'park' })).toBe('area');
    expect(placeTypeFor({ name: 'Villanova University', categories: ['campus-life'] })).toBe('area');
    expect(placeTypeFor({ name: 'South Beach' })).toBe('area');
    expect(placeTypeFor({ name: 'Golden Gate Bridge', categories: ['history-culture'] })).toBe('area');
    expect(placeTypeFor({ name: 'Rittenhouse', categories: ['parks-nature'] })).toBe('area');
    expect(placeTypeFor({ name: 'X', topic: 'statue' })).toBe('landmark');
    expect(placeTypeFor(null)).toBe('landmark');
  });
  it('gives each type its limits', () => {
    expect(presenceLimitsFor({ topic: 'museum' })).toEqual(PRESENCE_LIMITS.indoor);
  });
});

describe('checkPresence', () => {
  it('passes at the place with a good, fresh fix', () => {
    const r = run();
    expect(r).toMatchObject({ verified: true, reason: null, placeType: 'landmark', distanceMeters: 0, accuracyMeters: 10 });
  });
  it('fails outside the radius and reports the distance', () => {
    const r = run({ fix: fix({ lat: north(statue, 140) }) });
    expect(r).toMatchObject({ verified: false, reason: 'too-far' });
    expect(r.distanceMeters).toBeGreaterThanOrEqual(139);
  });
  it('uses the larger radius for a park', () => {
    const park = { name: 'Rittenhouse Square', lat: 39.9496, lng: -75.1716 };
    const f = { lat: north(park, 120), lng: park.lng, accuracy: 80, timestamp: NOW - 1000 };
    expect(checkPresence({ place: park, fix: f, nowMs: NOW, checkinAtMs: NOW }).verified).toBe(true);
    expect(checkPresence({ place: statue, fix: { ...f, lat: north(statue, 120), lng: statue.lng }, nowMs: NOW, checkinAtMs: NOW }).reason).toBe('weak-signal');
  });
  it('fails a weak signal', () => {
    expect(run({ fix: fix({ accuracy: 51 }) }).reason).toBe('weak-signal');
  });
  it('fails an old check-in, an old fix, and a fix from the future', () => {
    expect(run({ checkinAtMs: NOW - PRESENCE_CHECKIN_MAX_AGE_MS - 1 }).reason).toBe('stale-checkin');
    expect(run({ checkinAtMs: null }).reason).toBe('stale-checkin');
    expect(run({ fix: fix({ timestamp: NOW - PRESENCE_FIX_MAX_AGE_MS - 1 }) }).reason).toBe('stale-fix');
    expect(run({ fix: fix({ timestamp: NOW + 60000 }) }).reason).toBe('stale-fix');
  });
  it('fails a mocked fix', () => {
    expect(run({ fix: fix({ mocked: true }) }).reason).toBe('mocked');
  });
  it('fails travel faster than 900 km/h since the last verified fix, but not GPS jitter', () => {
    // Miami, 10 minutes ago: about 1,600 km away.
    expect(run({ last: { lat: 25.76, lng: -80.19, atMs: NOW - 600000 } }).reason).toBe('impossible-travel');
    // Same Miami fix 3 hours ago: about 530 km/h, a plane could do it.
    expect(run({ last: { lat: 25.76, lng: -80.19, atMs: NOW - 3 * 3600000 } }).verified).toBe(true);
    // 500 m away a second ago: under 1 km never trips it.
    expect(run({ last: { lat: north(statue, 500), lng: statue.lng, atMs: NOW - 6000 } }).verified).toBe(true);
  });
  it('fails without a place point or a usable fix', () => {
    expect(run({ place: { name: 'x' } }).reason).toBe('no-place');
    expect(run({ fix: { lat: 1 } }).reason).toBe('no-location');
  });
});

describe('validFix', () => {
  it('needs numbers in range and a boolean mocked flag', () => {
    expect(validFix(fix())).toBe(true);
    expect(validFix(fix({ lat: 91 }))).toBe(false);
    expect(validFix(fix({ accuracy: -1 }))).toBe(false);
    expect(validFix(fix({ timestamp: 'now' }))).toBe(false);
    expect(validFix(fix({ mocked: 'no' }))).toBe(false);
    expect(validFix(null)).toBe(false);
  });
});

describe('presenceLabel', () => {
  it('says verified, or why not', () => {
    expect(presenceLabel({ verified: true })).toBe('Verified visit');
    // Never a distance, even on an old check-in that still has one.
    expect(presenceLabel({ verified: false, reason: 'too-far', distanceMeters: 140 })).toBe('Not verified: too far away');
    expect(presenceLabel({ verified: false, reason: 'weak-signal' })).toBe('Not verified: too weak a signal');
    expect(presenceLabel(null)).toBe(null);
  });
});

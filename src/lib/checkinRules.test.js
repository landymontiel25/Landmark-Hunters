import { describe, it, expect } from 'vitest';
import { radiusFor, measureCheckin, isNearEnough, checkinBlockReason, checkinLocationFields } from './checkinRules';
import { CHECKIN_RULE_METERS, CHECKIN_MAX_ACCURACY_METERS, REQUIRE_GPS_CHECKIN, ONBOARDING_FIRST_CHECKIN } from './maprConstants';
import { placesNearby } from './firstCheckIn';

// 1 degree of latitude is about 111195 m.
const place = { id: 'p', lat: 25.0, lng: -80.0 };
const at = (metersNorth, accuracy = 10) => ({ lat: 25.0 + metersNorth / 111195, lng: -80.0, accuracy });

describe('check-in rule constants', () => {
  it('ships with the rule OFF, a 30 m default and the first check-in on', () => {
    expect(REQUIRE_GPS_CHECKIN).toBe(false);
    expect(CHECKIN_RULE_METERS).toBe(30);
    expect(ONBOARDING_FIRST_CHECKIN).toBe(true);
  });
});

describe('radiusFor', () => {
  it('uses the default, and a venue keeps its own larger radius', () => {
    expect(radiusFor(place)).toBe(30);
    expect(radiusFor({ ...place, checkInRadiusMeters: 500 })).toBe(500);
  });
});

describe('measureCheckin', () => {
  it('computes whole-meter distance and the fix accuracy', () => {
    const m = measureCheckin(at(20, 8.46), place);
    expect(m.distanceMeters).toBeGreaterThanOrEqual(19);
    expect(m.distanceMeters).toBeLessThanOrEqual(21);
    expect(m.gpsAccuracyMeters).toBe(8.5);
  });
  it('is null when there is no fix or the place has no coordinates', () => {
    expect(measureCheckin(null, place)).toEqual({ distanceMeters: null, gpsAccuracyMeters: null });
    expect(measureCheckin(at(5), { id: 'x' }).distanceMeters).toBeNull();
  });
});

describe('checkinBlockReason (rule ON)', () => {
  const on = { required: true };
  it('allows a fix within 30 m and good accuracy', () => {
    expect(checkinBlockReason(at(25), place, on)).toBeNull();
  });
  it('refuses beyond 30 m, with no fix, or with a poor fix', () => {
    expect(checkinBlockReason(at(40), place, on)).toBe('too-far');
    expect(checkinBlockReason(null, place, on)).toBe('no-location');
    expect(checkinBlockReason(at(5, CHECKIN_MAX_ACCURACY_METERS + 1), place, on)).toBe('weak-signal');
  });
  it('a big venue accepts what its own radius allows', () => {
    expect(checkinBlockReason(at(300), { ...place, checkInRadiusMeters: 500 }, on)).toBeNull();
    expect(checkinBlockReason(at(600), { ...place, checkInRadiusMeters: 500 }, on)).toBe('too-far');
  });
  it('never refuses a rating-only claim', () => {
    expect(checkinBlockReason(null, place, { ...on, ratingOnly: true })).toBeNull();
  });
});

describe('checkinBlockReason (rule OFF)', () => {
  it('never refuses, wherever you are', () => {
    expect(checkinBlockReason(at(5000), place, { required: false })).toBeNull();
    expect(checkinBlockReason(null, place, { required: false })).toBeNull();
    // and the shipped default is off
    expect(checkinBlockReason(at(5000), place)).toBeNull();
  });
});

describe('checkinLocationFields', () => {
  it('rule OFF: saves distance and accuracy, always unverified (even when close)', () => {
    const f = checkinLocationFields(at(10, 6), place, { required: false });
    expect(f.verification).toBe('unverified');
    expect(f.distanceMeters).toBeGreaterThanOrEqual(9);
    expect(f.gpsAccuracyMeters).toBe(6);
  });
  it('rule ON: verified only when near enough', () => {
    expect(checkinLocationFields(at(10), place, { required: true }).verification).toBe('verified');
    expect(checkinLocationFields(at(80), place, { required: true }).verification).toBe('unverified');
  });
  it('unverified, with no numbers, when the distance cannot be computed', () => {
    expect(checkinLocationFields(null, place, { required: true })).toEqual({ verification: 'unverified' });
  });
});

describe('placesNearby (first check-in offers)', () => {
  const far = { id: 'far', lat: 25.01, lng: -80.0 };
  const big = { id: 'park', lat: 25.0, lng: -80.003, checkInRadiusMeters: 500 };
  it('offers only places inside their own radius, nearest first', () => {
    const list = placesNearby(at(10), [far, big, place]);
    expect(list.map((x) => x.landmark.id)).toEqual(['p', 'park']);
  });
  it('offers nothing when no place is near, or without a usable fix', () => {
    expect(placesNearby(at(10), [far])).toEqual([]);
    expect(placesNearby(null, [place])).toEqual([]);
    expect(placesNearby(at(5, 500), [place])).toEqual([]);
    expect(isNearEnough(at(5, 500), place)).toBe(false);
  });
});

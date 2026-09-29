// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
  MAX_PLAN_MESSAGE,
  TRIP_STEPS,
  composePlanMessage,
  isPlanCacheValid,
  planAnswersKey,
  readPlanCache,
  timeOfDayBucket,
  writePlanCache,
} from './tripPlanner';

afterEach(() => localStorage.clear());

describe('trip wizard steps', () => {
  it('asks location, mood, what sounds good, trip type, then plans', () => {
    expect(TRIP_STEPS).toEqual(['location', 'mood', 'pick', 'tripType', 'plan']);
  });
});

describe('composePlanMessage', () => {
  it('keeps the same core sentences the old card sent', () => {
    const msg = composePlanMessage({
      mood: 'energized',
      tripMode: 'group',
      startingLocation: '9 Station Rd',
      regionNames: ['Philadelphia'],
    });
    expect(msg).toBe(
      "Plan a trip for me. I'm in the mood for something energized and active. It's for a group. Starting from 9 Station Rd. In Philadelphia."
    );
  });

  it('adds the usual/new hints and the specific wish', () => {
    const usual = composePlanMessage({ pickType: 'usual', rankedNames: ['A', 'B'] });
    expect(usual).toContain('my usual kind of places, like: A, B.');
    const fresh = composePlanMessage({ pickType: 'new', rankedNames: ['C'], specific: 'rooftops', specificMatchNames: ['D'] });
    expect(fresh).toContain('something new that still fits my taste, like: C.');
    expect(fresh).toContain('Specifically: rooftops.');
    expect(fresh).toContain('Places that fit that: D.');
  });

  it('fits in one plan-ai turn by trimming hints, never the core', () => {
    const long = Array.from({ length: 20 }, (_, i) => `A Very Long Landmark Name Number ${i}`);
    const msg = composePlanMessage({
      mood: 'easygoing',
      tripMode: 'solo',
      startingLocation: 'x'.repeat(100),
      regionNames: ['Philadelphia', 'New York City'],
      pickType: 'usual',
      rankedNames: long,
      specific: 'y'.repeat(200),
      specificMatchNames: long,
    });
    expect(msg.length).toBeLessThanOrEqual(MAX_PLAN_MESSAGE);
    expect(msg).toContain("It's just me.");
    expect(msg).toContain('Specifically:');
  });
});

describe('plan cache', () => {
  const answersKey = planAnswersKey({ mood: 'energized', pickType: 'usual', specific: '', tripMode: 'solo', startingLocation: 'Home', regionIds: ['philly'] });
  const at = new Date(2026, 8, 29, 14, 0); // 2pm, afternoon
  const origin = { lat: 40.0, lng: -75.3 };
  const cache = { answersKey, message: 'Plan a trip for me.', origin, bucket: timeOfDayBucket(at), reply: { text: 'Here you go', stops: [] } };

  it('reuses the plan when nothing changed', () => {
    expect(isPlanCacheValid(cache, { answersKey, origin: { lat: 40.001, lng: -75.3 }, now: new Date(2026, 8, 29, 16, 30) })).toBe(true);
  });

  it('refreshes when any answer changes', () => {
    const other = planAnswersKey({ mood: 'easygoing', pickType: 'usual', specific: '', tripMode: 'solo', startingLocation: 'Home', regionIds: ['philly'] });
    expect(isPlanCacheValid(cache, { answersKey: other, origin, now: at })).toBe(false);
  });

  it('refreshes after moving half a mile or more', () => {
    // ~0.009 degrees of latitude is ~1 km (0.62 mi).
    expect(isPlanCacheValid(cache, { answersKey, origin: { lat: 40.009, lng: -75.3 }, now: at })).toBe(false);
    // ~0.006 degrees is ~0.41 mi.
    expect(isPlanCacheValid(cache, { answersKey, origin: { lat: 40.006, lng: -75.3 }, now: at })).toBe(true);
  });

  it('refreshes when the time of day moves on', () => {
    expect(isPlanCacheValid(cache, { answersKey, origin, now: new Date(2026, 8, 29, 18, 0) })).toBe(false);
    expect(isPlanCacheValid(cache, { answersKey, origin, now: new Date(2026, 8, 30, 14, 0) })).toBe(false);
  });

  it('treats 1am as the same night as 11pm', () => {
    expect(timeOfDayBucket(new Date(2026, 8, 29, 23, 0))).toBe(timeOfDayBucket(new Date(2026, 8, 30, 1, 0)));
    expect(timeOfDayBucket(new Date(2026, 8, 29, 9, 0))).toBe('2026-09-29:morning');
  });

  it('round-trips through device storage per account', () => {
    writePlanCache('u1', { answersKey, origin, message: 'm', reply: { text: 'r', stops: [] }, pickType: 'usual', now: at });
    expect(readPlanCache('u1')).toMatchObject({ answersKey, message: 'm', pickType: 'usual', bucket: timeOfDayBucket(at) });
    expect(readPlanCache('u2')).toBe(null);
  });
});

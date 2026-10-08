import { describe, it, expect } from 'vitest';
import { regionTimezone, tzAbbrev, toZonedInputValue, fromZonedInputValue } from './timezones';
import { REGIONS } from '../data/regions';

describe('regionTimezone', () => {
  it('maps known regions to their real IANA timezone', () => {
    expect(regionTimezone('miami')).toBe('America/New_York');
    expect(regionTimezone('san-francisco')).toBe('America/Los_Angeles');
    expect(regionTimezone('switzerland')).toBe('Europe/Zurich');
    expect(regionTimezone('frankfurt')).toBe('Europe/Berlin');
    expect(regionTimezone('paris')).toBe('Europe/Paris');
  });

  it('has an exact zone for every single-place region', () => {
    const missing = REGIONS.filter((r) => !r.worldwide).map((r) => r.id).filter((id) => regionTimezone(id, 0) === 'Etc/UTC');
    expect(missing).toEqual([]);
  });

  it('falls back to the browser timezone for an unknown region with no longitude', () => {
    expect(regionTimezone('nowhere')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('estimates a fixed-offset zone from longitude for a worldwide region (F1 circuits)', () => {
    // Suzuka, Japan -- ~136.5E -> UTC+9.
    expect(regionTimezone('f1-circuits', 136.5)).toBe('Etc/GMT-9');
    // Silverstone, UK -- ~-1W, close enough to round to UTC.
    expect(regionTimezone('f1-circuits', -1)).toBe('Etc/UTC');
    // Circuit of the Americas, Austin -- ~-97.6W -> UTC-6ish.
    expect(regionTimezone('f1-circuits', -97.6)).toBe('Etc/GMT+7');
  });

  it('prefers the exact region mapping over longitude when both are given', () => {
    expect(regionTimezone('miami', 136.5)).toBe('America/New_York');
  });
});

describe('tzAbbrev', () => {
  it('gives a short, DST-aware label', () => {
    // Jan 1 is standard time in the US -- EST, not EDT.
    expect(tzAbbrev('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe('EST');
    // July is daylight time.
    expect(tzAbbrev('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe('EDT');
  });
});

describe('toZonedInputValue / fromZonedInputValue round-trip', () => {
  it('reads a known UTC instant as the correct Miami wall-clock time', () => {
    // 2026-07-15 12:00 UTC is 08:00 EDT (UTC-4) in Miami.
    const seconds = Date.UTC(2026, 6, 15, 12, 0) / 1000;
    expect(toZonedInputValue(seconds, 'America/New_York')).toBe('2026-07-15T08:00');
  });

  it('converts a Miami wall-clock string back to the correct UTC instant', () => {
    const date = fromZonedInputValue('2026-07-15T08:00', 'America/New_York');
    expect(date.toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('round-trips through winter (standard time, UTC-5) too', () => {
    const value = '2026-01-15T09:30';
    const date = fromZonedInputValue(value, 'America/New_York');
    expect(toZonedInputValue(Math.floor(date.getTime() / 1000), 'America/New_York')).toBe(value);
  });

  it('round-trips for a non-US zone (Switzerland, UTC+1/+2)', () => {
    const value = '2026-08-01T14:15';
    const date = fromZonedInputValue(value, 'Europe/Zurich');
    expect(toZonedInputValue(Math.floor(date.getTime() / 1000), 'Europe/Zurich')).toBe(value);
  });

  it('returns an empty string for a falsy seconds value', () => {
    expect(toZonedInputValue(0, 'America/New_York')).toBe('');
    expect(toZonedInputValue(null, 'America/New_York')).toBe('');
  });
});

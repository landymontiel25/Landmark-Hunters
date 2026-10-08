import { describe, it, expect } from 'vitest';
import { dayKey, previousDayKey, localDayKey, validClientDayKey } from './streakDay.js';

describe('localDayKey', () => {
  it('matches the machine-local dayKey when given that machine\'s own timezone', () => {
    const t = new Date('2026-03-10T12:00:00Z').getTime();
    // process.env.TZ isn't pinned in this suite, so compare against whatever
    // the actual running machine resolves for "its own" IANA zone -- this is
    // really just proving localDayKey(t, myZone) === dayKey(new Date(t)).
    const myZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(localDayKey(t, myZone)).toBe(dayKey(new Date(t)));
  });

  it('buckets a late-evening US-Eastern moment into the SAME local day even though it is already tomorrow in UTC', () => {
    // 11:30pm US-Eastern (EST, UTC-5, no DST in January) on Jan 9th is
    // 4:30am UTC on Jan 10th -- this is exactly the case that broke the
    // original solo-streak seed: a server always running in UTC would call
    // this "the 10th", but the traveler who made this check-in still calls
    // it "the 9th".
    const t = new Date('2026-01-10T04:30:00Z').getTime(); // 2026-01-09T23:30:00 US-Eastern
    const eastern = localDayKey(t, 'America/New_York');
    const utc = localDayKey(t, 'UTC');
    expect(eastern).not.toBe(utc);
    expect(eastern).toBe(dayKey(new Date(2026, 0, 9)));
    expect(utc).toBe(dayKey(new Date(2026, 0, 10)));
  });

  it('two consecutive real-world days stay two consecutive local days in a non-UTC zone', () => {
    const day1 = localDayKey(new Date('2026-01-10T04:30:00Z').getTime(), 'America/New_York'); // 2026-01-09 local
    const day2 = localDayKey(new Date('2026-01-11T04:30:00Z').getTime(), 'America/New_York'); // 2026-01-10 local
    expect(previousDayKey(day2)).toBe(day1);
  });

  it('falls back to the machine-local reading for a missing/invalid timeZone instead of throwing', () => {
    const t = Date.now();
    expect(() => localDayKey(t, undefined)).not.toThrow();
    expect(() => localDayKey(t, 'Not/AZone')).not.toThrow();
    expect(localDayKey(t, undefined)).toBe(dayKey(new Date(t)));
  });
});

describe('validClientDayKey', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  it('accepts yesterday, today and tomorrow (timezone spread)', () => {
    for (const k of ['2026-8-30', '2026-9-1', '2026-9-2']) expect(validClientDayKey(k, now)).toBe(k);
  });
  it('rejects forged, far-off or malformed days', () => {
    for (const k of ['2020-0-1', '2026-9-9', '2026-9-31', 'x', '', null, undefined, 5, '2026-9-1; DROP']) {
      expect(validClientDayKey(k, now)).toBe(null);
    }
  });
  it('rejects keys that roll over to another date or are not canonical', () => {
    const now = new Date(Date.UTC(2026, 2, 2, 12));
    expect(validClientDayKey('2026-1-31', now)).toBe(null);
    expect(validClientDayKey('2026-02-02', now)).toBe(null);
    expect(validClientDayKey('2026-2-2', now)).toBe('2026-2-2');
  });
});

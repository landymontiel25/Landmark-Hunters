import { describe, it, expect } from 'vitest';
import { periodKeysAt } from './periods.js';
import { periodKeys } from './leaderboard.js';

describe('periodKeysAt', () => {
  it('matches the app\'s own periodKeys in the device time zone', () => {
    for (const ms of [Date.UTC(2026, 0, 1, 3), Date.UTC(2026, 9, 12, 23, 30), Date.UTC(2026, 11, 31, 12), Date.UTC(2027, 0, 3, 1)]) {
      expect(periodKeysAt(ms, new Date(ms).getTimezoneOffset())).toEqual(periodKeys(new Date(ms)));
    }
  });
  it('follows the viewer\'s calendar: 11 pm on Dec 31 in New York is still that year', () => {
    expect(periodKeysAt(Date.UTC(2027, 0, 1, 4), 300)).toMatchObject({ yearly: '2026', monthly: '2026-12' });
    expect(periodKeysAt(Date.UTC(2027, 0, 1, 4), 0)).toMatchObject({ yearly: '2027' });
  });
});

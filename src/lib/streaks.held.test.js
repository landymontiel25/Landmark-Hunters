import { describe, it, expect } from 'vitest';
import { isDayHeld } from './streaks';

describe('isDayHeld', () => {
  it('is true for a day that was closed', () => {
    expect(isDayHeld({ lastCompletedDay: '2026-9-1', frozenDays: [] }, '2026-9-1')).toBe(true);
  });
  it('is true for a day a freeze was spent on', () => {
    expect(isDayHeld({ lastCompletedDay: '2026-8-29', frozenDays: ['2026-9-1'] }, '2026-9-1')).toBe(true);
  });
  it('is false when neither happened, or there is no streak', () => {
    expect(isDayHeld({ lastCompletedDay: '2026-8-30' }, '2026-9-1')).toBe(false);
    expect(isDayHeld(null, '2026-9-1')).toBe(false);
  });
});

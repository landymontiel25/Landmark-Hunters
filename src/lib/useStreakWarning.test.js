import { describe, it, expect } from 'vitest';
import { inStreakWarningWindow } from './useStreakWarning';

describe('streak warning window', () => {
  it('stays quiet until 5 hours are left in the day', () => {
    expect(inStreakWarningWindow(new Date(2026, 9, 13, 9, 0))).toBe(false);
    expect(inStreakWarningWindow(new Date(2026, 9, 13, 18, 59))).toBe(false);
  });

  it('warns in the last 5 hours', () => {
    expect(inStreakWarningWindow(new Date(2026, 9, 13, 19, 0))).toBe(true);
    expect(inStreakWarningWindow(new Date(2026, 9, 13, 23, 30))).toBe(true);
  });
});

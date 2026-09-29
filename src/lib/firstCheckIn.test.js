import { describe, it, expect } from 'vitest';
import { REQUIRE_FIRST_CHECKIN, needsFirstCheckIn } from './firstCheckIn';

describe('needsFirstCheckIn', () => {
  it('is on', () => {
    expect(REQUIRE_FIRST_CHECKIN).toBe(true);
  });

  it('new users with no check-ins need one', () => {
    expect(needsFirstCheckIn(0)).toBe(true);
  });

  it('existing users with at least one check-in skip it, however new the account is', () => {
    expect(needsFirstCheckIn(1)).toBe(false);
    expect(needsFirstCheckIn(40)).toBe(false);
  });

  it('never guesses from an unknown count', () => {
    expect(needsFirstCheckIn(null)).toBe(false);
  });

  it('turns off with the constant', () => {
    expect(needsFirstCheckIn(0, false)).toBe(false);
  });
});

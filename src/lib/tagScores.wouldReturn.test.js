import { describe, it, expect } from 'vitest';
import { ratingDelta, WOULD_RETURN_DELTAS } from './tagScores';

describe('"Would you come back?" leads (owner, 2026-11-23)', () => {
  it('"Probably not" now steps away from places like it, half of "Never again"', () => {
    expect(WOULD_RETURN_DELTAS['probably-not']).toBeLessThan(0);
    expect(WOULD_RETURN_DELTAS['probably-not']).toBe(WOULD_RETURN_DELTAS['never-again'] / 2);
  });
  it('it outweighs the tier: loved it but "Probably not" comes out negative; "Yes!" lifts an ok', () => {
    expect(ratingDelta('highly-recommend', 'probably-not')).toBeLessThan(0);
    expect(ratingDelta('worth-trying', 'yes')).toBeGreaterThan(ratingDelta('worth-trying'));
  });
});

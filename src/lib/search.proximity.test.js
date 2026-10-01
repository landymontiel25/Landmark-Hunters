import { describe, it, expect } from 'vitest';
import { proximityBonus, searchScore } from './search';

describe('proximityBonus', () => {
  it('favors places near the user and ignores far ones', () => {
    expect(proximityBonus(5000)).toBeGreaterThan(proximityBonus(100000));
    expect(proximityBonus(100000)).toBeGreaterThan(proximityBonus(500000));
    expect(proximityBonus(7000000)).toBe(0);
    expect(proximityBonus(undefined)).toBe(0);
  });
  it('lets a nearby equal match outrank a far one', () => {
    const base = searchScore('Far Cafe', '', 'far');
    expect(base + proximityBonus(2000)).toBeGreaterThan(base + proximityBonus(7000000));
  });
});

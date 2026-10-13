import { describe, it, expect } from 'vitest';
import { badgeLabel, levelsOf } from './reputationLabels.js';

describe('reputation labels', () => {
  it('lists levels best first, as words', () => {
    expect(levelsOf({ levels: { villanova: 'Local', philly: 'Trusted', x: 'Bogus' } }).map((l) => l.label)).toEqual(['Trusted in Philadelphia', 'Local in Villanova University']);
    expect(levelsOf(null)).toEqual([]);
  });
  it('names badges', () => {
    expect(badgeLabel('first-find').text).toBe('First find');
    expect(badgeLabel('went-10').text).toBe('10 went because of you');
    expect(badgeLabel('trusted-philly').text).toBe('Trusted in Philadelphia');
    expect(badgeLabel('founding-philly').text).toBe('Founding discoverer, Philadelphia');
    expect(badgeLabel('nope')).toBeNull();
  });
});

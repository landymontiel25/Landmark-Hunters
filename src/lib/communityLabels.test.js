import { describe, it, expect } from 'vitest';
import { foundByLine, foundByPeopleLikeYou } from './communityLabels.js';

describe('foundByLine', () => {
  it('names the finder and why, never a number', () => {
    expect(foundByLine({ community: { likeYou: true, finder: { name: 'Ana', match: 'High' } } })).toBe('Found by Ana · verified visit · Taste match: High');
    expect(foundByLine({ community: { likeYou: true, finder: { name: 'Bo', relation: 'follow' } } })).toBe('Found by Bo · verified visit · you follow them');
    expect(foundByLine({ community: { likeYou: true, finder: { name: 'Cy', relation: 'friend' } } })).toBe('Found by Cy · verified visit · your friend');
    expect(foundByLine({ community: { likeYou: false, finder: { name: 'Dee' } } })).toBeNull();
    expect(foundByLine({})).toBeNull();
  });
});

describe('foundByPeopleLikeYou', () => {
  it('keeps places people like you found', () => {
    const community = { philly: { places: { a: { likeYou: true }, b: { likeYou: false } } } };
    expect(foundByPeopleLikeYou([{ id: 'a', regionId: 'philly' }, { id: 'b', regionId: 'philly' }, { id: 'c', regionId: 'philly' }], community).map((p) => p.id)).toEqual(['a']);
    expect(foundByPeopleLikeYou([{ id: 'a', regionId: 'philly' }], null)).toEqual([]);
  });
});

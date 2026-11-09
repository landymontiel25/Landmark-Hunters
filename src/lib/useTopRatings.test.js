import { describe, it, expect, vi } from 'vitest';

vi.mock('./landmarkRatings', () => ({ loadLandmarkRatings: vi.fn() }));
const { topCandidates, TOP_RANK_MAX } = await import('./useTopRatings');

describe('topCandidates (which places Top Landmarks looks up on Google)', () => {
  const lm = (id, extra = {}) => ({ id, regionId: 'miami', ...extra });
  it('looks up every place in a city that fits the cap', () => {
    const miami = Array.from({ length: TOP_RANK_MAX - 1 }, (_, i) => lm(`p${i}`));
    expect(topCandidates(miami)).toHaveLength(TOP_RANK_MAX - 1);
  });
  it('past the cap, hand-picked places go first, then imported ones', () => {
    const imported = Array.from({ length: TOP_RANK_MAX }, (_, i) => lm(`osm-w${i}`, { source: 'osm' }));
    const out = topCandidates([...imported, lm('vizcaya'), lm('wynwood-walls')]);
    expect(out).toHaveLength(TOP_RANK_MAX);
    expect(out.slice(0, 2).map((l) => l.id)).toEqual(['vizcaya', 'wynwood-walls']);
  });
});

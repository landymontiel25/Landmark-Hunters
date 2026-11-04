import { describe, it, expect } from 'vitest';
import { ratedScore } from './topRated';

// Owner, 2026-10-18: Popular became an order by reviews.
describe('Top Rated order', () => {
  const g = (rating, count) => ({ google: { rating, count } });
  it('weights stars by review count', () => {
    const google = { gusman: g(4.8, 103), cosford: g(4.5, 126), jerry: g(4.7, 15), mound: g(5.0, 2) };
    const order = ['mound', 'jerry', 'cosford', 'gusman'].sort((a, b) => ratedScore({ id: b }, google, {}) - ratedScore({ id: a }, google, {}));
    expect(order).toEqual(['gusman', 'cosford', 'jerry', 'mound']);
  });
  it("falls back to the app's ratings, else no score", () => {
    expect(ratedScore({ id: 'x' }, {}, { x: { avg: 5, count: 3 } })).toBeGreaterThan(4);
    expect(ratedScore({ id: 'y' }, {}, {})).toBeNull();
  });
});

import { topCandidates, topLandmarksOrder, isRestaurantOrMall, TOP_CANDIDATES } from './topRated';

// Owner, 2026-11-04: Top Landmarks lists every landmark, best weighted rating
// first (not only the few over a review bar), with Miami malls last.
describe('Top Landmarks', () => {
  const lm = (id, name = id, extra = {}) => ({ id, name, categories: [], ...extra });
  const g = (rating, count) => ({ google: { rating, count } });
  const popular = () => 0;
  const ids = (a) => a.map((l) => l.id);

  it('lists every landmark, rated ones best first, unrated ones after', () => {
    const all = [lm('none'), lm('gesu'), lm('vizcaya'), lm('mound')];
    const google = { gesu: g(4.4, 1306), vizcaya: g(4.7, 12000), mound: g(5.0, 2) };
    expect(ids(topLandmarksOrder(all, google, popular))).toEqual(['vizcaya', 'gesu', 'mound', 'none']);
  });

  it("uses the app's own ratings where Google has none, and popularity among the unrated", () => {
    const all = [lm('a'), lm('b'), lm('own')];
    const pop = (l) => (l.id === 'b' ? 5 : 0);
    expect(ids(topLandmarksOrder(all, {}, pop, { own: { avg: 4.9, count: 50 } }))).toEqual(['own', 'b', 'a']);
  });

  it('puts Miami malls last, even with the best score or no Google data', () => {
    const mall = lm('dolphin-mall', 'Dolphin Mall', { regionId: 'miami', mall: true });
    const all = [mall, lm('vizcaya'), lm('fairchild')];
    const google = { 'dolphin-mall': g(4.9, 90000), vizcaya: g(4.7, 12000), fairchild: g(4.5, 6000) };
    expect(ids(topLandmarksOrder(all, google, popular))).toEqual(['vizcaya', 'fairchild', 'dolphin-mall']);
    expect(ids(topLandmarksOrder([mall, lm('x')], {}, (l) => (l.id === 'dolphin-mall' ? 9 : 0)))).toEqual(['x', 'dolphin-mall']);
  });

  it('leaves malls in other regions where they score', () => {
    const mall = lm('kop', 'King of Prussia', { regionId: 'philly', mall: true });
    const google = { kop: g(4.9, 90000), a: g(4.5, 60000) };
    expect(ids(topLandmarksOrder([lm('a'), mall], google, popular))).toEqual(['kop', 'a']);
  });

  it('asks Google about the most popular places, airports aside, up to the cap', () => {
    const many = Array.from({ length: TOP_CANDIDATES + 20 }, (_, i) => lm(`p${i}`));
    const pop = (l) => 1000 - Number(l.id.slice(1));
    const cands = topCandidates([lm('airport', 'Airport', { categories: ['airports'] }), ...many], pop);
    expect(cands).toHaveLength(TOP_CANDIDATES);
    expect(ids(cands)).not.toContain('airport');
    expect(cands[0].id).toBe('p0');
  });
});

// Owner, 2026-11-05: restaurants and malls are not top landmarks.
describe('restaurants and malls', () => {
  it('counts food places and malls, nothing else', () => {
    expect(isRestaurantOrMall({ categories: ['food'] })).toBe(true);
    expect(isRestaurantOrMall({ categories: ['shopping'], mall: true })).toBe(true);
    expect(isRestaurantOrMall({ categories: ['shopping'] })).toBe(false);
    expect(isRestaurantOrMall({ categories: ['history-culture'] })).toBe(false);
    expect(isRestaurantOrMall(null)).toBe(false);
  });
});

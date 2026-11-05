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

import { topLandmarksOrder, isRestaurantOrMall, popularityOf } from './topRated';

// Owner, 2026-11-04: Top Landmarks lists every landmark (not only the few over
// a review bar), with Miami malls last. Since 2026-11-05 the order is the
// catalog popularity first (see the popularity tests below), then rating.
describe('Top Landmarks', () => {
  const lm = (id, name = id, extra = {}) => ({ id, name, categories: [], ...extra });
  const g = (rating, count) => ({ google: { rating, count } });
  const ids = (a) => a.map((l) => l.id);

  it('lists every landmark, rated ones best first, unrated ones after', () => {
    const all = [lm('none'), lm('gesu'), lm('vizcaya'), lm('mound')];
    const google = { gesu: g(4.4, 1306), vizcaya: g(4.7, 12000), mound: g(5.0, 2) };
    expect(ids(topLandmarksOrder(all, google))).toEqual(['vizcaya', 'gesu', 'mound', 'none']);
  });

  it("uses the app's own ratings where Google has none, among places equally popular", () => {
    const all = [lm('a'), lm('b'), lm('own')];
    expect(ids(topLandmarksOrder(all, {}, { own: { avg: 4.9, count: 50 } }))).toEqual(['own', 'a', 'b']);
  });

  it('puts Miami malls last, even with the best score or no Google data', () => {
    const mall = lm('dolphin-mall', 'Dolphin Mall', { regionId: 'miami', mall: true });
    const all = [mall, lm('vizcaya'), lm('fairchild')];
    const google = { 'dolphin-mall': g(4.9, 90000), vizcaya: g(4.7, 12000), fairchild: g(4.5, 6000) };
    expect(ids(topLandmarksOrder(all, google))).toEqual(['vizcaya', 'fairchild', 'dolphin-mall']);
    const popularMall = lm('dolphin-mall', 'Dolphin Mall', { regionId: 'miami', mall: true, popularity: 9 });
    expect(ids(topLandmarksOrder([popularMall, lm('x')], {}))).toEqual(['x', 'dolphin-mall']);
  });

  it('leaves malls in other regions where they score', () => {
    const mall = lm('kop', 'King of Prussia', { regionId: 'philly', mall: true });
    const google = { kop: g(4.9, 90000), a: g(4.5, 60000) };
    expect(ids(topLandmarksOrder([lm('a'), mall], google))).toEqual(['kop', 'a']);
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

// Owner, 2026-11-05: Top Landmarks go by how many people go to a place (the
// catalog's popularity score), not by the app's own check-ins: with a few
// testers those put Actors' Playhouse above Ocean Drive.
describe('Top Landmarks by popularity', () => {
  const lm = (id, popularity, extra = {}) => ({ id, name: id, regionId: 'miami', categories: [], popularity, ...extra });
  const g = (rating, count) => ({ google: { rating, count } });
  const ids = (a) => a.map((l) => l.id);
  it('puts the most popular place first, whatever the rating', () => {
    const all = [lm('actors-playhouse', 5), lm('ocean-drive', 10), lm('miracle-mile', 5)];
    const google = { 'actors-playhouse': g(4.9, 5000), 'ocean-drive': g(4.2, 800), 'miracle-mile': g(4.6, 900) };
    expect(ids(topLandmarksOrder(all, google))[0]).toBe('ocean-drive');
  });
  it('breaks ties by rating', () => {
    const all = [lm('a', 7), lm('b', 7)];
    expect(ids(topLandmarksOrder(all, { a: g(4.0, 500), b: g(4.8, 500) }))).toEqual(['b', 'a']);
  });
  it('breaks the rest by name, and treats a missing popularity as 0', () => {
    expect(ids(topLandmarksOrder([lm('b', 3), lm('a', 3), lm('none', undefined)], {}))).toEqual(['a', 'b', 'none']);
  });
  it('still puts Miami malls last', () => {
    const all = [lm('dolphin-mall', 10, { mall: true }), lm('x', 1)];
    expect(ids(topLandmarksOrder(all, {}))).toEqual(['x', 'dolphin-mall']);
  });
  it('reads a place popularity as a number', () => {
    expect(popularityOf(lm('a', 8))).toBe(8);
    expect(popularityOf(lm('a', undefined))).toBe(0);
    expect(popularityOf(null)).toBe(0);
  });
});

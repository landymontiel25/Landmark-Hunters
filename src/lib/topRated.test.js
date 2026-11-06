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

import { topLandmarksOrder, isRestaurantOrMall } from './topRated';

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
describe('Top Landmarks by number of Google reviews (owner, 2026-11-06)', () => {
  const lm = (id, extra = {}) => ({ id, name: id, regionId: 'miami', categories: [], ...extra });
  const g = (rating, count) => ({ google: { rating, count } });
  const ids = (a) => a.map((l) => l.id);
  it('puts the place with the most reviews first, whatever the stars', () => {
    const all = [lm('ball-and-chain'), lm('bayfront-park'), lm('small')];
    const google = { 'ball-and-chain': g(4.6, 10138), 'bayfront-park': g(4.7, 21895), small: g(5.0, 40) };
    expect(ids(topLandmarksOrder(all, google))).toEqual(['bayfront-park', 'ball-and-chain', 'small']);
  });
  it('ignores the hand-typed popularity score', () => {
    const all = [lm('typed-ten', { popularity: 10 }), lm('reviewed', { popularity: 1 })];
    expect(ids(topLandmarksOrder(all, { 'typed-ten': g(4.9, 100), reviewed: g(4.1, 9000) }))).toEqual(['reviewed', 'typed-ten']);
  });
  it('breaks a tie on reviews by stars', () => {
    expect(ids(topLandmarksOrder([lm('a'), lm('b')], { a: g(4.0, 500), b: g(4.8, 500) }))).toEqual(['b', 'a']);
  });
  it('places Google has no answer for follow: app-rated ones first, then by name', () => {
    const all = [lm('zeta'), lm('alpha'), lm('app'), lm('google')];
    expect(ids(topLandmarksOrder(all, { google: g(4, 3) }, { app: { avg: 5, count: 2 } }))).toEqual(['google', 'app', 'alpha', 'zeta']);
  });
  it('still puts Miami malls last', () => {
    const all = [lm('dolphin-mall', { mall: true }), lm('x')];
    expect(ids(topLandmarksOrder(all, { 'dolphin-mall': g(4.5, 90000), x: g(4, 10) }))).toEqual(['x', 'dolphin-mall']);
  });
});

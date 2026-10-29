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

import { topScore, topReviewBar, topCandidates, topLandmarksOrder, TOP_CANDIDATES } from './topRated';

// Owner, 2026-10-29: Pinecrest Gardens was top 5 and Gesu Catholic Church
// was on the list; rank by rating and review volume, and drop thin places.
describe('Top Landmarks', () => {
  const lm = (id, name = id, categories = []) => ({ id, name, categories });
  const g = (rating, count) => ({ google: { rating, count } });
  const popular = () => 0;

  it('scores rating times the log of the review count', () => {
    expect(topScore(4.8, 8290)).toBeGreaterThan(topScore(4.6, 2000));
    expect(topScore(4.6, 2000)).toBeGreaterThan(topScore(4.9, 300));
  });

  it('puts the 8,000-review places above Pinecrest Gardens', () => {
    const cands = [lm('pinecrest'), lm('southpointe'), lm('fairchild'), lm('vizcaya')];
    const google = { pinecrest: g(4.6, 3200), southpointe: g(4.8, 8290), fairchild: g(4.8, 6102), vizcaya: g(4.7, 12000) };
    expect(topLandmarksOrder(cands, google, popular).map((l) => l.id)).toEqual(['vizcaya', 'southpointe', 'fairchild', 'pinecrest']);
  });

  it('drops a place under the review bar, and the bar is a quarter of the biggest count within 200 to 2,000', () => {
    const cands = [lm('big'), lm('gesu')];
    expect(topLandmarksOrder(cands, { big: g(4.8, 8290), gesu: g(4.8, 1306) }, popular).map((l) => l.id)).toEqual(['big']);
    expect(topReviewBar(8290)).toBe(2000);
    expect(topReviewBar(600)).toBe(200);
    expect(topReviewBar(0)).toBe(200);
    // A small city keeps its best places.
    expect(topLandmarksOrder([lm('a'), lm('b')], { a: g(4.7, 400), b: g(4.5, 120) }, popular).map((l) => l.id)).toEqual(['a']);
  });

  it('keeps the popularity order when Google answered for nobody', () => {
    const cands = [lm('x'), lm('y')];
    expect(topLandmarksOrder(cands, {}, popular)).toBe(cands);
  });

  it('asks about at most 40 popular places and never an airport', () => {
    const many = Array.from({ length: 60 }, (_, i) => lm(`p${i}`, `P${String(i).padStart(2, '0')}`));
    many.push(lm('mia', 'Miami International Airport', ['airports']));
    const pop = (l) => (l.id === 'mia' ? 100 : Number(l.id.slice(1)) || 0);
    const cands = topCandidates(many, pop);
    expect(cands).toHaveLength(TOP_CANDIDATES);
    expect(cands.some((l) => l.id === 'mia')).toBe(false);
    expect(cands[0].id).toBe('p59');
  });
});

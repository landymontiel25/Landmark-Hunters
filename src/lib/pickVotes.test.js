import { describe, it, expect } from 'vitest';
import { applyVote, rebuildTagScores, VOTE_DELTAS, TAG_DELTAS } from './tagScores';
import { computeTasteConfidence, votesAsReviews } from './tasteProfile';

describe('Mapr Picks votes feed taste', () => {
  it('moves tag scores lighter than a rating, without counting as a rating', () => {
    const next = applyVote({ scores: { food: 10 }, at: {} }, ['food'], 'yes', Date.now());
    expect(next.scores.food).toBe(10 + VOTE_DELTAS.yes);
    expect(next.counts).toEqual({});
    expect(VOTE_DELTAS.yes).toBeLessThan(TAG_DELTAS['highly-recommend']);
    expect(applyVote({}, ['food'], 'unsure', Date.now()).scores).toEqual({});
  });

  it('replays votes alongside reviews in time order', () => {
    const t = Date.UTC(2026, 8, 1);
    const out = rebuildTagScores(
      [{ region: 'miami', categories: ['food'], ratingTier: 'highly-recommend', updatedAtMs: t }],
      [
        { region: 'miami', categories: ['food'], verdict: 'yes', at: t + 1000 },
        { region: 'miami', categories: ['stadiums'], verdict: 'no', at: t + 2000 },
        { region: 'miami', categories: ['sports'], verdict: 'unsure', at: t + 3000 },
      ]
    );
    expect(out.tagScores.miami.food).toBeCloseTo(TAG_DELTAS['highly-recommend'] + VOTE_DELTAS.yes, 3);
    expect(out.tagScores.miami.stadiums).toBeCloseTo(VOTE_DELTAS.no, 3);
    expect(out.tagScores.miami.sports).toBeUndefined();
    expect(out.tagCounts.miami).toEqual({ food: 1 });
  });

  it('counts consistent votes toward the Taste Profile score', () => {
    const vote = (id, cat, verdict) => ({ landmarkId: id, categories: [cat], verdict, name: id, at: Date.now() });
    const feedback = {};
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => (feedback[id] = vote(id, 'food', 'yes')));
    ['f', 'g', 'h', 'i', 'j'].forEach((id) => (feedback[id] = vote(id, 'stadiums', 'no')));
    ['k', 'l', 'm'].forEach((id) => (feedback[id] = vote(id, 'history-culture', 'yes')));
    ['n', 'o', 'p'].forEach((id) => (feedback[id] = vote(id, 'local-life', 'no')));
    feedback.q = { landmarkId: 'q', categories: ['food'], verdict: 'unsure' };
    const asReviews = votesAsReviews(feedback, new Set(['a']));
    expect(asReviews).toHaveLength(15);
    expect(asReviews.every((r) => r.weight === 0.5)).toBe(true);
    expect(computeTasteConfidence([]).confidence).toBe(0);
    expect(computeTasteConfidence(asReviews).confidence).toBeGreaterThan(50);
  });
});

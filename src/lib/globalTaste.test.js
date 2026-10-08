// One taste per traveler (tagScores.GLOBAL_TASTE): what you think of museums
// in Miami is what Mapr assumes in Paris.
import { describe, it, expect } from 'vitest';
import {
  GLOBAL_TASTE,
  IGNORE_LIMIT,
  TAG_DELTAS,
  applyRating,
  effectiveTagScores,
  hasGlobalTaste,
  localRatingCount,
  rebuildGlobalTaste,
  settleShownPicks,
} from './tagScores';
import { planLearning } from './maprLearning';
import { seedTagScores } from './onboardingSave';
import { ALL_SWIPE_CARDS } from './onboardingCards';
import { ALL_LANDMARKS } from '../data/regions';

const NOW = Date.UTC(2026, 9, 5);

describe('effectiveTagScores with one overall taste', () => {
  it('reads the overall map in every city, ignoring the old per-city ones', () => {
    const profile = {
      tagScores: { all: { 'art-museums': -20 }, miami: { 'art-museums': 40 } },
      tagScoresAt: { all: { 'art-museums': NOW }, miami: { 'art-museums': NOW } },
      tagCounts: { all: { 'art-museums': 2 } },
    };
    expect(effectiveTagScores(profile, 'miami', NOW)['art-museums']).toBe(-20);
    expect(effectiveTagScores(profile, 'paris', NOW)['art-museums']).toBe(-20);
    expect(localRatingCount(profile, 'paris')).toBe(2);
  });

  it('keeps the per-city behavior for an account not moved yet', () => {
    const profile = { tagScores: { miami: { food: 30 } }, tagScoresAt: { miami: { food: NOW } } };
    expect(hasGlobalTaste(profile)).toBe(false);
    expect(effectiveTagScores(profile, 'miami', NOW).food).toBe(30);
  });

  it('an empty overall map still counts as moved', () => {
    expect(hasGlobalTaste({ tagScores: { all: {} } })).toBe(true);
  });
});

describe('rebuildGlobalTaste', () => {
  it('replays ratings from every city into one map, oldest first', () => {
    const reviews = [
      { region: 'miami', categories: ['art-museums'], ratingTier: 'probably-skip', ratedAt: NOW - 2000 },
      { region: 'paris', categories: ['art-museums'], ratingTier: 'probably-skip', ratedAt: NOW - 1000 },
      { region: 'paris', categories: ['food'], ratingTier: 'highly-recommend', ratedAt: NOW - 500 },
    ];
    const m = rebuildGlobalTaste({ reviews, nowMs: NOW });
    let want = { scores: {}, at: {}, counts: {} };
    for (const r of reviews) {
      const next = applyRating(want, r.categories, r.ratingTier, r.ratedAt);
      want = { scores: { ...want.scores, ...next.scores }, at: { ...want.at, ...next.at }, counts: { ...want.counts, ...next.counts } };
    }
    expect(m.scores['art-museums']).toBeCloseTo(want.scores['art-museums'], 5);
    expect(m.scores['art-museums']).toBeLessThan(TAG_DELTAS['probably-skip'] + 1); // both dislikes count
    expect(m.counts['art-museums']).toBe(2);
    expect(m.scores.food).toBeGreaterThan(0);
  });

  it('applies the sign-up swipes once, plus votes and comment deltas', () => {
    const m = rebuildGlobalTaste({
      reviews: [{ region: 'miami', categories: ['food'], ratingTier: 'worth-trying', ratedAt: NOW, comment: 'great' }],
      votes: [{ region: 'paris', categories: ['parks-nature'], verdict: 'yes', at: NOW - 10 }],
      seedDeltas: { entertainment: 10 },
      seedAtMs: NOW,
      commentDeltas: () => ({ food: 2 }),
      nowMs: NOW,
    });
    expect(m.scores.entertainment).toBe(10);
    expect(m.scores['parks-nature']).toBeGreaterThan(0);
    expect(m.counts['parks-nature']).toBeUndefined(); // a vote isn't a rating
    const plain = rebuildGlobalTaste({ reviews: [{ region: 'miami', categories: ['food'], ratingTier: 'worth-trying', ratedAt: NOW }], nowMs: NOW });
    expect(m.scores.food).toBeCloseTo((plain.scores.food || 0) + 2, 5);
  });

  it('gives a new account an empty map', () => {
    expect(rebuildGlobalTaste({ nowMs: NOW })).toEqual({ scores: {}, at: {}, counts: {} });
  });
});

describe('live learning writes the overall taste too', () => {
  const LM = { id: 'lm1', region: 'miami', categories: ['art-museums'] };
  it('a rating in Miami moves both the Miami map and the overall one', () => {
    const user = { tagScores: { all: {} } };
    const { userPatch } = planLearning({ user, landmark: LM, next: { rating: { tier: 'probably-skip' } }, nowMs: NOW });
    expect(userPatch.tagScores.miami['art-museums']).toBeLessThan(0);
    expect(userPatch.tagScores[GLOBAL_TASTE]['art-museums']).toBe(userPatch.tagScores.miami['art-museums']);
    expect(userPatch.tagCounts[GLOBAL_TASTE]['art-museums']).toBe(1);
  });

  it('an account not moved yet only gets the city map', () => {
    const { userPatch } = planLearning({ user: {}, landmark: LM, next: { rating: { tier: 'probably-skip' } }, nowMs: NOW });
    expect(userPatch.tagScores[GLOBAL_TASTE]).toBeUndefined();
  });

  it('a pick ignored too often nudges the overall taste as well', () => {
    const place = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && l.categories?.length);
    const profile = {
      tagScores: { all: {} },
      timesShownNotVisited: { miami: { [place.id]: IGNORE_LIMIT - 1 } },
      picksShown: { miami: { [place.id]: '2026-10-01' } },
    };
    const out = settleShownPicks(profile, { today: '2026-10-05', nowMs: NOW });
    expect(out.scorePatches.map((p) => p.region).sort()).toEqual([GLOBAL_TASTE, 'miami'].sort());
  });
});

describe('seedTagScores with one overall taste', () => {
  const steak = ALL_SWIPE_CARDS.find((c) => c.word === 'Steak');
  it('seeds the overall map once the account has it', () => {
    const out = seedTagScores({ tagScores: { all: {} } }, [{ card: steak, answer: 'love' }], NOW, ['miami']);
    expect(out.tagScores[GLOBAL_TASTE][steak.tag]).toBe(10);
    expect(out.tagScores.miami[steak.tag]).toBe(10);
  });
  it('leaves it out before the move (the move adds the swipes itself)', () => {
    const out = seedTagScores({}, [{ card: steak, answer: 'love' }], NOW, ['miami']);
    expect(out.tagScores[GLOBAL_TASTE]).toBeUndefined();
  });
});

describe('seedTagScores redo near the cap', () => {
  const food = ALL_SWIPE_CARDS.filter((c) => c.tag === ALL_SWIPE_CARDS.find((x) => x.word === 'Steak').tag);
  it('takes out only what the last save really added', () => {
    const tag = food[0].tag;
    const loved = food.map((card) => ({ card, answer: 'love' }));
    const profile = { tagScores: { miami: { [tag]: 80 } }, tagScoresAt: { miami: { [tag]: NOW } } };
    const first = seedTagScores(profile, loved, NOW, ['miami']);
    expect(first.tagScores.miami[tag]).toBe(100);
    const after = {
      ...profile,
      tagScores: first.tagScores,
      tagScoresAt: first.tagScoresAt,
      onboardingSwipeDeltas: first.deltas,
      onboardingSwipeApplied: first.applied,
    };
    // Redo with none of them loved: back to the 80 earned by ratings.
    const redo = seedTagScores(after, [], NOW, ['miami']);
    expect(redo.tagScores.miami[tag]).toBe(80);
  });
});

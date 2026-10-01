import { describe, it, expect } from 'vitest';
import {
  RATEABLE_CATEGORIES,
  isRateable,
  ratingCategory,
  TIERS,
  tierById,
  tierStars,
  isValidTier,
  isVisitedReview,
  withVisited,
  FREQUENCIES,
  frequencyById,
  chipsFor,
  chipLabel,
  MAX_CHIPS,
  MAX_ASPECTS,
  ASPECT_SETS,
  aspectsFor,
  aspectLabel,
  RATING_GOAL,
  diversityHint,
  tierQuestion,
  cleanTopic,
  commentQuestion,
} from './ratingFlow';
import { INTERESTS, migrateInterests } from '../data/regions';

describe('rateability gate', () => {
  it('rates history, art, and food landmarks', () => {
    for (const c of RATEABLE_CATEGORIES) {
      expect(isRateable({ categories: [c] })).toBe(true);
    }
  });

  it('rates parks and entertainment too, and lists them as onboarding interests', () => {
    expect(isRateable({ categories: ['parks-nature'] })).toBe(true);
    expect(isRateable({ categories: ['entertainment'] })).toBe(true);
    const ids = INTERESTS.map((i) => i.id);
    expect(ids).toContain('parks-nature');
    expect(ids).toContain('entertainment');
    expect(ids).not.toContain('dorms');
    expect(ids).toContain('campus-life');
    expect(ids).toContain('airports');
    expect(ids).toContain('food');
    expect(ids).toContain('local-life');
    expect(ids).toContain('sports');
    expect(ids).not.toContain('food-local-life');
    expect(ids).toContain('stadiums');
    expect(ids).toContain('formula-1');
    expect(ids).toContain('benches');
    expect(ids).toContain('tech');
    expect(ids).toHaveLength(13);
  });

  it('rates airports as airports, whatever else they are tagged', () => {
    expect(isRateable({ categories: ['airports'] })).toBe(true);
    expect(ratingCategory({ categories: ['food', 'airports'] })).toBe('airports');
  });

  it('rates a circuit as Formula 1 ahead of stadiums, and a bench as a bench', () => {
    expect(ratingCategory({ categories: ['stadiums', 'formula-1'] })).toBe('formula-1');
    expect(ratingCategory({ categories: ['benches'] })).toBe('benches');
  });

  it('rates a stadium as a stadium ahead of entertainment or history', () => {
    expect(ratingCategory({ categories: ['stadiums', 'history-culture'] })).toBe('stadiums');
    expect(ratingCategory({ categories: ['entertainment', 'stadiums'] })).toBe('stadiums');
  });

  it('rates a bar as local life and a court as a sports activity', () => {
    expect(ratingCategory({ categories: ['local-life'] })).toBe('local-life');
    expect(ratingCategory({ categories: ['food', 'local-life'] })).toBe('food');
    expect(ratingCategory({ categories: ['parks-nature', 'sports'] })).toBe('sports');
  });

  it('migrates the retired food-local-life interest into food + local-life', () => {
    expect(migrateInterests(['food-local-life', 'parks-nature'])).toEqual(['food', 'local-life', 'parks-nature']);
    expect(migrateInterests(['food', 'food-local-life'])).toEqual(['food', 'local-life']);
    expect(migrateInterests(undefined)).toEqual([]);
  });

  it('never rates a dorm', () => {
    expect(isRateable({ categories: ['dorms'] })).toBe(false);
    expect(isRateable({ categories: ['dorms', 'campus-life'] })).toBe(false);
  });

  it('a park that is also historic rates as a park', () => {
    expect(ratingCategory({ categories: ['history-culture', 'parks-nature'] })).toBe('parks-nature');
    expect(ratingCategory({ categories: ['parks-nature', 'history-culture'] })).toBe('parks-nature');
  });

  it('skips a campus-only landmark', () => {
    expect(isRateable({ categories: ['campus-life'] })).toBe(false);
  });

  it('rates a mixed campus + rateable landmark', () => {
    expect(isRateable({ categories: ['campus-life', 'food'] })).toBe(true);
  });

  it('fails safe on a landmark with no categories', () => {
    expect(isRateable({})).toBe(false);
    expect(isRateable({ categories: [] })).toBe(false);
    expect(isRateable(null)).toBe(false);
  });

  it('picks the chip set from the first rateable category, in priority order', () => {
    expect(ratingCategory({ categories: ['food', 'history-culture'] })).toBe('history-culture');
    expect(ratingCategory({ categories: ['campus-life', 'art-museums'] })).toBe('art-museums');
    expect(ratingCategory({ categories: ['campus-life'] })).toBe(null);
  });
});

describe('tier -> stars (feeds the landmark_ratings aggregate)', () => {
  it('maps the three tiers onto the 1-5 scale the aggregate expects', () => {
    expect(tierStars('highly-recommend')).toBe(5);
    expect(tierStars('worth-trying')).toBe(3);
    expect(tierStars('probably-skip')).toBe(1);
  });

  it('returns 0 for an unknown or missing tier so submitReview rejects it', () => {
    expect(tierStars('five-stars')).toBe(0);
    expect(tierStars(undefined)).toBe(0);
  });

  it('exposes exactly three tiers with unique ids', () => {
    expect(TIERS).toHaveLength(3);
    expect(new Set(TIERS.map((t) => t.id)).size).toBe(3);
  });

  it('labels the tiers as a plain personal verdict, not a star rating', () => {
    expect(tierById('highly-recommend').label).toBe('I loved it');
    expect(tierById('worth-trying').label).toBe('Ok');
    expect(tierById('probably-skip').label).toBe("I didn't like it");
  });
});

describe('chips', () => {
  it('has a chip set for every rateable category x tier', () => {
    for (const c of RATEABLE_CATEGORIES) {
      for (const t of TIERS) {
        const chips = chipsFor({ categories: [c] }, t.id);
        expect(chips.length, `${c} / ${t.id}`).toBeGreaterThanOrEqual(3);
        expect(chips.length, `${c} / ${t.id}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('returns no chips for a non-rateable landmark', () => {
    expect(chipsFor({ categories: ['campus-life'] }, 'highly-recommend')).toEqual([]);
  });

  it('keeps chip ids unique within a set so highlights can be toggled by id', () => {
    for (const c of RATEABLE_CATEGORIES) {
      for (const t of TIERS) {
        const ids = chipsFor({ categories: [c] }, t.id).map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('resolves a saved chip id back to its label', () => {
    const [first] = chipsFor({ categories: ['food'] }, 'highly-recommend');
    expect(chipLabel(first.id)).toBe(first.label);
    expect(chipLabel('not-a-real-chip')).toBe('not-a-real-chip');
  });
});

describe('limits and aspects', () => {
  it('caps picks at 3 chips and lets all 4 aspects be ranked', () => {
    expect(MAX_CHIPS).toBe(3);
    expect(MAX_ASPECTS).toBe(4);
  });

  it('never offers more aspects than can be ranked', () => {
    for (const c of RATEABLE_CATEGORIES) expect(ASPECT_SETS[c].length, c).toBeLessThanOrEqual(MAX_ASPECTS);
  });

  it('offers four aspects per rateable category, with Price and Location shared', () => {
    for (const c of RATEABLE_CATEGORIES) {
      const ids = ASPECT_SETS[c].map((a) => a.id);
      expect(ids, c).toHaveLength(4);
      expect(ids, c).toContain('price');
      expect(ids, c).toContain('location');
      expect(new Set(ids).size, c).toBe(4);
    }
    expect(aspectsFor({ categories: ['food'] }).map((a) => a.id)).toEqual([
      'price',
      'location',
      'atmosphere',
      'food',
    ]);
    expect(aspectsFor({ categories: ['art-museums'] }).map((a) => a.id)).toEqual([
      'price',
      'location',
      'exhibits',
      'crowd-level',
    ]);
    expect(aspectsFor({ categories: ['history-culture'] }).map((a) => a.id)).toEqual([
      'price',
      'location',
      'storytelling',
      'architecture',
    ]);
  });

  it('gives parks and entertainment their own third and fourth aspects', () => {
    expect(aspectsFor({ categories: ['parks-nature'] }).map((a) => a.id)).toEqual([
      'price',
      'location',
      'scenery',
      'upkeep',
    ]);
    expect(aspectsFor({ categories: ['entertainment'] }).map((a) => a.id)).toEqual([
      'price',
      'location',
      'fun-factor',
      'crowd-level',
    ]);
  });

  it('offers no aspects for a non-rateable landmark', () => {
    expect(aspectsFor({ categories: ['campus-life'] })).toEqual([]);
  });

  it('resolves a saved aspect id back to its label', () => {
    expect(aspectLabel('crowd-level')).toBe('Crowd level');
    expect(aspectLabel('not-an-aspect')).toBe('not-an-aspect');
  });

  it('sets the marketing goal at 10 ratings', () => {
    expect(RATING_GOAL).toBe(10);
  });
});

describe('diversityHint', () => {
  const rating = (tier, categories) => ({ ratingTier: tier, categories });

  it('says nothing with fewer than two ratings', () => {
    expect(diversityHint([])).toBeNull();
    expect(diversityHint([rating('highly-recommend', ['food'])])).toBeNull();
  });

  it('says nothing once already spread across categories', () => {
    const reviews = [
      rating('highly-recommend', ['food']),
      rating('probably-skip', ['history-culture']),
      rating('worth-trying', ['parks-nature']),
    ];
    expect(diversityHint(reviews)).toBeNull();
  });

  it('flags a lopsided history toward one category and suggests an unrated one', () => {
    const reviews = [
      rating('highly-recommend', ['food']),
      rating('highly-recommend', ['food']),
      rating('probably-skip', ['food']),
      rating('worth-trying', ['history-culture']),
    ];
    const hint = diversityHint(reviews);
    expect(hint).toContain('Food');
    expect(hint).not.toContain('undefined');
  });

  it('goes quiet once RATING_GOAL is reached, however lopsided', () => {
    const reviews = Array.from({ length: RATING_GOAL }, () => rating('highly-recommend', ['food']));
    expect(diversityHint(reviews)).toBeNull();
  });

  it('ignores reviews with no tier (not a real rating)', () => {
    const reviews = [{ categories: ['food'] }, { categories: ['food'] }, { categories: ['food'] }];
    expect(diversityHint(reviews)).toBeNull();
  });
});

describe('visit frequency', () => {
  it('exposes four frequencies with unique ids', () => {
    expect(FREQUENCIES).toHaveLength(3);
    expect(new Set(FREQUENCIES.map((f) => f.id)).size).toBe(3);
  });

  it('resolves a saved frequency id back to its label', () => {
    expect(frequencyById('a-lot').label).toBe('A lot');
    expect(frequencyById('not-a-real-id')).toBeNull();
  });
});

describe('tierQuestion', () => {
  it('asks about the cuisine for a restaurant with a specific topic', () => {
    expect(tierQuestion({ categories: ['food'], topic: 'Peruvian restaurant' })).toBe('Do you like Peruvian food?');
    expect(tierQuestion({ categories: ['food'], topic: 'Thai cafe' })).toBe('Do you like Thai food?');
    expect(tierQuestion({ categories: ['food'], topic: 'Peruvian food' })).toBe('Do you like Peruvian food?');
  });

  it('asks about the place itself when the cuisine reads badly as "<x> food"', () => {
    expect(tierQuestion({ categories: ['food'], topic: 'sushi restaurant' })).toBe('Do you like this sushi restaurant?');
    expect(tierQuestion({ categories: ['food'], topic: 'bakery' })).toBe('Do you like this bakery?');
  });

  it('asks about the bar for a bar, and the racing for a racing venue', () => {
    expect(tierQuestion({ categories: ['local-life'], topic: 'sports bar' })).toBe('Do you like this sports bar?');
    expect(tierQuestion({ categories: ['sports'], topic: 'go-kart track' })).toBe('Do you like the racing?');
    expect(tierQuestion({ categories: ['formula-1'], topic: 'Formula 1 circuit' })).toBe('Do you like the racing?');
    expect(tierQuestion({ categories: ['stadiums'], topic: 'NASCAR speedway' })).toBe('Do you like the racing?');
  });

  it('tidies a topic with an article or trailing period', () => {
    expect(tierQuestion({ categories: ['art-museums'], topic: '  A contemporary art museum. ' })).toBe(
      'Do you like this contemporary art museum?'
    );
  });

  it('falls back to a per-category question when there is no usable topic', () => {
    expect(tierQuestion({ categories: ['food'] })).toBe('Do you like the food here?');
    expect(tierQuestion({ categories: ['food'], topic: null })).toBe('Do you like the food here?');
    expect(tierQuestion({ categories: ['food'], topic: '' })).toBe('Do you like the food here?');
    expect(tierQuestion({ categories: ['formula-1'] })).toBe('Do you like the racing?');
    expect(tierQuestion({ categories: ['local-life'], topic: 'x'.repeat(200) })).toBe('Do you like this spot?');
    for (const c of RATEABLE_CATEGORIES) {
      expect(tierQuestion({ categories: [c] })).toMatch(/^Do you like .+\?$/);
    }
  });

  it('asks nothing for a landmark that is not rateable', () => {
    expect(tierQuestion({ categories: ['campus-life'] })).toBeNull();
    expect(tierQuestion(null)).toBeNull();
  });

  it('cleanTopic rejects non-strings and blanks', () => {
    expect(cleanTopic(undefined)).toBeNull();
    expect(cleanTopic(42)).toBeNull();
    expect(cleanTopic('   ')).toBeNull();
    expect(cleanTopic('the sports bar')).toBe('sports bar');
  });
});

describe('commentQuestion', () => {
  it('asks what you like, or what you did not for a "Not for me"', () => {
    expect(commentQuestion('highly-recommend')).toBe('What do you like about this place?');
    expect(commentQuestion('worth-trying')).toBe('What do you like about this place?');
    expect(commentQuestion('probably-skip')).toBe("What didn't you like about this place?");
  });
});

describe('every review needs a valid tier', () => {
  it('accepts only the three tiers', () => {
    expect(TIERS.map((t) => t.id).every(isValidTier)).toBe(true);
    for (const bad of [undefined, null, '', 'bogus', 5, 'highly_recommend']) expect(isValidTier(bad)).toBe(false);
  });
});

describe('rated is not visited', () => {
  it('stamps each review visited from the real check-ins only', () => {
    const reviews = { a: { landmarkId: 'a' }, b: { landmarkId: 'b' } };
    const out = withVisited(reviews, { a: true });
    expect(out.a.visited).toBe(true);
    expect(out.b.visited).toBe(false);
    expect(isVisitedReview(out.a)).toBe(true);
    expect(isVisitedReview(out.b)).toBe(false);
    expect(reviews.a.visited).toBeUndefined(); // input untouched
  });
  it('leaves reviews unstamped (treated as visited) when check-ins are unknown', () => {
    const reviews = { a: { landmarkId: 'a' } };
    expect(withVisited(reviews, undefined)).toBe(reviews);
    expect(isVisitedReview(reviews.a)).toBe(true);
    expect(isVisitedReview(null)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { onboardingTasteSeeded, picksUnlocked, MIN_RATINGS_FOR_PICKS } from './nearbyPicks';

// Owner, 2026-10-29: a new account gets picks from its onboarding answers,
// without first rating 10 places.
describe('onboarding unlocks picks', () => {
  it('a new account with no answers and no ratings stays locked', () => {
    expect(picksUnlocked(0, null)).toBe(false);
    expect(picksUnlocked(0, {})).toBe(false);
    expect(picksUnlocked(3, { swipeAnswers: [] })).toBe(false);
  });

  it('swipe cards that say love or dislike unlock it; only "not sure" does not', () => {
    expect(picksUnlocked(0, { swipeAnswers: [{ word: 'Steak', answer: 'love' }] })).toBe(true);
    expect(picksUnlocked(0, { swipeAnswers: [{ word: 'Zoo', answer: 'dislike' }] })).toBe(true);
    expect(picksUnlocked(0, { swipeAnswers: [{ word: 'Zoo', answer: 'unsure' }] })).toBe(false);
  });

  it('the onboarding questions unlock it: taste baseline, typed words, places visited most', () => {
    expect(onboardingTasteSeeded({ tasteBaseline: { food: 'love' } })).toBe(true);
    expect(onboardingTasteSeeded({ tasteBaseline: {} })).toBe(false);
    expect(onboardingTasteSeeded({ tasteIntro: '  I love racing ' })).toBe(true);
    expect(onboardingTasteSeeded({ tasteIntro: '   ' })).toBe(false);
    expect(onboardingTasteSeeded({ onboardingPlaces: [{ id: 'x', regionId: 'miami' }] })).toBe(true);
  });

  it('ratings still unlock it the old way', () => {
    expect(picksUnlocked(MIN_RATINGS_FOR_PICKS, null)).toBe(true);
    expect(picksUnlocked(MIN_RATINGS_FOR_PICKS - 1, null)).toBe(false);
    expect(picksUnlocked(4, null, 5)).toBe(false);
    expect(picksUnlocked(5, null, 5)).toBe(true);
  });
});

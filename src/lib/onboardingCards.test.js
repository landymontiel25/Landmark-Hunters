import { describe, it, expect } from 'vitest';
import { INTERESTS } from '../data/regions';
import { ALL_SWIPE_CARDS, SWIPE_GROUPS, pickSwipeCards, tagDeltasFromAnswers } from './onboardingCards';

describe('onboarding swipe cards', () => {
  it('has all 40 listed cards across 6 groups, each scoring a real category tag', () => {
    expect(SWIPE_GROUPS).toHaveLength(6);
    expect(ALL_SWIPE_CARDS).toHaveLength(40);
    const tags = new Set(INTERESTS.map((i) => i.id));
    for (const c of ALL_SWIPE_CARDS) expect(tags.has(c.tag)).toBe(true);
  });

  it('picks 15-18 cards, 2-3 per group, no repeats', () => {
    for (let run = 0; run < 200; run += 1) {
      const picked = pickSwipeCards();
      expect(picked.length).toBeGreaterThanOrEqual(15);
      expect(picked.length).toBeLessThanOrEqual(18);
      expect(new Set(picked.map((c) => c.word)).size).toBe(picked.length);
      for (const g of SWIPE_GROUPS) {
        const n = picked.filter((c) => c.group === g.id).length;
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(3);
      }
    }
  });

  it('eventually shows every card across many signups', () => {
    const seen = new Set();
    for (let run = 0; run < 300; run += 1) for (const c of pickSwipeCards()) seen.add(c.word);
    expect(seen.size).toBe(40);
  });

  it('+10 love, -15 dislike, nothing for not sure, summed per tag', () => {
    const card = (word) => ALL_SWIPE_CARDS.find((c) => c.word === word);
    const deltas = tagDeltasFromAnswers([
      { card: card('Steak'), answer: 'love' },
      { card: card('Pizza'), answer: 'dislike' },
      { card: card('Sushi'), answer: 'unsure' },
      { card: card('Racing'), answer: 'love' },
    ]);
    expect(deltas).toEqual({ food: -5, 'formula-1': 10 });
  });
});

describe('tasteIntroFromAnswers', () => {
  it('lists loved, disliked and unsure words plus notes', async () => {
    const { tasteIntroFromAnswers, ALL_SWIPE_CARDS } = await import('./onboardingCards');
    const card = (w) => ALL_SWIPE_CARDS.find((c) => c.word === w);
    const text = tasteIntroFromAnswers(
      [
        { card: card('Steak'), answer: 'love' },
        { card: card('Sushi'), answer: 'love' },
        { card: card('Zoos'), answer: 'dislike' },
        { card: card('Golf'), answer: 'unsure' },
      ],
      ' no crowds '
    );
    expect(text).toBe("Loves: Steak, Sushi. Doesn't like: Zoos. Not sure about: Golf. Also said: no crowds");
  });

  it('allSwipeCards deals every card once', async () => {
    const { allSwipeCards, ALL_SWIPE_CARDS } = await import('./onboardingCards');
    const dealt = allSwipeCards();
    expect(dealt).toHaveLength(ALL_SWIPE_CARDS.length);
    expect(new Set(dealt.map((c) => c.word)).size).toBe(ALL_SWIPE_CARDS.length);
  });
});

describe('card photos', () => {
  it('gives every card its own Wikimedia Commons photo', async () => {
    const { ALL_SWIPE_CARDS, CARD_PHOTOS } = await import('./onboardingCards');
    expect(Object.keys(CARD_PHOTOS).sort()).toEqual(ALL_SWIPE_CARDS.map((c) => c.word).sort());
    const files = Object.values(CARD_PHOTOS).flat();
    expect(new Set(files).size).toBe(files.length);
    for (const c of ALL_SWIPE_CARDS) {
      expect(c.photos.length).toBeGreaterThan(0);
      expect(c.photos.length).toBe(c.photoPages.length);
      for (const u of c.photos) expect(u).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/.+\?width=800$/);
      for (const u of c.photoPages) expect(u).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
    expect(ALL_SWIPE_CARDS.find((c) => c.word === 'Arcades/bowling').photos).toHaveLength(2);
  });
});

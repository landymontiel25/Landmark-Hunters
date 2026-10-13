import { describe, it, expect } from 'vitest';
import { swipeKindAffinity, tasteKindAffinity, kindBoost } from './placeKinds';
import { tasteScorer } from './maprRank/surfaces';
import { summaryScorer } from '../../api/_lib/maprChatRanking.js';

// The reported case: someone loves steak and sushi (Food stays positive) but
// swipes left on pizza and coffee. Pizza and coffee places must rank below a
// plain food place and below a loved kind.
const answers = [
  { word: 'Steak', answer: 'love' },
  { word: 'Sushi', answer: 'love' },
  { word: 'Pizza', answer: 'dislike' },
  { word: 'Coffee shops', answer: 'dislike' },
];
const place = (id, name, summary) => ({ id, regionId: 'miami', name, summary, categories: ['food'] });
const pizza = place('p', "Joe's Pizza", 'A pizzeria serving New York style slices.');
const coffee = place('c', 'Panther Coffee', 'A coffee roaster and cafe.');
const steak = place('s', 'Bern Steakhouse', 'A classic steakhouse.');
const plain = place('x', 'Corner Diner', 'A neighborhood diner.');

describe('onboarding swipes reach the kind of place', () => {
  it('maps swiped cards to kinds, a dislike outweighing a love', () => {
    const a = swipeKindAffinity(answers);
    expect(a.pizza).toBeLessThan(0);
    expect(a.coffee).toBeLessThan(0);
    expect(a.steakhouse).toBeGreaterThan(0);
    expect(kindBoost(pizza, a)).toBeLessThanOrEqual(-40);
  });

  it('ranks pizza and coffee last for that person, on every Mapr surface', () => {
    const profile = { swipeAnswers: answers, tagScores: { all: { food: 20 } }, tagScoresAt: { all: { food: Date.now() } } };
    const fit = tasteScorer({ profile, myReviews: {} });
    const order = [pizza, coffee, steak, plain].sort((a, b) => fit(b) - fit(a)).map((l) => l.id);
    expect(order.slice(-2).sort()).toEqual(['c', 'p']);
    expect(order[0]).toBe('s');

    const chat = summaryScorer({ all: { food: 20 } }, tasteKindAffinity({}, () => null, { swipeAnswers: answers }));
    expect(chat(pizza)).toBeLessThan(chat(plain));
    expect(chat(coffee)).toBeLessThan(chat(plain));
  });
});

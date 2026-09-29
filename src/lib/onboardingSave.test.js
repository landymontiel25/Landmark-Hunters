import { describe, it, expect } from 'vitest';
import { ALL_SWIPE_CARDS } from './onboardingCards';
import { answersToPairs, pairsToAnswers, prefillAnswers, seedTagScores, swipeSummary } from './onboardingSave';

const card = (word) => ALL_SWIPE_CARDS.find((c) => c.word === word);
const ans = (word, answer) => ({ card: card(word), answer });
const NOW = Date.UTC(2026, 8, 29);

describe('seedTagScores', () => {
  it('seeds every listed region from love / dislike answers, and ignores not sure', () => {
    const out = seedTagScores({}, [ans('Steak', 'love'), ans('Museums', 'dislike'), ans('Golf', 'unsure')], NOW, ['miami', 'madrid']);
    expect(out.tagScores.miami[card('Steak').tag]).toBe(10);
    expect(out.tagScores.madrid[card('Museums').tag]).toBe(-15);
    expect(out.tagScores.miami[card('Golf').tag]).toBeUndefined();
    expect(out.tagScoresAt.miami[card('Steak').tag]).toBe(NOW);
  });

  it('adds to what a returning user already has', () => {
    const tag = card('Steak').tag;
    const profile = { tagScores: { miami: { [tag]: 20 } }, tagScoresAt: { miami: { [tag]: NOW } } };
    expect(seedTagScores(profile, [ans('Steak', 'love')], NOW, ['miami']).tagScores.miami[tag]).toBe(30);
  });

  it('redoing onboarding applies only the change since last time', () => {
    const tag = card('Steak').tag;
    const profile = {
      tagScores: { miami: { [tag]: 10 } },
      tagScoresAt: { miami: { [tag]: NOW } },
      onboardingSwipeDeltas: { [tag]: 10 },
    };
    // Same answer again: nothing to write.
    expect(seedTagScores(profile, [ans('Steak', 'love')], NOW, ['miami']).tagScores).toEqual({});
    // Changed their mind: love (+10) becomes dislike (-15), a swing of -25.
    expect(seedTagScores(profile, [ans('Steak', 'dislike')], NOW, ['miami']).tagScores.miami[tag]).toBe(-15);
  });
});

describe('prefillAnswers', () => {
  const words = ['Steak', 'Museums', 'Golf'];

  it('starts empty for someone who has told us nothing', () => {
    expect(prefillAnswers({ cardWords: words, profile: {}, savedInterests: [] })).toEqual([]);
  });

  it('fills "love" for cards whose category the user already saved', () => {
    const out = prefillAnswers({ cardWords: words, profile: {}, savedInterests: [card('Golf').tag] });
    expect(out.map((a) => [a.card.word, a.answer])).toEqual([['Golf', 'love']]);
  });

  it('prefers earlier swipes over saved interests, and this run over both', () => {
    const profile = { swipeAnswers: [{ word: 'Golf', answer: 'dislike' }] };
    const progress = { answers: [{ word: 'Steak', answer: 'love' }, { word: 'Golf', answer: 'unsure' }] };
    const out = prefillAnswers({ cardWords: words, progress, profile, savedInterests: [card('Golf').tag] });
    expect(Object.fromEntries(out.map((a) => [a.card.word, a.answer]))).toEqual({ Steak: 'love', Golf: 'unsure' });
  });

  it('only returns cards that are in the deck', () => {
    const progress = { answers: [{ word: 'Pizza', answer: 'love' }] };
    expect(prefillAnswers({ cardWords: ['Steak'], progress, profile: {}, savedInterests: [] })).toEqual([]);
  });
});

describe('answers <-> Firestore pairs', () => {
  it('round-trips and drops unknown words and answers', () => {
    const list = [ans('Steak', 'love'), ans('Golf', 'dislike')];
    expect(pairsToAnswers(answersToPairs(list)).map((a) => [a.card.word, a.answer])).toEqual([
      ['Steak', 'love'],
      ['Golf', 'dislike'],
    ]);
    expect(pairsToAnswers([{ word: 'Not a card', answer: 'love' }, { word: 'Steak', answer: 'maybe' }, null].filter(Boolean))).toEqual([]);
    expect(pairsToAnswers(undefined)).toEqual([]);
  });
});

describe('swipeSummary', () => {
  it('reads the words back as prose for Mapr, without a trailing period', () => {
    expect(swipeSummary([ans('Steak', 'love'), ans('Golf', 'love'), ans('Museums', 'dislike'), ans('Zoos', 'unsure')])).toBe(
      "Loves: Steak, Golf. Doesn't like: Museums"
    );
    expect(swipeSummary([])).toBe('');
  });
});

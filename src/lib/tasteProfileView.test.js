import { describe, it, expect } from 'vitest';
import { buildTasteProfile, parseTasteComment, tasteWord } from './tasteProfileView';

describe('taste profile', () => {
  it('turns scores, swipes and words into a profile with a summary', () => {
    const now = Date.now();
    const profile = {
      tagScores: { all: { food: 45, 'parks-nature': 20, 'local-life': -50 } },
      tagScoresAt: { all: { food: now, 'parks-nature': now, 'local-life': now } },
      swipeAnswers: [
        { word: 'Steak', answer: 'love' },
        { word: 'Pizza', answer: 'dislike' },
      ],
      tasteIntro: 'I love beach days',
    };
    const p = buildTasteProfile({ profile, now });
    expect(p.categories[0]).toMatchObject({ id: 'food', word: 'Loves' });
    expect(p.categories.find((c) => c.id === 'local-life').word).toBe('Not for you');
    expect(p.loves).toContain('steakhouse');
    expect(p.skips).toContain('pizza');
    expect(p.words).toContain('I love beach days');
    expect(p.summary).toBe('You lean toward Food and Parks & Nature, you love steakhouses, you skip pizza.');
  });

  it('reads a comment into what Mapr would change', () => {
    const changes = parseTasteComment('I actually like coffee now, but no more pizza. Love museums!');
    expect(changes).toEqual(
      expect.arrayContaining([
        { type: 'kind', id: 'coffee', label: 'Coffee', direction: 1 },
        { type: 'kind', id: 'pizza', label: 'Pizza', direction: -1 },
        { type: 'category', id: 'history-culture', label: 'Art & Culture', direction: 1 },
      ])
    );
    expect(parseTasteComment('hello there')).toEqual([]);
  });

  it('puts scores into words', () => {
    expect([60, 15, 0, -20, -60].map(tasteWord)).toEqual(['Loves', 'Likes', 'Neutral', 'Not really', 'Not for you']);
  });
});

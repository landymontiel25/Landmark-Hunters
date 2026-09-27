import { describe, it, expect } from 'vitest';
import {
  baselineToSentence,
  baselineToSyntheticReviews,
  composeTasteIntro,
  extractLegacyBaselineFromIntro,
  tasteFingerprint,
} from './tasteQuestions';

describe('baselineToSentence', () => {
  it('returns empty string for no baseline', () => {
    expect(baselineToSentence(null)).toBe('');
    expect(baselineToSentence({})).toBe('');
  });

  it('lists likes and dislikes per category', () => {
    const sentence = baselineToSentence({
      food: { Steak: 'like', Sushi: 'dislike' },
      'parks-nature': { 'Hiking trails': 'like' },
    });
    expect(sentence).toContain('Food: likes Steak; dislikes Sushi');
    expect(sentence).toContain('Parks & Nature: likes Hiking trails');
  });

  it('skips a category with no picks left in it', () => {
    expect(baselineToSentence({ food: {} })).toBe('');
  });

  it('appends a per-category comment as a note', () => {
    const sentence = baselineToSentence({ food: { Steak: 'like' } }, { food: 'No pepper on my steak' });
    expect(sentence).toBe('Food: likes Steak; note: No pepper on my steak');
  });

  it('includes a category with only a comment and no picks', () => {
    const sentence = baselineToSentence({}, { food: 'Allergic to shellfish' });
    expect(sentence).toBe('Food: note: Allergic to shellfish');
  });
});

describe('baselineToSyntheticReviews', () => {
  it('returns no reviews for an empty baseline', () => {
    expect(baselineToSyntheticReviews(null)).toEqual([]);
    expect(baselineToSyntheticReviews({})).toEqual([]);
  });

  it('turns a like into a highly-recommend and a dislike into a probably-skip, at the category level', () => {
    const reviews = baselineToSyntheticReviews({ food: { Steak: 'like', Sushi: 'dislike' } });
    expect(reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: 'highly-recommend', categories: ['food'], name: 'Steak' }),
        expect.objectContaining({ tier: 'probably-skip', categories: ['food'], name: 'Sushi' }),
      ])
    );
    expect(reviews).toHaveLength(2);
  });

  it('carries the category comment onto every synthetic review in that category', () => {
    const reviews = baselineToSyntheticReviews({ food: { Steak: 'like', Sushi: 'dislike' } }, { food: 'No pepper' });
    expect(reviews.every((r) => r.comment === 'No pepper')).toBe(true);
  });
});

describe('composeTasteIntro', () => {
  it('combines free-text intro, baseline, and notes into one string', () => {
    const myProfile = {
      tasteIntro: 'I love racing and steak.',
      tasteBaseline: { food: { Steak: 'like' } },
      tasteBaselineNotes: 'No pepper on my steak.',
    };
    const combined = composeTasteIntro(myProfile);
    expect(combined).toContain('I love racing and steak.');
    expect(combined).toContain('Food: likes Steak');
    expect(combined).toContain('No pepper on my steak.');
  });

  it('handles a completely empty profile without throwing', () => {
    expect(composeTasteIntro(null)).toBe('');
    expect(composeTasteIntro({})).toBe('');
  });

  it('folds per-category comments in too', () => {
    const combined = composeTasteIntro({
      tasteBaseline: { food: { Steak: 'like' } },
      tasteBaselineCategoryNotes: { food: 'No pepper on my steak' },
    });
    expect(combined).toContain('note: No pepper on my steak');
  });

  it('passes named places/brands through in tasteIntro, same as any other free text', () => {
    const profile = { tasteIntro: "I love Dunkin' Donuts, sushi, and Carrot Express." };
    expect(composeTasteIntro(profile)).toContain("Dunkin' Donuts");
    expect(composeTasteIntro(profile)).toContain('Carrot Express');
  });
});

describe('extractLegacyBaselineFromIntro', () => {
  it('finds nothing in an empty or plain intro', () => {
    expect(extractLegacyBaselineFromIntro('')).toEqual({ baseline: null, remainingIntro: '' });
    expect(extractLegacyBaselineFromIntro('I love racing and steak.').baseline).toBeNull();
  });

  it('recovers a baseline that was previously baked into tasteIntro', () => {
    // Exactly the format the old (pre-tasteBaseline-field) TasteNudgeCard
    // used to generate and append to tasteIntro on every save.
    const legacy = baselineToSentence({
      food: { Steak: 'like', Sushi: 'dislike' },
      'parks-nature': { 'Hiking trails': 'like' },
    });
    const { baseline, remainingIntro } = extractLegacyBaselineFromIntro(legacy);
    expect(baseline.food).toEqual({ Steak: 'like', Sushi: 'dislike' });
    expect(baseline['parks-nature']).toEqual({ 'Hiking trails': 'like' });
    expect(remainingIntro).toBe('');
  });

  it('keeps a typed sentence the user added alongside the picks as leftover text', () => {
    const legacy = ['I really love a good view.', baselineToSentence({ food: { Steak: 'like' } })].join('. ');
    const { baseline, remainingIntro } = extractLegacyBaselineFromIntro(legacy);
    expect(baseline.food).toEqual({ Steak: 'like' });
    expect(remainingIntro).toBe('I really love a good view.');
  });
});

describe('tasteFingerprint', () => {
  it('is stable for the same profile', () => {
    const profile = { tasteIntro: 'I love steak', tasteBaseline: { food: { Steak: 'like' } } };
    expect(tasteFingerprint(profile)).toBe(tasteFingerprint({ ...profile }));
  });

  it('changes when a baseline pick is added, even with the exact same tasteIntro', () => {
    const before = tasteFingerprint({ tasteIntro: 'hi', tasteBaseline: {} });
    const after = tasteFingerprint({ tasteIntro: 'hi', tasteBaseline: { food: { Steak: 'like' } } });
    expect(before).not.toBe(after);
  });

  it('changes when a category comment is added', () => {
    const before = tasteFingerprint({ tasteBaseline: { food: { Steak: 'like' } } });
    const after = tasteFingerprint({
      tasteBaseline: { food: { Steak: 'like' } },
      tasteBaselineCategoryNotes: { food: 'No pepper' },
    });
    expect(before).not.toBe(after);
  });

  it('is the same (empty) for two profiles with nothing set', () => {
    expect(tasteFingerprint(null)).toBe(tasteFingerprint({}));
  });
});

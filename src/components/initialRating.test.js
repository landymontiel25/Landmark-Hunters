import { describe, it, expect } from 'vitest';
import { initialRating } from './initialRating';

const existing = { ratingTier: 'worth-trying', highlights: ['a'], lovedOrder: ['x'], comment: 'nice', visitFrequency: 'once' };

describe('initialRating', () => {
  it('returns null with nothing on file and no pre-picked tier', () => {
    expect(initialRating(null, null)).toBeNull();
  });
  it('keeps a comment saved before any rating, with or without a pre-picked tier', () => {
    expect(initialRating({ comment: 'loud' }, null)).toEqual({ comment: 'loud' });
    expect(initialRating({ comment: 'loud' }, 'highly-recommend')).toEqual({ tier: 'highly-recommend', comment: 'loud' });
    expect(initialRating({ comment: '' }, null)).toBeNull();
  });
  it('pre-fills everything on file when the tier is unchanged', () => {
    expect(initialRating(existing, 'worth-trying')).toMatchObject({ tier: 'worth-trying', highlights: ['a'], comment: 'nice' });
  });
  it('drops tier-specific chips when a different tier is pre-picked', () => {
    const r = initialRating(existing, 'highly-recommend');
    expect(r.tier).toBe('highly-recommend');
    expect(r.highlights).toBeUndefined();
    expect(r.lovedOrder).toBeUndefined();
    expect(r.comment).toBe('nice');
  });
});

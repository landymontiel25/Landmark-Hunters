import { describe, it, expect } from 'vitest';
import { normalizeGoogle } from './ratingSources.js';

describe('normalizeGoogle', () => {
  it('keeps author attribution and trims long reviews', () => {
    const long = 'word '.repeat(100);
    const out = normalizeGoogle(
      { rating: 4, userRatingCount: 3, googleMapsUri: 'https://maps.google.com/?cid=2', reviews: [{ text: { text: long }, authorAttribution: { displayName: 'Bo' } }] },
      { detail: true }
    );
    expect(out.snippets[0].author).toBe('Bo');
    expect(out.snippets[0].text.length).toBeLessThanOrEqual(221);
    expect(out.snippets[0].text.endsWith('…')).toBe(true);
    // Falls back to the place link when the review has none.
    expect(out.snippets[0].url).toBe('https://maps.google.com/?cid=2');
  });
  it('drops non-https links', () => {
    expect(normalizeGoogle({ rating: 4, userRatingCount: 3, googleMapsUri: 'javascript:alert(1)' })).toBeNull();
  });
});

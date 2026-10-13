import { describe, it, expect } from 'vitest';
import { normalizeGoogle, normalizeTripadvisor } from './ratingSources.js';

const loc = (rating) => ({
  traveler_ratings: { overall: { rating, count: 10, icon_url: 'https://static.tacdn.com/x.svg' } },
  urls: { tripadvisor: { main: 'https://www.tripadvisor.com/x' } },
});
const five = { rating: 5, text: [{ language: 'en', value: 'Loved it' }], publish_ts: '2026-01-02T00:00:00Z' };

describe('normalizeTripadvisor (quoting rules)', () => {
  it('quotes 5-bubble reviews only when the place is rated 4 or more', () => {
    expect(normalizeTripadvisor(loc(4.5), { data: [five] }).snippets).toHaveLength(1);
    expect(normalizeTripadvisor(loc(3.5), { data: [five] }).snippets).toEqual([]);
    expect(normalizeTripadvisor(loc(4.5), { data: [{ ...five, rating: 4 }] }).snippets).toEqual([]);
  });
  it('skips a review with no date, and keeps at most 2', () => {
    expect(normalizeTripadvisor(loc(5), { data: [{ ...five, publish_ts: '' }] }).snippets).toEqual([]);
    expect(normalizeTripadvisor(loc(5), { data: [five, five, five] }).snippets).toHaveLength(2);
  });
  it('is null without a rating, a count or a link back', () => {
    expect(normalizeTripadvisor({})).toBeNull();
    expect(normalizeTripadvisor({ ...loc(4), urls: {} })).toBeNull();
  });
});

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

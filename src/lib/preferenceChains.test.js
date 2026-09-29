import { describe, it, expect } from 'vitest';
import {
  CHAIN_MIN_COUNT,
  CHAIN_WINDOW_MS,
  buildPreferenceChains,
  checkinEvents,
  countBackToBackPairs,
  linksFrom,
} from './preferenceChains';

const HOUR = 60 * 60 * 1000;
// Local-time dates, so "same calendar day" means the user's day.
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();
const visit = (ms, category, extra = {}) => ({ at: ms, categories: [category], ...extra });

// One museum -> food pair per day, back to back, `gapHours` apart.
const museumThenFood = (days, gapHours = 1) =>
  days.flatMap((d) => [visit(at(d, 10), 'art-museums'), visit(at(d, 10) + gapHours * HOUR, 'food')]);

describe('preference chaining: the back-to-back rule', () => {
  it('keeps the window and minimum count in named constants: 3 hours, 3 times', () => {
    expect(CHAIN_WINDOW_MS).toBe(3 * HOUR);
    expect(CHAIN_MIN_COUNT).toBe(3);
  });

  it('counts B right after A within 3 hours on the same day', () => {
    const counts = countBackToBackPairs(checkinEvents(museumThenFood([1])));
    expect(counts).toEqual({ 'art-museums>food': 1 });
  });

  it('counts exactly at 3 hours, but not a minute past it', () => {
    expect(countBackToBackPairs(checkinEvents(museumThenFood([1], 3)))).toEqual({ 'art-museums>food': 1 });
    const late = [visit(at(1, 10), 'art-museums'), visit(at(1, 13, 1), 'food')];
    expect(countBackToBackPairs(checkinEvents(late))).toEqual({});
  });

  it('does not count a pair with another check-in in between', () => {
    const rows = [visit(at(1, 10), 'art-museums'), visit(at(1, 10, 30), 'parks-nature'), visit(at(1, 11), 'food')];
    const counts = countBackToBackPairs(checkinEvents(rows));
    expect(counts['art-museums>food']).toBeUndefined();
    // The two real back-to-back pairs still count.
    expect(counts).toEqual({ 'art-museums>parks-nature': 1, 'parks-nature>food': 1 });
  });

  it('does not count across midnight, even inside 3 hours', () => {
    const rows = [visit(at(1, 23), 'art-museums'), visit(at(2, 0, 30), 'food')];
    expect(countBackToBackPairs(checkinEvents(rows))).toEqual({});
  });

  it('ignores same-category pairs and "Rate a Landmark" claims (not visits)', () => {
    const rows = [
      visit(at(1, 10), 'food'),
      visit(at(1, 11), 'food'),
      visit(at(1, 11, 30), 'art-museums', { ratingOnly: true }),
      visit(at(1, 12), 'local-life'),
    ];
    // The rating-only claim neither pairs nor sits "in between".
    expect(countBackToBackPairs(checkinEvents(rows))).toEqual({ 'food>local-life': 1 });
  });

  it('reads Firestore timestamps and sorts out-of-order history', () => {
    const rows = [
      { createdAt: { seconds: at(1, 11) / 1000 }, categories: ['food'] },
      { createdAt: { seconds: at(1, 10) / 1000 }, categories: ['art-museums'] },
    ];
    expect(countBackToBackPairs(checkinEvents(rows))).toEqual({ 'art-museums>food': 1 });
  });

  it('links only after 3 or more times', () => {
    expect(buildPreferenceChains(museumThenFood([1, 2]))).toEqual([]);
    expect(buildPreferenceChains(museumThenFood([1, 2, 3]))).toEqual([{ from: 'art-museums', to: 'food', count: 3 }]);
  });

  it('links point one way', () => {
    const links = buildPreferenceChains(museumThenFood([1, 2, 3, 4]));
    expect(linksFrom(links, 'art-museums')).toEqual([{ from: 'art-museums', to: 'food', count: 4 }]);
    expect(linksFrom(links, 'food')).toEqual([]);
    // Two food -> museum days don't make food -> museum a link.
    const mixed = [
      ...museumThenFood([1, 2, 3]),
      visit(at(4, 10), 'food'),
      visit(at(4, 11), 'art-museums'),
      visit(at(5, 10), 'food'),
      visit(at(5, 11), 'art-museums'),
    ];
    expect(linksFrom(buildPreferenceChains(mixed), 'food')).toEqual([]);
  });

  it('resolves categories through a lookup, e.g. the catalog', () => {
    const cats = { mus: 'art-museums', cafe: 'food' };
    const rows = [1, 2, 3].flatMap((d) => [
      { at: at(d, 9), landmarkId: 'mus' },
      { at: at(d, 9, 45), landmarkId: 'cafe' },
    ]);
    expect(buildPreferenceChains(rows, { categoryOf: (c) => cats[c.landmarkId] })).toEqual([
      { from: 'art-museums', to: 'food', count: 3 },
    ]);
  });
});

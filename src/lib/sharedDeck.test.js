import { describe, it, expect } from 'vitest';
import { pickDailyCardIds, dailyDeck, deckPool } from './sharedDeck';
import { ALL_LANDMARKS } from '../data/regions';

describe('sharedDeck', () => {
  it('picks the same 3 cards for the same pair/day/city, every time', () => {
    const a = pickDailyCardIds('uid1_uid2', '2026-9-28', 'miami');
    const b = pickDailyCardIds('uid1_uid2', '2026-9-28', 'miami');
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
  });

  it('gives a different pair a different deck (same day, same city)', () => {
    const a = pickDailyCardIds('uid1_uid2', '2026-9-28', 'miami');
    const b = pickDailyCardIds('uid3_uid4', '2026-9-28', 'miami');
    expect(a).not.toEqual(b);
  });

  it('changes tomorrow', () => {
    const today = pickDailyCardIds('uid1_uid2', '2026-9-28', 'miami');
    const tomorrow = pickDailyCardIds('uid1_uid2', '2026-9-29', 'miami');
    expect(today).not.toEqual(tomorrow);
  });

  it('only ever picks rateable landmarks that actually exist in that city', () => {
    const ids = pickDailyCardIds('uid1_uid2', '2026-9-28', 'villanova');
    const pool = new Set(deckPool('villanova'));
    for (const id of ids) expect(pool.has(id)).toBe(true);
  });

  it('dailyDeck returns full landmark objects with regionId attached', () => {
    const deck = dailyDeck('uid1_uid2', '2026-9-28', 'miami');
    expect(deck.length).toBe(3);
    for (const l of deck) {
      expect(l.regionId).toBe('miami');
      expect(ALL_LANDMARKS.some((x) => x.id === l.id && x.regionId === 'miami')).toBe(true);
    }
  });

  it('never picks more cards than exist for a tiny city', () => {
    // frankfurt has just 1 landmark in the catalog.
    const ids = pickDailyCardIds('uid1_uid2', '2026-9-28', 'frankfurt');
    expect(ids.length).toBeLessThanOrEqual(deckPool('frankfurt').length);
  });

  it('skips landmarks either member has already checked into', () => {
    const pool = deckPool('miami');
    const untouched = pool.slice(-5);
    const visited = new Set(pool.slice(0, -5));
    const ids = pickDailyCardIds('uid1_uid2', '2026-9-28', 'miami', visited);
    for (const id of ids) expect(untouched).toContain(id);
  });

  it('falls back to repeats rather than an empty deck once everything is visited', () => {
    const pool = deckPool('miami');
    const ids = pickDailyCardIds('uid1_uid2', '2026-9-28', 'miami', new Set(pool));
    expect(ids.length).toBe(3);
  });
});

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

describe('deckPool and imported places', () => {
  it('draws only from the hand-picked catalog, so the app and the day-close agree', async () => {
    const { deckPool } = await import('./sharedDeck.js');
    const { getRegion, registerPlaces } = await import('../data/regions.js');
    const before = deckPool('philly');
    const sample = getRegion('philly').landmarks.find((l) => l.source !== 'osm');
    registerPlaces([{ ...sample, id: 'osm-n999999999', name: 'Imported Test Cafe', source: 'osm', region: 'philly' }]);
    expect(getRegion('philly').landmarks.some((l) => l.id === 'osm-n999999999')).toBe(true);
    expect(deckPool('philly')).toEqual(before);
  });

  it('puts places you already answered after every fresh one', () => {
    const pool = deckPool('villanova');
    const answered = new Map(pool.slice(0, pool.length - 2).map((id, i) => [id, 1000 + i]));
    const ids = pickDailyCardIds('me', '2026-9-28', 'villanova', [], 3, answered);
    expect(ids).toHaveLength(3);
    // The 2 never-answered places, then the one answered longest ago.
    expect(ids).toEqual([...pool.slice(-2), pool[0]].sort());
  });

  it('changes the solo cards every day until the city is used up', () => {
    const pool = deckPool('villanova');
    const answered = new Map();
    const seen = [];
    for (let day = 1; day <= Math.floor(pool.length / 3); day++) {
      const ids = pickDailyCardIds('me', `2026-9-${day}`, 'villanova', [], 3, answered);
      expect(ids.some((id) => seen.includes(id))).toBe(false);
      ids.forEach((id) => answered.set(id, day));
      seen.push(...ids);
    }
  });

  it('still deals 3 cards when fewer than 3 places are left unvisited', () => {
    const pool = deckPool('villanova');
    const ids = pickDailyCardIds('me', '2026-9-28', 'villanova', pool.slice(1));
    expect(ids).toHaveLength(3);
    expect(ids).toContain(pool[0]);
  });

  it('draws the same cards as before when nothing is answered', () => {
    const pool = deckPool('miami');
    expect(pickDailyCardIds('a_b', '2026-9-28', 'miami', [], 3, new Map())).toEqual(pickDailyCardIds('a_b', '2026-9-28', 'miami'));
    expect(pool.length).toBeGreaterThan(3);
  });
});

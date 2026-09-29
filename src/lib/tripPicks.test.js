import { describe, it, expect } from 'vitest';
import { ALL_LANDMARKS } from '../data/regions';
import { discoveryPicks, usualPicks, NEW_PICK_PER_TAG } from './tagScores';
import { rankTripPicks } from './tripPlanner';

const NOW = Date.UTC(2026, 8, 1);
// Loves food, likes history, dislikes local-life, rated parks once (and liked it).
const profile = {
  tagScores: { villanova: { food: 60, 'history-culture': 40, 'local-life': -30, 'parks-nature': 10 } },
  tagScoresAt: { villanova: { food: NOW, 'history-culture': NOW, 'local-life': NOW, 'parks-nature': NOW } },
  tagCounts: { villanova: { food: 8, 'history-culture': 6, 'local-life': 4, 'parks-nature': 1 } },
};
const primary = (l) => l.categories.find((c) => c !== 'campus-life' && c !== 'dorms');

describe('"The usual" ranking', () => {
  it('ranks by saved tag scores, best-loved category first, and only places they score above zero', () => {
    const picks = usualPicks({ profile, region: 'villanova', limit: 5, now: NOW });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0].categories).toContain('food');
    expect(picks.every((p) => p.tagScore > 0)).toBe(true);
    expect(picks.every((p) => p.pickType === 'usual')).toBe(true);
    for (let i = 1; i < picks.length; i++) expect(picks[i - 1].tagScore).toBeGreaterThanOrEqual(picks[i].tagScore - 3);
  });

  it('never suggests a place already rated or visited', () => {
    const first = usualPicks({ profile, region: 'villanova', limit: 1, now: NOW })[0];
    const again = usualPicks({ profile, region: 'villanova', excludeIds: [first.id], limit: 5, now: NOW });
    expect(again.map((p) => p.id)).not.toContain(first.id);
  });
});

describe('"Something new" ranking', () => {
  it('only picks categories rated little or never, skipping anything disliked', () => {
    const picks = discoveryPicks({ profile, region: 'villanova', limit: 8, now: NOW });
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) {
      expect(['food', 'history-culture', 'local-life']).not.toContain(primary(p));
      expect(p.categories).not.toContain('local-life');
      expect(p.pickType).toBe('new');
    }
  });

  it('still leans toward their taste: the barely-rated category they liked comes first', () => {
    const picks = discoveryPicks({ profile, region: 'villanova', limit: 8, now: NOW });
    expect(primary(picks[0])).toBe('parks-nature');
  });

  it('spreads across categories', () => {
    const picks = discoveryPicks({ profile, region: 'villanova', limit: 8, now: NOW });
    const perTag = {};
    for (const p of picks) perTag[p.categories[0]] = (perTag[p.categories[0]] || 0) + 1;
    expect(Math.max(...Object.values(perTag))).toBeLessThanOrEqual(NEW_PICK_PER_TAG);
  });

  it('counts ratings per region: a category rated a lot in another city is still new here', () => {
    // Taste varies city to city (museums in Paris vs. Brussels), so what's
    // "new" is scoped to THIS region, not blended across every place they've
    // ever rated -- rating art-museums a lot in Miami shouldn't hide it as
    // "new" in Villanova, where they've never rated one.
    const traveled = { ...profile, tagCounts: { ...profile.tagCounts, miami: { 'art-museums': 5 } } };
    const picks = discoveryPicks({ profile: traveled, region: 'villanova', limit: 8, now: NOW });
    expect(picks.some((p) => primary(p) === 'art-museums')).toBe(true);
  });

  it('does not count ratings from another region: heavily-rated locally is not new here', () => {
    const local = { ...profile, tagCounts: { ...profile.tagCounts, villanova: { ...profile.tagCounts.villanova, 'art-museums': 5 } } };
    const picks = discoveryPicks({ profile: local, region: 'villanova', limit: 8, now: NOW });
    expect(picks.some((p) => primary(p) === 'art-museums')).toBe(false);
  });

  it('usual and new pick different places', () => {
    const usual = new Set(usualPicks({ profile, region: 'villanova', limit: 6, now: NOW }).map((p) => p.id));
    const fresh = discoveryPicks({ profile, region: 'villanova', limit: 6, now: NOW });
    expect(fresh.some((p) => !usual.has(p.id))).toBe(true);
    expect(fresh.every((p) => !['food', 'history-culture'].includes(primary(p)))).toBe(true);
  });
});

describe('rankTripPicks', () => {
  it('returns nothing without a pick type or a city', () => {
    expect(rankTripPicks({ pickType: null, profile, regionIds: ['villanova'] })).toEqual([]);
    expect(rankTripPicks({ pickType: 'usual', profile, regionIds: [] })).toEqual([]);
  });

  it('interleaves several cities and keeps to real catalog landmarks', () => {
    const picks = rankTripPicks({ pickType: 'new', profile, regionIds: ['villanova', 'philly'], limit: 6, now: NOW });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(6);
    const regions = new Set(picks.map((p) => p.regionId));
    expect(regions.size).toBe(2);
    expect(picks.every((p) => ALL_LANDMARKS.some((l) => l.id === p.id && l.regionId === p.regionId))).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('./leaderboard', () => ({ rankOf: (entries, idx) => entries.findIndex((x) => x.points === entries[idx].points) + 1 }));
vi.mock('./streaks', () => ({ displayStreakCount: (s) => (s?.live ? s.count : 0) }));

const { MISSING, joinedText, levelText, countriesOf, countText, friendStanding, lastCheckin, soloStreakDays } = await import('./friendProfile');

describe('friend profile helpers', () => {
  it('points and rank come from the friends leaderboard, ties share a rank', () => {
    const board = [{ userId: 'a', points: 500 }, { userId: 'b', points: 500 }, { userId: 'c', points: 10 }];
    expect(friendStanding(board, 'b')).toEqual({ points: '500', rank: '#1 of 3' });
    expect(friendStanding(board, 'c')).toEqual({ points: '10', rank: '#3 of 3' });
    expect(friendStanding(board, 'zz')).toEqual({ points: MISSING, rank: MISSING });
    expect(friendStanding(null, 'a')).toEqual({ points: MISSING, rank: MISSING });
  });
  it('counts countries from cities, and missing numbers read –', () => {
    expect(countriesOf(['miami', 'philly', 'madrid', 'milan'])).toBe(3);
    expect(countriesOf(undefined)).toBeNull();
    expect(countText(null)).toBe(MISSING);
    expect(countText(0)).toBe('0');
  });
  it('joined date, level and last check-in fall back to –', () => {
    expect(joinedText(null)).toBe(MISSING);
    expect(joinedText({ seconds: Date.UTC(2026, 2, 14, 12) / 1000 })).toMatch(/2026/);
    expect(levelText(null)).toBe(MISSING);
    expect(levelText({ totalPoints: 0 })).toBe('1');
    expect(lastCheckin([])).toEqual({ name: MISSING, city: MISSING, date: MISSING });
    expect(lastCheckin([{ ratingOnly: true, landmarkName: 'Rated' }]).name).toBe(MISSING);
  });
  it('a lapsed or missing solo streak is 0 days', () => {
    expect(soloStreakDays(null)).toBe(0);
    expect(soloStreakDays({ count: 5, live: false })).toBe(0);
    expect(soloStreakDays({ count: 5, live: true })).toBe(5);
  });
});

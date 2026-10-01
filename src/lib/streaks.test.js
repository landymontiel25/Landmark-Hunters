import { describe, it, expect } from 'vitest';
import {
  computeStreakDays,
  computeBadges,
  closestUnearnedBadge,
  hasCheckedInToday,
  hasSecuredStreakToday,
  msUntilStreakLapse,
  todaysActionCount,
  PICKS_STREAK_THRESHOLD,
} from './streaks';

const sec = (isoDate) => Math.floor(new Date(isoDate).getTime() / 1000);
const checkin = (isoDate) => ({ createdAt: { seconds: sec(isoDate) } });
const vote = (isoDate, landmarkId) => ({ at: new Date(isoDate).getTime(), landmarkId });
// PICKS_STREAK_THRESHOLD distinct-landmark votes on the same day.
const votesOn = (isoDate, count = PICKS_STREAK_THRESHOLD) =>
  Array.from({ length: count }, (_, i) => vote(isoDate, `landmark-${i}`));

describe('computeStreakDays', () => {
  it('is zero with no check-ins', () => {
    expect(computeStreakDays([])).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-10T08:00:00Z'), checkin('2026-03-09T08:00:00Z'), checkin('2026-03-08T08:00:00Z')];
    expect(computeStreakDays(checkins, now)).toBe(3);
  });

  it('still counts through yesterday if today has no check-in yet', () => {
    const now = new Date('2026-03-10T23:00:00Z');
    const checkins = [checkin('2026-03-09T08:00:00Z'), checkin('2026-03-08T08:00:00Z')];
    expect(computeStreakDays(checkins, now)).toBe(2);
  });

  it('is broken by a gap', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-10T08:00:00Z'), checkin('2026-03-07T08:00:00Z')];
    expect(computeStreakDays(checkins, now)).toBe(1);
  });

  it('is zero if the most recent check-in was more than a day ago', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-05T08:00:00Z')];
    expect(computeStreakDays(checkins, now)).toBe(0);
  });

  it('counts multiple check-ins on the same day as one day', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-10T08:00:00Z'), checkin('2026-03-10T20:00:00Z')];
    expect(computeStreakDays(checkins, now)).toBe(1);
  });

  it('counts a day with PICKS_STREAK_THRESHOLD distinct Mapr Picks votes the same as a check-in', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-09T08:00:00Z')];
    const feedback = votesOn('2026-03-10T08:00:00Z');
    expect(computeStreakDays(checkins, now, feedback)).toBe(2);
  });

  it('does not count a day with fewer than PICKS_STREAK_THRESHOLD votes', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-09T08:00:00Z')];
    const feedback = votesOn('2026-03-10T08:00:00Z', PICKS_STREAK_THRESHOLD - 1);
    expect(computeStreakDays(checkins, now, feedback)).toBe(1);
  });

  it('does not double-count repeat votes on the same landmark toward the threshold', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-09T08:00:00Z')];
    // Same landmark voted on PICKS_STREAK_THRESHOLD times -- only 1 distinct id.
    const feedback = Array.from({ length: PICKS_STREAK_THRESHOLD }, () => vote('2026-03-10T08:00:00Z', 'same-landmark'));
    expect(computeStreakDays(checkins, now, feedback)).toBe(1);
  });

  it('bridges a gap in check-ins with a qualifying picks-voting day', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const checkins = [checkin('2026-03-10T08:00:00Z'), checkin('2026-03-08T08:00:00Z')];
    const feedback = votesOn('2026-03-09T08:00:00Z');
    expect(computeStreakDays(checkins, now, feedback)).toBe(3);
  });
});

describe('hasCheckedInToday', () => {
  it('is true for a check-in earlier the same UTC day', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(hasCheckedInToday([checkin('2026-03-10T08:00:00Z')], now)).toBe(true);
  });

  it('is false with no check-ins today', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(hasCheckedInToday([checkin('2026-03-09T08:00:00Z')], now)).toBe(false);
  });
});

describe('hasSecuredStreakToday', () => {
  it('is true with a real check-in today, no votes needed', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(hasSecuredStreakToday([checkin('2026-03-10T08:00:00Z')], [], now)).toBe(true);
  });

  it('is true with PICKS_STREAK_THRESHOLD votes today, with no check-in at all', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(hasSecuredStreakToday([], votesOn('2026-03-10T08:00:00Z'), now)).toBe(true);
  });

  it('is false with neither a check-in nor enough votes today', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(hasSecuredStreakToday([], votesOn('2026-03-10T08:00:00Z', PICKS_STREAK_THRESHOLD - 1), now)).toBe(false);
  });

  it("ignores votes from a day other than today", () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(hasSecuredStreakToday([], votesOn('2026-03-09T08:00:00Z'), now)).toBe(false);
  });
});

describe('todaysActionCount', () => {
  it('counts distinct landmarks voted on today', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(todaysActionCount([], votesOn('2026-03-10T08:00:00Z', 2), now)).toBe(2);
  });

  it('ignores votes from a day other than today', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    expect(todaysActionCount([], votesOn('2026-03-09T08:00:00Z'), now)).toBe(0);
  });

  it('does not double-count repeat votes on the same landmark', () => {
    const now = new Date('2026-03-10T20:00:00Z');
    const feedback = Array.from({ length: 3 }, () => vote('2026-03-10T08:00:00Z', 'same-landmark'));
    expect(todaysActionCount([], feedback, now)).toBe(1);
  });
});

describe('computeBadges', () => {
  it('awards nothing below every threshold', () => {
    expect(computeBadges({ checkinsCount: 0, citiesCount: 0, streakDays: 0 })).toEqual([]);
  });

  it('awards the right milestones for a strong run', () => {
    const badges = computeBadges({ checkinsCount: 10, citiesCount: 3, streakDays: 7 });
    const ids = badges.map((b) => b.id);
    expect(ids).toContain('checkins-1');
    expect(ids).toContain('checkins-5');
    expect(ids).toContain('checkins-10');
    expect(ids).not.toContain('checkins-25');
    expect(ids).toContain('cities-2');
    expect(ids).toContain('cities-3');
    expect(ids).toContain('streak-3');
    expect(ids).toContain('streak-7');
    expect(ids).not.toContain('streak-30');
  });

  it('only awards the welcome badge once onboarding is marked complete', () => {
    const without = computeBadges({ checkinsCount: 0, citiesCount: 0, streakDays: 0 });
    expect(without.map((b) => b.id)).not.toContain('welcome');
    const withIt = computeBadges({ checkinsCount: 0, citiesCount: 0, streakDays: 0, onboardingCompleted: true });
    expect(withIt.map((b) => b.id)).toContain('welcome');
  });

  it('ignores extra-kind badges entirely when no extra counts are given', () => {
    const badges = computeBadges({ checkinsCount: 100, citiesCount: 3, streakDays: 30 });
    expect(badges.map((b) => b.id)).not.toContain('friend-finder');
  });

  it('awards extra-kind badges (numeric and boolean) once their counts are given', () => {
    const badges = computeBadges({
      checkinsCount: 0,
      citiesCount: 0,
      streakDays: 0,
      extra: { friends: 5, photoCheckins: 3, top10: true, nightOwl: false },
    });
    const ids = badges.map((b) => b.id);
    expect(ids).toContain('friend-finder');
    expect(ids).toContain('competitor'); // boolean true counts as >= 1
    expect(ids).not.toContain('photo-contributor'); // 3 < 10
    expect(ids).not.toContain('night-owl'); // boolean false
  });

  it('checkins-based expedition/cartographer stack on the same kind as checkins-25', () => {
    const ids = computeBadges({ checkinsCount: 100, citiesCount: 0, streakDays: 0 }).map((b) => b.id);
    expect(ids).toContain('checkins-25');
    expect(ids).toContain('expedition');
    expect(ids).toContain('cartographer');
  });
});

describe('closestUnearnedBadge', () => {
  it('picks the smallest remaining gap across kinds', () => {
    // 4 checkins -> 1 away from checkins-5; 0 cities -> 2 away from cities-2.
    const closest = closestUnearnedBadge({ checkinsCount: 4, citiesCount: 0, streakDays: 0 });
    expect(closest.id).toBe('checkins-5');
  });

  it('is null once every original-4-kind badge is earned', () => {
    // 100, not 25 -- expedition/cartographer share the same `checkins`
    // kind as checkins-25, at higher thresholds.
    expect(closestUnearnedBadge({ checkinsCount: 100, citiesCount: 3, streakDays: 30, onboardingCompleted: true })).toBeNull();
  });
});

describe('msUntilStreakLapse', () => {
  it('counts down to the next UTC midnight', () => {
    expect(msUntilStreakLapse(new Date('2026-03-10T19:00:00Z'))).toBe(5 * 60 * 60 * 1000);
    expect(msUntilStreakLapse(new Date('2026-03-10T23:59:59Z'))).toBe(1000);
  });

  it('is a full day right at midnight', () => {
    expect(msUntilStreakLapse(new Date('2026-03-10T00:00:00Z'))).toBe(24 * 60 * 60 * 1000);
  });
});

describe('displayStreakCount (lapsed stored streaks)', () => {
  const now = new Date(2026, 5, 10, 15, 0, 0);
  const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  it('keeps the count when completed today or yesterday', async () => {
    const { displayStreakCount } = await import('./streaks');
    expect(displayStreakCount({ count: 7, lastCompletedDay: key(now) }, now)).toBe(7);
    expect(displayStreakCount({ count: 7, lastCompletedDay: key(new Date(2026, 5, 9)) }, now)).toBe(7);
  });
  it('shows 0 once a day has been missed with no freeze', async () => {
    const { displayStreakCount } = await import('./streaks');
    expect(displayStreakCount({ count: 7, lastCompletedDay: key(new Date(2026, 5, 8)) }, now)).toBe(0);
  });
  it('keeps the count when today is frozen even if yesterday was missed', async () => {
    const { displayStreakCount } = await import('./streaks');
    const streak = { count: 7, lastCompletedDay: key(new Date(2026, 5, 8)), frozenDays: [key(now)] };
    expect(displayStreakCount(streak, now)).toBe(7);
  });
  it('keeps the count when yesterday was frozen', async () => {
    const { displayStreakCount } = await import('./streaks');
    const streak = { count: 7, lastCompletedDay: key(new Date(2026, 5, 8)), frozenDays: [key(new Date(2026, 5, 9))] };
    expect(displayStreakCount(streak, now)).toBe(7);
  });
});

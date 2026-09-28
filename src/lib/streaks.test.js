import { describe, it, expect } from 'vitest';
import { computeBadges, closestUnearnedBadge, msUntilStreakLapse, todaysActionCount, PICKS_STREAK_THRESHOLD } from './streaks';

const vote = (isoDate, landmarkId) => ({ at: new Date(isoDate).getTime(), landmarkId });
// PICKS_STREAK_THRESHOLD distinct-landmark votes on the same day.
const votesOn = (isoDate, count = PICKS_STREAK_THRESHOLD) =>
  Array.from({ length: count }, (_, i) => vote(isoDate, `landmark-${i}`));

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

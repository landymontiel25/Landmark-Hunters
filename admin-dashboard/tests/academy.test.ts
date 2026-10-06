import { describe, it, expect } from 'vitest';
import { academyCards } from '@/lib/academy';
import type { AppMetricCard } from '@/lib/types';

const m = (id: string, value: number | null, extra: Partial<AppMetricCard> = {}): AppMetricCard => ({ id, label: id, value, status: 'unknown', ...extra });

describe('Horowitz Andreesen Academy cards', () => {
  it('shows real values with their sample sizes and the 75% match target', () => {
    const cards = academyCards([
      m('matchRate', 80, { unit: '%', n: 4, nLabel: 'users with 10+ ratings', baseline: { value: 61.2, unit: '%', label: 'Always guessing the usual answer' } }),
      m('retentionD1', 50, { unit: '%', status: 'met', n: 6, nLabel: 'users old enough' }),
      m('retentionD7', 25, { unit: '%', status: 'info', n: 4, nLabel: 'users old enough' }),
      m('retentionD30', null, { status: 'unknown', n: 0 }),
      m('weeklyUsers', 3, { n: 7, nLabel: 'accounts in total', newUsers: 1, weekly: [{ weekEnding: '2026-10-05', active: 3, newUsers: 1 }] }),
      m('ratingsPerActiveUserWeek', 3.456, { n: 5, nLabel: 'active users, last 7 days' }),
      m('viralSignupRate', 0, { unit: '%', status: 'missed', goal: 'above 40%', n: 3, nLabel: 'new users, last 30 days' }),
    ]);
    expect(cards.map((c) => c.key)).toEqual(['match', 'retention', 'users', 'ratings', 'invite']);
    expect(cards[0]).toMatchObject({ status: 'met' });
    expect(cards[0].rows[0]).toMatchObject({ value: '80%' });
    expect(cards[0].rows[0].detail).toContain('Target 75%');
    expect(cards[0].rows[0].detail).toContain('4 users with 10+ ratings');
    expect(cards[0].rows[1].value).toBe('61.2%');
    expect(cards[1].rows.map((r) => r.value)).toEqual(['50%', '25%', 'Not measured yet']);
    expect(cards[2].rows.map((r) => r.value)).toEqual(['3', '1']);
    expect(cards[2].table).toEqual([{ label: '2026-10-05', active: 3, newUsers: 1 }]);
    expect(cards[3].rows[0].value).toBe('3.46');
    expect(cards[4]).toMatchObject({ status: 'missed' });
    expect(cards[4].rows[0].value).toBe('0%');
  });
  it('match is red below 75% even when the app goal is 70%', () => {
    expect(academyCards([m('matchRate', 72, { unit: '%', status: 'met', n: 3 })])[0].status).toBe('missed');
  });
  it('never invents a number: missing data reads Not measured yet', () => {
    const cards = academyCards([]);
    expect(cards[0].rows[0].value).toBe('Not measured yet');
    expect(cards[2].rows[0].value).toBe('Not measured yet');
    expect(cards[2].table).toBeUndefined();
    for (const c of cards) expect(c.status).toBe('unknown');
  });
});

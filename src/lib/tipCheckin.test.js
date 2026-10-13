import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: null }));
const { pickTipCheckin } = await import('./tipCheckin.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const ts = (ms) => ({ toMillis: () => ms });

describe('pickTipCheckin', () => {
  it('takes the newest verified real visit from the last 30 days', () => {
    const out = pickTipCheckin([
      { id: 'a', userId: 'me', createdAt: ts(NOW - 5 * DAY), presence: { verified: true } },
      { id: 'b', userId: 'me', createdAt: ts(NOW - 1 * DAY), presence: { verified: true } },
      { id: 'c', userId: 'me', createdAt: ts(NOW - 0.5 * DAY), presence: { verified: false } },
      { id: 'd', userId: 'me', createdAt: ts(NOW - 0.2 * DAY), presence: { verified: true }, ratingOnly: true },
      { id: 'e', userId: 'me', createdAt: ts(NOW - 40 * DAY), presence: { verified: true } },
    ], NOW, 'me');
    expect(out).toEqual({ id: 'b', at: NOW - DAY });
  });
  it('is null without one', () => {
    expect(pickTipCheckin([{ id: 'x', createdAt: ts(NOW), verification: 'verified' }], NOW)).toBeNull();
    expect(pickTipCheckin([], NOW)).toBeNull();
  });
});

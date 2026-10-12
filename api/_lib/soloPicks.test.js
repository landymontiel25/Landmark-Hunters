import { describe, it, expect } from 'vitest';
import { distinctActionsOn, localDayWindow } from './soloPicks.js';

describe('localDayWindow', () => {
  it('is 24 hours with one offset (old clients)', () => {
    const w = localDayWindow('2026-9-8', 240);
    expect(w.start).toBe(Date.UTC(2026, 9, 8, 4));
    expect(w.end - w.start).toBe(24 * 3600 * 1000);
  });
  it('is 23 hours on the spring-forward day in New York', () => {
    // 8 Mar 2026: local midnight is 05:00Z, the next one 04:00Z.
    const w = localDayWindow('2026-2-8', 300, 240);
    expect(w.start).toBe(Date.UTC(2026, 2, 8, 5));
    expect(w.end).toBe(Date.UTC(2026, 2, 9, 4));
  });
  it('ignores an implausible end offset', () => {
    const w = localDayWindow('2026-9-8', 240, 9999);
    expect(w.end - w.start).toBe(24 * 3600 * 1000);
  });
});

describe('distinctActionsOn', () => {
  it('counts check-ins, ratings and Travel Picks answers toward the daily 3', () => {
    const w = localDayWindow('2026-9-12', 240);
    const at = w.start + 3600 * 1000;
    const picks = [{ landmarkId: 'a', verdict: 'yes', at }];
    const checkins = [
      { landmarkId: 'b', visited: true, points: 0, createdAt: { seconds: at / 1000 } },
      { landmarkId: 'c', ratingOnly: true, visited: false, createdAt: { seconds: at / 1000 } },
      { landmarkId: 'd', visited: true, createdAt: { seconds: (w.start - 1000) / 1000 } },
    ];
    expect(distinctActionsOn(picks, checkins, w)).toBe(3);
  });
});

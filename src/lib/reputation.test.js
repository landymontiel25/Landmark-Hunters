import { describe, it, expect } from 'vitest';
import { decay, EVENT_WEIGHTS, levelsFor, PERSON_CAP, reachesEveryone, reputation01, reputationScore, trustOf } from './reputation.js';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86400000;

describe('step 8: event weights', () => {
  it('helpful 1, saved 2, went 10, loved 5', () => {
    expect(EVENT_WEIGHTS).toEqual({ helpful: 1, saved: 2, went: 10, loved: 5 });
  });
});

describe('step 9: local reputation', () => {
  it('caps one person at 15 (so loved and saved still count above went)', () => {
    expect(PERSON_CAP).toBe(15);
    const ev = ['went', 'loved', 'saved', 'helpful'].map((k) => ({ actorUid: 'a', weight: EVENT_WEIGHTS[k], at: NOW }));
    expect(reputationScore(ev, { finderUid: 'f', nowMs: NOW, trust: () => 1 })).toEqual({ score: 15, people: 1 });
    const two = [{ actorUid: 'a', weight: 10, at: NOW }, { actorUid: 'a', weight: 5, at: NOW }];
    expect(reputationScore(two, { finderUid: 'f', nowMs: NOW, trust: () => 1 }).score).toBe(15);
  });
  it('halves every 180 days', () => {
    expect(decay(0)).toBe(1);
    expect(decay(180)).toBeCloseTo(0.5, 6);
    expect(decay(360)).toBeCloseTo(0.25, 6);
    const old = [{ actorUid: 'a', weight: 10, at: NOW - 180 * DAY }];
    expect(reputationScore(old, { finderUid: 'f', nowMs: NOW, trust: () => 1 }).score).toBeCloseTo(5, 6);
  });
  it('multiplies by trust and ignores the finder\'s own events', () => {
    const ev = [{ actorUid: 'a', weight: 10, at: NOW }, { actorUid: 'f', weight: 10, at: NOW }];
    expect(reputationScore(ev, { finderUid: 'f', nowMs: NOW, trust: () => 0.3 })).toEqual({ score: 3, people: 1 });
  });
  it('trust: friends 0.5, established accounts 1.0, others 0.3', () => {
    expect(trustOf({ isFriend: true, verifiedCheckins: 9, accountAgeDays: 99 })).toBe(0.5);
    expect(trustOf({ verifiedCheckins: 3, accountAgeDays: 15 })).toBe(1);
    expect(trustOf({ verifiedCheckins: 3, accountAgeDays: 14 })).toBe(0.3);
    expect(trustOf({ verifiedCheckins: 2, accountAgeDays: 99 })).toBe(0.3);
  });
  it('a new account adds at most 4.5; three fake accounts can\'t reach Local', () => {
    const fakes = ['x', 'y', 'z'].flatMap((u) => [{ actorUid: u, weight: 10, at: NOW }, { actorUid: u, weight: 5, at: NOW }]);
    const { score, people } = reputationScore(fakes, { finderUid: 'f', nowMs: NOW, trust: () => trustOf({}) });
    expect(score).toBeCloseTo(13.5, 6);
    expect(levelsFor([{ uid: 'f', score, people }]).get('f')).toBeUndefined();
  });
});

describe('levels', () => {
  it('Local 20 from 3 people, Trusted 80 from 10, Insider 250 from 25 and the top 5%', () => {
    const scores = [
      { uid: 'local', score: 20, people: 3 },
      { uid: 'few', score: 50, people: 2 },
      { uid: 'trusted', score: 80, people: 10 },
      { uid: 'insider', score: 300, people: 25 },
      ...Array.from({ length: 30 }, (_, i) => ({ uid: `n${i}`, score: 1, people: 1 })),
    ];
    const lv = levelsFor(scores);
    expect(lv.get('local')).toBe('Local');
    expect(lv.get('few')).toBeUndefined();
    expect(lv.get('trusted')).toBe('Trusted');
    expect(lv.get('insider')).toBe('Insider');
  });
  it('outside the top 5% an Insider-sized score is Trusted', () => {
    const scores = [
      { uid: 'a', score: 400, people: 30 },
      { uid: 'b', score: 300, people: 30 },
      ...Array.from({ length: 18 }, (_, i) => ({ uid: `n${i}`, score: 1, people: 1 })),
    ];
    const lv = levelsFor(scores);
    expect(lv.get('a')).toBe('Insider');
    expect(lv.get('b')).toBe('Trusted');
  });
  it('reputation for finder weight is score / 250, capped at 1; Trusted and Insider reach everyone', () => {
    expect(reputation01(125)).toBe(0.5);
    expect(reputation01(999)).toBe(1);
    expect(reputation01(0)).toBe(0);
    expect(reachesEveryone('Trusted')).toBe(true);
    expect(reachesEveryone('Local')).toBe(false);
  });
});

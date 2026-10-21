import { describe, it, expect } from 'vitest';
import { PHOTO_BONUS_POINTS, PHOTO_BONUSES_PER_DAY, photoBonusDecision } from './photoBonus.js';

// The photo bonus: +10 for a photo at a place you really checked in to,
// once per place, a few places a day.
const visit = { userId: 'u', points: 100, visited: true, ratingOnly: false, photoURLs: ['a.jpg'] };
const decide = (over) => photoBonusDecision({ uid: 'u', checkin: visit, review: null, paid: false, today: 0, ...over });

describe('photoBonusDecision', () => {
  it('pays for a photo on a real check-in', () => {
    expect(decide()).toEqual({ awarded: PHOTO_BONUS_POINTS });
    expect(decide({ checkin: { ...visit, photoURLs: undefined, photoURL: 'old.jpg' } }).awarded).toBe(PHOTO_BONUS_POINTS);
  });

  it('counts a photo saved on your rating of a place you checked in to', () => {
    const checkin = { ...visit, photoURLs: [] };
    expect(decide({ checkin, review: { userId: 'u', photoURLs: ['r.jpg'] } }).awarded).toBe(PHOTO_BONUS_POINTS);
    expect(decide({ checkin, review: { userId: 'someone-else', photoURLs: ['r.jpg'] } })).toEqual({ awarded: 0, reason: 'no-photo' });
  });

  it('pays nothing without a real check-in, without a photo, twice, or past the daily limit', () => {
    expect(decide({ checkin: null }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, userId: 'x' } }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, ratingOnly: true } }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, visited: false } }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, photoURLs: [] } }).reason).toBe('no-photo');
    expect(decide({ paid: true }).reason).toBe('already');
    expect(decide({ today: PHOTO_BONUSES_PER_DAY }).reason).toBe('daily-limit');
    expect(decide({ today: PHOTO_BONUSES_PER_DAY - 1 }).awarded).toBe(PHOTO_BONUS_POINTS);
  });

  it('stays small next to a first check-in', () => {
    expect(PHOTO_BONUS_POINTS).toBe(10);
    expect(PHOTO_BONUS_POINTS * PHOTO_BONUSES_PER_DAY).toBeLessThanOrEqual(100);
  });
});

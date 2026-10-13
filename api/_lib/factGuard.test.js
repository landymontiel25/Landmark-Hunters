import { describe, it, expect } from 'vitest';
import { guardReply, travelClaims, CANT_CHECK_DISTANCE, NEED_LOCATION } from './factGuard.js';

const KRES = { from: { name: 'Kres Chophouse' }, to: { name: 'House of Blues Orlando' }, mode: 'driving', miles: 14.6, km: 23.5, minutes: 23, minutesWithoutTraffic: 19 };

describe('fact guard: distances and travel times', () => {
  it('keeps numbers that match the real route', () => {
    const t = 'Kres Chophouse is 14.6 miles from House of Blues Orlando, about 23 minutes by car.';
    expect(guardReply(t, { routes: [KRES], askedTravel: true })).toEqual({ reply: t, removed: [] });
  });

  it('replaces a made-up distance with the real one', () => {
    const { reply, removed } = guardReply('Kres is about 7 miles away, roughly 12 minutes by car.', { routes: [KRES], askedTravel: true });
    expect(removed.map((r) => r.text)).toEqual(expect.arrayContaining(['7 miles']));
    expect(reply).not.toMatch(/\b7 miles/);
    expect(reply).toContain('14.6 mi, about 23 min driving');
  });

  it('says it could not check when there is no route at all', () => {
    const { reply } = guardReply('It is about 7 miles, 15 minutes away.', { routes: [], askedTravel: true });
    expect(reply).toBe(CANT_CHECK_DISTANCE);
  });

  it('asks for location when that is what blocked the lookup', () => {
    expect(guardReply('About 10 minutes away.', { askedTravel: true, locationOff: true }).reply).toBe(NEED_LOCATION);
  });

  it('cuts a guessed distance out of a recommendation and keeps the rest', () => {
    const { reply } = guardReply('Try Joe Stone Crab (a quick 10-minute drive), then Vizcaya, just 5 min away by car.', {});
    expect(reply).toMatch(/^Try Joe Stone Crab, then Vizcaya\./);
    expect(reply).not.toMatch(/10-minute|5 min/);
  });

  it('reads decimals, ranges, words and hours-plus-minutes whole', () => {
    const c = travelClaims('It is 14.6 miles, 20-25 minutes by car, or an hour and a half on foot; 1 hr 24 min driving.');
    expect(c.map((x) => [x.lo, x.hi])).toEqual([[14.6, 14.6], [84, 84], [90, 90], [20, 25]]);
  });

  it('leaves visit lengths and app how-tos alone', () => {
    for (const t of ['Plan to spend about 2 hours at the museum.', 'It takes about 2 minutes to add a landmark.', 'The tour runs 90 minutes.']) {
      expect(guardReply(t, {}).reply).toBe(t);
    }
  });

  it('treats vague closeness as a claim', () => {
    expect(guardReply('Vizcaya is a short walk from you.', {}).removed[0]).toMatchObject({ why: 'travel' });
  });
});

describe('fact guard: hours, prices, ratings', () => {
  const hours = [{ name: 'Joe', openNow: true, closesAt: '9:00 PM', today: '11:00 AM – 9:00 PM' }];
  it('keeps hours that match the place_hours lookup and cuts ones that do not', () => {
    expect(guardReply("Joe's is open now and closes at 9 PM.", { hoursLookups: hours }).removed).toEqual([]);
    const bad = guardReply("Joe's is open until 11 PM.", { hoursLookups: hours });
    expect(bad.removed[0]).toMatchObject({ why: 'hours' });
    expect(bad.reply).toMatch(/couldn't confirm their hours/);
  });

  it('cuts hours, prices and ratings with no lookup behind them', () => {
    const { removed } = guardReply("Joe's opens at 5 pm, costs $60 a head and is rated 4.7 stars.", {});
    expect(removed.map((r) => r.why).sort()).toEqual(['hours', 'price', 'rating']);
  });

  it('trusts them when the reply searched the web', () => {
    const t = "Joe's opens at 5 pm and tickets are $25.";
    expect(guardReply(t, { webSearches: 1 }).reply).toBe(t);
  });
});

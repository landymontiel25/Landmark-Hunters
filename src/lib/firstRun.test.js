import { describe, it, expect } from 'vitest';
import {
  PROGRESS_GOAL,
  SWIPES,
  firstRunKey,
  firstRunReducer as r,
  initialFirstRun,
  loadFirstRun,
  mergeFirstRun,
  saveFirstRun,
} from './firstRun';

// The owner's First-Run Tutorial Build Guide, acceptance tests T2, T3, T5,
// T6, T9/T10 (per account) and T16 (every transition).
const at = (step, extra = {}) => ({ ...initialFirstRun(0), step, ...extra });
const place = { id: 'p1', name: 'Place 1' };

describe('firstRunReducer (T16)', () => {
  it('NEXT walks welcome, taste, swipe, checkin, progress, done', () => {
    let s = initialFirstRun(0);
    expect(s.step).toBe('welcome');
    s = r(s, { type: 'NEXT', now: 1 });
    expect(s.step).toBe('taste');
    s = r(s, { type: 'NEXT', chips: ['food', 'sports', 'parks-nature'], now: 2 });
    expect(s).toMatchObject({ step: 'swipe', tasteChips: ['food', 'sports', 'parks-nature'] });
    s = r(s, { type: 'NEXT', now: 3 });
    expect(s.step).toBe('checkin');
    s = r(s, { type: 'NEXT', now: 4 });
    expect(s.step).toBe('progress');
    s = r(s, { type: 'NEXT', now: 5 });
    expect(s).toMatchObject({ step: 'done', outcome: 'done', completedAt: 5 });
  });

  it('swipes count to 3 (T5), then go to check-in', () => {
    let s = at('swipe');
    for (let i = 0; i < SWIPES; i++) s = r(s, { type: 'SWIPE', dir: 'not_for_me' });
    expect(s).toMatchObject({ swipesDone: 3, step: 'checkin' });
    // A late swipe after the cards are done changes nothing.
    expect(r(s, { type: 'SWIPE', dir: 'interested', place })).toBe(s);
  });

  it('the first Interested asks for one rating (T6); later ones do not', () => {
    let s = r(at('swipe'), { type: 'SWIPE', dir: 'interested', place });
    expect(s).toMatchObject({ step: 'rate', swipesDone: 1, ratePlace: place });
    s = r(s, { type: 'RATE', label: 'highly-recommend' });
    expect(s).toMatchObject({ step: 'swipe', ratingsCount: 1, ratePlace: null });
    s = r(s, { type: 'SWIPE', dir: 'interested', place });
    expect(s).toMatchObject({ step: 'swipe', swipesDone: 2, ratingsCount: 1 });
  });

  it('a rating on the third card goes on to check-in', () => {
    const s = r(r(at('swipe', { swipesDone: 2 }), { type: 'SWIPE', dir: 'interested', place }), { type: 'RATE', label: 'worth-trying' });
    expect(s).toMatchObject({ step: 'checkin', ratingsCount: 1 });
  });

  it('RATE and CHECKIN_OK only count on their own step', () => {
    const s = at('swipe');
    expect(r(s, { type: 'RATE', label: 'x' })).toBe(s);
    expect(r(s, { type: 'CHECKIN_OK' })).toBe(s);
    expect(r(at('checkin'), { type: 'CHECKIN_OK' })).toMatchObject({ step: 'progress', checkinsCount: 1 });
  });

  it('DISMISS_HINT marks a hint once; RESET keeps hints and starts over', () => {
    let s = r(at('checkin', { swipesDone: 3, ratingsCount: 1 }), { type: 'DISMISS_HINT', key: 'itinerary_reorder' });
    expect(s.hintsShown).toEqual({ itinerary_reorder: true });
    expect(r(s, { type: 'DISMISS_HINT', key: 'itinerary_reorder' })).toBe(s);
    s = r(s, { type: 'RESET', now: 9 });
    expect(s).toMatchObject({ step: 'welcome', swipesDone: 0, ratingsCount: 0, startedAt: 9, hintsShown: { itinerary_reorder: true } });
  });

  it('SIGNUP_NOT_NOW counts, so the prompt can wait before it returns', () => {
    expect(r(r(at('done'), { type: 'SIGNUP_NOT_NOW' }), { type: 'SIGNUP_NOT_NOW' }).signupDismissals).toBe(2);
  });

  it('unknown actions change nothing', () => {
    const s = at('taste');
    expect(r(s, { type: 'NOPE' })).toBe(s);
  });
});

describe('skip (T2, T3)', () => {
  it('Skip step moves on and marks the step skipped, on every step', () => {
    const next = { welcome: 'taste', taste: 'swipe', swipe: 'checkin', checkin: 'progress', progress: 'done' };
    for (const [step, to] of Object.entries(next)) {
      const s = r(at(step), { type: 'SKIP_STEP', now: 1 });
      expect(s.step).toBe(to);
      expect(s.skippedSteps).toContain(step);
    }
  });

  it('skipping the taste pick keeps the default mix (no chips)', () => {
    expect(r(at('taste'), { type: 'SKIP_STEP' }).tasteChips).toEqual([]);
  });

  it('skipping the rating hides it for that place and goes back to the cards; no score changes', () => {
    const rating = r(at('swipe'), { type: 'SWIPE', dir: 'interested', place });
    const s = r(rating, { type: 'SKIP_STEP' });
    expect(s).toMatchObject({ step: 'swipe', ratingsCount: 0, ratePlace: null });
    expect(s.skippedSteps).toContain('rate');
    // Rating was skipped, so the next Interested doesn't ask again.
    expect(r(s, { type: 'SWIPE', dir: 'interested', place }).step).toBe('swipe');
  });

  it('Skip all ends the flow from any step, and nothing brings a step back', () => {
    for (const step of ['welcome', 'taste', 'swipe', 'rate', 'checkin', 'progress']) {
      const s = r(at(step), { type: 'SKIP_ALL', now: 7 });
      expect(s).toMatchObject({ step: 'skipped', outcome: 'skipped', completedAt: 7 });
      for (const type of ['NEXT', 'SKIP_STEP', 'SKIP_ALL']) expect(r(s, { type })).toBe(s);
      expect(r(s, { type: 'SWIPE', dir: 'interested', place })).toBe(s);
    }
  });
});

describe('storage (T9, T10)', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  };

  it('saves per account: account A never shows for account B', () => {
    const store = memory();
    saveFirstRun('A', { ...initialFirstRun(0), step: 'checkin', hintsShown: { x: true } }, store);
    expect(loadFirstRun('A', store)).toMatchObject({ step: 'checkin', hintsShown: { x: true } });
    expect(loadFirstRun('B', store)).toMatchObject({ step: 'welcome', hintsShown: {} });
    expect(firstRunKey(null)).toBe('lh.firstRunLab.guest');
  });

  it('bad saved data or blocked storage starts fresh', () => {
    expect(loadFirstRun('A', { getItem: () => '{oops' }).step).toBe('welcome');
    expect(loadFirstRun('A', { getItem: () => { throw new Error('blocked'); } }).step).toBe('welcome');
    expect(() => saveFirstRun('A', initialFirstRun(), { setItem: () => { throw new Error('full'); } })).not.toThrow();
  });

  it('merging a guest into an account never lowers a count', () => {
    const account = { ...initialFirstRun(0), swipesDone: 1, ratingsCount: 4, checkinsCount: 0, skippedSteps: ['taste'], hintsShown: { a: true } };
    const guest = { ...initialFirstRun(0), swipesDone: 3, ratingsCount: 1, checkinsCount: 1, skippedSteps: ['rate'], hintsShown: { b: true } };
    expect(mergeFirstRun(account, guest)).toMatchObject({
      swipesDone: 3,
      ratingsCount: 4,
      checkinsCount: 1,
      skippedSteps: ['taste', 'rate'],
      hintsShown: { a: true, b: true },
    });
    expect(mergeFirstRun(account, null)).toBe(account);
  });

  it('the progress goal is a config value', () => {
    expect([10, 15]).toContain(PROGRESS_GOAL);
  });
});

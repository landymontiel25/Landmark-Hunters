import { describe, it, expect } from 'vitest';
import {
  NO_SKIP,
  ORDER,
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
  it('NEXT walks every step in order, onboarding around the guide', () => {
    let s = initialFirstRun(0);
    const seen = [s.step];
    while (s.step !== 'done') {
      s = r(s, { type: 'NEXT', chips: s.step === 'taste' ? ['food', 'sports', 'parks-nature'] : undefined, now: 5 });
      seen.push(s.step);
    }
    expect(seen).toEqual(ORDER);
    expect(seen.slice(0, 4)).toEqual(['signup', 'verify', 'welcome', 'taste']);
    expect(s).toMatchObject({ outcome: 'done', completedAt: 5, tasteChips: ['food', 'sports', 'parks-nature'] });
  });

  it('JUMP goes straight to any step and keeps the counts; unknown steps are ignored', () => {
    const s = r(at('checkin', { swipesDone: 3, ratingsCount: 1 }), { type: 'JUMP', step: 'taste' });
    expect(s).toMatchObject({ step: 'taste', swipesDone: 3, ratingsCount: 1 });
    expect(r(at('skipped', { outcome: 'skipped' }), { type: 'JUMP', step: 'welcome' })).toMatchObject({ step: 'welcome', outcome: null });
    expect(r(s, { type: 'JUMP', step: 'rate' })).toBe(s);
  });

  it('swipes count to 3 (T5), then go on to "anything else"', () => {
    let s = at('swipe');
    for (let i = 0; i < SWIPES; i++) s = r(s, { type: 'SWIPE', dir: 'not_for_me' });
    expect(s).toMatchObject({ swipesDone: 3, step: 'notes' });
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

  it('a rating on the third card goes on past the cards', () => {
    const s = r(r(at('swipe', { swipesDone: 2 }), { type: 'SWIPE', dir: 'interested', place }), { type: 'RATE', label: 'worth-trying' });
    expect(s).toMatchObject({ step: 'notes', ratingsCount: 1 });
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
    expect(s).toMatchObject({ step: 'signup', swipesDone: 0, ratingsCount: 0, startedAt: 9, hintsShown: { itinerary_reorder: true } });
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
    const next = { welcome: 'taste', taste: 'swipe', swipe: 'notes', notes: 'places', places: 'checkin', checkin: 'progress', progress: 'location', location: 'tabs', tabs: 'done' };
    for (const [step, to] of Object.entries(next)) {
      const s = r(at(step), { type: 'SKIP_STEP', now: 1 });
      expect(s.step).toBe(to);
      expect(s.skippedSteps).toContain(step);
    }
  });

  it('sign-up and email verification cannot be skipped', () => {
    for (const step of NO_SKIP) {
      const s = at(step);
      expect(r(s, { type: 'SKIP_STEP' })).toBe(s);
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
    for (const step of ['welcome', 'taste', 'swipe', 'rate', 'notes', 'places', 'checkin', 'progress', 'location', 'tabs']) {
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
    expect(loadFirstRun('B', store)).toMatchObject({ step: 'signup', hintsShown: {} });
    expect(firstRunKey(null)).toBe('lh.firstRunLab.guest');
  });

  it('bad saved data or blocked storage starts fresh', () => {
    expect(loadFirstRun('A', { getItem: () => '{oops' }).step).toBe('signup');
    expect(loadFirstRun('A', { getItem: () => { throw new Error('blocked'); } }).step).toBe('signup');
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

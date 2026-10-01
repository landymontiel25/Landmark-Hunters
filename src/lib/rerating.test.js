import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DISAGREEMENT_NEW_WEIGHT,
  DISAGREEMENT_OLD_WEIGHT,
  PLACE_RATING_DELTA,
  RATING_TAG_DELTA,
  TAP_TAG_DELTA,
} from './maprConstants';
import { disagreementCheck, levelGap, ratedAtMs, reasonFromComment, reasonKind } from './rerating';
import { COMMENT_MAX } from './ratingFlow';

// Same tiny in-memory Firestore as maprLearning.test.js.
const store = new Map();
vi.mock('firebase/firestore', () => {
  const snap = (path) => ({ exists: () => store.has(path), data: () => store.get(path) });
  const deepMerge = (a = {}, b = {}) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
    }
    return out;
  };
  return {
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    getDoc: async (ref) => snap(ref.path),
    runTransaction: async (_db, fn) => {
      const writes = new Map();
      const result = await fn({
        get: async (ref) => snap(ref.path),
        set: (ref, data, opts) => {
          const base = writes.has(ref.path) ? writes.get(ref.path) : store.get(ref.path);
          writes.set(ref.path, opts?.merge ? deepMerge(base || {}, data) : data);
        },
        delete: (ref) => writes.set(ref.path, null),
      });
      for (const [p, v] of writes) (v ? store.set(p, v) : store.delete(p));
      return result;
    },
    setDoc: async (ref, data) => {
      store.set(ref.path, data);
    },
    deleteDoc: async (ref) => store.delete(ref.path),
    serverTimestamp: () => 0,
    arrayUnion: (x) => x,
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
    addDoc: vi.fn(),
  };
});
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('./firebase', () => ({ db: {}, storage: null }));

import { submitReview, deleteMyReview, saveMyComment, previewDisagreement } from './reviews';
import { setPickFeedback } from './pickFeedback';

const LM = { id: 'lm1', name: 'Cafe', region: 'r', categories: ['food'] };
const user = () => store.get('users/u1') || {};
const place = () => store.get('users/u1/place_scores/lm1');
const review = () => store.get('reviews/u1_lm1');
const food = () => user().tagScores?.r?.food ?? 0;
const count = () => user().tagCounts?.r?.food ?? 0;
const L = 'highly-recommend';
const OK = 'worth-trying';
const D = 'probably-skip';

let clock = 1_000_000;
const rate = (tier, extra = {}, disagreement) =>
  submitReview({ userId: 'u1', userName: 'u', landmark: LM, rating: { tier, ...extra }, disagreement });
const later = () => {
  clock += 1000;
};
const tap = async (verdict) => {
  later();
  await setPickFeedback({ uid: 'u1', landmark: LM, verdict });
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  store.clear();
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const mem = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  });
});

describe('helpers', () => {
  it('levelGap and reasonKind', () => {
    expect(levelGap('positive', 'negative')).toBe(2);
    expect(levelGap('positive', 'neutral')).toBe(1);
    expect(levelGap('neutral', 'neutral')).toBe(0);
    for (const r of ['food', 'service', 'price', 'noise-crowd']) expect(reasonKind(r)).toBe('place-only');
    for (const r of ['changed-mind', 'wrong-type']) expect(reasonKind(r)).toBe('full');
    expect(reasonKind('one-off')).toBe('one-off');
    expect(reasonKind('skip')).toBe('blend');
    expect(reasonKind('other')).toBe('blend');
    expect(reasonKind(null)).toBeNull();
  });

  it('disagreementCheck: only two levels apart on the user\'s OWN answers', () => {
    const rated = (tier) => ({ ratingTier: tier });
    expect(disagreementCheck({ prev: rated(L), newTier: D })).toMatchObject({ needed: true, oldKind: 'rating', oldLevel: 'positive', newLevel: 'negative' });
    expect(disagreementCheck({ prev: rated(D), newTier: L }).needed).toBe(true);
    expect(disagreementCheck({ prev: rated(L), newTier: OK }).needed).toBe(false);
    expect(disagreementCheck({ prev: rated(OK), newTier: D }).needed).toBe(false);
    expect(disagreementCheck({ prev: rated(L), newTier: L }).needed).toBe(false);
    // a first rating with nothing before it (Mapr's guess is not an answer)
    expect(disagreementCheck({ prev: null, place: null, newTier: D }).needed).toBe(false);
    // tap then rating
    expect(disagreementCheck({ place: { tap: 'positive' }, newTier: D })).toMatchObject({ needed: true, oldKind: 'tap' });
    expect(disagreementCheck({ place: { tap: 'negative' }, newTier: L }).needed).toBe(true);
    expect(disagreementCheck({ place: { tap: 'positive' }, newTier: OK }).needed).toBe(false);
    expect(disagreementCheck({ place: { tap: 'neutral' }, newTier: D }).needed).toBe(false);
    // an earlier rating wins over a stale tap, so it is not asked again and again
    expect(disagreementCheck({ prev: rated(D), place: { tap: 'positive' }, newTier: D }).needed).toBe(false);
  });

  it('reasonFromComment reads the existing lexicon and ignores what gives no signal', () => {
    expect(reasonFromComment('way too loud in there')).toBe('noise-crowd');
    expect(reasonFromComment('so crowded')).toBe('noise-crowd');
    expect(reasonFromComment('overpriced for what it is')).toBe('price');
    expect(reasonFromComment('the food was terrible')).toBe('food');
    expect(reasonFromComment('rude staff and slow service')).toBe('service');
    expect(reasonFromComment('not loud at all')).toBeNull(); // negated complaint says nothing
    expect(reasonFromComment('I just felt like it')).toBeNull();
    expect(reasonFromComment('')).toBeNull();
    expect(reasonFromComment(undefined)).toBeNull();
  });

  it('ratedAtMs falls back to updatedAt for old docs', () => {
    expect(ratedAtMs({ ratedAt: 5, updatedAt: { seconds: 9 } })).toBe(5);
    expect(ratedAtMs({ updatedAt: { seconds: 9 } })).toBe(9000);
    expect(ratedAtMs({ updatedAt: { toMillis: () => 42 } })).toBe(42);
    expect(ratedAtMs({})).toBeNull();
    expect(ratedAtMs(null)).toBeNull();
  });
});

describe('ratedAt, priorTier, priorRatedAt', () => {
  it('first rating stores ratedAt and no prior fields', async () => {
    await rate(L);
    expect(review().ratedAt).toBe(clock);
    expect(review().priorTier).toBeUndefined();
    expect(review().priorRatedAt).toBeUndefined();
  });

  it('a re-rating keeps ratedAt forever and saves the old level and when it was given', async () => {
    await rate(L);
    const first = clock;
    later();
    await rate(OK);
    expect(review().ratedAt).toBe(first);
    expect(review().priorTier).toBe(L);
    expect(review().priorRatedAt).toBe(first);
    later();
    const second = clock;
    await rate(D);
    expect(review().ratedAt).toBe(first); // never overwritten
    expect(review().priorTier).toBe(OK);
    expect(review().priorRatedAt).toBe(second - 1000); // when the OK answer was given
    expect(review().ratingTier).toBe(D);
  });

  it('saving the same level again (an edit) neither moves ratedAt nor replaces the prior level', async () => {
    await rate(L);
    later();
    await rate(OK);
    later();
    await rate(OK, { comment: 'edit' });
    expect(review().priorTier).toBe(L);
    expect(review().ratedAt).toBe(1_000_000);
  });

  it('an old review with no ratedAt gets one from its updatedAt when re-rated (no backfill job)', async () => {
    store.set('reviews/u1_lm1', { userId: 'u1', landmarkId: 'lm1', stars: 5, ratingTier: L, region: 'r', categories: ['food'], updatedAt: { seconds: 100 } });
    await rate(OK);
    expect(review().ratedAt).toBe(100000);
    expect(review().priorTier).toBe(L);
    expect(review().priorRatedAt).toBe(100000);
  });
});

describe('one-level change and no explanation: nothing is asked or stored', () => {
  it('loved -> ok replaces the old effect and stores no disagreement', async () => {
    await rate(L);
    expect((await previewDisagreement({ userId: 'u1', landmark: LM, tier: OK })).needsAsk).toBe(false);
    later();
    await rate(OK);
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.neutral, 5);
    expect(count()).toBe(1);
    expect(review().disagreement).toBeNull();
    expect(place().resolution).toBeNull();
  });

  it('a two-level change that was never answered still replaces the old answer (as before)', async () => {
    await rate(L);
    later();
    await rate(D);
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.negative, 5);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.negative);
    expect(review().disagreement).toBeNull();
  });
});

describe('two-level re-rating: each answer', () => {
  const lovedThen = async (reason, comment = '') => {
    await rate(L);
    later();
    await rate(D, {}, { reason, comment });
  };

  it.each(['food', 'service', 'price', 'noise-crowd'])('%s: the drop stays on that one place, the type is unchanged', async (reason) => {
    await lovedThen(reason);
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.positive, 5); // type still shows the earlier "loved"
    expect(count()).toBe(1);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.negative);
    expect(place().rating).toBe('negative');
    expect(review().disagreement).toMatchObject({ reason, comment: '', source: 'asked' });
  });

  it.each(['changed-mind', 'wrong-type'])('%s: the new answer counts fully, on the place and the type', async (reason) => {
    await lovedThen(reason);
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.negative, 5);
    expect(count()).toBe(1);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.negative);
    expect(review().disagreement.reason).toBe(reason);
  });

  it('one-off: the two answers average to neutral for scoring', async () => {
    await lovedThen('one-off');
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.neutral, 5);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.neutral);
    expect(place().rating).toBe('negative'); // the answer itself is still recorded
    expect(place().latestLevel).toBe('negative');
  });

  it.each(['skip', 'other'])('%s: new answer at 70%, old at 30%', async (reason) => {
    await lovedThen(reason);
    const w = (a, b) => DISAGREEMENT_NEW_WEIGHT * a + DISAGREEMENT_OLD_WEIGHT * b;
    expect(food()).toBeCloseTo(w(RATING_TAG_DELTA.negative, RATING_TAG_DELTA.positive), 5);
    expect(place().placeScore).toBeCloseTo(w(PLACE_RATING_DELTA.negative, PLACE_RATING_DELTA.positive), 5);
    expect(count()).toBe(1);
  });

  it('skip works the other way too (didn\'t like -> loved)', async () => {
    await rate(D);
    later();
    await rate(L, {}, { reason: 'skip', comment: '' });
    expect(food()).toBeCloseTo(0.7 * RATING_TAG_DELTA.positive + 0.3 * RATING_TAG_DELTA.negative, 5);
    expect(place().placeScore).toBeCloseTo(0.7 * PLACE_RATING_DELTA.positive + 0.3 * PLACE_RATING_DELTA.negative, 5);
  });

  it('keeps the note, capped at COMMENT_MAX, and the time', async () => {
    await rate(L);
    later();
    await rate(D, {}, { reason: 'other', comment: 'x'.repeat(COMMENT_MAX + 50) });
    expect(review().disagreement.comment).toHaveLength(COMMENT_MAX);
    expect(review().disagreement.at).toBe(clock);
  });

  it('an unknown reason is ignored (treated as unanswered)', async () => {
    await lovedThen('because');
    expect(review().disagreement).toBeNull();
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.negative, 5);
  });

  it('a one-level change ignores a stray answer', async () => {
    await rate(L);
    later();
    await rate(OK, {}, { reason: 'food', comment: '' });
    expect(review().disagreement).toBeNull();
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.neutral, 5);
  });
});

describe('two-level re-rating with a comment', () => {
  it('a comment that says why (price) answers it with no question, and is read as the answer', async () => {
    await rate(L);
    later();
    const p = await previewDisagreement({ userId: 'u1', landmark: LM, tier: D, comment: 'way overpriced' });
    expect(p).toMatchObject({ needed: true, auto: 'price', needsAsk: false });
    await rate(D, { comment: 'way overpriced' });
    expect(review().disagreement).toMatchObject({ reason: 'price', comment: 'way overpriced', source: 'comment' });
    expect(place().resolution).toBe('price');
  });

  it('place-only: the comment\'s own tag effect stays off the type, but counts on the place', async () => {
    await rate(L);
    later();
    await rate(D, { comment: 'the food was terrible' });
    expect(review().disagreement.reason).toBe('food');
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.positive, 5); // "terrible food" would have taken 3 off food
    expect(place().placeScore).toBeLessThan(PLACE_RATING_DELTA.negative); // the comment still lowers the place
  });

  it('a comment with no usable signal means the question is asked', async () => {
    await rate(L);
    const p = await previewDisagreement({ userId: 'u1', landmark: LM, tier: D, comment: 'it was fine I guess' });
    expect(p).toMatchObject({ needed: true, auto: null, needsAsk: true });
  });

  it('no comment on file or sent means the question is asked; one level never asks', async () => {
    await rate(L);
    expect(await previewDisagreement({ userId: 'u1', landmark: LM, tier: D })).toMatchObject({ needed: true, needsAsk: true });
    expect(await previewDisagreement({ userId: 'u1', landmark: LM, tier: OK })).toMatchObject({ needed: false, needsAsk: false });
  });

  it('a first rating with no earlier answer never asks, even a "didn\'t like it"', async () => {
    expect(await previewDisagreement({ userId: 'u1', landmark: LM, tier: D })).toMatchObject({ needed: false, needsAsk: false });
  });
});

describe('the old answer\'s effect is removed (exact undo)', () => {
  it.each(['food', 'changed-mind', 'one-off', 'skip', 'wrong-type'])('after %s, deleting the rating leaves the type and place clean', async (reason) => {
    await rate(L);
    later();
    await rate(D, {}, { reason, comment: '' });
    await deleteMyReview('u1', 'lm1');
    expect(food()).toBeCloseTo(0, 5);
    expect(count()).toBe(0);
    expect(place()).toBeUndefined();
    expect(review()).toBeUndefined(); // the review doc, with ratedAt/priorTier/priorRatedAt/disagreement, is gone
  });

  it('re-rating again after a place-only answer takes out exactly what is on the type', async () => {
    await rate(L);
    later();
    await rate(D, {}, { reason: 'service', comment: '' }); // type still +10
    later();
    await rate(OK); // D -> OK is one level; type should now be OK only, not OK + stale loved
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.neutral, 5);
    expect(count()).toBe(1);
  });

  it('a later comment edit keeps a place-only answer off the type', async () => {
    await rate(L);
    later();
    await rate(D, {}, { reason: 'food', comment: '' });
    later();
    await saveMyComment({ userId: 'u1', userName: 'u', landmark: LM, comment: 'bad food' });
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.positive, 5);
    expect(place().commentDeltas.food).toBeLessThan(0);
    expect(place().commentTypeDeltas).toEqual({});
  });
});

describe('tap, then a rating two levels away', () => {
  const tapThen = async (reason) => {
    await tap('yes'); // +4 on the type
    later();
    await rate(D, {}, reason ? { reason, comment: '' } : undefined);
  };

  it('asks (the user gave two answers)', async () => {
    await tap('yes');
    expect(await previewDisagreement({ userId: 'u1', landmark: LM, tier: D })).toMatchObject({ needed: true, oldKind: 'tap', needsAsk: true });
    expect(await previewDisagreement({ userId: 'u1', landmark: LM, tier: OK })).toMatchObject({ needed: false });
  });

  it('unanswered: the existing "half a miss" scoring still applies', async () => {
    await tapThen(null);
    expect(place().missWeight).toBe(0.5);
    expect(place().placeScore).toBeLessThan(PLACE_RATING_DELTA.negative);
  });

  it('changed-mind: the tap is taken out, the rating counts fully', async () => {
    await tapThen('changed-mind');
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.negative, 5);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.negative);
    expect(place().tapDelta).toBe(0);
    expect(place().latestLevel).toBe('negative');
    expect(place().latestSource).toBe('rating');
  });

  it('place-only (price): the tap stays on the type, the place follows the rating alone', async () => {
    await tapThen('price');
    expect(food()).toBeCloseTo(TAP_TAG_DELTA.positive, 5);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.negative);
  });

  it('one-off: both answers score as neutral', async () => {
    await tapThen('one-off');
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.neutral, 5);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.neutral);
    expect(place().missWeight).toBe(0); // a one-off visit is not a miss
  });

  it('skip: 70% the rating, 30% the tap (on the rating scale)', async () => {
    await tapThen('skip');
    expect(food()).toBeCloseTo(0.7 * RATING_TAG_DELTA.negative + 0.3 * RATING_TAG_DELTA.positive, 5);
    expect(place().placeScore).toBeCloseTo(0.7 * PLACE_RATING_DELTA.negative + 0.3 * PLACE_RATING_DELTA.positive, 5);
  });

  it('deleting the rating afterwards removes it exactly (place-only case keeps the tap, others lose it)', async () => {
    await tapThen('price');
    await deleteMyReview('u1', 'lm1');
    expect(food()).toBeCloseTo(TAP_TAG_DELTA.positive, 5);
    expect(place().tap).toBe('positive');
    expect(place().tapPlaceOff).toBe(false);
  });
});

describe('the newest answer for the later taste score', () => {
  it('latestLevel follows the newest of tap and rating', async () => {
    await rate(L);
    expect(place()).toMatchObject({ latestLevel: 'positive', latestSource: 'rating' });
    later();
    await rate(D, {}, { reason: 'changed-mind', comment: '' });
    expect(place()).toMatchObject({ latestLevel: 'negative', latestSource: 'rating', latestAt: clock });
    await tap('yes');
    expect(place()).toMatchObject({ latestLevel: 'positive', latestSource: 'tap' });
  });
});

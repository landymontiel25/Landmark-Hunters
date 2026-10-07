import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  COMMENT_CAP_PER_TAG,
  COMMENT_COMPLAINT_DELTA,
  COMMENT_MAX_TAGS,
  COMMENT_PRAISE_DELTA,
  MISS_TYPE_FACTOR,
  PLACE_MISS_DELTA,
  PLACE_RATING_DELTA,
  PLACE_TAP_DELTA,
  RATING_TAG_DELTA,
  TAP_TAG_DELTA,
} from './maprConstants';
import { commentTagDeltas } from './commentSignals';
import { missWeightFor, planLearning, placeScoreOf } from './maprLearning';

// A tiny in-memory Firestore, just enough for submitReview / saveMyComment /
// deleteMyReview / setPickFeedback, which all go through runTransaction.
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

import { submitReview, deleteMyReview, saveMyComment } from './reviews';
import { setPickFeedback } from './pickFeedback';

const LM = { id: 'lm1', name: 'Cafe', region: 'r', categories: ['food'] };
const user = () => store.get('users/u1') || {};
const place = () => store.get('users/u1/place_scores/lm1');
const food = () => user().tagScores?.r?.food ?? 0;
const rate = (tier, extra = {}) => submitReview({ userId: 'u1', userName: 'u', landmark: LM, rating: { tier, ...extra } });
// The profile update after a tap is fire-and-forget; let it settle.
const tap = async (verdict) => {
  await setPickFeedback({ uid: 'u1', landmark: LM, verdict });
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  store.clear();
  const mem = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  });
});

describe('planLearning (pure): positive / negative / neutral', () => {
  const run = (next, extra = {}) => planLearning({ landmark: LM, next, nowMs: 1000, ...extra });
  it('a positive rating raises the place tags and the place; negative lowers both; neutral is small', () => {
    const pos = run({ rating: { tier: 'highly-recommend' } });
    const neg = run({ rating: { tier: 'probably-skip' } });
    const neu = run({ rating: { tier: 'worth-trying' } });
    expect(pos.userPatch.tagScores.r.food).toBe(RATING_TAG_DELTA.positive);
    expect(neg.userPatch.tagScores.r.food).toBe(RATING_TAG_DELTA.negative);
    expect(neu.userPatch.tagScores.r.food).toBe(RATING_TAG_DELTA.neutral);
    expect(Math.abs(neu.userPatch.tagScores.r.food)).toBeLessThan(Math.abs(pos.userPatch.tagScores.r.food));
    expect(pos.ledger.placeScore).toBeGreaterThan(0);
    expect(neg.ledger.placeScore).toBeLessThan(0);
    expect(Math.abs(neu.ledger.placeScore)).toBeLessThan(Math.abs(pos.ledger.placeScore));
  });

  it('taps move tags the same direction but less than a rating; "Not sure" does not move tags', () => {
    const yes = run({ tap: 'positive' });
    const no = run({ tap: 'negative' });
    const unsure = run({ tap: 'neutral' });
    expect(yes.userPatch.tagScores.r.food).toBe(TAP_TAG_DELTA.positive);
    expect(no.userPatch.tagScores.r.food).toBe(TAP_TAG_DELTA.negative);
    expect(unsure.userPatch).toBeNull();
    expect(unsure.ledger.tap).toBe('neutral');
    expect(TAP_TAG_DELTA.positive).toBeLessThan(RATING_TAG_DELTA.positive);
    expect(Math.abs(TAP_TAG_DELTA.negative)).toBeLessThan(Math.abs(RATING_TAG_DELTA.negative));
    expect(PLACE_TAP_DELTA.positive).toBeLessThan(PLACE_RATING_DELTA.positive);
  });

  it('a tap does not count as a rating behind the tag; a rating does', () => {
    expect(run({ tap: 'positive' }).userPatch.tagCounts.r).toEqual({});
    expect(run({ rating: { tier: 'highly-recommend' } }).userPatch.tagCounts.r.food).toBe(1);
  });
});

describe('type vs place', () => {
  it('stores the place score separately from the tag scores, one doc per landmark', () => {
    const a = planLearning({ landmark: LM, next: { rating: { tier: 'probably-skip' } }, nowMs: 1 });
    expect(a.ledger.landmarkId).toBe('lm1');
    expect(a.ledger.placeScore).toBe(PLACE_RATING_DELTA.negative);
    // the type score sits on the user profile, shared by every food place
    const other = planLearning({ user: a.userPatch, landmark: { ...LM, id: 'lm2' }, next: { tap: 'positive' }, nowMs: 2 });
    expect(other.ledger.placeScore).toBe(PLACE_TAP_DELTA.positive); // lm2 starts clean
    expect(other.userPatch.tagScores.r.food).toBeCloseTo(RATING_TAG_DELTA.negative + TAP_TAG_DELTA.positive, 5);
  });
});

describe("I'd go, then didn't like it", () => {
  it('drops the place a lot, the type a little, and records half a miss', () => {
    const t = planLearning({ landmark: LM, next: { tap: 'positive' }, nowMs: 1 });
    let u = t.userPatch;
    const r = planLearning({ user: u, prev: t.ledger, landmark: LM, next: { rating: { tier: 'probably-skip' } }, nowMs: 2 });
    expect(r.ledger.missWeight).toBe(0.5);
    expect(r.ledger.predicted).toBe('positive');
    expect(r.ledger.outcome).toBe('negative');
    expect(r.ledger.placeScore).toBe(PLACE_TAP_DELTA.positive + PLACE_RATING_DELTA.negative + PLACE_MISS_DELTA);
    // place falls much further than a plain "didn't like it" would
    expect(r.ledger.placeScore).toBeLessThan(PLACE_RATING_DELTA.negative);
    // type: tap +4, then the rating counted at MISS_TYPE_FACTOR of -15: a small net drop
    const net = r.userPatch.tagScores.r.food;
    expect(net).toBeCloseTo(TAP_TAG_DELTA.positive + RATING_TAG_DELTA.negative * MISS_TYPE_FACTOR, 5);
    expect(net).toBeLessThan(0);
    expect(net).toBeGreaterThan(RATING_TAG_DELTA.negative);
  });

  it('only that pair is a miss', () => {
    expect(missWeightFor('positive', 'negative')).toBe(0.5);
    expect(missWeightFor('positive', 'positive')).toBe(0);
    expect(missWeightFor('neutral', 'negative')).toBe(0);
    expect(missWeightFor(null, 'negative')).toBe(0);
  });

  it('a plain rating with no tap has no miss', () => {
    expect(planLearning({ landmark: LM, next: { rating: { tier: 'probably-skip' } }, nowMs: 1 }).ledger.missWeight).toBe(0);
  });
});

describe('changing an answer takes the old effect out first', () => {
  it('rating loved -> didnt like: tags end where a straight "didnt like" would have', () => {
    const a = planLearning({ landmark: LM, next: { rating: { tier: 'highly-recommend' } }, nowMs: 1 });
    const b = planLearning({ user: a.userPatch, prev: a.ledger, landmark: LM, next: { rating: { tier: 'probably-skip' } }, nowMs: 1 });
    expect(b.userPatch.tagScores.r.food).toBeCloseTo(RATING_TAG_DELTA.negative, 5);
    expect(b.userPatch.tagCounts.r.food).toBe(1); // still one rating, not two
    expect(b.ledger.placeScore).toBe(PLACE_RATING_DELTA.negative);
  });

  it('tap yes -> no (and back) leaves only the current tap', () => {
    const yes = planLearning({ landmark: LM, next: { tap: 'positive' }, nowMs: 1 });
    const no = planLearning({ user: yes.userPatch, prev: yes.ledger, landmark: LM, next: { tap: 'negative' }, nowMs: 1 });
    expect(no.userPatch.tagScores.r.food).toBeCloseTo(TAP_TAG_DELTA.negative, 5);
    expect(no.ledger.placeScore).toBe(PLACE_TAP_DELTA.negative);
    const unsure = planLearning({ user: no.userPatch, prev: no.ledger, landmark: LM, next: { tap: 'neutral' }, nowMs: 1 });
    expect(unsure.userPatch.tagScores.r.food).toBeCloseTo(0, 5);
  });

  it('an unchanged answer touches nothing', () => {
    const a = planLearning({ landmark: LM, next: { rating: { tier: 'highly-recommend' } }, nowMs: 1 });
    const b = planLearning({ user: a.userPatch, prev: a.ledger, landmark: LM, next: { rating: { tier: 'highly-recommend' } }, nowMs: 2 });
    expect(b.userPatch).toBeNull();
  });

  it('a rating saved before place_scores existed (legacy) is still taken back out', () => {
    const user = { tagScores: { r: { food: 10 } }, tagScoresAt: { r: { food: 1 } }, tagCounts: { r: { food: 1 } } };
    const legacy = { rating: { tier: 'highly-recommend', frequency: null, region: 'r', categories: ['food'] } };
    const b = planLearning({ user, legacy, landmark: LM, next: { rating: { tier: 'probably-skip' } }, nowMs: 1 });
    expect(b.userPatch.tagScores.r.food).toBeCloseTo(RATING_TAG_DELTA.negative, 5);
    expect(b.userPatch.tagCounts.r.food).toBe(1);
  });

  it('removing the rating removes its comment effect but keeps a tap', () => {
    const t = planLearning({ landmark: LM, next: { tap: 'positive' }, nowMs: 1 });
    const r = planLearning({ user: t.userPatch, prev: t.ledger, landmark: LM, next: { rating: { tier: 'highly-recommend' }, comment: 'great food' }, nowMs: 1 });
    const gone = planLearning({ user: r.userPatch, prev: r.ledger, landmark: LM, next: { rating: null }, nowMs: 1 });
    expect(gone.userPatch.tagScores.r.food).toBeCloseTo(TAP_TAG_DELTA.positive, 5);
    expect(gone.ledger.tap).toBe('positive');
    expect(gone.ledger.rating).toBeNull();
    expect(gone.ledger.commentDeltas).toEqual({});
    const noSignal = planLearning({ user: gone.userPatch, prev: gone.ledger, landmark: LM, next: { tap: null }, nowMs: 1 });
    expect(noSignal.ledger).toBeNull();
  });
});

describe('comment lexicon', () => {
  const food = ['food'];
  it('"too loud" lowers loud / noisy kinds of places', () => {
    const d = commentTagDeltas('Way too loud for me', ['local-life']);
    expect(d['local-life']).toBe(COMMENT_COMPLAINT_DELTA);
    expect(d.entertainment).toBe(COMMENT_COMPLAINT_DELTA);
    expect(d.food).toBeUndefined();
  });
  it('"not loud" does not lower anything (negated complaint)', () => {
    expect(commentTagDeltas('It was not loud at all', ['local-life'])).toEqual({});
    expect(commentTagDeltas("wasn't too loud", ['local-life'])).toEqual({});
    expect(commentTagDeltas('not very noisy, nice', ['local-life'])).toEqual({});
  });
  it('"great food" raises food, wherever the place is tagged', () => {
    expect(commentTagDeltas('Great food and friendly people', ['local-life']).food).toBe(COMMENT_PRAISE_DELTA);
  });
  it('negated praise becomes a weaker complaint', () => {
    const d = commentTagDeltas('not good food', food);
    expect(d.food).toBeLessThan(0);
    expect(Math.abs(d.food)).toBeLessThan(Math.abs(COMMENT_COMPLAINT_DELTA));
  });
  it('negation does not leak across a comma or "but"', () => {
    expect(commentTagDeltas('not crowded, but way too loud', ['local-life'])['local-life']).toBe(COMMENT_COMPLAINT_DELTA);
    expect(commentTagDeltas('not great but the food was delicious', food).food).toBe(COMMENT_PRAISE_DELTA);
  });
  it('general sentiment applies to the place own tags', () => {
    expect(commentTagDeltas('Loved it, hidden gem', ['parks-nature'])['parks-nature']).toBeGreaterThan(0);
    expect(commentTagDeltas('so boring', ['history-culture'])['history-culture']).toBeLessThan(0);
  });
  it('is capped per tag and in how many tags it can touch', () => {
    const rant = 'loud noisy crowded dirty boring overpriced bad food rude staff unsafe tiny awful terrible';
    const d = commentTagDeltas(rant, ['food', 'local-life']);
    expect(Object.keys(d).length).toBeLessThanOrEqual(COMMENT_MAX_TAGS);
    for (const v of Object.values(d)) expect(Math.abs(v)).toBeLessThanOrEqual(COMMENT_CAP_PER_TAG);
  });
  it('is deterministic and empty for text with no signal', () => {
    expect(commentTagDeltas('We went on Tuesday', food)).toEqual({});
    expect(commentTagDeltas('', food)).toEqual({});
    expect(commentTagDeltas('too loud', ['local-life'])).toEqual(commentTagDeltas('too loud', ['local-life']));
  });
  it('a comment moves the tags in planLearning, and an edited comment replaces the old effect', () => {
    const a = planLearning({ landmark: LM, next: { rating: { tier: 'worth-trying' }, comment: 'too loud and crowded' }, nowMs: 1 });
    const ent = a.userPatch.tagScores.r;
    expect(ent.entertainment).toBe(-COMMENT_CAP_PER_TAG); // loud + crowded = -6, capped
    const b = planLearning({ user: a.userPatch, prev: a.ledger, landmark: LM, next: { comment: 'great food' }, nowMs: 1 });
    expect(b.userPatch.tagScores.r.entertainment).toBeCloseTo(0, 5);
    expect(b.userPatch.tagScores.r.food).toBeCloseTo(RATING_TAG_DELTA.neutral + COMMENT_PRAISE_DELTA, 5);
  });
  it('place score includes the comment', () => {
    const base = placeScoreOf({ rating: 'positive' });
    expect(placeScoreOf({ rating: 'positive', commentDeltas: { food: 2 } })).toBeGreaterThan(base);
  });
});

describe('through the real write paths (taps, ratings, comments, delete)', () => {
  it('tap then rating via submitReview: type + place + half miss are stored', async () => {
    await tap('yes');
    expect(food()).toBeCloseTo(TAP_TAG_DELTA.positive, 5);
    expect(place()).toMatchObject({ tap: 'positive', placeScore: PLACE_TAP_DELTA.positive, missWeight: 0 });
    await rate('probably-skip');
    expect(place()).toMatchObject({ missWeight: 0.5, predicted: 'positive', outcome: 'negative' });
    expect(food()).toBeCloseTo(TAP_TAG_DELTA.positive + RATING_TAG_DELTA.negative * MISS_TYPE_FACTOR, 5);
  });

  it('changing the tap later undoes the old tap (even though the review is unchanged)', async () => {
    await tap('yes');
    await tap('no');
    expect(food()).toBeCloseTo(TAP_TAG_DELTA.negative, 5);
    expect(place().tap).toBe('negative');
  });

  it('a pre-existing (legacy) tap with no place doc is undone when changed', async () => {
    store.set('users/u1', { tagScores: { r: { food: 4 } }, tagScoresAt: { r: { food: Date.now() } } });
    localStorage.setItem('lh-pick-feedback:u1', JSON.stringify({ lm1: { landmarkId: 'lm1', verdict: 'yes' } }));
    await tap('no');
    expect(food()).toBeCloseTo(TAP_TAG_DELTA.negative, 3);
  });

  it('editing a rating swaps the old rating effect for the new one; place follows', async () => {
    await rate('highly-recommend');
    await rate('probably-skip');
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.negative, 5);
    expect(user().tagCounts.r.food).toBe(1);
    expect(place().placeScore).toBe(PLACE_RATING_DELTA.negative);
  });

  it('a rating comment moves tags; editing it with saveMyComment swaps its effect', async () => {
    await rate('worth-trying', { comment: 'too loud' });
    expect(user().tagScores.r.entertainment).toBe(COMMENT_COMPLAINT_DELTA);
    await saveMyComment({ userId: 'u1', userName: 'u', landmark: LM, comment: 'great food' });
    expect(user().tagScores.r.entertainment).toBeCloseTo(0, 5);
    expect(food()).toBeCloseTo(RATING_TAG_DELTA.neutral + COMMENT_PRAISE_DELTA, 5);
  });

  it('a rating edit that sends no comment keeps the comment effect', async () => {
    await rate('worth-trying', { comment: 'great food' });
    await rate('worth-trying', { visitFrequency: 'a-lot' });
    expect(place().commentDeltas.food).toBe(COMMENT_PRAISE_DELTA);
  });

  it('deleting the review rolls back rating + comment but keeps the tap', async () => {
    await tap('yes');
    await rate('highly-recommend', { comment: 'great food' });
    await deleteMyReview('u1', 'lm1');
    expect(food()).toBeCloseTo(TAP_TAG_DELTA.positive, 5);
    expect(place()).toMatchObject({ tap: 'positive', rating: null });
  });

  it('a check-in rating counts the same for "Just me" and "A group"', async () => {
    await rate('highly-recommend', { companions: 'group' });
    const solo = food();
    store.clear();
    await rate('highly-recommend', { companions: 'solo' });
    expect(food()).toBe(solo);
  });
});

describe('taps far from where you were count half', () => {
  it('a weighted tap moves the type by the weighted delta and stores it, so undo is exact', () => {
    const half = planLearning({ landmark: LM, next: { tap: 'positive', tapWeight: 0.5 }, nowMs: 1 });
    expect(half.userPatch.tagScores.r.food).toBe(TAP_TAG_DELTA.positive * 0.5);
    expect(half.ledger.tapDelta).toBe(TAP_TAG_DELTA.positive * 0.5);
    const undone = planLearning({ user: half.userPatch, prev: half.ledger, landmark: LM, next: { tap: null }, nowMs: 2 });
    expect(undone.userPatch.tagScores.r.food).toBe(0);
  });
  it('a full-weight tap is unchanged', () => {
    const full = planLearning({ landmark: LM, next: { tap: 'negative' }, nowMs: 1 });
    expect(full.userPatch.tagScores.r.food).toBe(TAP_TAG_DELTA.negative);
  });
});

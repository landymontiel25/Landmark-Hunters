import { describe, it, expect, vi } from 'vitest';
import { PHOTO_BONUS_POINTS, PHOTO_BONUSES_PER_DAY, PHOTOS_CHECKED_PER_TRY, awardPhotoBonus, photoBonusDecision, photosToCheck } from './photoBonus.js';
import { backfillCandidates, runPhotoBonusBackfill } from './photoBonusBackfill.js';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n) => ({ __inc: n }),
    arrayUnion: (...xs) => ({ __union: xs }),
    serverTimestamp: () => 'now',
  },
}));

// A tiny in-memory Firestore: docs by path, set/merge with increment and
// arrayUnion, create that fails if the doc exists, and transactions.
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const apply = (cur, patch) => {
    const next = { ...(cur || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v && v.__inc != null) next[k] = (Number(next[k]) || 0) + v.__inc;
      else if (v && v.__union) next[k] = [...new Set([...(next[k] || []), ...v.__union])];
      else next[k] = v;
    }
    return next;
  };
  const ref = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data, opts) => docs.set(path, opts?.merge ? apply(docs.get(path), data) : apply(null, data)),
  });
  const db = {
    docs,
    collection: (name) => {
      // where(a, '==', x).where(b, '==', y).get() over this collection.
      const query = (filters) => ({
        where: (f, _op, v) => query([...filters, [f, v]]),
        get: async () => ({
          docs: [...docs.entries()]
            .filter(([path, d]) => path.startsWith(`${name}/`) && filters.every(([f, v]) => d[f] === v))
            .map(([, d]) => ({ data: () => d })),
        }),
      });
      return { doc: (id) => ref(`${name}/${id}`), where: (f, op, v) => query([[f, v]]) };
    },
    runTransaction: async (fn) =>
      fn({
        get: (r) => r.get(),
        create: (r, data) => {
          if (docs.has(r.path)) throw new Error('exists');
          docs.set(r.path, apply(null, data));
        },
        set: (r, data, opts) => docs.set(r.path, opts?.merge ? apply(docs.get(r.path), data) : apply(null, data)),
      }),
  };
  return db;
}

const PHOTO = 'https://firebasestorage.googleapis.com/v0/b/app/o/checkin_photos%2Fx.jpg?alt=media';
const visit = { userId: 'u', userName: 'Alex', landmarkId: 'x', region: 'miami', landmarkName: 'X Place', points: 100, visited: true, ratingOnly: false, photoURLs: [PHOTO] };
const decide = (over) => photoBonusDecision({ uid: 'u', checkin: visit, review: null, paid: false, today: 0, ...over });

describe('photoBonusDecision', () => {
  it('can pay for a photo on a real check-in, or on your rating of a place you checked in to', () => {
    expect(decide()).toEqual({ awarded: PHOTO_BONUS_POINTS });
    const checkin = { ...visit, photoURLs: [] };
    expect(decide({ checkin, review: { userId: 'u', photoURLs: ['r.jpg'] } }).awarded).toBe(PHOTO_BONUS_POINTS);
    expect(decide({ checkin, review: { userId: 'someone-else', photoURLs: ['r.jpg'] } })).toEqual({ awarded: 0, reason: 'no-photo' });
  });

  it('pays nothing without a real check-in, without a photo, twice, or past the daily limit (the back-pay has none)', () => {
    expect(decide({ checkin: null }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, userId: 'x' } }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, ratingOnly: true } }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, visited: false } }).reason).toBe('no-checkin');
    expect(decide({ checkin: { ...visit, photoURLs: [] } }).reason).toBe('no-photo');
    expect(decide({ paid: true }).reason).toBe('already');
    expect(decide({ today: PHOTO_BONUSES_PER_DAY }).reason).toBe('daily-limit');
    expect(decide({ today: null }).awarded).toBe(PHOTO_BONUS_POINTS);
  });

  it('stays small next to a first check-in', () => {
    expect(PHOTO_BONUS_POINTS).toBe(10);
    expect(PHOTO_BONUS_POINTS * PHOTO_BONUSES_PER_DAY).toBeLessThanOrEqual(100);
  });
});

describe('photosToCheck', () => {
  it('checks the newest photos first, skips ones checked before, and only a few', () => {
    const checkin = { ...visit, photoURLs: ['a', 'b', 'c', 'd'] };
    expect(photosToCheck({ uid: 'u', checkin, review: { userId: 'u', photoURLs: ['r'] }, checked: ['d'] })).toEqual(['c', 'b', 'a'].slice(0, PHOTOS_CHECKED_PER_TRY));
    expect(photosToCheck({ uid: 'u', checkin: { ...visit, photoURLs: [] }, review: { userId: 'u', photoURLs: ['r'] } })).toEqual(['r']);
  });
});

describe('awardPhotoBonus', () => {
  const setup = () => fakeDb({ 'checkins/u_x': visit });

  it('pays +10 once when the photo shows the place: ledger, day count, lifetime points', async () => {
    const db = setup();
    const check = vi.fn(async () => ({ ok: true, reason: 'the stadium from the stands' }));
    const out = await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', boards: false, check });
    expect(out.awarded).toBe(PHOTO_BONUS_POINTS);
    expect(check).toHaveBeenCalledWith({ url: PHOTO, place: expect.objectContaining({ name: 'X Place', city: 'Miami' }) });
    expect(db.docs.get('users/u').bonusPoints).toBe(PHOTO_BONUS_POINTS);
    expect(db.docs.get('photo_bonus_days/u_2026-9-21').count).toBe(1);
    expect(db.docs.has('photo_bonuses/u_x')).toBe(true);
    // Again: already paid, and no second photo check.
    expect((await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', boards: false, check })).reason).toBe('already');
    expect(check).toHaveBeenCalledTimes(1);
    expect(db.docs.get('users/u').bonusPoints).toBe(PHOTO_BONUS_POINTS);
  });

  it('pays nothing for a black screen or a random photo, and never checks that photo again', async () => {
    const db = setup();
    const check = vi.fn(async () => ({ ok: false, reason: 'a black image' }));
    expect((await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', check })).reason).toBe('photo-not-of-place');
    expect(db.docs.has('users/u')).toBe(false);
    expect(db.docs.get('photo_bonus_checks/u_x').urls).toEqual([PHOTO]);
    expect((await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', check })).reason).toBe('photo-not-of-place');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('a failed check is not a verdict: the photo is checked again next time', async () => {
    const db = setup();
    await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', check: async () => ({ ok: false, reason: 'check failed' }) });
    expect(db.docs.has('photo_bonus_checks/u_x')).toBe(false);
    const out = await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', boards: false, check: async () => ({ ok: true, reason: 'ok' }) });
    expect(out.awarded).toBe(PHOTO_BONUS_POINTS);
  });

  it('a real visit counts even when the first entry at the place was a rating-only one', async () => {
    const db = fakeDb({
      'checkins/u_x': { ...visit, ratingOnly: true, visited: false, points: 0 },
      'checkins/u_x_2': { userId: 'u', landmarkId: 'x', ratingOnly: false, visited: true, points: 0 },
    });
    const out = await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', boards: false, check: async () => ({ ok: true, reason: 'ok' }) });
    expect(out.awarded).toBe(PHOTO_BONUS_POINTS);
    // With no real visit anywhere, still nothing.
    const none = fakeDb({ 'checkins/u_x': { ...visit, ratingOnly: true, visited: false, points: 0 } });
    expect((await awardPhotoBonus(none, 'u', 'x', { dayId: '2026-9-21', check: async () => ({ ok: true }) })).reason).toBe('no-checkin');
  });

  it('respects the daily limit, except for the back-pay', async () => {
    const db = fakeDb({ 'checkins/u_x': visit, 'photo_bonus_days/u_2026-9-21': { count: PHOTO_BONUSES_PER_DAY } });
    const check = vi.fn(async () => ({ ok: true, reason: 'ok' }));
    expect((await awardPhotoBonus(db, 'u', 'x', { dayId: '2026-9-21', check })).reason).toBe('daily-limit');
    expect(check).not.toHaveBeenCalled();
    expect((await awardPhotoBonus(db, 'u', 'x', { dailyLimit: false, boards: false, check })).awarded).toBe(PHOTO_BONUS_POINTS);
  });
});

describe('the one-time back-pay', () => {
  it('finds every place with a photo on a real check-in, or on a rating of a place visited, minus places paid', () => {
    const out = backfillCandidates({
      checkins: [
        { userId: 'a', landmarkId: 'p1', photoURLs: ['x'] },
        { userId: 'a', landmarkId: 'p2', photoURLs: ['x'], ratingOnly: true },
        { userId: 'b', landmarkId: 'p3' },
        { userId: 'c', landmarkId: 'p4', photoURLs: ['x'] },
      ],
      reviews: [
        { userId: 'b', landmarkId: 'p3', photoURLs: ['r'] },
        { userId: 'd', landmarkId: 'p5', photoURLs: ['r'] },
      ],
      paidIds: new Set(['c_p4']),
    });
    expect(out).toEqual([
      { userId: 'a', landmarkId: 'p1' },
      { userId: 'b', landmarkId: 'p3' },
    ]);
  });

  it('pays a batch with no daily limit and no board points, and says how many are left', async () => {
    const snap = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
    const sets = {
      checkins: snap([...Array(5)].map((_, i) => [`u_p${i}`, { userId: 'u', landmarkId: `p${i}`, photoURLs: [`f${i}`] }])),
      reviews: snap([]),
      photo_bonuses: snap([['u_p0', {}]]),
      photo_bonus_checks: snap([['u_p1', { urls: ['f1'] }]]),
    };
    const db = { collection: (n) => ({ select: () => ({ get: async () => sets[n] }), get: async () => sets[n] }) };
    const award = vi.fn(async (_db, uid, lm) => (lm === 'p3' ? { awarded: 0, reason: 'photo-not-of-place' } : { awarded: 10 }));
    const out = await runPhotoBonusBackfill(db, { limit: 2, award });
    // p0 already paid, p1's only photo already checked: p2 and p3 this run, p4 left.
    expect(award.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ['p2', { dailyLimit: false, boards: false }],
      ['p3', { dailyLimit: false, boards: false }],
    ]);
    expect(out).toMatchObject({ paid: 1, points: 10, turnedDown: 1, leftAfterThisRun: 1, done: false });
  });
});

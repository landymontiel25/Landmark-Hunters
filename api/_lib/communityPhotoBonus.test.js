import { describe, it, expect, vi } from 'vitest';
import { awardCommunityPhotoBonus, COMMUNITY_PHOTO_POINTS } from './communityPhotoBonus.js';

vi.mock('./usageQuota.js', async (orig) => ({ ...(await orig()), takeDailyQuota: async () => ({ ok: true }) }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n) => ({ __inc: n }), arrayUnion: (...xs) => ({ __union: xs }), serverTimestamp: () => 'now' },
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

const PHOTO = 'https://firebasestorage.googleapis.com/v0/b/landmark-hunters-284ab.firebasestorage.app/o/checkin_photos%2Fx%2Fu_2.jpg?alt=media';
const visit = { userId: 'u', userName: 'Alex', landmarkId: 'x', region: 'miami', landmarkName: 'X Place', points: 100, visited: true, ratingOnly: false, presence: { verified: true } };
const shared = { region: 'miami', id: 'x', url: PHOTO, photoUid: 'u' };
const okGuard = async () => ({ ok: true });
const yes = async () => ({ ok: true, reason: 'the terminal' });
const args = { regionId: 'miami', landmarkId: 'x', photoUrl: PHOTO };
const setup = (over = {}) => fakeDb({ 'checkins/u_x': visit, 'community_photos/miami__x': shared, ...over });
const run = (db, extra = {}, a = args) => awardCommunityPhotoBonus(db, 'u', a, { guard: okGuard, check: yes, boards: false, ...extra });

describe('awardCommunityPhotoBonus', () => {
  it('pays +10 once, for the photo that is now the place\'s public picture', async () => {
    const db = setup();
    expect(await run(db)).toEqual({ awarded: COMMUNITY_PHOTO_POINTS, reason: null });
    expect(COMMUNITY_PHOTO_POINTS).toBe(10);
    expect(db.docs.get('users/u').bonusPoints).toBe(10);
    expect(db.docs.has('community_photo_bonuses/u_x')).toBe(true);
    expect((await run(db)).reason).toBe('already');
    expect(db.docs.get('users/u').bonusPoints).toBe(10);
  });

  it('pays nothing when the picture is not theirs or not the public one', async () => {
    expect((await run(setup({ 'community_photos/miami__x': { ...shared, photoUid: 'other' } }))).reason).toBe('not-shared');
    expect((await run(setup({ 'community_photos/miami__x': { ...shared, url: 'https://x/other.jpg' } }))).reason).toBe('not-shared');
    expect((await run(fakeDb({ 'checkins/u_x': visit }))).reason).toBe('not-shared');
  });

  it('pays nothing for someone else\'s photo, or without a verified visit', async () => {
    expect((await run(setup(), {}, { ...args, photoUrl: PHOTO.replace('u_2', 'zed_2') })).reason).toBe('bad-photo');
    expect((await run(setup({ 'checkins/u_x': { ...visit, presence: {}, visited: false } }))).reason).toBe('no-checkin');
  });

  it('pays nothing when the photo check says it is not the place, and says why', async () => {
    const db = setup();
    const out = await run(db, { check: async () => ({ ok: false, reason: 'a blank wall' }) });
    expect(out).toMatchObject({ awarded: 0, reason: 'photo-not-of-place', why: 'a blank wall' });
    expect(db.docs.has('community_photo_bonuses/u_x')).toBe(false);
  });

  it('a check that could not run is not a verdict', async () => {
    expect((await run(setup(), { check: async () => ({ ok: false, failed: true, reason: 'check failed' }) })).reason).toBe('check-failed');
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => 'now' },
}));
vi.mock('./leaderboardPoints.js', () => ({ cleanUserName: (n) => n || 'Explorer', leaderboardPointWrites: () => [] }));

const { checkMissionPhoto, missionPhotoPrecheck } = await import('./missionPhoto.js');
const { MISSION_POINTS } = await import('./missionAnswer.js');

// In-memory Firestore, enough for one place's check-ins and the ledger.
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const apply = (cur, patch) => {
    const next = { ...(cur || {}) };
    for (const [k, v] of Object.entries(patch)) next[k] = v && v.__inc != null ? (Number(next[k]) || 0) + v.__inc : v;
    return next;
  };
  const ref = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data, opts) => docs.set(path, opts?.merge ? apply(docs.get(path), data) : apply(null, data)),
  });
  const query = (name, filters) => ({
    where: (f, _op, v) => query(name, [...filters, [f, v]]),
    get: async () => ({ docs: [...docs.entries()].filter(([p, d]) => p.startsWith(`${name}/`) && filters.every(([f, v]) => d[f] === v)).map(([, d]) => ({ data: () => d })) }),
  });
  return {
    docs,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`), where: (f, op, v) => query(name, [[f, v]]) }),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, data, opts) => docs.set(r.path, opts?.merge ? apply(docs.get(r.path), data) : apply(null, data)) }),
  };
}

const FLOOR = 'https://firebasestorage.googleapis.com/v0/b/landmark-hunters-284ab.firebasestorage.app/o/checkin_photos%2Fabaco-beach-resort%2Fu_floor.jpg?alt=media';
const MARINA = 'https://firebasestorage.googleapis.com/v0/b/landmark-hunters-284ab.firebasestorage.app/o/checkin_photos%2Fabaco-beach-resort%2Fu_marina.jpg?alt=media';
const okGuard = async () => ({ ok: true });
const visit = { userId: 'u', userName: 'u', landmarkId: 'abaco-beach-resort', region: 'abacos', ratingOnly: false, visited: true, presence: { verified: true }, photoURLs: [FLOOR, MARINA] };
const setup = () => fakeDb({ 'checkins/u_abaco-beach-resort': visit });
// Stands in for Claude: a floor isn't the mission, the marina shot is.
const check = vi.fn(async ({ url, mission }) => (url === MARINA && /marina/.test(mission) ? { ok: true, reason: 'The marina, boats and beach.' } : { ok: false, reason: 'A tiled floor.' }));

describe('photo missions', () => {
  it('a wrong photo earns nothing and says why; the right one then pays once', async () => {
    const db = setup();
    const no = await checkMissionPhoto(db, 'u', 'abacos', 'abaco-beach-resort', FLOOR, '2026-11-22', { check, guard: okGuard });
    expect(no).toMatchObject({ awarded: 0, passed: false, reason: 'photo-not-mission', why: 'A tiled floor.' });
    expect(no.mission).toMatch(/marina/);
    expect(db.docs.get('users/u')).toBeUndefined();

    const yes = await checkMissionPhoto(db, 'u', 'abacos', 'abaco-beach-resort', MARINA, '2026-11-22', { check, guard: okGuard });
    expect(yes).toMatchObject({ awarded: MISSION_POINTS, passed: true });
    expect(db.docs.get('users/u').bonusPoints).toBe(MISSION_POINTS);

    const again = await checkMissionPhoto(db, 'u', 'abacos', 'abaco-beach-resort', MARINA, '2026-11-22', { check, guard: okGuard });
    expect(again).toMatchObject({ awarded: 0, reason: 'already' });
    expect(db.docs.get('users/u').bonusPoints).toBe(MISSION_POINTS);
  });

  it('the check gets the mission text and the place', async () => {
    const seen = vi.fn(async () => ({ ok: false, reason: 'x' }));
    await checkMissionPhoto(setup(), 'u', 'abacos', 'abaco-beach-resort', FLOOR, '2026-11-22', { check: seen, guard: okGuard });
    expect(seen.mock.calls[0][0]).toMatchObject({ url: FLOOR, mission: "Photograph the marina from the water's edge, with the boats and the beach in one shot.", place: { name: 'Abaco Beach Resort & Boat Harbour Marina' } });
  });

  it("a check that couldn't run pays nothing and isn't a verdict", async () => {
    const db = setup();
    expect(await checkMissionPhoto(db, 'u', 'abacos', 'abaco-beach-resort', MARINA, '2026-11-22', { check: async () => ({ ok: false, failed: true }), guard: okGuard })).toMatchObject({ awarded: 0, reason: 'check-failed' });
    expect(db.docs.has('mission_photos/u_abaco-beach-resort')).toBe(false);
  });

  it('only your own check-in photo, at a place with a photo mission, after a real visit', () => {
    const mission = { type: 'photo', text: 'x' };
    expect(missionPhotoPrecheck({ mission, checkins: [{ ...visit, photoURLs: [...visit.photoURLs, 'https://firebasestorage.googleapis.com/v0/b/landmark-hunters-284ab.firebasestorage.app/o/checkin_photos%2Fabaco-beach-resort%2Fsomeone_1.jpg'] }], photoURL: 'https://firebasestorage.googleapis.com/v0/b/landmark-hunters-284ab.firebasestorage.app/o/checkin_photos%2Fabaco-beach-resort%2Fsomeone_1.jpg', uid: 'u', landmarkId: 'abaco-beach-resort' })).toMatchObject({ reason: 'not-your-photo' });
    expect(missionPhotoPrecheck({ mission, checkins: [visit], photoURL: 'https://evil.example/x.jpg', uid: 'u', landmarkId: 'abaco-beach-resort' })).toMatchObject({ reason: 'not-your-photo' });
    expect(missionPhotoPrecheck({ mission, checkins: [{ ...visit, ratingOnly: true, visited: false }], photoURL: FLOOR, uid: 'u', landmarkId: 'abaco-beach-resort' })).toMatchObject({ reason: 'no-checkin' });
    expect(missionPhotoPrecheck({ mission: { type: 'trivia' }, checkins: [visit], photoURL: FLOOR, uid: 'u', landmarkId: 'abaco-beach-resort' })).toMatchObject({ reason: 'no-photo-mission' });
    expect(missionPhotoPrecheck({ mission, checkins: [visit], photoURL: FLOOR, uid: 'u', landmarkId: 'abaco-beach-resort' })).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now' } }));
const { storageObjectPath, isOwnPlacePhoto, claimPhotoHash, guardPhoto, hashPhoto } = await import('./photoGuard.js');

const url = (path, bucket = 'landmark-hunters-284ab.firebasestorage.app') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=t`;

function fakeDb() {
  const docs = new Map();
  return {
    docs,
    collection: (n) => ({ doc: (id) => ({ path: `${n}/${id}`, get: async () => ({ exists: docs.has(`${n}/${id}`), data: () => docs.get(`${n}/${id}`) }) }) }),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d) => docs.set(r.path, d) }),
  };
}

describe('whose photo', () => {
  it("only this project's bucket, in your own folder for that place", () => {
    expect(storageObjectPath(url('checkin_photos/x/u_1.jpg'))).toBe('checkin_photos/x/u_1.jpg');
    expect(storageObjectPath(url('checkin_photos/x/u_1.jpg', 'someone-elses-app.appspot.com'))).toBeNull();
    expect(storageObjectPath('https://evil.example/v0/b/landmark-hunters-284ab.firebasestorage.app/o/x.jpg')).toBeNull();
    expect(isOwnPlacePhoto(url('checkin_photos/x/u_1.jpg'), 'u', 'x')).toBe(true);
    expect(isOwnPlacePhoto(url('review_photos/x/u_17123.jpg'), 'u', 'x')).toBe(true);
    expect(isOwnPlacePhoto(url('checkin_photos/x/someone_1.jpg'), 'u', 'x')).toBe(false);
    expect(isOwnPlacePhoto(url('checkin_photos/other-place/u_1.jpg'), 'u', 'x')).toBe(false);
    expect(isOwnPlacePhoto(url('profile_photos/u_1.jpg'), 'u', 'x')).toBe(false);
  });
});

describe('duplicate photos', () => {
  it('the same bytes again: fine for the same account and place, refused for anyone or anywhere else', async () => {
    const db = fakeDb();
    expect(await claimPhotoHash(db, 'h1', { uid: 'u', landmarkId: 'x', url: 'a' })).toEqual({ ok: true });
    expect(await claimPhotoHash(db, 'h1', { uid: 'u', landmarkId: 'x', url: 'a' })).toEqual({ ok: true });
    expect(await claimPhotoHash(db, 'h1', { uid: 'u', landmarkId: 'y', url: 'a' })).toEqual({ ok: false, reason: 'duplicate-photo' });
    expect(await claimPhotoHash(db, 'h1', { uid: 'v', landmarkId: 'x', url: 'a' })).toEqual({ ok: false, reason: 'duplicate-photo' });
    expect(await claimPhotoHash(db, null, { uid: 'u', landmarkId: 'x' })).toEqual({ ok: false, reason: 'unreadable-photo' });
  });
  it('hashes the bytes; same bytes, same hash', async () => {
    const f = async () => ({ ok: true, headers: { get: () => '3' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const a = await hashPhoto('x', f);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPhoto('y', f)).toBe(a);
    expect(await hashPhoto('z', async () => ({ ok: false }))).toBeNull();
  });
  it("guardPhoto: someone else's photo never reaches the hash check", async () => {
    const fetchImpl = vi.fn();
    expect(await guardPhoto(fakeDb(), url('checkin_photos/x/v_1.jpg'), { uid: 'u', landmarkId: 'x', fetchImpl })).toEqual({ ok: false, reason: 'not-your-photo' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

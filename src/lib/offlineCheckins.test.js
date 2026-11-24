// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./firebase', () => ({ db: null, storage: null, auth: null, appCheckInstance: null }));
vi.mock('./apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));
vi.mock('./leaderboard', () => ({ uploadCheckinPhotoFile: vi.fn(), addCheckinPhotoURL: vi.fn() }));

const { offlineCheckinDecision, OFFLINE_FREE_PER_DAY } = await import('./presence');
const outbox = await import('./outbox');
const oc = await import('./offlineCheckins');

const place = { name: 'Elbow Reef Lighthouse', lat: 26.5410, lng: -76.9590, categories: ['history'] };
const at = 1_800_000_000_000;
// About `m` meters north of the place.
const fixAt = (m, extra = {}) => ({ lat: place.lat + m / 111_320, lng: place.lng, accuracy: 8, timestamp: at, ...extra });

describe('offline check-in decision (owner, 2026-11-24)', () => {
  const decide = (fix, o = {}) => offlineCheckinDecision({ place, fix, capturedAtMs: at, nowMs: at + 3 * 3600_000, ...o });
  it('within 30 m: verified by GPS, hours later on sync', () => {
    expect(decide(fixAt(10))).toMatchObject({ tier: 'gps', reason: null });
  });
  it('outside 30 m but nearby: only a photo that shows the place can count', () => {
    expect(decide(fixAt(200))).toMatchObject({ tier: 'photo', reason: 'too-far' });
    expect(decide(fixAt(10, { accuracy: 400 }))).toMatchObject({ tier: 'photo', reason: 'weak-signal' });
  });
  it('kilometers away: refused, photo or not', () => {
    expect(decide(fixAt(5000))).toMatchObject({ tier: 'refused', reason: 'too-far' });
  });
  it('refuses a fix from another moment, a fake location, a check-in too old or from the future', () => {
    expect(decide(fixAt(10, { timestamp: at - 10 * 60_000 }))).toMatchObject({ tier: 'refused', reason: 'stale-fix' });
    expect(decide(fixAt(10, { mocked: true }))).toMatchObject({ tier: 'refused', reason: 'mocked' });
    expect(decide(fixAt(10), { nowMs: at + 8 * 24 * 3600_000 })).toMatchObject({ tier: 'refused', reason: 'stale-checkin' });
    expect(decide(fixAt(10), { nowMs: at - 3600_000 })).toMatchObject({ tier: 'refused', reason: 'stale-checkin' });
  });
});

describe('offline check-ins on the phone', () => {
  beforeEach(() => {
    outbox._resetOutboxForTests();
    localStorage.clear();
  });

  it('allows the free 5 a day, then refuses; Pro has no limit', async () => {
    const landmark = { id: 'x', region: 'abacos', name: 'X' };
    for (let i = 0; i < OFFLINE_FREE_PER_DAY; i++) {
      expect(oc.canCheckInOffline('u1')).toBe(true);
      await oc.queueOfflineCheckin({ uid: 'u1', landmark, fix: fixAt(1) });
    }
    expect(oc.canCheckInOffline('u1')).toBe(false);
    localStorage.setItem('lh.pro.u1', 'true');
    expect(oc.canCheckInOffline('u1')).toBe(true);
    expect((await oc.pendingOfflineCheckins('u1')).length).toBe(OFFLINE_FREE_PER_DAY);
  });

  it('syncs on its own once online: photo up first, the server decides, then the photo and rating attach', async () => {
    const upload = vi.fn(async () => 'https://firebasestorage.googleapis.com/v0/b/b/o/p.jpg');
    const addPhoto = vi.fn(async () => {});
    const saveReview = vi.fn(async () => {});
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('offline');
      return { ok: true, status: 200, json: async () => ({ ok: true, saved: true, verified: true, awarded: 100, checkinId: 'c1' }) };
    });
    outbox.registerOutboxHandler('checkin', oc.makeCheckinHandler({ fetchImpl, upload, addPhoto, saveReview }));
    const notices = [];
    window.addEventListener(outbox.OUTBOX_NOTICE_EVENT, (e) => notices.push(e.detail.message));
    await oc.queueOfflineCheckin({ uid: 'u1', landmark: { id: 'lm', region: 'abacos', name: 'Nippers' }, fix: fixAt(5), review: { rating: { tier: 'love' } }, photos: [new Blob(['x'])] });

    await outbox.flushOutbox('u1');
    expect((await oc.pendingOfflineCheckins('u1')).length).toBe(1);
    await outbox.flushOutbox('u1');
    expect((await oc.pendingOfflineCheckins('u1')).length).toBe(0);
    // Uploaded once, even though the first send failed.
    expect(upload).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(body).toMatchObject({ landmarkId: 'lm', region: 'abacos', photoURL: expect.stringContaining('firebasestorage') });
    expect(addPhoto).toHaveBeenCalledOnce();
    expect(saveReview).toHaveBeenCalledWith({ rating: { tier: 'love' } });
    expect(notices.at(-1)).toBe("Your offline check-in at Nippers synced and it's verified. +100 points.");
  });

  it('says plainly when a synced check-in could not be verified', () => {
    expect(oc.syncedNotice('Nippers', { saved: true, verified: false, reason: 'too-far' })).toBe(
      "Your offline check-in at Nippers synced, but it couldn't be verified (too far away), so it didn't earn points."
    );
    expect(oc.syncedNotice('Nippers', { saved: false, reason: 'offline-limit', limit: 5 })).toMatch(/over today's 5 offline check-ins/);
  });
});

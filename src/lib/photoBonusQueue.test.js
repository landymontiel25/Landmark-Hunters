// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queuePhotoBonus, makePhotoBonusHandler } from './photoBonusQueue';
import { claimPhotoBonusAndTell } from './photoBonus';
import { _resetOutboxForTests, listJobs, putJob, flushOutbox, registerOutboxHandler, OUTBOX_NOTICE_EVENT } from './outbox';

vi.mock('./apiAuth', () => ({ authHeaders: async () => ({}) }));
vi.mock('./firebase', () => ({ db: null }));

const place = { id: 'hope-town-harbour', region: 'abacos', name: 'Hope Town Harbour' };
const notices = [];
window.addEventListener(OUTBOX_NOTICE_EVENT, (e) => notices.push(e.detail));

beforeEach(() => {
  _resetOutboxForTests();
  notices.length = 0;
  vi.unstubAllGlobals();
});

describe('photo bonus in the background (owner, 2026-11-25)', () => {
  it('a check that fails (server error) shows nothing and waits in the outbox', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'x' }) })));
    const toast = { show: vi.fn() };
    const res = await claimPhotoBonusAndTell(place.id, toast, { uid: 'u1', landmark: place });
    expect(res.reason).toBe('check-failed');
    expect(toast.show).not.toHaveBeenCalled();
    const jobs = await listJobs('u1', 'photoBonus');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.landmarkId).toBe(place.id);
  });

  it('offline (no answer at all) shows nothing either', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));
    const toast = { show: vi.fn() };
    await claimPhotoBonusAndTell(place.id, toast, { uid: 'u1', landmark: place });
    expect(toast.show).not.toHaveBeenCalled();
    expect(await listJobs('u1', 'photoBonus')).toHaveLength(1);
  });

  it('one waiting check per place', async () => {
    await queuePhotoBonus({ uid: 'u1', landmarkId: place.id, landmark: place });
    await queuePhotoBonus({ uid: 'u1', landmarkId: place.id, landmark: place });
    expect(await listJobs('u1', 'photoBonus')).toHaveLength(1);
  });

  it('retried quietly while it fails, then pays with a notice when the photo passes', async () => {
    const claim = vi.fn().mockResolvedValueOnce({ awarded: 0, reason: 'check-failed' }).mockResolvedValueOnce({ awarded: 10, reason: null });
    registerOutboxHandler('photoBonus', makePhotoBonusHandler({ claim }));
    await putJob({ uid: 'u1', kind: 'photoBonus', payload: { landmarkId: place.id, landmark: place }, giveUpNotice: null });
    await flushOutbox('u1');
    expect(notices).toEqual([]);
    expect(await listJobs('u1', 'photoBonus')).toHaveLength(1);
    await flushOutbox('u1');
    expect(notices.at(-1)).toMatchObject({ message: expect.stringContaining('+10 pts'), tone: 'success' });
    expect(await listJobs('u1', 'photoBonus')).toHaveLength(0);
  });

  it('a photo that really does not show the place: plain words and Retake', async () => {
    const out = await makePhotoBonusHandler({ claim: async () => ({ awarded: 0, reason: 'photo-not-of-place', why: 'A dark room', expected: null }) })({ uid: 'u1', payload: { landmarkId: place.id, landmark: place } });
    expect(out).toMatchObject({ done: true, actionLabel: 'Retake', href: '#/landmarks/abacos/hope-town-harbour' });
    expect(out.notice).toMatch(/doesn't show the place/);
  });

  it('never says it could not check the photo, even when it finally gives up', async () => {
    registerOutboxHandler('photoBonus', makePhotoBonusHandler({ claim: async () => ({ awarded: 0, reason: 'check-failed' }) }));
    await putJob({ uid: 'u1', kind: 'photoBonus', payload: { landmarkId: place.id }, giveUpNotice: null, tries: 199 });
    await flushOutbox('u1');
    expect(await listJobs('u1', 'photoBonus')).toHaveLength(0);
    expect(notices).toEqual([]);
  });
});

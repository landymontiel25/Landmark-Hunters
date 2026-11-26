// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./firebase', () => ({ db: null, storage: null, auth: null, appCheckInstance: null }));
vi.mock('./leaderboard', () => ({ addCheckinPhoto: vi.fn() }));

const outbox = await import('./outbox');
const pq = await import('./photoQueue');

const landmark = { id: 'alburys-sail-shop', name: "Albury's Sail Shop", region: 'abacos' };
const review = (photoURLs = []) => ({ exists: () => true, data: () => ({ photoURLs }) });
const none = { exists: () => false };

describe("a rating's photo that couldn't upload waits on the phone (owner, 2026-11-24)", () => {
  beforeEach(() => outbox._resetOutboxForTests());

  it('waits for the rating to save, then uploads and attaches it on its own', async () => {
    let saved = false;
    const read = vi.fn(async () => (saved ? review([]) : none));
    let net = false;
    const upload = vi.fn(async () => {
      if (!net) throw new Error('offline');
      return 'https://firebasestorage.googleapis.com/v0/b/b/o/r.jpg';
    });
    const attach = vi.fn(async () => {});
    outbox.registerOutboxHandler('reviewPhotos', pq.makeReviewPhotosHandler({ read, upload, attach, toCheckin: vi.fn() }));
    await pq.queueReviewPhotos({ userId: 'u1', landmark, files: [new Blob(['p'])] });

    await outbox.flushOutbox('u1'); // the rating isn't saved yet
    saved = true;
    await outbox.flushOutbox('u1'); // no connection for the photo
    expect(attach).not.toHaveBeenCalled();
    net = true;
    const notices = [];
    window.addEventListener(outbox.OUTBOX_NOTICE_EVENT, (e) => notices.push(e.detail.message));
    await outbox.flushOutbox('u1');
    expect(attach).toHaveBeenCalledWith('u1', landmark.id, ['https://firebasestorage.googleapis.com/v0/b/b/o/r.jpg']);
    expect(await outbox.listJobs('u1', 'reviewPhotos')).toEqual([]);
    expect(notices).toContain("Your photo for Albury's Sail Shop uploaded.");
    // Now that it's up, the photo bonus is checked in the background (owner, 2026-11-25).
    expect((await outbox.listJobs('u1', 'photoBonus')).map((j) => j.payload.landmarkId)).toEqual([landmark.id]);
  });

  it('never uploads or attaches twice when a later step fails, and overflow goes to the check-in once', async () => {
    const upload = vi.fn(async (_u, _l, f) => `https://x/${f.size}`);
    const attach = vi.fn(async () => {});
    let fail = true;
    const toCheckin = vi.fn(async () => {
      if (fail) throw new Error('drop');
    });
    // Two photos, one free slot on the rating.
    outbox.registerOutboxHandler('reviewPhotos', pq.makeReviewPhotosHandler({ read: async () => review(['a', 'b']), upload, attach, toCheckin }));
    await pq.queueReviewPhotos({ userId: 'u1', landmark, files: [new Blob(['1']), new Blob(['22'])] });
    await outbox.flushOutbox('u1');
    fail = false;
    await outbox.flushOutbox('u1');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(toCheckin).toHaveBeenCalledTimes(2); // failed once, then landed once
    expect(await outbox.listJobs('u1', 'reviewPhotos')).toEqual([]);
  });

  it('a check-in photo waits too; a full gallery says so and stops', async () => {
    const upload = vi.fn(async () => {
      throw Object.assign(new Error('full'), { userMessage: 'This check-in already has 9 photos, the most it can hold.' });
    });
    outbox.registerOutboxHandler('checkinPhoto', pq.makeCheckinPhotoHandler({ upload }));
    const notices = [];
    window.addEventListener(outbox.OUTBOX_NOTICE_EVENT, (e) => notices.push(e.detail.message));
    await pq.queueCheckinPhoto({ userId: 'u1', landmarkId: landmark.id, landmarkName: landmark.name, file: new Blob(['x']) });
    await outbox.flushOutbox('u1');
    expect(await outbox.listJobs('u1')).toEqual([]);
    expect(notices).toContain('This check-in already has 9 photos, the most it can hold.');
  });
});

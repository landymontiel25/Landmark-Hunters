// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ docs: new Map(), setDocImpl: null }));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ path: `${col}/${id}`, id }),
  getDoc: async (ref) => ({ exists: () => h.docs.has(ref.path), data: () => h.docs.get(ref.path), ref }),
  setDoc: async (ref, data) => {
    if (h.setDocImpl) return h.setDocImpl(ref, data);
    if (h.docs.has(ref.path)) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    h.docs.set(ref.path, data);
  },
  deleteDoc: async (ref) => h.docs.delete(ref.path),
  serverTimestamp: () => 'ts',
}));

import {
  getCommunityPhoto,
  shareCommunityPhoto,
  removeCommunityPhotoIfMine,
  isSharablePhotoUrl,
  photoOfferDeclined,
  rememberPhotoOfferDeclined,
  resetCommunityPhotoCache,
} from './communityPhotos';

const URL_A = 'https://firebasestorage.googleapis.com/v0/b/b.appspot.com/o/checkin_photos%2Fpl-1%2Fann_1700000000001.jpg?alt=media&token=t';

beforeEach(() => {
  h.docs.clear();
  h.setDocImpl = null;
  resetCommunityPhotoCache();
  localStorage.clear();
});

describe('community photos', () => {
  it('only the first photo becomes the public one; the second share loses', async () => {
    expect(await getCommunityPhoto('miami', 'pl-1')).toBeNull();
    expect(await shareCommunityPhoto({ region: 'miami', id: 'pl-1', url: URL_A, uid: 'ann' })).toBe(true);
    resetCommunityPhotoCache();
    expect(await getCommunityPhoto('miami', 'pl-1')).toEqual({ url: URL_A, photoUid: 'ann' });
    expect(await shareCommunityPhoto({ region: 'miami', id: 'pl-1', url: URL_A.replace('ann', 'bob'), uid: 'bob' })).toBe(false);
    resetCommunityPhotoCache();
    expect((await getCommunityPhoto('miami', 'pl-1')).photoUid).toBe('ann');
  });

  it('other errors are thrown, not mistaken for losing the race', async () => {
    h.setDocImpl = async () => {
      throw Object.assign(new Error('offline'), { code: 'unavailable' });
    };
    await expect(shareCommunityPhoto({ region: 'miami', id: 'pl-1', url: URL_A, uid: 'ann' })).rejects.toThrow('offline');
  });

  it('only the owner of that photo takes it down', async () => {
    await shareCommunityPhoto({ region: 'miami', id: 'pl-1', url: URL_A, uid: 'ann' });
    await removeCommunityPhotoIfMine({ region: 'miami', id: 'pl-1', uid: 'bob' });
    expect(h.docs.size).toBe(1);
    await removeCommunityPhotoIfMine({ region: 'miami', id: 'pl-1', uid: 'ann', url: 'https://other' });
    expect(h.docs.size).toBe(1);
    await removeCommunityPhotoIfMine({ region: 'miami', id: 'pl-1', uid: 'ann', urlIncludes: 'review_photos' });
    expect(h.docs.size).toBe(1);
    await removeCommunityPhotoIfMine({ region: 'miami', id: 'pl-1', uid: 'ann', url: URL_A });
    expect(h.docs.size).toBe(0);
  });

  it('only your own check-in or rating photo can be shared', () => {
    expect(isSharablePhotoUrl(URL_A, 'ann')).toBe(true);
    expect(isSharablePhotoUrl(URL_A.replace('checkin_photos', 'review_photos'), 'ann')).toBe(true);
    expect(isSharablePhotoUrl(URL_A, 'bob')).toBe(false);
    expect(isSharablePhotoUrl(URL_A.replace('checkin_photos', 'tip_photos'), 'ann')).toBe(false);
    expect(isSharablePhotoUrl('https://evil.example/x.jpg', 'ann')).toBe(false);
  });

  it('a no is remembered for that person and place only', () => {
    expect(photoOfferDeclined('ann', 'miami', 'pl-1')).toBe(false);
    rememberPhotoOfferDeclined('ann', 'miami', 'pl-1');
    expect(photoOfferDeclined('ann', 'miami', 'pl-1')).toBe(true);
    expect(photoOfferDeclined('bob', 'miami', 'pl-1')).toBe(false);
    expect(photoOfferDeclined('ann', 'miami', 'pl-2')).toBe(false);
  });
});

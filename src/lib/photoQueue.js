import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';
import { putJob, registerOutboxHandler, updateJob } from './outbox';
import { addCheckinPhoto } from './leaderboard';
import { queuePhotoBonus } from './photoBonusQueue';

// Photos that couldn't upload right away (owner, 2026-11-24: "Rating saved,
// but your photo couldn't upload" lost the photo). They wait on the phone in
// the outbox (outbox.js), photo and all, and upload on their own once
// there's a connection, no retry button:
//   'reviewPhotos'   photos for a rating: added to it once the rating itself
//                    has saved (a queued rating syncs first, ratingQueue.js);
//                    any the rating has no room for go on the check-in
//   'checkinPhoto'   a photo for the check-in's own gallery

export const PHOTO_QUEUED_MESSAGE = "Your photo's saved on this phone and uploads on its own when you're back online.";
export const RATING_PHOTO_QUEUED_MESSAGE = "Rating saved. Your photo's saved on this phone and uploads on its own when you're back online.";
const MAX_REVIEW_PHOTOS = 3;

const plainLandmark = (l) => ({ id: l.id, name: l.name, region: l.region ?? l.regionId ?? null });

export function queueReviewPhotos({ userId, landmark, files }) {
  if (!userId || !landmark?.id || !files?.length) return null;
  return putJob({ uid: userId, kind: 'reviewPhotos', payload: { landmark: plainLandmark(landmark), uploaded: [] }, files: files.slice(0, MAX_REVIEW_PHOTOS), giveUpNotice: `Your photo for ${landmark.name} couldn't be uploaded.` });
}

export function queueCheckinPhoto({ userId, landmarkId, landmarkName, file }) {
  if (!userId || !landmarkId || !file) return null;
  return putJob({ uid: userId, kind: 'checkinPhoto', payload: { landmarkId, landmarkName }, files: [file], giveUpNotice: `Your photo for ${landmarkName} couldn't be uploaded.` });
}

async function uploadReviewPhoto(userId, landmarkId, file) {
  const path = `review_photos/${landmarkId}/${userId}_${Date.now()}${crypto.getRandomValues(new Uint32Array(2)).join('')}.jpg`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(r);
}

export function makeReviewPhotosHandler({ read = (path) => getDoc(doc(db, ...path)), upload = uploadReviewPhoto, attach = (uid, id, urls) => updateDoc(doc(db, 'reviews', `${uid}_${id}`), { photoURLs: arrayUnion(...urls) }), toCheckin = addCheckinPhoto } = {}) {
  return async (job) => {
    const { landmark } = job.payload;
    const uid = job.uid;
    let snap;
    try {
      snap = await read(['reviews', `${uid}_${landmark.id}`]);
    } catch {
      return { retry: true, error: 'read' };
    }
    // The rating hasn't saved yet (it's waiting on the phone too).
    if (!snap?.exists?.()) return { retry: true, error: 'no rating yet' };
    // Worked out once and kept on the job, so a retry after the photos were
    // attached never sends them to the check-in as well.
    const room = job.payload.room ?? Math.max(0, MAX_REVIEW_PHOTOS - (snap.data().photoURLs || []).length);
    let p = { ...job.payload, room };
    const save = async (patch) => {
      p = { ...p, ...patch };
      await updateJob(job.id, { payload: p });
    };
    const files = job.files || [];
    try {
      let uploaded = p.uploaded || [];
      for (let i = uploaded.length; i < files.length && i < room; i++) {
        uploaded = [...uploaded, await upload(uid, landmark.id, files[i])];
        await save({ uploaded });
      }
      if (uploaded.length && !p.attached) {
        await attach(uid, landmark.id, uploaded);
        await save({ attached: true });
      }
      // No room left on the rating: the rest go on the check-in.
      for (let i = Math.max(room, p.onCheckin || room); i < files.length; i++) {
        await toCheckin(uid, landmark.id, files[i]);
        await save({ onCheckin: i + 1 });
      }
    } catch (e) {
      if (e?.userMessage) return { drop: true, notice: e.userMessage };
      return { retry: true, error: 'upload' };
    }
    // The photo bonus is checked now that the photo is up, in the background.
    queuePhotoBonus({ uid, landmarkId: landmark.id, landmark }).catch(() => {});
    return { done: true, notice: `Your ${files.length === 1 ? 'photo' : 'photos'} for ${landmark.name} uploaded.`, tone: 'success' };
  };
}

export function makeCheckinPhotoHandler({ upload = addCheckinPhoto } = {}) {
  return async (job) => {
    const { landmarkId, landmarkName } = job.payload;
    try {
      await upload(job.uid, landmarkId, job.files[0]);
    } catch (e) {
      // The gallery is full, say: nothing to retry.
      if (e?.userMessage) return { drop: true, notice: e.userMessage };
      return { retry: true, error: 'upload' };
    }
    queuePhotoBonus({ uid: job.uid, landmarkId, landmark: job.payload.region ? { id: landmarkId, region: job.payload.region, name: landmarkName } : null }).catch(() => {});
    return { done: true, notice: `Your photo for ${landmarkName} uploaded.`, tone: 'success' };
  };
}

export function registerPhotoQueue(hooks = {}) {
  registerOutboxHandler('reviewPhotos', makeReviewPhotosHandler(hooks.review));
  registerOutboxHandler('checkinPhoto', makeCheckinPhotoHandler(hooks.checkin));
}

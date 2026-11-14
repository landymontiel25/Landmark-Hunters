// Profile pictures (owner, 2026-11-14). One square JPEG per account at
// avatars/{uid}.jpg (storage.rules: only its owner writes it), its download
// URL on users/{uid}.avatarURL (firestore.rules: only that file's URL), so
// friends, leaderboards and Mapr can show it. No picture: the gold initial.
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';

export const AVATAR_SIZE = 512;
export const avatarPath = (uid) => `avatars/${uid}.jpg`;

/** Saves the cropped picture and returns its URL. */
export async function saveAvatar(uid, blob) {
  if (!db || !storage || !uid || !blob) throw new Error('Profile pictures need an account.');
  const fileRef = ref(storage, avatarPath(uid));
  await uploadBytes(fileRef, blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=3600' });
  // A new token per upload, so phones never show the old picture from cache.
  const url = await getDownloadURL(fileRef);
  await updateDoc(doc(db, 'users', uid), { avatarURL: url });
  return url;
}

/** Removes the picture (back to the gold initial). */
export async function removeAvatar(uid) {
  if (!db || !uid) return;
  await updateDoc(doc(db, 'users', uid), { avatarURL: deleteField() });
  if (storage) {
    try {
      await deleteObject(ref(storage, avatarPath(uid)));
    } catch {
      /* already gone */
    }
  }
}

// The crop: the part of the image under the squircle frame, drawn into a
// square. `view` is the frame's size on screen; `zoom` scales the image
// (1 = it just covers the frame); `x`, `y` move it, in screen pixels, from
// centered. Pure, so it can be tested.
export function cropRect({ width, height }, view, zoom, x, y) {
  const cover = Math.max(view / width, view / height) * zoom; // screen px per image px
  const side = view / cover; // the frame's side, in image px
  const cx = width / 2 - x / cover;
  const cy = height / 2 - y / cover;
  const sx = Math.min(Math.max(0, cx - side / 2), Math.max(0, width - side));
  const sy = Math.min(Math.max(0, cy - side / 2), Math.max(0, height - side));
  return { sx, sy, side: Math.min(side, width, height) };
}

// How far the image may move before the frame shows an edge.
export function clampOffset({ width, height }, view, zoom, x, y) {
  const cover = Math.max(view / width, view / height) * zoom;
  const maxX = Math.max(0, (width * cover - view) / 2);
  const maxY = Math.max(0, (height * cover - view) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
}

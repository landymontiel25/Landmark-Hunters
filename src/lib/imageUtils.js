import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

// Opens the native camera/photo-library prompt (an actual iOS action sheet
// once wrapped in Capacitor; the browser's own file picker on the web, via
// the plugin's web fallback) and returns a single File, or null if the user
// backed out without choosing one.
//
// webUseInput forces the web fallback straight to a plain <input type=file>
// instead of CameraSource.Prompt's action-sheet path, which depends on a
// <pwa-action-sheet> custom element from the separate @ionic/pwa-elements
// package. That package was never installed here, so the element is just an
// inert, unregistered tag -- Camera.getPhoto() would wait forever for an
// event it can never fire, and the button looked like it did nothing at all.
// Native iOS/Android ignore this flag and still show the real action sheet.
export async function pickPhoto() {
  let photo;
  try {
    photo = await Camera.getPhoto({
      quality: 85,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
      webUseInput: true,
    });
  } catch (e) {
    const msg = String(e?.message || e || '');
    // Backing out of the picker is not an error; a refused permission is, and
    // swallowing it made the photo button look dead.
    if (/denied|not.?authori[sz]ed|permission/i.test(msg)) {
      const err = new Error(PHOTO_DENIED_MESSAGE);
      err.userMessage = PHOTO_DENIED_MESSAGE;
      throw err;
    }
    return null;
  }
  if (!photo.webPath) return null;
  let blob;
  try {
    blob = await (await fetch(photo.webPath)).blob();
  } finally {
    // The web fallback hands back a URL.createObjectURL() blob: URL; we've
    // copied the bytes, so free it or every pick leaks the full photo.
    if (photo.webPath.startsWith('blob:')) URL.revokeObjectURL(photo.webPath);
  }
  const ext = photo.format || 'jpeg';
  const original = new File([blob], `photo.${ext}`, { type: blob.type || `image/${ext}` });
  const file = await downscalePhoto(original);
  if (file.size >= PHOTO_MAX_BYTES) {
    // Storage refuses 8 MB+ files; say so now instead of failing at upload.
    const msg = isHeic(file) ? PHOTO_HEIC_TOO_BIG_MESSAGE : PHOTO_TOO_BIG_MESSAGE;
    const err = new Error(msg);
    err.userMessage = msg;
    throw err;
  }
  return file;
}

const PHOTO_DENIED_MESSAGE = "Landmark Hunters doesn't have access to your camera or photos. Turn it on in Settings, then try again.";
export const PHOTO_HEIC_TOO_BIG_MESSAGE =
  "That HEIC photo is over the 8 MB limit and this browser can't shrink it. Pick a JPEG instead, or take a screenshot of the photo.";
const isHeic = (f) => /hei[cf]/i.test(f?.type || '') || /\.hei[cf]$/i.test(f?.name || '');

// storage.rules refuses uploads of 8 MB or more.
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_TOO_BIG_MESSAGE = "That photo is too large to upload (the limit is 8 MB). Try a smaller one or a screenshot of it.";

// Phone photos are routinely 5-12 MB. Redraws one at most `maxDim` px on its
// long side as a JPEG so it fits the upload cap and uploads fast. Anything
// the browser can't decode (e.g. HEIC on desktop Chrome) or that doesn't
// get smaller comes back unchanged.
export async function downscalePhoto(file, maxDim = 2000, quality = 0.85) {
  try {
    if (typeof document === 'undefined' || !file) return file;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('decode'));
        el.src = url;
      });
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale) || 1;
      canvas.height = Math.round(img.height * scale) || 1;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || (blob.size >= file.size && file.type === 'image/jpeg')) return file;
      return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return file;
  }
}

// Shrinks an image file down to a small JPEG data URL for sending to the AI
// verification endpoint -- the original file still gets uploaded to Storage
// at full quality separately. Keeps the request tiny and fast regardless of
// how large the original photo is (a phone photo can be several MB).
export function fileToSmallDataUrl(file, maxSize = 768, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that photo.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale) || 1;
        canvas.height = Math.round(img.height * scale) || 1;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

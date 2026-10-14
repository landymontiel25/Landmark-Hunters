import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// The app's side of the tips endpoints (api/post-tip.js, api/tips.js).
// Every call returns the server's JSON; a failure throws an Error whose
// message is the server's own (already written for people to read).

// Fired after a tip of yours is posted, so an open landmark page reloads.
export const TIPS_CHANGED_EVENT = 'lh-tips-changed';

async function call(path, { method = 'POST', body = null, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || 'Something went wrong. Try again.'), { status: r.status, code: out.code || null, userMessage: out.error || null });
  return out;
}

export const postTip = ({ checkinId, text, tags = [], photoURL = null }, opts) => call('/api/post-tip', { body: { checkinId, text, tags, photoURL }, ...opts });
export const editMyTip = ({ landmarkId, region, text, tags = [] }, opts) =>
  call('/api/post-tip', { body: { action: 'edit', landmarkId, region, text, tags }, ...opts });
export const deleteMyTip = (landmarkId, region, opts) => call('/api/post-tip', { body: { action: 'delete', landmarkId, region }, ...opts });
// A photo uploaded for a tip that never posted (cancelled or refused).
export const discardTipPhoto = (photoURL, opts) => call('/api/post-tip', { body: { action: 'discard-photo', photoURL }, ...opts });
// Account deletion: your tips and marks, on the server (a removed or
// reported tip stays hidden for review; reports you filed stay).
export const deleteAllMyTips = (opts) => call('/api/post-tip', { body: { action: 'delete-mine' }, ...opts });
export const fetchTips = (region, landmarkId, opts) => call(`/api/tips?region=${encodeURIComponent(region)}&landmarkId=${encodeURIComponent(landmarkId)}`, { method: 'GET', ...opts });
export const reactToTip = (tipId, kind, on, opts) => call('/api/tips', { body: { action: 'react', tipId, kind, on }, ...opts });
export const reportTip = (tipId, reason, opts) => call('/api/tips', { body: { action: 'report', tipId, reason }, ...opts });
// Tips that reached the screen (the server keeps who saw what, privately).
export const markTipsSeen = (tipIds, opts) => call('/api/tips', { body: { action: 'seen', tipIds }, ...opts });

// Uploads a tip photo to tip_photos/{uid}/ (storage.rules: the owner's own
// folder, images under 5 MB, never overwritten) and returns its download
// URL. Shrunk first: a phone photo is often over 5 MB.
export async function uploadTipPhoto(uid, file) {
  const [{ ref, uploadBytes, getDownloadURL }, { storage }, { shrinkPhoto }, { withTimeout }] = await Promise.all([
    import('firebase/storage'),
    import('./firebase'),
    import('./shrinkPhoto'),
    import('./withTimeout'),
  ]);
  if (!storage || !uid || !file) throw new Error('Photos are not available right now.');
  const small = await shrinkPhoto(file, 1600, 0.82);
  // Only formats every phone and browser shows: a photo the browser
  // couldn't convert (HEIC on most desktops) is refused, not posted broken.
  // A file with no type counts only by its name.
  const ok = small.type ? /^image\/(jpeg|png|webp)$/.test(small.type) : /\.(jpe?g|png|webp)$/i.test(file.name || '');
  if (!ok) {
    const msg = "That photo's format can't be shown everywhere. Try a JPEG or a screenshot of it.";
    throw Object.assign(new Error(msg), { userMessage: msg });
  }
  if (small.size >= 5 * 1024 * 1024) throw Object.assign(new Error('That photo is too large (the limit is 5 MB).'), { userMessage: 'That photo is too large (the limit is 5 MB).' });
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const r = ref(storage, `tip_photos/${uid}/${name}`);
  // Timed out like the other uploads, so a dead connection shows an error
  // instead of "Sharing…" forever.
  const slow = "Couldn't upload the photo. Check your connection and try again.";
  // An upload that ends up unused (no URL back, or it finishes after the
  // timeout) is removed by the server (the URL needs no token for that).
  const discard = () => discardTipPhoto(`https://firebasestorage.googleapis.com/v0/b/${r.bucket}/o/${encodeURIComponent(r.fullPath)}`).catch(() => {});
  const upload = uploadBytes(r, small, { contentType: small.type || 'image/jpeg' });
  try {
    await withTimeout(upload, 30000);
  } catch (e) {
    upload.then(discard, () => {});
    throw Object.assign(new Error(slow), { userMessage: slow, cause: e });
  }
  try {
    return await withTimeout(getDownloadURL(r), 10000);
  } catch (e) {
    discard();
    throw Object.assign(new Error(slow), { userMessage: slow, cause: e });
  }
}

import { authHeaders } from './apiAuth';
import { API_BASE } from './apiBase';
import { dayKey } from './streaks';

// Asks the server for the photo bonus (api/_lib/photoBonus.js: +10 the
// first time you add a photo at a place you checked in to, once per place,
// 5 places a day, and only if the photo shows the place). Called after a
// photo saves. Best effort: a failure never touches the photo itself.
// Resolves to { awarded, reason } (awarded 0 when none).
export async function claimPhotoBonus(landmarkId) {
  if (!landmarkId) return { awarded: 0, reason: null };
  try {
    const r = await fetch(`${API_BASE}/api/photo-bonus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ landmarkId, dayId: dayKey(new Date()) }),
    });
    const data = await r.json().catch(() => null);
    return { awarded: Number(data?.awarded) || 0, reason: data?.reason || null };
  } catch {
    return { awarded: 0, reason: null };
  }
}

// The toast after a photo, or null for nothing to say (already paid, the
// daily limit, no check-in here).
export function photoBonusToast({ awarded, reason }) {
  if (awarded > 0) return { message: `\u{1F4F8} +${awarded} pts for your photo!`, tone: 'success' };
  if (reason === 'photo-not-of-place')
    return { message: "No photo bonus: that photo doesn't look like it was taken here. Add one of the place to earn it.", tone: 'info' };
  return null;
}

// Asks, then shows the toast (if any) with the app's toast.show.
export function claimPhotoBonusAndTell(landmarkId, toast) {
  return claimPhotoBonus(landmarkId).then((res) => {
    const t = photoBonusToast(res);
    if (t) toast.show(t.message, { tone: t.tone });
    return res;
  });
}

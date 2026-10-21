import { authHeaders } from './apiAuth';
import { API_BASE } from './apiBase';
import { dayKey } from './streaks';

// Asks the server for the photo bonus (api/_lib/photoBonus.js: +10 the
// first time you add a photo at a place you checked in to, once per place,
// 5 places a day). Called after a photo saves. Best effort: a failure never
// touches the photo itself. Resolves to the points awarded (0 when none).
export async function claimPhotoBonus(landmarkId) {
  if (!landmarkId) return 0;
  try {
    const r = await fetch(`${API_BASE}/api/photo-bonus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ landmarkId, dayId: dayKey(new Date()) }),
    });
    const data = await r.json().catch(() => null);
    return Number(data?.awarded) || 0;
  } catch {
    return 0;
  }
}

export const photoBonusMessage = (points) => `\u{1F4F8} +${points} pts for your photo!`;

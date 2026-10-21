import { authHeaders } from './apiAuth';
import { API_BASE } from './apiBase';
import { dayKey } from './streaks';
import { isRealCheckin } from './realCheckin';

// A place's own bonus (src/data/specialPlaces.js, e.g. 1,000 points at the
// Alhambra Water Tower), paid once per account by the server
// (api/_lib/landmarkBonus.js) for a real check-in there. Best effort.
export async function claimLandmarkBonus(landmark) {
  const regionId = landmark?.regionId || landmark?.region;
  if (!landmark?.landmarkBonus || !regionId) return 0;
  try {
    const r = await fetch(`${API_BASE}/api/landmark-bonus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ regionId, landmarkId: landmark.id, dayId: dayKey(new Date()) }),
    });
    const data = await r.json().catch(() => null);
    return Number(data?.awarded) || 0;
  } catch {
    return 0;
  }
}

export const landmarkBonusMessage = (points, landmark) =>
  `\u{1F3C6} +${points.toLocaleString()} pts: ${landmark?.name || 'this place'} is the first landmark ever in Landmark Hunters!`;

// Asks, and shows the toast when it paid. Also used when someone who
// checked in before the bonus existed opens the place (myCheckin real).
export function claimLandmarkBonusAndTell(landmark, toast, { checkin = null } = {}) {
  if (!landmark?.landmarkBonus) return Promise.resolve(0);
  if (checkin && !isRealCheckin(checkin)) return Promise.resolve(0);
  return claimLandmarkBonus(landmark).then((pts) => {
    if (pts > 0) toast.show(landmarkBonusMessage(pts, landmark), { tone: 'success', durationMs: 9000 });
    return pts;
  });
}

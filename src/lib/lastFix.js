// The device's last GPS fix (GeoContext saves it), for screens that need
// where you were without watching the GPS, like Get directions deciding
// which ways of getting there fit. Null when there's none, or it's old.
export const LAST_FIX_KEY = 'lh-last-fix';
const LAST_FIX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function readLastFix() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_FIX_KEY) || 'null');
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Date.now() - (v.t || 0) < LAST_FIX_MAX_AGE_MS ? v : null;
  } catch {
    return null;
  }
}

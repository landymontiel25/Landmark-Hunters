// Travel Picks answers (pick_feedback docs) that count toward a solo streak
// day: the same "rate 3 landmarks today" the app has always promised under
// Mapr Travel Picks. Pure, so the day-close route and its tests share it.

// Mirrors PICKS_STREAK_THRESHOLD in src/lib/streaks.js (not imported: that
// file pulls in the browser Firebase SDK, which has no place in an API route).
export const SOLO_PICK_VOTES_REQUIRED = 3;

const VERDICTS = new Set(['yes', 'no', 'unsure']);

// dayId is the client's local day key, `${year}-${monthIndex0}-${day}`.
// tzOffsetMin is the client's Date#getTimezoneOffset() (UTC minus local, in
// minutes, so UTC-4 is 240). Returns the UTC ms window of that local day, or
// null when either is missing or implausible (then only the daily cards close
// the day, as before).
export function localDayWindow(dayId, tzOffsetMin) {
  if (!Number.isInteger(tzOffsetMin) || tzOffsetMin < -840 || tzOffsetMin > 840) return null;
  const parts = String(dayId || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  const [y, m, d] = parts;
  const start = Date.UTC(y, m, d) + tzOffsetMin * 60000;
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

// Distinct landmarks the user answered on that local day.
export function distinctPickAnswersOn(docs, window) {
  if (!window) return 0;
  const ids = new Set();
  for (const raw of docs || []) {
    const f = typeof raw?.data === 'function' ? raw.data() : raw;
    if (!f || !VERDICTS.has(f.verdict)) continue;
    const id = typeof f.landmarkId === 'string' ? f.landmarkId : '';
    const at = Number(f.at);
    if (!id || id.length > 100 || !Number.isFinite(at)) continue;
    if (at >= window.start && at < window.end) ids.add(id);
  }
  return ids.size;
}

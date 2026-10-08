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
// tzOffsetEndMin (optional) is the offset at the NEXT local midnight. On a
// daylight-saving day the local day is 23 or 25 hours long, so the end uses
// its own offset; without it the window is a plain 24 hours, as before.
const offsetOk = (v) => Number.isInteger(v) && v >= -840 && v <= 840;
export function localDayWindow(dayId, tzOffsetMin, tzOffsetEndMin) {
  if (!offsetOk(tzOffsetMin)) return null;
  const parts = String(dayId || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  const [y, m, d] = parts;
  const start = Date.UTC(y, m, d) + tzOffsetMin * 60000;
  const endOffset = offsetOk(tzOffsetEndMin) && Math.abs(tzOffsetEndMin - tzOffsetMin) <= 120 ? tzOffsetEndMin : tzOffsetMin;
  return { start, end: Date.UTC(y, m, d + 1) + endOffset * 60000 };
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

// A check-in doc that is NOT a real visit: the 0-point claim "Rate a
// Landmark" (and the Mapr rate card) writes. Mirrors isRealCheckin in
// src/lib/leaderboard.js, which this route cannot import (browser SDK).
export function isRatingOnlyClaim(c) {
  if (!c) return false;
  if (c.ratingOnly) return true;
  if (typeof c.visited === 'boolean') return !c.visited;
  return c.points === 0;
}

const msOf = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : Number.isFinite(t?.seconds) ? t.seconds * 1000 : Number(t));

// Distinct landmarks engaged with on that local day, the SAME rule the
// "N/3 today" counter uses on the client (todaysActionCount in
// src/lib/streaks.js): Travel Picks answers plus 0-point "Rate a Landmark"
// ratings. Real check-ins do not count here.
export function distinctActionsOn(pickDocs, checkinDocs, window) {
  if (!window) return 0;
  const ids = new Set();
  for (const raw of pickDocs || []) {
    const f = typeof raw?.data === 'function' ? raw.data() : raw;
    if (!f || !VERDICTS.has(f.verdict)) continue;
    const id = typeof f.landmarkId === 'string' ? f.landmarkId : '';
    const at = Number(f.at);
    if (id && id.length <= 100 && Number.isFinite(at) && at >= window.start && at < window.end) ids.add(id);
  }
  for (const raw of checkinDocs || []) {
    const c = typeof raw?.data === 'function' ? raw.data() : raw;
    if (!isRatingOnlyClaim(c)) continue;
    const id = typeof c.landmarkId === 'string' ? c.landmarkId : '';
    const at = msOf(c.createdAt);
    if (id && id.length <= 100 && Number.isFinite(at) && at >= window.start && at < window.end) ids.add(id);
  }
  return ids.size;
}

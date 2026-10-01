import { MATCH_WEEK_MS } from './maprConstants.js';

// Which shown picks count toward Mapr's match rate. A place counts once per
// user per MATCH_WEEK_MS: the first showing opens the window, and later
// showings of the same place to the same user inside it are dropped (the
// next one after the window counts and opens a new window).
//
// Only real shown rows count: not test rows, and not old build-time rows
// (no shownAt/setId), which never proved the pick reached the screen.
// `rows` are recommendation_log docs; shownAt is ms or a Firestore timestamp.
const msOf = (v) => (typeof v === 'number' ? v : v?.seconds != null ? v.seconds * 1000 : v?.toMillis?.() ?? null);

export function countedShownPicks(rows, weekMs = MATCH_WEEK_MS) {
  const shown = (rows || [])
    .filter((r) => r && r.isTest !== true && r.setId && r.userId && r.landmarkId)
    .map((r) => ({ r, ms: msOf(r.shownAt) }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);
  const lastCounted = new Map();
  const out = [];
  for (const { r, ms } of shown) {
    const k = `${r.userId}|${r.region || ''}/${r.landmarkId}`;
    const prev = lastCounted.get(k);
    if (prev != null && ms - prev < weekMs) continue;
    lastCounted.set(k, ms);
    out.push(r);
  }
  return out;
}

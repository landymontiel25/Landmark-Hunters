// Preference chaining: "after a museum, this person usually goes for
// coffee". Built only from the user's own check-in history, as one-way
// category -> category links.
//
// A pair A -> B is counted when a check-in in category B comes within
// CHAIN_WINDOW_MS after a check-in in category A, on the same calendar day,
// with no other check-in in between (so only back-to-back check-ins count).
// Once the same ordered pair has been counted CHAIN_MIN_COUNT times, the
// link A -> B is real. B -> A is a separate link with its own count.

export const CHAIN_WINDOW_MS = 3 * 60 * 60 * 1000;
export const CHAIN_MIN_COUNT = 3;

const UNRATEABLE = new Set(['dorms', 'campus-life']);

// A check-in's time in ms: Firestore Timestamp ({ seconds }), a number, or
// a Date. Null when there's nothing usable.
export function checkinTimeMs(c) {
  if (!c) return null;
  if (Number.isFinite(c.at)) return c.at;
  if (c.at instanceof Date) return c.at.getTime();
  const ts = c.createdAt;
  if (ts?.seconds != null) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  if (Number.isFinite(ts)) return ts;
  return null;
}

// The category a check-in counts under: its landmark's first rateable
// category (a campus building tagged history + campus-life reads as history).
export function primaryCategory(categories) {
  return (categories || []).find((c) => !UNRATEABLE.has(c)) || null;
}

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

// A 0-point "Rate a Landmark" claim isn't a visit, so it never counts and
// never sits "in between" two real check-ins.
const isVisit = (c) => !c.ratingOnly && c.visited !== false;

// Turns raw check-ins into time-ordered { at, category } events.
// categoryOf(checkin) resolves the category -- pass one that looks the
// landmark up in the catalog; by default it reads checkin.categories.
export function checkinEvents(checkins, categoryOf = (c) => primaryCategory(c.categories)) {
  return (checkins || [])
    .filter((c) => c && isVisit(c))
    .map((c) => ({ at: checkinTimeMs(c), category: categoryOf(c) }))
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at);
}

// { 'A>B': count } over back-to-back pairs. Events without a category still
// take their place in the timeline (they break a chain), they just can't
// be either end of a pair.
export function countBackToBackPairs(events, { windowMs = CHAIN_WINDOW_MS } = {}) {
  const counts = {};
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1];
    const b = events[i];
    if (!a.category || !b.category || a.category === b.category) continue;
    const gap = b.at - a.at;
    if (gap <= 0 || gap > windowMs) continue;
    if (dayKey(a.at) !== dayKey(b.at)) continue;
    const key = `${a.category}>${b.category}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Links that have reached CHAIN_MIN_COUNT, strongest first:
// [{ from, to, count }].
export function buildPreferenceChains(checkins, { categoryOf, windowMs = CHAIN_WINDOW_MS, minCount = CHAIN_MIN_COUNT } = {}) {
  const counts = countBackToBackPairs(checkinEvents(checkins, categoryOf), { windowMs });
  return Object.entries(counts)
    .filter(([, n]) => n >= minCount)
    .map(([key, count]) => {
      const [from, to] = key.split('>');
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

// Links leading out of one category, strongest first. One-way: a link
// museum -> food never answers for food.
export function linksFrom(links, category) {
  if (!category) return [];
  return (links || []).filter((l) => l.from === category);
}

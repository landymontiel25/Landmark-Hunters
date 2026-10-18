// What counts as a real visit, pure, so the app (leaderboard.js, streaks,
// galleries, friend stats, Mapr ratings) and the API
// (api/regional-leaderboard.js) agree. Check-ins carry explicit `visited` /
// `ratingOnly` fields; data written before those existed falls back to the
// old points rule, which was right for that data.
export function isRealCheckin(x) {
  if (x.ratingOnly) return false;
  if (typeof x.visited === 'boolean') return x.visited;
  return x.points !== 0;
}

// Local calendar day of a check-in ("2026-9-14"), or null while its
// createdAt is still pending.
const secondsOf = (x) => (Number.isFinite(x?.createdAt?.seconds) ? x.createdAt.seconds : Number.isFinite(x?.createdAt) ? x.createdAt : null);
export function visitDayOf(x) {
  const s = secondsOf(x);
  if (s == null) return null;
  const d = new Date(s * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// One visit per place per day (owner, 2026-10-18: re-checking in to edit a
// rating made Budare Bistro show twice). Real check-ins to the same place on
// the same local day collapse into the first one, which picks up the later
// ones' photos. Everything else passes through untouched, in order.
export function oneVisitPerDay(rows = []) {
  const firstOf = new Map(); // landmarkId|day -> the row kept for it
  const out = [];
  const sorted = [...rows].sort((a, b) => (secondsOf(a) ?? Infinity) - (secondsOf(b) ?? Infinity));
  const keep = new Set();
  for (const x of sorted) {
    const day = isRealCheckin(x) ? visitDayOf(x) : null;
    const key = day && x.landmarkId ? `${x.landmarkId}|${day}` : null;
    if (!key || !firstOf.has(key)) {
      if (key) firstOf.set(key, x);
      keep.add(x);
      continue;
    }
    const first = firstOf.get(key);
    const more = [...(x.photoURLs || []), ...(x.photoURL && !x.photoURLs?.length ? [x.photoURL] : [])];
    if (more.length) {
      const merged = { ...first, photoURLs: [...(first.photoURLs || (first.photoURL ? [first.photoURL] : [])), ...more] };
      keep.delete(first);
      keep.add(merged);
      firstOf.set(key, merged);
    }
  }
  // Back in the caller's order, with merged rows in their first one's place.
  const byId = new Map([...keep].map((x) => [x.id ?? x, x]));
  for (const x of rows) {
    const k = x.id ?? x;
    if (byId.has(k)) {
      out.push(byId.get(k));
      byId.delete(k);
    }
  }
  return out;
}

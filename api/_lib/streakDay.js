// Pure day/month-key helpers, duplicated from src/lib/streaks.js rather
// than imported from it: streaks.js imports leaderboard.js, which imports
// src/lib/firebase.js, which reads import.meta.env.VITE_FIREBASE_API_KEY --
// a Vite-only construct. Vite substitutes it in the client build; these
// serverless functions are bundled by Vercel's own (esbuild) builder,
// which leaves `import.meta.env` as literal syntax. `import.meta.env` is
// undefined at runtime outside Vite, so `.VITE_FIREBASE_API_KEY` on it
// throws a TypeError the instant the module loads -- any api/ file that
// imports src/lib/streaks.js (or anything else that chains into
// src/lib/firebase.js) crashes on every call. verifyAuth.js already avoids
// this by reading process.env.VITE_FIREBASE_API_KEY instead; these
// duplicated helpers are the same fix applied here.

export const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

export function previousDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m, d - 1));
}

// dayKey(d) above reads d.getFullYear()/getMonth()/getDate() -- the
// *executing machine's* local timezone. In a browser that's the traveler's
// own clock, which is exactly what a "local calendar day" streak needs (see
// src/lib/streaks.js's own note on this). On Vercel's serverless functions
// the machine's local timezone is UTC, so the SAME code run here computes a
// different "today" than the client did for the same real-world moment --
// for anyone not in UTC, that silently shifts which calendar day a
// historical check-in/vote lands in. localDayKey fixes that by resolving
// the day in an explicitly-given IANA timeZone (the client's own, via
// Intl.DateTimeFormat().resolvedOptions().timeZone) instead of the
// executing machine's, so a day-key computed here always matches the one
// the same timestamp would produce in the user's own browser. Falls back to
// the machine-local reading only if timeZone is missing/invalid, so this
// never throws.
export function localDayKey(epochMs, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(
      new Date(epochMs)
    );
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (!y || !m || !d) throw new Error('unresolvable timeZone');
    return `${y}-${m - 1}-${d}`;
  } catch {
    return dayKey(new Date(epochMs));
  }
}

// A day key sent by the client ("2026-9-1", month 0-based like dayKey), or
// null if it isn't well-formed or isn't plausibly "today" somewhere on
// Earth. Real local dates differ from the server's UTC date by at most one
// day either way (UTC-12..UTC+14), so anything further out is a forged day
// -- close-*-streak-day used to accept any string, which let someone write
// ratings for made-up past/future days and close each one for leaderboard
// points. The freeze endpoints also use this so a freeze lands on the
// caller's own local day instead of the server's UTC day.
export function validClientDayKey(raw, nowMs = Date.now()) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const asUtc = Date.UTC(y, m, d);
  if (new Date(asUtc).getUTCMonth() !== m || new Date(asUtc).getUTCDate() !== d) return null;
  const n = new Date(nowMs);
  const todayUtc = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return Math.abs(asUtc - todayUtc) <= 86400000 ? raw : null;
}

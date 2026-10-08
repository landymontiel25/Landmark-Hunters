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

// The client's own local "today" key (dayKey(new Date()) in its browser),
// sent as `dayId`. Freezes must be keyed to THIS day, not the serverless
// machine's own clock (always UTC): in the evening in any US timezone the
// server's "today" is already tomorrow, so a freeze would hold a day the
// traveler never sees as today and the next completion would still count as a
// break. Returns the key if it's well-formed and within one calendar day of
// the server's UTC date (every real timezone is within that), else null.
export function validClientDayKey(dayId, now = new Date()) {
  if (typeof dayId !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(dayId)) return null;
  const [y, m, d] = dayId.split('-').map(Number);
  if (m > 11 || d < 1 || d > 31) return null;
  // Only the canonical form of a real date: "2026-1-31" (Feb 31 = Mar 3) or
  // "2026-02-03" would otherwise name the same day under a second key and
  // slip past the string "already closed" checks for a second payout.
  if (new Date(Date.UTC(y, m, d)).getUTCDate() !== d || `${y}-${m}-${d}` !== dayId) return null;
  const n = now instanceof Date ? now : new Date(now);
  const diffDays = (Date.UTC(y, m, d) - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86400000;
  return Math.abs(diffDays) <= 1 ? dayId : null;
}

// True when dayKey `a` is strictly before dayKey `b` (both "y-m-d" keys).
export function isDayBefore(a, b) {
  const t = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m, d);
  };
  return t(a) < t(b);
}

// Month key (same shape as monthKey) of a dayKey -- so a freeze spent late on
// the last evening of a month lands in the traveler's month, not the server's.
export function monthKeyOfDay(dayId) {
  const [y, m] = dayId.split('-');
  return `${y}-${m}`;
}

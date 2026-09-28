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

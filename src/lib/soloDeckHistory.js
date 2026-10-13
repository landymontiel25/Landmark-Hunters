import { getUserCheckins } from './leaderboard';
import { getPickFeedback } from './pickFeedback';

// Landmarks you answered before `beforeMs` (a rating, a check-in, or an
// I'd go / Not sure / Not for me vote), as a Map of id -> when, for the solo
// streak's daily cards (sharedDeck.js avoidIds). Only answers from before
// today count, so rating today's cards never reshuffles today's deck.
export async function answeredBefore(uid, beforeMs) {
  const [rows, feedback] = await Promise.all([
    Promise.resolve()
      .then(() => getUserCheckins(uid))
      .catch(() => []),
    Promise.resolve()
      .then(() => getPickFeedback(uid))
      .catch(() => ({})),
  ]);
  const out = new Map();
  const add = (id, at) => {
    if (typeof id !== 'string' || !id || !Number.isFinite(at) || at >= beforeMs) return;
    out.set(id, Math.max(out.get(id) || 0, at));
  };
  for (const c of rows || []) add(c?.landmarkId, Number(c?.createdAt?.seconds) * 1000);
  for (const f of Object.values(feedback || {})) add(f?.landmarkId, Number(f?.at));
  return out;
}

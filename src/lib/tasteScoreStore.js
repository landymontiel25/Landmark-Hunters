import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { PREDICTION_LEVELS, TASTE_RECOMPUTE_DELAY_MS } from './maprConstants';
import { historySnapshot, shouldSnapshot, tasteSummary } from './tasteScore';

// Firestore side of the taste score (pure maths lives in tasteScore.js).
// Reads only the signed-in user's own rows: their recommendation_log picks
// that carry a hidden prediction, and their own place_scores docs.

export const TASTE_ANSWER_EVENT = 'lh-taste-answer';

export async function loadTasteSummary(uid) {
  if (!db || !uid) return null;
  const [rowsSnap, placesSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'recommendation_log'),
        where('userId', '==', uid),
        where('isTest', '==', false),
        where('predicted', 'in', PREDICTION_LEVELS)
      )
    ),
    getDocs(collection(db, 'users', uid, 'place_scores')),
  ]);
  const rows = rowsSnap.docs.map((d) => d.data());
  const places = placesSnap.docs.map((d) => d.data());
  return tasteSummary({ rows, places });
}

// After an answer (a rating or a tap): recompute, tell the card, and write a
// history snapshot if the throttle allows. Best-effort, never throws.
export async function recordTasteAnswer(uid, { now = Date.now() } = {}) {
  try {
    const summary = await loadTasteSummary(uid);
    if (!summary) return null;
    try {
      window.dispatchEvent(new CustomEvent(TASTE_ANSWER_EVENT, { detail: summary }));
    } catch {
      /* no window (tests/SSR) */
    }
    const lastSnap = await getDocs(query(collection(db, 'users', uid, 'taste_history'), orderBy('at', 'desc'), limit(1)));
    const last = lastSnap.docs[0]?.data() || null;
    if (shouldSnapshot({ last, summary, now })) {
      await addDoc(collection(db, 'users', uid, 'taste_history'), { ...historySnapshot(summary, now), createdAt: serverTimestamp() });
    }
    return summary;
  } catch {
    return null;
  }
}

// Answers often arrive in bursts (onboarding rates ten places in a row), so
// the recompute waits for a quiet moment instead of reading once per answer.
const timers = new Map();
export function scheduleTasteRecompute(uid) {
  if (!uid) return;
  clearTimeout(timers.get(uid));
  timers.set(
    uid,
    setTimeout(() => {
      timers.delete(uid);
      recordTasteAnswer(uid);
    }, TASTE_RECOMPUTE_DELAY_MS)
  );
}

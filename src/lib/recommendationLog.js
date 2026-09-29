import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// One row per place Mapr recommended from the Plan Your Trip wizard, in
// Firestore recommendation_log/{auto-id}. pickType records which "What
// sounds good?" answer produced it -- 'usual', 'new', or null when that step
// was skipped or hidden (under 10 ratings) -- so the match rate (how many
// of these later got a check-in or a good rating) can be split by type.
// Best-effort, like pick_feedback: a failed write never blocks the chat.

export const PICK_TYPES = ['usual', 'new'];

export function recommendationEntries({ uid, source, pickType, stops, rankedIds = [], at = Date.now() }) {
  const ranked = new Set(rankedIds);
  return (stops || [])
    .filter((s) => s && !s.external && s.id && s.region)
    .map((s) => ({
      userId: uid,
      source,
      pickType: PICK_TYPES.includes(pickType) ? pickType : null,
      landmarkId: s.id,
      region: s.region,
      name: String(s.name || '').slice(0, 120),
      categories: s.categories || [],
      // Whether the on-device usual/new ranking had suggested this exact place.
      fromRanking: ranked.has(`${s.region}/${s.id}`),
      at,
    }));
}

export async function logRecommendations(args) {
  if (!db || !args?.uid) return [];
  const entries = recommendationEntries(args);
  await Promise.all(
    entries.map((e) => addDoc(collection(db, 'recommendation_log'), { ...e, createdAt: serverTimestamp() }).catch(() => {}))
  );
  return entries;
}

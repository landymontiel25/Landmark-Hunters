import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// One row per place Mapr recommended, in Firestore recommendation_log/
// {auto-id}. pickType records which kind of pick produced it -- 'usual',
// 'new', or null when that step was skipped or hidden (under 10 ratings) --
// so the match rate (how many of these later got a check-in or a good
// rating) can be split by type. A stop can carry its own pickType (a mixed
// set, like nearby picks); otherwise the call's pickType applies to all.
//
// isTest is true for picks shown in admin preview/test surfaces (the Test
// tab). Those never count toward Mapr's match rate: filter on
// `isTest == false`. Every row has the field, so the filter never misses one.
// Best-effort, like pick_feedback: a failed write never blocks the chat.

export const PICK_TYPES = ['usual', 'new'];

export function recommendationEntries({ uid, source, pickType, stops, rankedIds = [], isTest = false, at = Date.now() }) {
  const ranked = new Set(rankedIds);
  return (stops || [])
    .filter((s) => s && !s.external && s.id && s.region)
    .map((s) => {
      const type = s.pickType !== undefined ? s.pickType : pickType;
      return {
        userId: uid,
        source,
        pickType: PICK_TYPES.includes(type) ? type : null,
        landmarkId: s.id,
        region: s.region,
        name: String(s.name || '').slice(0, 120),
        categories: s.categories || [],
        // Whether the on-device usual/new ranking had suggested this exact place.
        fromRanking: ranked.has(`${s.region}/${s.id}`),
        isTest: isTest === true,
        at,
      };
    });
}

export async function logRecommendations(args) {
  if (!db || !args?.uid) return [];
  const entries = recommendationEntries(args);
  await Promise.all(
    entries.map((e) => addDoc(collection(db, 'recommendation_log'), { ...e, createdAt: serverTimestamp() }).catch(() => {}))
  );
  return entries;
}

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { getLandmark } from '../data/regions';
import { makeSetId } from './setId';
import { predictLevel } from './maprPrediction';
import { REQUEST_FOR_VALUES, SHOWN_MEMORY_LIMIT, SURFACES } from './maprConstants';
import { rememberShownPicks } from './pickMarks';

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
//
// A row is written when a pick is SHOWN on screen, not when its set is built:
//   setId    one id per built set (makeSetId), shared by every row of the set
//   rank     1-based position in that set
//   shownAt  ms the card reached the screen
//   surface  'map-sheet' | 'mapr-tab' | 'chat' (SURFACES)
//   predicted  hidden guess of how the user will answer ('positive' |
//            'neutral' | 'negative' | null, see maprPrediction.js). Written
//            only; never put on a pick object or returned to the UI.
//   requestFor  'solo' | 'group', for picks that answer a Mapr chat request
//            (asked before every request). Absent on picks from other surfaces.
// Rows from older app builds are written at build time without these fields.

export const PICK_TYPES = ['usual', 'new'];

const catsOf = (s) => (s.categories && s.categories.length ? s.categories : getLandmark(s.region, s.id)?.categories) || [];

export { makeSetId };
export function recommendationEntries({ uid, source, surface, setId, profile, pickType, stops, rankedIds = [], isTest = false, requestFor = null, at = Date.now() }) {
  const ranked = new Set(rankedIds);
  const withRank = (stops || []).map((s, i) => (s && s.rank == null ? { ...s, rank: i + 1 } : s));
  return withRank
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
        // 'solo' | 'group': who the Mapr request behind this pick was for.
        ...(REQUEST_FOR_VALUES.includes(requestFor) ? { requestFor } : {}),
        ...(setId
          ? {
              setId,
              rank: s.rank,
              shownAt: at,
              surface: SURFACES.includes(surface) ? surface : null,
              predicted: profile ? predictLevel({ profile, region: s.region, tags: catsOf(s), nowMs: at }) : null,
            }
          : {}),
      };
    });
}

export async function logRecommendations(args) {
  if (!db || !args?.uid) return [];
  const entries = recommendationEntries(args);
  await Promise.all(
    entries.map((e) => addDoc(collection(db, 'recommendation_log'), { ...e, createdAt: serverTimestamp() }).catch(() => {}))
  );
  // Rows hold the hidden `predicted`, so only a count goes back to callers.
  return entries.length;
}

// Once per set per place: remembers what was logged in memory and on the
// device, so a re-render, or reopening the app on the same cached set, never
// writes a second row.
const SEEN_KEY = 'lh_shown_logged';
const seenMemory = new Set();
let seenLoaded = false;
function loadSeen() {
  if (seenLoaded) return;
  seenLoaded = true;
  try {
    for (const k of JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) seenMemory.add(k);
  } catch {
    /* storage unavailable: memory only */
  }
}
export function claimShown(setId, placeKey) {
  loadSeen();
  const k = `${setId}|${placeKey}`;
  if (seenMemory.has(k)) return false;
  seenMemory.add(k);
  try {
    const all = [...seenMemory].slice(-SHOWN_MEMORY_LIMIT);
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  return true;
}
export function resetShownMemory() {
  seenMemory.clear();
  seenLoaded = false;
}

// Log the given on-screen stops (each may carry its own 1-based `rank`) that
// haven't been logged for this set yet. Returns how many rows were written.
export async function logShownPicks({ uid, setId, stops, log = logRecommendations, ...rest }) {
  if (!uid || !setId) return 0;
  const fresh = (stops || []).filter((s) => s && s.id && s.region && claimShown(setId, `${s.region}/${s.id}`));
  if (!fresh.length) return 0;
  const at = rest.at ?? Date.now();
  // Remember these as picks so a later tap or rating on one is marked (see
  // pickMarks.js). Test surfaces never count, so they are not remembered.
  if (rest.isTest !== true) rememberShownPicks({ uid, setId, surface: rest.surface, stops: fresh, at });
  return log({ uid, setId, stops: fresh, ...rest, at });
}

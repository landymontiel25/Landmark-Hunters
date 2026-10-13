import { getRegion } from '../data/regions.js';
import { isRateable } from './ratingFlow.js';

// Deterministic per-pair daily deck (Dual Streak spec item 3: "Each pair
// gets 3 cards per day, chosen by a server function from a pair-day ID.
// Both people see the same 3"). This MVP computes it deterministically
// instead of via an actual scheduled server function -- both members'
// clients (and api/close-streak-day.js, verifying completion) derive the
// identical 3 landmarks from the same inputs (pairId, dayId, cityId), with
// no network round trip and nothing to keep in sync. Pure and dependency-
// free (only reads static landmark data), so it's safe to import from
// either a browser bundle or a serverless function.
//
// Known simplification: a pair's deck doesn't track which landmarks the pair
// has already seen, so a card can resurface on a later day. The solo deck
// passes your earlier answers as avoidIds (MyStreaks.jsx) so it doesn't.

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 -- small, fast, deterministic PRNG. Good enough for picking
// cards; not cryptographic, not meant to be.
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DAILY_DECK_SIZE = 3;

// Every rateable landmark id in a city, sorted -- the pool the deck draws
// from. Exported so the UI can tell "no cards possible" (an empty/tiny
// city) apart from "cards not generated yet". Only the hand-picked catalog:
// imported everyday places (source 'osm', loaded from public/places after
// startup) join region.landmarks in the app but not in the day-close
// functions, so drawing from them gave the phone a different 3 than the
// server checks, and rating them never closed the day.
export function deckPool(cityId) {
  const region = getRegion(cityId);
  if (!region) return [];
  return region.landmarks.filter((l) => l.source !== 'osm' && isRateable(l)).map((l) => l.id).sort();
}

// The 3 landmark ids both members of a pair see today, for this city.
// excludeIds (a landmark id Set/array) is meant to be the union of both
// members' REAL check-ins in this city -- the deck is for discovering and
// rating places together, so a spot either of you has already physically
// been to is skipped. Passed in rather than looked up here so this stays
// pure and dependency-free (see the file-level note); callers fetch the
// real check-in ids themselves (client: leaderboard.js's
// getUserCheckedInLandmarkIds; server: close-streak-day.js, admin SDK).
//
// avoidIds (optional, a Map of landmark id -> when you last answered it, or
// a Set) are places you already rated or voted on: they come after every
// place you have never answered, oldest answer first, so the solo cards
// change every day and only repeat once the whole city is used up.
export function pickDailyCardIds(pairId, dayId, cityId, excludeIds = [], count = DAILY_DECK_SIZE, avoidIds = null) {
  return pickOrderedCardIds(pairId, dayId, cityId, excludeIds, count, avoidIds).sort();
}

// The same draw in pick order. The first DAILY_DECK_SIZE of any larger draw
// are the day's real cards, so the server (which draws 3) and the phone agree
// on them whatever `count` the phone asks for.
function pickOrderedCardIds(pairId, dayId, cityId, excludeIds, count, avoidIds) {
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds);
  const avoid = avoidIds instanceof Map ? avoidIds : new Map([...(avoidIds || [])].map((id) => [id, 0]));
  const fullPool = deckPool(cityId);
  // Never answered, then answered (oldest first), then places you have been
  // to. A city you have done everything in still gets a full deck: a repeat
  // is the lesser problem next to "no cards at all" (or only 1 or 2, which
  // the day-close never counts as done).
  const fresh = fullPool.filter((id) => !exclude.has(id) && !avoid.has(id));
  const answered = fullPool
    .filter((id) => !exclude.has(id) && avoid.has(id))
    .sort((a, b) => (avoid.get(a) || 0) - (avoid.get(b) || 0) || (a < b ? -1 : 1));
  const visited = fullPool.filter((id) => exclude.has(id));
  const rand = mulberry32(hashSeed(`${pairId}:${dayId}:${cityId}`));
  const picked = [];
  const draw = (tier) => {
    const remaining = [...tier];
    while (picked.length < count && remaining.length) {
      picked.push(remaining.splice(Math.floor(rand() * remaining.length), 1)[0]);
    }
  };
  draw(fresh);
  for (const id of answered) if (picked.length < count) picked.push(id);
  draw(visited);
  return picked;
}

// Full landmark objects (with regionId attached, matching ALL_LANDMARKS'
// shape) for today's deck, in the app's own catalog order -- not the
// pick order, so the row doesn't visually reshuffle between renders.
export function dailyDeck(pairId, dayId, cityId, excludeIds = [], avoidIds = null) {
  const region = getRegion(cityId);
  if (!region) return [];
  const ids = new Set(pickDailyCardIds(pairId, dayId, cityId, excludeIds, DAILY_DECK_SIZE, avoidIds));
  return region.landmarks.filter((l) => ids.has(l.id)).map((l) => ({ ...l, regionId: cityId }));
}

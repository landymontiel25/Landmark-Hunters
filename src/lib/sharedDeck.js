import { getRegion } from '../data/regions';
import { isRateable } from './ratingFlow';

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
// Known simplification: doesn't track which landmarks a pair has already
// seen, so "cards do not repeat until the city is exhausted" (spec item 3)
// isn't implemented -- a card can resurface on a later day. A real
// server-tracked history would be the fix once this is proven out.

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
// city) apart from "cards not generated yet".
export function deckPool(cityId) {
  const region = getRegion(cityId);
  if (!region) return [];
  return region.landmarks.filter(isRateable).map((l) => l.id).sort();
}

// The 3 landmark ids both members of a pair see today, for this city.
// excludeIds (a landmark id Set/array) is meant to be the union of both
// members' REAL check-ins in this city -- the deck is for discovering and
// rating places together, so a spot either of you has already physically
// been to is skipped. Passed in rather than looked up here so this stays
// pure and dependency-free (see the file-level note); callers fetch the
// real check-in ids themselves (client: leaderboard.js's
// getUserCheckedInLandmarkIds; server: close-streak-day.js, admin SDK).
export function pickDailyCardIds(pairId, dayId, cityId, excludeIds = [], count = DAILY_DECK_SIZE) {
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds);
  const fullPool = deckPool(cityId);
  const unvisited = fullPool.filter((id) => !exclude.has(id));
  // Both of you have been everywhere rateable in this city -- fall back to
  // the full pool rather than leaving the deck empty; a repeat is the
  // lesser problem next to "no cards at all".
  const source = unvisited.length > 0 ? unvisited : fullPool;
  if (source.length <= count) return source;
  const rand = mulberry32(hashSeed(`${pairId}:${dayId}:${cityId}`));
  const remaining = [...source];
  const picked = [];
  for (let i = 0; i < count && remaining.length; i++) {
    const idx = Math.floor(rand() * remaining.length);
    picked.push(remaining.splice(idx, 1)[0]);
  }
  return picked.sort();
}

// Full landmark objects (with regionId attached, matching ALL_LANDMARKS'
// shape) for today's deck, in the app's own catalog order -- not the
// pick order, so the row doesn't visually reshuffle between renders.
export function dailyDeck(pairId, dayId, cityId, excludeIds = []) {
  const region = getRegion(cityId);
  if (!region) return [];
  const ids = new Set(pickDailyCardIds(pairId, dayId, cityId, excludeIds));
  return region.landmarks.filter((l) => ids.has(l.id)).map((l) => ({ ...l, regionId: cityId }));
}

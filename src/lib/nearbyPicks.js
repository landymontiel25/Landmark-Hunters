import { ALL_LANDMARKS, INTERESTS } from '../data/regions';
import { distanceMeters } from './geo';
import { discoveryPicks, usualPicks } from './tagScores';
import { tierStars } from './ratingFlow';
import { coarseLocation } from './maprPicks';
import { linksFrom, primaryCategory } from './preferenceChains';

// "Picked for you right now": nearby picks ranked on-device from the saved
// tag scores (tagScores.js usualPicks / discoveryPicks), filtered to what is
// actually worth showing right here, right now. Pure functions only -- the
// UI (components/nearbyPicks, on the Map tab) and the one reasons call sit
// on top.

export const DISTANCE_OPTIONS_MI = [1, 5, 10, 15, 20, 30, 50, 100];
export const DEFAULT_DISTANCE_MI = 10;
export const METERS_PER_MILE = 1609.34;
// Same bar as Plan Your Trip's "The usual" / "Something new".
export const MIN_RATINGS_FOR_PICKS = 10;
// Four in the full list, the first three in the collapsed bottom sheet.
export const PICKS_SHOWN = 4;
export const SHEET_PICKS = 3;
// The Map tab sheet's height in px, minimized (title only) and collapsed
// (top three). MapExplore lifts its own bottom controls by this much.
export const PICKS_SHEET_H = { minimized: 58, collapsed: 232 };
export const SIMILAR_LIMIT = 4;
export const MEAL_LIMIT = 3;
// "You're near something you love" only fires this close.
export const NEARBY_INTEREST_MI = 1;
// A rating at or below this many stars rules the place out for good.
export const LOW_RATING_STARS = 2;
// Same 4-hour freshness as the Mapr Picks cache (maprPicks.js).
export const PICKS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const LABELS = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));
export const categoryLabel = (id) => LABELS[id] || id || 'this kind of place';

export const pickKey = (p) => `${p.region || p.regionId}/${p.id}`;

// A usable photo is part of the landmark's own data. The top picks never
// show a place without one (the next pick takes its place); the other rows
// (mood, meal, because you liked, nearby) show it on a category tile.
export function hasPhoto(l) {
  const src = l?.image ?? l?.images?.[0];
  return typeof src === 'string' && /^(https?:)?\/\//.test(src.trim());
}

// Places within `miles` of origin, each with distanceMeters, closest first.
export function withinDistance(places, origin, miles) {
  if (!origin) return [];
  const max = miles * METERS_PER_MILE;
  return (places || [])
    .map((p) => ({ ...p, distanceMeters: distanceMeters(origin.lat, origin.lng, p.lat, p.lng) }))
    .filter((p) => Number.isFinite(p.distanceMeters) && p.distanceMeters <= max)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// ---- Open / closed -------------------------------------------------------
// Built-in landmarks carry no hours (unknown = open). Places added through
// verification carry a short free-text line like "Mon–Sat 10am–11pm, Sun
// 12pm–8pm" or "Open 24 hours"; this reads the common shapes and treats
// anything it can't read as open rather than hiding a real place.

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_RE = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?/g;

function daysIn(text) {
  const t = text.toLowerCase();
  if (/\b(daily|every ?day)\b/.test(t)) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const out = new Set();
  if (/\bweekdays?\b/.test(t)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
  if (/\bweekends?\b/.test(t)) [0, 6].forEach((d) => out.add(d));
  const tokens = [...t.matchAll(DAY_RE)].map((m) => ({ day: DAY_NAMES.indexOf(m[1]), end: m.index + m[0].length, start: m.index }));
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    const between = next ? t.slice(cur.end, next.start) : '';
    if (next && /^\s*(-|–|—|to|through|thru)\s*$/.test(between)) {
      for (let d = cur.day; ; d = (d + 1) % 7) {
        out.add(d);
        if (d === next.day) break;
      }
      i++;
    } else {
      out.add(cur.day);
    }
  }
  return out.size ? out : null;
}

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?|noon|midnight`;
const RANGE_RE = new RegExp(`(${TIME})\\s*(?:-|–|—|to)\\s*(${TIME})`, 'i');

function toMinutes(h, m, suffix) {
  let hour = Number(h) % 12;
  if (suffix && suffix.startsWith('p')) hour += 12;
  if (!suffix && Number(h) >= 12) hour = Number(h);
  return hour * 60 + (Number(m) || 0);
}

function parseRange(text) {
  const m = text.match(RANGE_RE);
  if (!m) return null;
  const side = (whole, h, min, suf) => {
    const w = whole.toLowerCase();
    if (w === 'noon') return { mins: 720, suffix: 'pm' };
    if (w === 'midnight') return { mins: 24 * 60, suffix: 'am' };
    return { h, min, suffix: suf ? suf.toLowerCase().replace(/\./g, '') : null };
  };
  const a = side(m[1], m[2], m[3], m[4]);
  const b = side(m[5], m[6], m[7], m[8]);
  const endMins = b.mins ?? toMinutes(b.h, b.min, b.suffix);
  let startMins = a.mins;
  if (startMins == null) {
    // "10-5pm": borrow the end's am/pm unless that puts the start after the end.
    const borrowed = a.suffix || b.suffix;
    startMins = toMinutes(a.h, a.min, borrowed);
    if (!a.suffix && b.suffix && startMins > endMins) startMins = toMinutes(a.h, a.min, 'am');
  }
  return { start: startMins, end: endMins };
}

// True only when the place's own data says it's closed at `date`.
export function isClosedNow(l, date = new Date()) {
  if (!l) return false;
  if (l.closed === true || l.permanentlyClosed === true || l.temporarilyClosed === true) return true;
  const hours = typeof l.hours === 'string' ? l.hours.trim() : '';
  if (!hours) return false;
  const lower = hours.toLowerCase();
  if (/permanently closed|temporarily closed/.test(lower)) return true;
  if (/24 ?hours|24\/7/.test(lower)) return false;
  const day = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  let sawToday = false;
  for (const seg of hours.split(/[,;]/)) {
    const days = daysIn(seg);
    const appliesToday = !days || days.has(day);
    if (/\bclosed\b/i.test(seg)) {
      if (days && days.has(day)) return true;
      continue;
    }
    const range = parseRange(seg);
    if (!range || !appliesToday) continue;
    sawToday = true;
    const inRange = range.end > range.start ? mins >= range.start && mins < range.end : mins >= range.start || mins < range.end;
    if (inRange) return false;
  }
  // Hours listed for today and now falls outside all of them: closed.
  return sawToday;
}

// ---- The user's own ratings ---------------------------------------------

const starsOf = (r) => (r?.ratingTier ? tierStars(r.ratingTier) : Number(r?.stars) || 0);

// Landmark ids the user rated LOW_RATING_STARS or lower (the "Not for me"
// tier is 1 star). myReviews is RatingsContext's { [landmarkId]: review }.
export function lowRatedIds(myReviews) {
  return Object.values(myReviews || {})
    .filter((r) => r?.landmarkId && starsOf(r) > 0 && starsOf(r) <= LOW_RATING_STARS)
    .map((r) => r.landmarkId);
}

export function ratingsCountOf(myReviews) {
  return Object.values(myReviews || {}).filter((r) => r?.ratingTier).length;
}

// ---- Candidate pool ------------------------------------------------------

export function regionsWithin(origin, miles, landmarks = ALL_LANDMARKS) {
  const found = new Set(withinDistance(landmarks, origin, miles).map((l) => l.regionId));
  return [...found];
}

// A place that can be shown at all: close enough, open, and not something
// the user already said was bad. A missing photo does NOT rule a place out
// here -- about one catalog place in six ships without one (Campus Corner
// and every other Villanova food spot among them), and dropping them here
// emptied the mood and meal rows for places that really are nearby. Only
// the top picks require a photo (composePicks).
export function eligiblePlaces({ origin, miles, lowRated = [], date = new Date(), landmarks = ALL_LANDMARKS }) {
  const low = new Set(lowRated);
  return withinDistance(landmarks, origin, miles).filter((l) => !isClosedNow(l, date) && !low.has(l.id));
}

export function toPick(l, extra = {}) {
  return {
    id: l.id,
    region: l.regionId || l.region,
    name: l.name,
    image: l.image ?? l.images?.[0] ?? null,
    categories: l.categories || [],
    lat: l.lat,
    lng: l.lng,
    summary: l.summary || '',
    distanceMeters: l.distanceMeters ?? null,
    ...(l.pickType ? { pickType: l.pickType } : {}),
    ...(l.tagScore != null ? { tagScore: l.tagScore } : {}),
    ...extra,
  };
}

// The two ranked queues behind the picks, both already filtered (distance,
// open, not low-rated) and in best-first order -- composePicks then skips
// any without a photo:
//   usual -- places the saved tag scores rate above zero (usualPicks)
//   fresh -- "something new": categories rated little or never (discoveryPicks)
// Ranking spans every region inside the distance filter, since a 30-mile
// circle around Miami also covers Coral Gables and Key Biscayne.
export function rankNearbyCandidates({ profile, origin, miles, myReviews = {}, checkinCounts = {}, now = Date.now(), date = new Date(now) }) {
  if (!origin) return { usual: [], fresh: [] };
  const lowRated = lowRatedIds(myReviews);
  const eligible = new Map(eligiblePlaces({ origin, miles, lowRated, date }).map((l) => [`${l.regionId}/${l.id}`, l]));
  const regions = [...new Set([...eligible.values()].map((l) => l.regionId))];
  const usual = [];
  const fresh = [];
  for (const region of regions) {
    const args = { profile, region, excludeIds: lowRated, checkinCounts, now };
    for (const l of usualPicks({ ...args, limit: 60 })) {
      const e = eligible.get(`${l.regionId}/${l.id}`);
      if (e) usual.push(toPick({ ...l, distanceMeters: e.distanceMeters }));
    }
    for (const l of discoveryPicks({ ...args, limit: 20 })) {
      const e = eligible.get(`${l.regionId}/${l.id}`);
      if (e) fresh.push(toPick({ ...l, distanceMeters: e.distanceMeters }));
    }
  }
  const best = (a, b) => (b.tagScore || 0) - (a.tagScore || 0) || a.distanceMeters - b.distanceMeters;
  const usualKeys = new Set(usual.map(pickKey));
  return {
    usual: usual.sort(best),
    fresh: fresh.filter((p) => !usualKeys.has(pickKey(p))).sort(best),
  };
}

// A pick backed by a preference chain: the user's last check-in was in
// category A, and they have a real A -> B link, so the best B place wins a
// slot with the link attached. Null when no link applies.
export function chainedPick({ usual = [], fresh = [], links = [], lastCategory = null }) {
  for (const link of linksFrom(links, lastCategory)) {
    const hit =
      usual.find((p) => hasPhoto(p) && primaryCategory(p.categories) === link.to) ||
      fresh.find((p) => hasPhoto(p) && primaryCategory(p.categories) === link.to);
    if (hit) return { ...hit, chain: { from: link.from, to: link.to, count: link.count } };
  }
  return null;
}

// The final list: mostly usual, exactly one "something new" when there is
// one, and a chained pick first when a link applies. A pick that isn't
// ready (still loading, no photo, or its photo failed) is skipped and the
// next one in the same queue takes its place.
//   order: usual, usual, new, usual -- so the three in the collapsed sheet
//   are two usual + the one new, and the full four are three usual + one new.
export function composePicks({ usual = [], fresh = [], chained = null, count = PICKS_SHOWN, isReady = hasPhoto }) {
  const ready = (p) => p && hasPhoto(p) && isReady(p);
  const used = new Set();
  const take = (queue) => {
    const p = queue.find((x) => ready(x) && !used.has(pickKey(x)));
    if (p) used.add(pickKey(p));
    return p || null;
  };
  const chain = ready(chained) ? chained : null;
  if (chain) used.add(pickKey(chain));
  const newPick = chain?.pickType === 'new' ? null : take(fresh);
  // A chained pick that is itself "new" already fills the one new slot.
  const usualSlots = count - (chain ? 1 : 0) - (newPick ? 1 : 0);
  const usuals = [];
  for (let i = 0; i < usualSlots; i++) {
    const p = take(usual);
    if (!p) break;
    usuals.push(p);
  }
  const list = chain ? [chain, ...usuals] : usuals;
  if (newPick) list.splice(Math.min(2, list.length), 0, newPick);
  // Not enough usual places nearby: fill with more new ones rather than
  // leaving a gap.
  while (list.length < count) {
    const p = take(fresh);
    if (!p) break;
    list.push(p);
  }
  return list.slice(0, count);
}

// The other rows of cards ("Because you liked", the mood carousel, the meal
// and nearby cards): first `limit` items that are ready, in order. A place
// with no photo is always ready -- it shows on a category tile instead of
// being dropped -- and one whose photo is still loading waits (isReady).
export function selectReady(items, isReady = () => true, limit = Infinity) {
  return (items || []).filter((p) => !hasPhoto(p) || isReady(p)).slice(0, limit);
}

// ---- Reasons -------------------------------------------------------------

// The plain line a card shows when the one AI call fails or is skipped.
export function fallbackReason(p) {
  const cat = categoryLabel(primaryCategory(p?.categories));
  if (p?.chain) return `You often go for ${categoryLabel(p.chain.to)} after ${categoryLabel(p.chain.from)}.`;
  if (p?.pickType === 'new') return `Something new for you: ${cat}.`;
  return `${cat} is one of your favorite kinds of places.`;
}

// Attaches a reason to each pick: the AI line when there's a usable one for
// that exact pick, otherwise the plain fallback. reasons: { [pickKey]: text }.
export function withReasons(picks, reasons = {}) {
  return (picks || []).map((p) => {
    const ai = typeof reasons?.[pickKey(p)] === 'string' ? reasons[pickKey(p)].trim() : '';
    return ai ? { ...p, reason: ai.slice(0, 120), reasonSource: 'ai' } : { ...p, reason: fallbackReason(p), reasonSource: 'fallback' };
  });
}

// ---- "Because you liked X" ----------------------------------------------

// The most recent place the user loved, as a catalog landmark.
export function lovedSeed(myReviews, landmarks = ALL_LANDMARKS) {
  const toMs = (r) => (r.updatedAt?.seconds ? r.updatedAt.seconds * 1000 : r.updatedAtMs || 0);
  const loved = Object.values(myReviews || {})
    .filter((r) => r?.ratingTier === 'highly-recommend')
    .sort((a, b) => toMs(b) - toMs(a));
  for (const r of loved) {
    const l = landmarks.find((x) => x.id === r.landmarkId && (!r.region || x.regionId === r.region));
    if (l) return l;
  }
  return null;
}

// Up to `limit` places like `liked`: same main category first, then any
// shared category, closest first within each. `pool` is eligiblePlaces.
export function similarPlaces({ liked, pool = [], exclude = [], limit = SIMILAR_LIMIT }) {
  if (!liked) return [];
  const skip = new Set([pickKey({ ...liked, region: liked.regionId }), ...exclude]);
  const main = primaryCategory(liked.categories);
  const cats = new Set(liked.categories || []);
  const score = (l) => (primaryCategory(l.categories) === main ? 2 : (l.categories || []).some((c) => cats.has(c)) ? 1 : 0);
  return pool
    .filter((l) => !skip.has(`${l.regionId}/${l.id}`) && score(l) > 0)
    .sort((a, b) => score(b) - score(a) || a.distanceMeters - b.distanceMeters)
    .slice(0, limit)
    .map((l) => toPick(l));
}

// ---- Mood ask --------------------------------------------------------------

export const MOODS = [
  { id: 'eat', icon: '\u{1F37D}\u{FE0F}', label: 'Something to eat', categories: ['food'] },
  { id: 'history', icon: '\u{1F3DB}\u{FE0F}', label: 'Some history', categories: ['history-culture'] },
  { id: 'art', icon: '\u{1F5BC}\u{FE0F}', label: 'Art & museums', categories: ['art-museums'] },
  { id: 'outdoors', icon: '\u{1F333}', label: 'Fresh air', categories: ['parks-nature', 'benches'] },
  { id: 'night', icon: '\u{1F378}', label: 'A night out', categories: ['local-life', 'entertainment'] },
  { id: 'sports', icon: '\u{1F3DF}\u{FE0F}', label: 'Sports', categories: ['stadiums', 'sports', 'formula-1'] },
  { id: 'tech', icon: '\u{1F4BB}', label: 'Tech spots', categories: ['tech'] },
];
export const MOOD_SORTS = [
  { id: 'closest', label: 'Closest' },
  { id: 'rated', label: 'Highest rated' },
];

// Places for one mood, sorted closest first or by the public average rating
// (ratings: RatingsContext's { [landmarkId]: { avg, count } }). Unrated
// places sort after rated ones, closest first.
export function moodPlaces({ moodId, pool = [], sort = 'closest', ratings = {}, limit = 10 }) {
  const mood = MOODS.find((m) => m.id === moodId);
  if (!mood) return [];
  const wanted = new Set(mood.categories);
  const avg = (l) => (ratings?.[l.id]?.count ? Number(ratings[l.id].avg) || 0 : -1);
  return pool
    .filter((l) => (l.categories || []).some((c) => wanted.has(c)))
    .sort((a, b) => (sort === 'rated' ? avg(b) - avg(a) : 0) || a.distanceMeters - b.distanceMeters)
    .slice(0, limit)
    .map((l) => toPick(l, ratings?.[l.id]?.count ? { rating: ratings[l.id] } : {}));
}

// ---- Meal and nearby-interest cards ----------------------------------------

// Breakfast, lunch and dinner windows, local time.
export function isMealTime(date = new Date()) {
  const h = date.getHours();
  return (h >= 7 && h < 10) || (h >= 11 && h < 14) || (h >= 17 && h < 21);
}

// Top food places nearby: the user's own food score orders nothing here
// (it's one category), so it's public rating, then distance.
export function mealPicks({ pool = [], ratings = {}, limit = MEAL_LIMIT }) {
  return moodPlaces({ moodId: 'eat', pool, sort: 'rated', ratings, limit });
}

// The closest place (within NEARBY_INTEREST_MI) in one of the user's
// top-scoring categories. usual is rankNearbyCandidates().usual.
export function nearbyInterest({ usual = [], maxMiles = NEARBY_INTEREST_MI }) {
  const max = maxMiles * METERS_PER_MILE;
  const topCats = new Set(usual.slice(0, 8).map((p) => primaryCategory(p.categories)).filter(Boolean));
  return (
    usual
      .filter((p) => p.distanceMeters <= max && topCats.has(primaryCategory(p.categories)))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null
  );
}

// ---- Cache of the last set ------------------------------------------------

const CACHE_PREFIX = 'lh-nearby-picks:v1';

export const nearbyPicksCacheKey = ({ uid, ratingsCount, origin, miles, lastCategory = '' }) =>
  `${CACHE_PREFIX}:${uid}:${ratingsCount}:${coarseLocation(origin)}:${miles}:${lastCategory || ''}`;

// The last set for this key, even when old: { picks, at, stale }. An old set
// still goes on screen right away (marked stale) while a new one loads.
export function readNearbyPicksCache(key, now = Date.now()) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, picks } = JSON.parse(raw);
    if (!Array.isArray(picks) || !Number.isFinite(at)) return null;
    return { picks, at, stale: now - at > PICKS_CACHE_TTL_MS };
  } catch {
    return null;
  }
}

export function writeNearbyPicksCache(key, picks, at = Date.now()) {
  try {
    localStorage.setItem(key, JSON.stringify({ at, picks }));
  } catch {
    /* private mode */
  }
}

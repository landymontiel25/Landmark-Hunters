import { ALL_LANDMARKS, INTERESTS } from '../data/regions';
import { distanceMeters } from './geo';
import { discoveryPicks, effectiveTagScores, usualPicks } from './tagScores';
import { tierStars, isVisitedReview } from './ratingFlow';
import { linksFrom, primaryCategory } from './preferenceChains';
import { formatDistance } from './formatDistance';
import { placeKinds, kindSimilarity, kindAffinity, kindBoost } from './placeKinds.js';
import { scorePicks, planExploration } from './maprRank/rank.js';
import { assignSlots } from './maprRank/exploration.js';
import { FEATURES } from './maprRank/config.js';

// "Picked for you right now": nearby picks ranked on-device from the saved
// tag scores (tagScores.js usualPicks / discoveryPicks), filtered to what is
// actually worth showing right here, right now. Pure functions only -- the
// UI (components/nearbyPicks, on the Map tab) and the one reasons call sit
// on top.

export const DISTANCE_OPTIONS_MI = [1, 5, 10, 15, 20, 30, 50, 100];
export const DEFAULT_DISTANCE_MI = 10;
export const METERS_PER_MILE = 1609.34;
// The distance chips and the map zoom menu offer the same numbers (1, 5,
// 10...) in whichever unit the Units setting resolves to; internally
// everything stays in miles.
export const distanceUnitLabel = (units) => (units === 'metric' ? 'km' : 'mi');
export const optionToMiles = (n, units) => (units === 'metric' ? (n * 1000) / METERS_PER_MILE : n);
// Same bar as Plan Your Trip's "The usual" / "Something new".
export const MIN_RATINGS_FOR_PICKS = 10;
// "Rate 10 places" for someone with none; "Rate 1 more place" for someone at 9.
export function ratePlacesText(count, min = MIN_RATINGS_FOR_PICKS) {
  const left = Math.max(0, min - (Number(count) || 0));
  if (left === 0 || left === min) return `Rate ${min} places`;
  return `Rate ${left} more ${left === 1 ? 'place' : 'places'}`;
}
// Four in the full list, the first three in the collapsed bottom sheet.
export const PICKS_SHOWN = 4;
export const SHEET_PICKS = 3;
// The Map tab sheet's height in px, minimized (title only) and collapsed
// (top three). MapExplore lifts its own bottom controls by this much.
// moodCollapsed (the Test tab's mood-first layout) is a CSS length: tall enough
// for the mood cards and three picks, capped so it never covers the whole map.
export const PICKS_SHEET_H = {
  minimized: 58,
  collapsed: 232,
  moodCollapsed: 'min(380px, calc(100dvh - var(--header-h, 64px) - var(--nav-h, 64px) - 120px))',
  // Swiping up goes half way up the screen, not to the top.
  moodExpanded: '50dvh',
};
export const SIMILAR_LIMIT = 4;
// "Because you liked" looks at least this far (miles) for the same kind of place.
export const SIMILAR_MIN_MI = 25;
export const MEAL_LIMIT = 3;
// "You're near something you love" only fires this close.
export const NEARBY_INTEREST_MI = 1;
// A rating at or below this many stars rules the place out for good.
export const LOW_RATING_STARS = 2;
// Places rated at least this many stars ("I loved it" is 5) are favorites:
// within FAVORITE_RADIUS_MI of you they go to the front of the picks (up to
// FAVORITE_SLOTS of them), ahead of new places. One you are standing at
// (inside FAVORITE_MIN_METERS) is not worth suggesting.
export const FAVORITE_MIN_STARS = 4;
export const FAVORITE_RADIUS_MI = 1;
export const FAVORITE_SLOTS = 2;
export const FAVORITE_MIN_METERS = 75;
// Same 4-hour freshness as the Mapr Picks cache (maprPicks.js).
export const PICKS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const LABELS = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));
export const categoryLabel = (id) => LABELS[id] || id || 'this kind of place';

export const pickKey = (p) => `${p.region || p.regionId}/${p.id}`;

// A usable photo is part of the landmark's own data. A place without one is
// still picked (best match wins); its tile looks a photo up at view time
// (usePlacePhoto) and falls back to a category tile.
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
  let endMins = b.mins ?? toMinutes(b.h, b.min, b.suffix);
  let startMins = a.mins;
  if (startMins == null) {
    // "10-5pm": borrow the end's am/pm unless that puts the start after the end.
    const borrowed = a.suffix || b.suffix;
    startMins = toMinutes(a.h, a.min, borrowed);
    if (!a.suffix && b.suffix && startMins > endMins) startMins = toMinutes(a.h, a.min, 'am');
  }
  // "9-5" (no am/pm anywhere) is a normal day, 9am-5pm, not 9am-5am: a bare
  // end that lands before the start is read as the afternoon.
  if (a.mins == null && b.mins == null && !a.suffix && !b.suffix && Number(b.h) < 12 && endMins <= startMins) endMins += 12 * 60;
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
  const yesterday = (day + 6) % 7;
  let sawRange = false;
  let closedToday = false;
  // "Mon–Thu, Sun 11am–10pm": a piece with days but no time range (and no
  // "closed") shares the range of the piece after it, so carry it forward.
  let carry = '';
  for (const piece of hours.split(/[,;]/)) {
    const seg = carry ? `${carry}, ${piece}` : piece;
    carry = '';
    const days = daysIn(seg);
    if (days && !/\bclosed\b/i.test(seg) && !parseRange(seg)) {
      carry = seg;
      continue;
    }
    const appliesToday = !days || days.has(day);
    if (/\bclosed\b/i.test(seg)) {
      if (days && days.has(day)) closedToday = true;
      continue;
    }
    const range = parseRange(seg);
    if (!range) continue;
    sawRange = true;
    const wraps = range.end <= range.start;
    // A range that runs past midnight (6pm-2am) is still open after midnight
    // on the day AFTER the one it's listed for.
    if (wraps && (!days || days.has(yesterday)) && mins < range.end) return false;
    if (!appliesToday) continue;
    const inRange = wraps ? mins >= range.start || mins < range.end : mins >= range.start && mins < range.end;
    if (inRange) return false;
  }
  // Hours are listed but none cover this moment (or this day): closed.
  return closedToday || sawRange;
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

// Reviews at FAVORITE_MIN_STARS or better, as { landmarkId, stars }.
// Only places actually visited: a place you rated without going isn't a
// "favorite" you've been to (it still teaches Mapr, and "Because you liked"
// reads it through lovedSeed).
export function favoriteReviews(myReviews) {
  return Object.values(myReviews || {})
    .filter((r) => r?.landmarkId && isVisitedReview(r) && starsOf(r) >= FAVORITE_MIN_STARS)
    .map((r) => ({ landmarkId: r.landmarkId, stars: starsOf(r) }));
}

// Landmark ids with a review AND a real visit. A review alone is not proof
// of a visit: rating a place needs no check-in (see isVisitedReview).
//
// `profile` adds the places they told us they visit most at sign-up
// (profile.onboardingPlaces): known visits, so never picks.
export function visitedReviewIds(myReviews, profile = null) {
  return [
    ...Object.values(myReviews || {})
      .filter((r) => r?.landmarkId && isVisitedReview(r))
      .map((r) => r.landmarkId),
    ...(Array.isArray(profile?.onboardingPlaces) ? profile.onboardingPlaces.map((p) => p.id) : []),
  ];
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
// Drag-to-fix pin corrections ({ "region/id": { lat, lng } }) win over the
// catalog coordinates, so a place is the same distance away everywhere.
export function withPositionOverrides(places, overrides) {
  if (!overrides) return places;
  return places.map((l) => {
    const pos = overrides[`${l.regionId || l.region}/${l.id}`];
    return pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) ? { ...l, lat: pos.lat, lng: pos.lng } : l;
  });
}

// User-added landmarks (lib/customLandmarks.js) are real places too: a
// restaurant someone added by hand is exactly what "close to me" should find.
// They carry `region` (a catalog region id or 'custom'); the picks pipeline
// reads `regionId`. A custom doc that duplicates a catalog id is ignored.
export function withCustomPlaces(extraPlaces, landmarks = ALL_LANDMARKS) {
  const seen = new Set(landmarks.map((l) => `${l.regionId}/${l.id}`));
  const extras = (extraPlaces || [])
    .filter((l) => l?.id && Number.isFinite(l.lat) && Number.isFinite(l.lng) && l.name)
    .map((l) => ({ ...l, regionId: l.regionId || l.region || 'custom', custom: true }))
    .filter((l) => !seen.has(`${l.regionId}/${l.id}`));
  return extras.length ? [...landmarks, ...extras] : landmarks;
}

export function eligiblePlaces({ origin, miles, lowRated = [], date = new Date(), landmarks = ALL_LANDMARKS, overrides = null, extraPlaces = null }) {
  const low = new Set(lowRated);
  const all = extraPlaces?.length ? withCustomPlaces(extraPlaces, landmarks) : landmarks;
  return withinDistance(withPositionOverrides(all, overrides), origin, miles).filter((l) => !isClosedNow(l, date) && !low.has(l.id));
}

// Places the user rated highly that are within a mile (or the chosen
// distance, if that is smaller): best-rated first, then closest. They skip
// closed places and the one the user is standing at. Built from the live
// position and ratings so a new rating or a few blocks of walking shows up at
// once, without waiting for the cached set to rebuild.
export function favoritePlaces({ origin, miles, myReviews, date = new Date(), landmarks = ALL_LANDMARKS, overrides = null, extraPlaces = null }) {
  if (!origin) return [];
  const loved = favoriteReviews(myReviews);
  if (!loved.length) return [];
  const stars = new Map();
  for (const f of loved) stars.set(f.landmarkId, Math.max(stars.get(f.landmarkId) || 0, f.stars));
  const all = extraPlaces?.length ? withCustomPlaces(extraPlaces, landmarks) : landmarks;
  const candidates = withPositionOverrides(
    all.filter((l) => stars.has(l.id)),
    overrides
  );
  const maxMiles = Math.min(FAVORITE_RADIUS_MI, Number.isFinite(miles) ? miles : FAVORITE_RADIUS_MI);
  return withinDistance(candidates, origin, maxMiles)
    .filter((l) => l.distanceMeters >= FAVORITE_MIN_METERS && !isClosedNow(l, date))
    .map((l) => toPick({ ...l, pickType: 'usual' }, { favorite: true, favoriteStars: stars.get(l.id) }))
    .sort((a, b) => b.favoriteStars - a.favoriteStars || a.distanceMeters - b.distanceMeters);
}

// Puts the favorites first in a finished picks list. At most FAVORITE_SLOTS of
// them, then the rest in their existing order with the one "something new"
// kept at the third spot, so the collapsed three are favorite, favorite, new
// (or favorite, usual, new with one favorite). Stale copies of favorites in a
// cached set are dropped and replaced by the live ones.
export function mergeFavorites(picks, favorites, count = PICKS_SHOWN) {
  if (!Array.isArray(picks)) return picks;
  const favs = (favorites || []).slice(0, FAVORITE_SLOTS).map((f) => ({ ...f, reason: fallbackReason(f), reasonSource: 'fallback' }));
  if (!favs.length) return picks.filter((p) => !p.favorite);
  const taken = new Set(favs.map(pickKey));
  const rest = picks.filter((p) => !p.favorite && !taken.has(pickKey(p)));
  const fresh = rest.find((p) => p.pickType === 'new');
  const list = [...favs, ...rest.filter((p) => p !== fresh)];
  if (fresh) list.splice(Math.min(2, list.length), 0, fresh);
  return list.slice(0, count);
}

// "Show me different places" (the Test tab's refresh button): remember what
// has been on screen, and put the places not shown yet ahead of the ones that
// were. The set is always full: when few places are left unseen, the earlier
// ones fill in after them rather than leaving gaps.
const SEEN_LIMIT = 80;
export function nextSeenKeys({ seen = [], shown = [] }) {
  return [...new Set([...(seen || []), ...(shown || []).map(pickKey)])].slice(-SEEN_LIMIT);
}

export function unseenFirst(list, seen) {
  const skip = new Set(seen || []);
  if (!skip.size) return list || [];
  const items = list || [];
  return [...items.filter((p) => !skip.has(pickKey(p))), ...items.filter((p) => skip.has(pickKey(p)))];
}

// With more favorites than slots, the ones not shown yet go first.
export function rotateFavorites(favorites, seen) {
  const skip = new Set(seen || []);
  const unseen = (favorites || []).filter((f) => !skip.has(pickKey(f)));
  return unseen.length ? [...unseen, ...(favorites || []).filter((f) => skip.has(pickKey(f)))] : favorites || [];
}

// Places past the chosen distance, nearest first -- what "Nothing within 1
// mi. Nearest: ..." shows when the radius comes up empty or thin. Photos are
// not required here (it is a pointer, not a pick).
export const NEAREST_BEYOND_LIMIT = 3;
export function nearestBeyond({ origin, miles, count = NEAREST_BEYOND_LIMIT, ...rest }) {
  if (!origin) return [];
  const max = miles * METERS_PER_MILE;
  return eligiblePlaces({ origin, miles: 20000, ...rest })
    .filter((p) => p.distanceMeters > max)
    .slice(0, count)
    .map((l) => toPick(l));
}

// The smallest distance chip (in the chip's own unit) that covers `meters`,
// or the biggest chip when none does.
export function chipCovering(meters, units, options = DISTANCE_OPTIONS_MI, above = 0) {
  const chips = options.filter((n) => n > above);
  return chips.find((n) => optionToMiles(n, units) * METERS_PER_MILE >= meters) ?? chips[chips.length - 1] ?? null;
}

// The chip "Widen to" offers: the smallest wider one reaching the nearest
// place past the radius; null when there is no such place (widening would
// show nothing new) or the biggest chip is already on.
export function widenChip(places, distance, units, options = DISTANCE_OPTIONS_MI) {
  if (!places?.length || distance >= options[options.length - 1]) return null;
  return chipCovering(places[0].distanceMeters, units, options, distance);
}

// Default distance: the smallest chip with at least `min` places that could
// be picked (open, not low-rated), so a dense neighborhood
// opens tight and a thin one (Doral has nothing within 5 mi) opens wide.
export const SMART_MIN_PLACES = 3;
export function smartDistance({ origin, units, lowRated = [], date = new Date(), overrides = null, extraPlaces = null, options = DISTANCE_OPTIONS_MI, min = SMART_MIN_PLACES }) {
  if (!origin) return DEFAULT_DISTANCE_MI;
  const maxMiles = optionToMiles(options[options.length - 1], units);
  const pool = eligiblePlaces({ origin, miles: maxMiles, lowRated, date, overrides, extraPlaces });
  for (const n of options) {
    const max = optionToMiles(n, units) * METERS_PER_MILE;
    if (pool.filter((p) => p.distanceMeters <= max).length >= min) return n;
  }
  return DEFAULT_DISTANCE_MI;
}

// Last distance the user picked on the chips, per account. Only an explicit
// choice is stored; the smart default is recomputed from where they are.
const distanceStoreKey = (uid) => `lh-picks-distance:v1:${uid}`;
export function readStoredDistance(uid, options = DISTANCE_OPTIONS_MI) {
  if (!uid) return null;
  try {
    const n = Number(localStorage.getItem(distanceStoreKey(uid)));
    return options.includes(n) ? n : null;
  } catch {
    return null;
  }
}
export function writeStoredDistance(uid, n) {
  if (!uid) return;
  try {
    localStorage.setItem(distanceStoreKey(uid), String(n));
  } catch {
    /* private mode */
  }
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
// Distance is a real ranking factor. For signed-in users in the Phase 1
// distance-decay rollout (src/lib/maprRank), the tag score is multiplied by
// 1 / (1 + km / 1.5) -- see maprRank/rank.js scorePicks. Everyone else (and
// any call without a uid) keeps the older rule below: every mile away costs
// this many tag-score points (one "Highly recommend" is worth 10).
export const DISTANCE_PENALTY_PER_MILE = 1.5;
export const rankScore = (p) => (p.tagScore || 0) - (p.distanceMeters / METERS_PER_MILE) * DISTANCE_PENALTY_PER_MILE;

// fillNew (the Test tab): "Something new" normally means a category you have
// rated little in this region, so an active user can run out of them. With
// fillNew, any place you have not rated counts as new once those run out.
//
// Phase 1 inputs (all optional; without them ranking is as before):
//   uid         decides the user's feature variants (maprRank/experiments.js)
//   models      { similarity, ncf, userEmbedding, signals } (maprRank/modelStore.js)
//   visitedIds  landmark ids with a real check-in (telemetry `revisit`)
//   explore     exploration context, see maprRank/rank.js planExploration
export function rankNearbyCandidates({ profile, origin, miles, myReviews = {}, checkinCounts = {}, now = Date.now(), date = new Date(now), overrides = null, extraPlaces = null, fillNew = false, uid = null, models = null, visitedIds = null, explore = null, features = FEATURES }) {
  if (!origin) return { usual: [], fresh: [], favorites: [], exploration: null, meta: null };
  const lowRated = lowRatedIds(myReviews);
  // Anything already rated AND visited (like Plan Your Trip and Mapr Travel
  // Picks) is not a pick: "Picked for you" shouldn't suggest a place they've
  // been to. A place rated without a visit (rating needs no check-in) still
  // counts as somewhere new to go; if they rated it "didn't like it" it is
  // already out through lowRated.
  const ratedIds = visitedReviewIds(myReviews, profile);
  const eligible = new Map(eligiblePlaces({ origin, miles, lowRated, date, overrides, extraPlaces }).map((l) => [`${l.regionId}/${l.id}`, l]));
  const regions = [...new Set([...eligible.values()].map((l) => l.regionId))];
  const usual = [];
  const fresh = [];
  const rated = new Set(ratedIds);
  for (const region of regions) {
    const args = { profile, region, excludeIds: ratedIds, checkinCounts, now };
    // Big limits: the distance filter runs AFTER the region's ranking, and a
    // top-60 cut by taste alone dropped the closest places in a big region.
    for (const l of usualPicks({ ...args, limit: 1000 })) {
      const e = eligible.get(`${l.regionId}/${l.id}`);
      if (e) usual.push(toPick({ ...l, lat: e.lat, lng: e.lng, distanceMeters: e.distanceMeters }));
    }
    for (const l of discoveryPicks({ ...args, limit: 1000 })) {
      const e = eligible.get(`${l.regionId}/${l.id}`);
      if (e) fresh.push(toPick({ ...l, lat: e.lat, lng: e.lng, distanceMeters: e.distanceMeters }));
    }
  }
  // Custom (user-added) places are not in the catalog the tag-score queues
  // read, so score them here with the same effective tag scores.
  for (const e of eligible.values()) {
    if (!e.custom || rated.has(e.id)) continue;
    const scores = effectiveTagScores(profile, e.regionId, now);
    const cats = e.categories || [];
    if (cats.some((c) => (scores[c] || 0) < 0)) continue;
    const tagScore = Math.round(cats.reduce((sum, c) => sum + (scores[c] || 0), 0) * 10) / 10;
    (tagScore > 0 ? usual : fresh).push(toPick({ ...e, pickType: tagScore > 0 ? 'usual' : 'new', tagScore }));
  }
  if (fillNew) {
    const taken = new Set([...usual, ...fresh].map(pickKey));
    for (const e of eligible.values()) {
      if (rated.has(e.id) || taken.has(`${e.regionId}/${e.id}`)) continue;
      const scores = effectiveTagScores(profile, e.regionId, now);
      const cats = e.categories || [];
      if (cats.some((c) => (scores[c] || 0) < 0)) continue;
      const tagScore = Math.round(cats.reduce((sum, c) => sum + (scores[c] || 0), 0) * 10) / 10;
      fresh.push(toPick({ ...e, pickType: 'new', tagScore }));
    }
  }
  // Within a category, the KIND of place matters too (placeKinds.js): a loved
  // steakhouse lifts other steakhouses, a disliked kind sinks its places.
  const byKey = new Map(landmarksForKinds().map((l) => [`${l.regionId}/${l.id}`, l]));
  const affinity = kindAffinity(myReviews, (r) => byKey.get(`${r.region}/${r.landmarkId}`) || null);
  for (const p of [...usual, ...fresh]) {
    const boost = kindBoost(byKey.get(pickKey(p)) || p, affinity);
    if (boost) p.tagScore = Math.round(((p.tagScore || 0) + boost) * 10) / 10;
  }
  const usualKeys = new Set(usual.map(pickKey));
  const scored = scorePicks({ usual, fresh: fresh.filter((p) => !usualKeys.has(pickKey(p))), uid, myReviews, models, visitedIds, features });
  let exploration = null;
  try {
    exploration = uid
      ? planExploration({
          uid,
          usual: scored.usual,
          fresh: scored.fresh,
          features,
          ctx: {
            myReviews,
            now,
            profileOf: (region) => effectiveTagScores(profile, region, now),
            ...(explore || {}),
            // Public ratings ({ [landmarkId]: { avg, count } }, RatingsContext).
            ratingOf: (p) => explore?.ratings?.[p.id] || null,
            trendOf: (p) => models?.signals?.trending?.[pickKey(p)] || 0,
          },
        })
      : null;
  } catch {
    exploration = null;
    scored.meta.fallbacks.push('exploration-error');
  }
  return {
    usual: scored.usual,
    fresh: scored.fresh,
    favorites: favoritePlaces({ origin, miles, myReviews, date, overrides, extraPlaces }),
    exploration,
    meta: scored.meta,
  };
}

// Every place, imported ones included, read when it's needed (place packs
// join ALL_LANDMARKS after startup).
const landmarksForKinds = () => ALL_LANDMARKS;

// A pick backed by a preference chain: the user's last check-in was in
// category A, and they have a real A -> B link, so the best B place wins a
// slot with the link attached. Null when no link applies.
export function chainedPick({ usual = [], fresh = [], links = [], lastCategory = null }) {
  for (const link of linksFrom(links, lastCategory)) {
    const hit =
      usual.find((p) => primaryCategory(p.categories) === link.to) ||
      fresh.find((p) => primaryCategory(p.categories) === link.to);
    if (hit) return { ...hit, chain: { from: link.from, to: link.to, count: link.count } };
  }
  return null;
}

// The final list: mostly usual, exactly one "something new" when there is
// one, and a chained pick first when a link applies. A pick that isn't
// ready (its photo is still loading) is skipped and the
// next one in the same queue takes its place.
//   order: usual, usual, new, usual -- so the three in the collapsed sheet
//   are two usual + the one new, and the full four are three usual + one new.
//
// With `exploration` (the Phase 1 exploration treatment, see
// maprRank/rank.js planExploration), the fixed "one new" slot is replaced by
// epsilon-greedy: each open slot explores with probability epsilon (drawn
// from `rng`), taking the next place from the exploration set; the rest take
// the best exploitation pick. Either queue running dry falls back to the
// other, so the set is always full.
export function composePicks({ usual = [], fresh = [], chained = null, count = PICKS_SHOWN, isReady = hasPhoto, exploration = null, rng = Math.random }) {
  const ready = (p) => p && (!hasPhoto(p) || isReady(p));
  const used = new Set();
  const take = (queue) => {
    const p = queue.find((x) => ready(x) && !used.has(pickKey(x)));
    if (p) used.add(pickKey(p));
    return p || null;
  };
  const chain = ready(chained) ? chained : null;
  if (chain) used.add(pickKey(chain));
  if (exploration?.explore) {
    const slots = assignSlots(count - (chain ? 1 : 0), exploration.epsilon, rng);
    const exploitQ = exploration.exploit?.length ? exploration.exploit : [...usual, ...fresh];
    const list = chain ? [{ ...chain, slot: 'exploit' }] : [];
    for (const slot of slots) {
      const first = slot === 'explore' ? exploration.explore : exploitQ;
      const second = slot === 'explore' ? exploitQ : exploration.explore;
      const fromFirst = take(first);
      const p = fromFirst || take(second);
      if (!p) break;
      const explored = fromFirst ? slot === 'explore' : slot !== 'explore';
      list.push(explored ? { ...p, pickType: 'new', slot: 'explore' } : { ...p, slot: 'exploit' });
    }
    return list.slice(0, count);
  }
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
// With `units` and a distance on the pick, it ends with the real distance in
// the user's units ("... 0.3 mi away"); the AI lines never mention distance.
export function fallbackReason(p, units = null) {
  const cat = categoryLabel(primaryCategory(p?.categories));
  const away = units && Number.isFinite(p?.distanceMeters) ? ` ${formatDistance(p.distanceMeters, units)} away.` : '';
  if (p?.favorite) {
    const stars = p.favoriteStars || 0;
    return `${stars >= 5 ? 'You loved this place.' : `You rated this ${stars} stars.`}${away}`;
  }
  if (p?.chain) return `You often go for ${categoryLabel(p.chain.to)} after ${categoryLabel(p.chain.from)}.${away}`;
  if (p?.pickType === 'new') return `Something new for you: ${cat}.${away}`;
  return `${cat} is one of your favorite kinds of places.${away}`;
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
//
// With no loved rating yet, the places they told us they visit most at
// sign-up stand in: we already know they love those.
export function lovedSeed(myReviews, landmarks = ALL_LANDMARKS, profile = null) {
  const toMs = (r) => (r.updatedAt?.seconds ? r.updatedAt.seconds * 1000 : r.updatedAtMs || 0);
  const loved = Object.values(myReviews || {})
    .filter((r) => r?.ratingTier === 'highly-recommend')
    .sort((a, b) => toMs(b) - toMs(a));
  for (const r of loved) {
    const l = landmarks.find((x) => x.id === r.landmarkId && (!r.region || x.regionId === r.region));
    if (l) return l;
  }
  for (const p of Array.isArray(profile?.onboardingPlaces) ? profile.onboardingPlaces : []) {
    const l = landmarks.find((x) => x.id === p.id && x.regionId === p.regionId);
    if (l) return l;
  }
  return null;
}

// `pool` without anything the user has already rated. "Picked for you" skips
// those (rankNearbyCandidates), and so must the rows built from the same pool
// that suggest a place ("Because you liked", "Time to eat?") -- otherwise they
// recommend the restaurant you are standing in.
export function unratedPlaces(pool, myReviews, profile = null) {
  const rated = new Set(visitedReviewIds(myReviews, profile));
  return (pool || []).filter((l) => !rated.has(l.id));
}

// Up to `limit` places like `liked`: same main category first, then any
// shared category, closest first within each. `pool` is eligiblePlaces.
// "Like it" means the same KIND of place (placeKinds.js), not just the same
// category: after a steakhouse, other steakhouses, never a cookie shop just
// because both are food. A liked place with no recognizable kind falls back
// to its category. Nothing of the same kind nearby means no row at all.
export function similarPlaces({ liked, pool = [], exclude = [], limit = SIMILAR_LIMIT }) {
  if (!liked) return [];
  const skip = new Set([pickKey({ ...liked, region: liked.regionId }), ...exclude]);
  const main = primaryCategory(liked.categories);
  const cats = new Set(liked.categories || []);
  const likedKinds = placeKinds(liked);
  // Places to eat and drink must share a kind; sights and parks only rank by
  // it (another history site after a history site first), since their kinds
  // are looser.
  const strict = likedKinds.size > 0 && ['food', 'local-life'].includes(main);
  const categoryScore = (l) => (primaryCategory(l.categories) === main ? 2 : (l.categories || []).some((c) => cats.has(c)) ? 1 : 0);
  const score = strict
    ? (l) => (primaryCategory(l.categories) === main ? kindSimilarity(liked, l) : 0)
    : (l) => (categoryScore(l) ? categoryScore(l) * 10 + (likedKinds.size ? kindSimilarity(liked, l) : 0) : 0);
  // One per name: three branches of the same chain aren't three suggestions.
  const names = new Set([String(liked.name || '').toLowerCase()]);
  return pool
    .filter((l) => !skip.has(`${l.regionId}/${l.id}`) && score(l) > 0)
    .sort((a, b) => score(b) - score(a) || a.distanceMeters - b.distanceMeters)
    .filter((l) => {
      const n = String(l.name || '').toLowerCase();
      if (names.has(n)) return false;
      names.add(n);
      return true;
    })
    .slice(0, limit)
    // `similarity` is the row's own fit; Phase 1 ranking (maprRank/surfaces.js)
    // uses it as the base score before distance, similarity and NCF.
    .map((l) => toPick(l, { similarity: score(l) }));
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
// The Test tab's moods: eating first, then entertainment (shows, zoos,
// aquariums, amusement parks), the rest as before except that a night out is
// only bars and clubs, and no tech spots.
export const TEST_MOODS = [
  MOODS.find((m) => m.id === 'eat'),
  { id: 'entertainment', icon: '\u{1F39F}\u{FE0F}', label: 'Entertainment', categories: ['entertainment'] },
  ...MOODS.filter((m) => m.id !== 'eat' && m.id !== 'tech').map((m) =>
    // A night out is bars, clubs and live music (Local Life), not shows and zoos.
    m.id === 'night' ? { ...m, categories: ['local-life'] } : m
  ),
];
// Where the Test tab's picks start, until someone taps a distance chip.
export const TEST_DEFAULT_DISTANCE_MI = 5;
// 'foryou' (the default) is Mapr's ranking (maprRank/surfaces.js rankPlaces):
// taste, distance, similar places and the model. moodPlaces itself returns
// closest-first for it; the caller re-ranks.
export const MOOD_SORTS = [
  { id: 'foryou', label: 'For you' },
  { id: 'closest', label: 'Closest' },
  { id: 'rated', label: 'Highest rated' },
];

// Places for one mood, sorted closest first or by the public average rating
// (ratings: RatingsContext's { [landmarkId]: { avg, count } }). Unrated
// places sort after rated ones, closest first.
export function moodPlaces({ moodId, pool = [], sort = 'closest', ratings = {}, limit = 10, moods = MOODS }) {
  const mood = moods.find((m) => m.id === moodId);
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

// The best place (within NEARBY_INTEREST_MI) in one of the user's
// top-scoring categories. usual is rankNearbyCandidates().usual, already in
// Mapr's order (finalScore); without scores, the closest wins.
export function nearbyInterest({ usual = [], maxMiles = NEARBY_INTEREST_MI }) {
  const max = maxMiles * METERS_PER_MILE;
  const topCats = new Set(usual.slice(0, 8).map((p) => primaryCategory(p.categories)).filter(Boolean));
  const score = (p) => (Number.isFinite(p.finalScore) ? p.finalScore : -Infinity);
  return (
    usual
      .filter((p) => p.distanceMeters <= max && topCats.has(primaryCategory(p.categories)))
      .sort((a, b) => score(b) - score(a) || a.distanceMeters - b.distanceMeters)[0] || null
  );
}

// ---- Cache of the last set ------------------------------------------------

const CACHE_PREFIX = 'lh-nearby-picks:v1';

// ~1 km grid, not coarseLocation's ~10 km: a set built across town would
// otherwise be shown as-is, with places outside the distance filter.
const nearbyCell = (origin) => (origin ? `${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}` : 'nowhere');
// extraCount: how many user-added places were in the pool, so adding one
// rebuilds the set instead of waiting out the 4 hours.
// scope: the Test tab builds its sets differently (new places filled in, refresh
// rotation), so its saved sets must never be shown on the real Map.
export const nearbyPicksCacheKey = ({ uid, ratingsCount, origin, miles, lastCategory = '', extraCount = 0, scope = '' }) =>
  `${CACHE_PREFIX}:${uid}:${ratingsCount}:${nearbyCell(origin)}:${miles}:${lastCategory || ''}${extraCount ? `:c${extraCount}` : ''}${scope ? `:${scope}` : ''}`;

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

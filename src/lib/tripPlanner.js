import { distanceMeters } from './geo';
import { readPersisted, writePersisted } from './usePersistentState';
import { discoveryPicks, usualPicks } from './tagScores';
import { rankPlaces } from './maprRank/surfaces.js';

// Plain logic behind Mapr's Plan Your Trip wizard (TripPlannerCard): the
// fixed step order, the message it hands Mapr, and the cached last plan.
// Nothing here calls the AI -- the wizard's only AI calls are the optional
// interest classifier (only when "Anything specific?" has text) and the one
// plan call Mapr makes with the composed message.

export const TRIP_STEPS = ['location', 'mood', 'pick', 'tripType', 'plan'];
// Under this many ratings sitewide, "The usual" / "Something new" have too
// little taste to rank from, so step 3 shows only the text box.
export const MIN_RATINGS_FOR_PICK_TYPE = 10;

// plan-ai.js keeps only the first 800 characters of each chat turn.
export const MAX_PLAN_MESSAGE = 780;
const MAX_HINT_NAMES = 6;

const MOOD_TEXT = {
  energized: "I'm in the mood for something energized and active.",
  easygoing: "I'm in the mood for something easygoing and chill.",
};

// The chat message the wizard turns into -- the same kind of plain message
// the old card composed, plus the on-device usual/new ranking and the
// classifier's matches as name hints. Hints are trimmed (never the core
// sentences) until it fits in one plan-ai turn.
export function composePlanMessage({
  mood = null,
  tripMode = null,
  startingLocation = '',
  regionNames = [],
  pickType = null,
  rankedNames = [],
  specific = '',
  specificMatchNames = [],
}) {
  const build = (ranked, matched) => {
    const parts = ['Plan a trip for me.'];
    if (MOOD_TEXT[mood]) parts.push(MOOD_TEXT[mood]);
    if (tripMode === 'group') parts.push("It's for a group.");
    else if (tripMode === 'solo') parts.push("It's just me.");
    if (startingLocation) parts.push(`Starting from ${startingLocation}.`);
    if (regionNames.length) parts.push(`In ${regionNames.join(' or ')}.`);
    if (pickType === 'usual') {
      parts.push(
        ranked.length ? `I want my usual kind of places, like: ${ranked.join(', ')}.` : 'I want my usual kind of places.'
      );
    } else if (pickType === 'new') {
      parts.push(
        ranked.length
          ? `I want to try something new that still fits my taste, like: ${ranked.join(', ')}.`
          : 'I want to try something new that still fits my taste.'
      );
    }
    const wish = String(specific || '').trim().slice(0, 200);
    if (wish) {
      parts.push(`Specifically: ${wish}.`);
      if (matched.length) parts.push(`Places that fit that: ${matched.join(', ')}.`);
    }
    return parts.join(' ');
  };
  let ranked = rankedNames.slice(0, MAX_HINT_NAMES);
  let matched = specificMatchNames.slice(0, MAX_HINT_NAMES);
  let msg = build(ranked, matched);
  while (msg.length > MAX_PLAN_MESSAGE && (ranked.length || matched.length)) {
    if (matched.length >= ranked.length) matched = matched.slice(0, -1);
    else ranked = ranked.slice(0, -1);
    msg = build(ranked, matched);
  }
  return msg.slice(0, MAX_PLAN_MESSAGE);
}

// On-device ranking for "The usual" / "Something new", across the plan's
// cities (at most three), best first. The candidates are the saved tag
// scores' own queues (usualPicks / discoveryPicks); Mapr Phase 1
// (maprRank/surfaces.js) then orders them: distance from `origin`, similar
// places, the model once switched on, and for "Something new" exploration
// slots (novel and unexpected places). Without a uid this is the older
// interleaved tag-score order.
export const TRIP_CANDIDATES_PER_CITY = 40;
export function rankTripPicks({ pickType, profile, regionIds = [], excludeIds = [], limit = MAX_HINT_NAMES, now = Date.now(), uid = null, origin = null, myReviews = {}, models = null, explore = null, rng = Math.random }) {
  if (pickType !== 'usual' && pickType !== 'new') return [];
  const rank = pickType === 'usual' ? usualPicks : discoveryPicks;
  const ids = [...new Set(regionIds.filter(Boolean))].slice(0, 3);
  if (!ids.length) return [];
  const per = uid ? TRIP_CANDIDATES_PER_CITY : Math.max(2, Math.ceil(limit / ids.length));
  const lists = ids.map((region) => rank({ profile, region, excludeIds, limit: per, now }));
  // Interleave so one city doesn't take every slot.
  const out = [];
  const cap = uid ? Infinity : limit;
  for (let i = 0; out.length < cap && lists.some((l) => l[i]); i++) {
    for (const l of lists) if (l[i] && out.length < cap) out.push(l[i]);
  }
  if (!uid) return out;
  return rankPlaces({
    places: out,
    uid,
    profile,
    myReviews,
    origin,
    models,
    now,
    scoreOf: (p) => p.tagScore || 0,
    count: pickType === 'new' ? limit : null,
    explore,
    rng,
  }).picks.slice(0, limit);
}

// ---- Cached last plan -----------------------------------------------------
// Reused only when every answer is the same, you're within half a mile of
// where it was made, and it's still the same part of the same day.

export const PLAN_CACHE_MAX_METERS = 804.672; // 0.5 mile

// "2026-09-29:afternoon". Night runs 9pm-5am and belongs to the evening it
// started on, so 1am is still the same night as 11pm.
export function timeOfDayBucket(date = new Date()) {
  const d = new Date(date);
  const h = d.getHours();
  const part = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
  if (h < 5) d.setDate(d.getDate() - 1);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${day}:${part}`;
}

// Everything the wizard asked, as one comparable string.
export function planAnswersKey({ mood, pickType, specific, tripMode, startingLocation, regionIds, requestFor = 'solo' }) {
  return JSON.stringify([
    requestFor === 'group' ? 'group' : 'solo',
    mood || null,
    pickType || null,
    String(specific || '').trim().toLowerCase(),
    tripMode || null,
    String(startingLocation || '').trim(),
    [...(regionIds || [])].sort(),
  ]);
}

export function isPlanCacheValid(cache, { answersKey, origin, now = new Date() }) {
  if (!cache || !cache.reply || !cache.message || cache.answersKey !== answersKey) return false;
  if (cache.bucket !== timeOfDayBucket(now)) return false;
  const a = cache.origin;
  if (!a && !origin) return true;
  if (!a || !origin) return false;
  return distanceMeters(a.lat, a.lng, origin.lat, origin.lng) < PLAN_CACHE_MAX_METERS;
}

const cacheKey = (uid) => `mapr.planCache.${uid || 'anon'}`;
const DAY_MS = 24 * 60 * 60 * 1000;

export function readPlanCache(uid) {
  return readPersisted(cacheKey(uid), DAY_MS) || null;
}

export function writePlanCache(uid, { answersKey, origin, message, reply, pickType, now = new Date() }) {
  writePersisted(cacheKey(uid), {
    answersKey,
    message,
    origin: origin ? { lat: origin.lat, lng: origin.lng } : null,
    bucket: timeOfDayBucket(now),
    pickType: pickType || null,
    reply,
  });
}

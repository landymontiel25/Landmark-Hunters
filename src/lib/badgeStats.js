// Pure derived-stat helpers for the badges added beyond the original four
// (checkins/cities/streak/onboarding) in streaks.js. Each takes the user's
// own check-ins, pre-annotated by the caller with whatever extra fields it
// needs (`state`/`country` from the check-in's region, `categories` from
// its landmark) -- resolving those needs data this file deliberately
// doesn't import (region/landmark lookups), keeping these pure and easy to
// test. Returns a plain count or boolean, fed into computeBadges' `extra`.

export function countPhotoCheckins(checkins) {
  return checkins.filter((c) => c.photoURL || c.photoURLs?.length).length;
}

// Highest number of distinct landmarks checked into within any single region.
export function maxRegionCheckins(checkins) {
  const byRegion = new Map();
  for (const c of checkins) {
    if (!c.region || !c.landmarkId) continue;
    if (!byRegion.has(c.region)) byRegion.set(c.region, new Set());
    byRegion.get(c.region).add(c.landmarkId);
  }
  let max = 0;
  for (const ids of byRegion.values()) max = Math.max(max, ids.size);
  return max;
}

// Requires each check-in to already carry a `.state`/`.country` field.
export function countDistinctStates(checkins) {
  return new Set(checkins.map((c) => c.state).filter(Boolean)).size;
}
export function countDistinctCountries(checkins) {
  return new Set(checkins.map((c) => c.country).filter(Boolean)).size;
}

// Device-local hour, not UTC -- "midnight" and "sunset" are experienced
// locally, and the app has no other precedent either way for badge gating
// (only streaks.js's UTC day-boundary, which is a different kind of thing).
function localHour(checkin) {
  const sec = checkin.createdAt?.seconds;
  return sec ? new Date(sec * 1000).getHours() : null;
}
export function hasNightOwlCheckin(checkins) {
  return checkins.some((c) => {
    const h = localHour(c);
    return h !== null && h >= 0 && h < 6;
  });
}
export function hasGoldenHourCheckin(checkins) {
  return checkins.some((c) => {
    const h = localHour(c);
    return h !== null && h >= 18 && h < 19;
  });
}

// Requires each check-in to already carry a `.categories` array (the
// landmark's own categories) -- one this file couldn't resolve is simply
// skipped, not guessed at.
// No cuisine sub-type data exists on any real restaurant in this app today
// (Italian/Mexican/etc. was never tagged, and inventing it per business
// would mean fabricating facts about real places) -- this counts distinct
// food-category landmarks instead of distinct cuisines, the closest honest
// proxy available without making something up.
export function countCuisineTypes(checkins) {
  return new Set(checkins.filter((c) => c.categories?.includes('food')).map((c) => c.landmarkId)).size;
}

// "museum, restaurant, landmark, nature" mapped onto this app's real
// category taxonomy.
// Art & Museums folded into Art & Culture (history-culture); categories
// come from the current catalog, so museums count as Art & Culture.
export const ALL_STAR_CATEGORIES = ['food', 'history-culture', 'parks-nature'];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Whether all four ALL_STAR_CATEGORIES were each hit by at least one
// check-in within some single rolling 7-day window.
export function hasAllStarWeek(checkins) {
  const events = checkins
    .map((c) => ({
      sec: c.createdAt?.seconds,
      cats: (c.categories || []).filter((cat) => ALL_STAR_CATEGORIES.includes(cat)),
    }))
    .filter((e) => e.sec && e.cats.length)
    .sort((a, b) => a.sec - b.sec);
  for (let i = 0; i < events.length; i++) {
    const windowStart = events[i].sec * 1000;
    const seen = new Set();
    for (let j = i; j < events.length; j++) {
      const t = events[j].sec * 1000;
      if (t - windowStart > WEEK_MS) break;
      for (const cat of events[j].cats) seen.add(cat);
      if (seen.size === ALL_STAR_CATEGORIES.length) return true;
    }
  }
  return false;
}

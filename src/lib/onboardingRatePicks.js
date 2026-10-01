import { ALL_LANDMARKS } from '../data/regions';
import { isRateable, ratingCategory } from './ratingFlow';
import { hasPhoto, METERS_PER_MILE } from './nearbyPicks';
import { distanceMeters } from './geo';

// The places onboarding's "rate 10" step shows, best first. Pure and
// deterministic. Well-known places (catalog popularity) lead; places in a
// category the swipe cards said you love get a bump; a photo is a small
// bonus, never a requirement; with a location, every mile away costs a
// little, otherwise a place in `region` (the city you picked) beats the rest
// of the world. Categories are spread out: each repeat of one already queued
// costs more, so the queue mixes food, parks, museums and so on.
const POPULARITY_W = 2;
const TASTE_BONUS = 4;
const PHOTO_BONUS = 1.5;
const REGION_BONUS = 6;
const MILE_PENALTY = 0.35;
const REPEAT_PENALTY = 3;

export function onboardingRateQueue({ coords = null, region = null, lovedTags = [], excludeIds = [], limit = 40, landmarks = ALL_LANDMARKS }) {
  const exclude = new Set(excludeIds);
  const loved = new Set(lovedTags);
  const scored = landmarks
    .filter((l) => l && !exclude.has(l.id) && isRateable(l))
    .map((l) => {
      const meters = coords ? distanceMeters(coords.lat, coords.lng, l.lat, l.lng) : null;
      const miles = Number.isFinite(meters) ? meters / METERS_PER_MILE : null;
      const base =
        (Number(l.popularity) || 0) * POPULARITY_W +
        ((l.categories || []).some((c) => loved.has(c)) ? TASTE_BONUS : 0) +
        (hasPhoto(l) ? PHOTO_BONUS : 0) +
        (!coords && region && (l.regionId || l.region) === region ? REGION_BONUS : 0) -
        (miles != null ? miles * MILE_PENALTY : 0);
      return { landmark: l, base, distanceMeters: Number.isFinite(meters) ? meters : null, category: ratingCategory(l) };
    })
    .sort((a, b) => b.base - a.base);

  const out = [];
  const used = {};
  while (scored.length && out.length < limit) {
    let best = 0;
    let bestScore = -Infinity;
    // Only the strongest few are weighed against category repeats, so the
    // greedy pick stays cheap over a catalog of over a thousand places.
    for (let i = 0; i < Math.min(scored.length, 12); i++) {
      const s = scored[i].base - (used[scored[i].category] || 0) * REPEAT_PENALTY;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    const [pick] = scored.splice(best, 1);
    used[pick.category] = (used[pick.category] || 0) + 1;
    out.push({ ...pick.landmark, distanceMeters: pick.distanceMeters });
  }
  return out;
}

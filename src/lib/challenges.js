import { ALL_LANDMARKS, INTERESTS } from '../data/regions';

// Themed challenges (item i5) -- built from the existing category system
// (INTERESTS) rather than a separately hand-curated list, so every
// challenge is grounded in real, already-verified landmark data instead of
// a fabricated theme this app can't actually back up.
export function getChallengesForRegion(regionId) {
  return INTERESTS.map((cat) => ({
    id: `${regionId}-${cat.id}`,
    categoryId: cat.id,
    label: `Every ${cat.label} Spot`,
    icon: cat.icon,
    landmarks: ALL_LANDMARKS.filter((l) => l.regionId === regionId && l.source !== 'osm' && l.categories?.includes(cat.id)),
    // A "collection" of one isn't much of a challenge.
  })).filter((c) => c.landmarks.length >= 2);
}

function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** Deterministically rotates which challenge is "featured" week to week. */
export function getFeaturedChallenge(regionId, now = new Date()) {
  const all = getChallengesForRegion(regionId);
  if (all.length === 0) return null;
  return all[isoWeekNumber(now) % all.length];
}

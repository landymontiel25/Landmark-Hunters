// Which staged places a region keeps, when it keeps fewer than all of them
// (regions.js `select`). Tiers, in priority order:
//   insider    added by hand for a sourced reason (overrides.json include)
//   nightlife  every named bar, pub, beer garden and nightclub
//   wikidata   every place with a Wikidata item
//   culture    museums, galleries, arts centers, theaters, cinemas, zoos,
//              historic sites, statues, attractions, stadiums, markets,
//              bookstores and record stores
//   nearby     everything within `anchorMeters` of an anchor (a campus or town)
//   fill       the rest of the restaurants, cafes, bakeries and parks, richest
//              OSM tags first (website, hours, cuisine...), until the region
//              holds `target` places
// Without a Wikidata item, these never count: community gardens, playgrounds,
// plazas and other pocket parks; numbered or generic practice fields; chain
// branches (a `brand` tag) outside the nightlife and culture tiers. An old
// building tagged historic=building with nothing else (often a school or a
// house) is no "historic site" unless it has a heritage listing.
import { distanceMeters } from './transform.js';

const NIGHTLIFE = new Set(['bar', 'pub', 'beer garden', 'nightclub']);
const CULTURE_CATEGORIES = new Set(['art-museums', 'entertainment', 'stadiums']);
const CULTURE_TOPICS = new Set(['market', 'bookstore', 'record store', 'historic site', 'attraction', 'monument', 'statue', 'ruins', 'historic ship', 'historic church', 'lighthouse', 'fort', 'archaeological site']);
const POCKET = /\b(community|tot lot|play ?lot|playground|pocket park|parklet|plaza|triangle|farm)\b|^\d/i;
const PRACTICE_FIELD = /\b(field|court)s? \d+$|^(upper|lower|auxiliary|practice|paddle tennis) (field|court)$/i;
const FILL_CATEGORIES = new Set(['food', 'parks-nature']);

const plainOldBuilding = (tags) =>
  tags.historic === 'building' && !tags.heritage && !tags['ref:nrhp'] && !tags['heritage:operator'] && !tags.wikipedia && !tags.tourism;

export function isPocketPark(place, tags = {}) {
  if (place.categories[0] !== 'parks-nature' || place.topic === 'nature preserve' || place.topic === 'viewpoint') return false;
  return tags['garden:type'] === 'community' || POCKET.test(place.name);
}

// How much the OSM record says about a place.
export function richness(place, tags = {}) {
  let n = 0;
  if (tags.website || tags['contact:website'] || place.website) n += 2;
  if (tags.wikidata) n += 2;
  if (tags.wikipedia) n += 1;
  if (tags.opening_hours) n += 1;
  if (tags.cuisine) n += 1;
  if (tags.description) n += 1;
  if (tags['addr:street'] && tags['addr:housenumber']) n += 0.5;
  if (tags.phone || tags['contact:phone']) n += 0.5;
  return n + Math.min(place.facts.length, 8) * 0.25;
}

export function tierOf(place, tags = {}, { overrides = {}, anchors = [], anchorMeters = 3000 } = {}) {
  if (overrides[place.id]?.include) return 'insider';
  if (place.wikidata) return NIGHTLIFE.has(place.topic) ? 'nightlife' : 'wikidata';
  if (isPocketPark(place, tags) || PRACTICE_FIELD.test(place.name) || plainOldBuilding(tags)) return null;
  if (NIGHTLIFE.has(place.topic)) return 'nightlife';
  if (CULTURE_CATEGORIES.has(place.categories[0]) || CULTURE_TOPICS.has(place.topic)) return 'culture';
  if (tags.brand) return null;
  if (anchors.some(([lat, lng]) => distanceMeters(place.lat, place.lng, lat, lng) <= anchorMeters)) return 'nearby';
  return FILL_CATEGORIES.has(place.categories[0]) ? 'fill' : null;
}

export function whyNotSelected(place, tags = {}) {
  if (isPocketPark(place, tags)) return 'community garden or pocket park';
  if (PRACTICE_FIELD.test(place.name)) return 'numbered or generic practice field';
  if (plainOldBuilding(tags)) return 'old building with no heritage listing';
  if (tags.brand) return 'chain branch';
  return 'not a restaurant, cafe, bakery or park, and outside the other tiers';
}

export const TIERS = ['insider', 'nightlife', 'wikidata', 'culture', 'nearby', 'fill'];

export function selectPlaces(places, { tagsById = new Map(), overrides = {}, anchors = [], anchorMeters = 3000, target = 1000 } = {}) {
  const byTier = Object.fromEntries(TIERS.map((t) => [t, []]));
  const notSelected = [];
  for (const p of places) {
    const tags = tagsById.get(p.id) || {};
    const tier = tierOf(p, tags, { overrides, anchors, anchorMeters });
    if (tier) byTier[tier].push({ p, score: richness(p, tags) });
    else notSelected.push({ ...p, why: whyNotSelected(p, tags) });
  }
  const kept = TIERS.filter((t) => t !== 'fill').flatMap((t) => byTier[t].map((x) => x.p));
  const fill = byTier.fill.sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
  const room = Math.max(0, target - kept.length);
  // Only places with something to say fill the gap.
  const filled = fill.slice(0, room).filter((x) => x.score >= 2);
  const filledIds = new Set(filled.map((x) => x.p.id));
  for (const x of fill) if (!filledIds.has(x.p.id)) notSelected.push({ ...x.p, why: 'below the fill line (fewer OSM details)' });
  const keep = new Set([...kept, ...filled.map((x) => x.p)].map((p) => p.id));
  const tiers = Object.fromEntries(TIERS.map((t) => [t, t === 'fill' ? filled.length : byTier[t].length]));
  // Same order as the input (category, then name).
  return { selected: places.filter((p) => keep.has(p.id)), notSelected, tiers };
}

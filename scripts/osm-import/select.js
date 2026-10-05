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

// ---- Curated selection (San Francisco, Silicon Valley) -----------------------
// For a region shown to people who know it well: a wrong or dull place costs
// more than a missing one. Tiers, in priority order:
//   curated    added by hand for a sourced reason (overrides.json include:
//              awards, critics' lists, known founder / VC / tech spots)
//   landmark   every place with a Wikidata item (outside the skips below)
//   culture    museums, galleries, arts centers, theaters, cinemas, markets,
//              bookstores, record stores, viewpoints, beaches, gardens and
//              preserves with a website or Wikidata item (score >= minCultureScore)
//   nightlife  the best-documented bars, pubs and clubs, at most
//              nightlifeShare of the target
//   fill       restaurants, cafes, bakeries and parks with rich OSM records
//              (score >= minFillScore), taken round-robin across neighborhoods
//              or towns (area) so no part of the region crowds out the rest
// Never, unless curated: chain branches (brand tags or a national chain's
// name), members-only or private places, courts and fields, malls and
// department stores, airports, memorials and old buildings without a
// heritage listing or Wikidata item, pocket parks and community gardens.
const NATIONAL_CHAINS =
  /^(starbucks|peet'?s( coffee)?|mcdonald'?s|subway|chipotle|panera|pizza hut|domino'?s|jamba|burger king|wendy'?s|taco bell|kfc|dunkin'?|the cheesecake factory|cheesecake factory|p\.?f\.? chang'?s|olive garden|applebee'?s|ihop|denny'?s|chick-fil-a|panda express|five guys|shake shack|sweetgreen|cava|tender greens|blaze pizza|mod pizza|noah'?s( new york)? bagels|einstein bros|round table pizza|togo'?s|specialty'?s|la boulange|corner bakery|coffee bean|the coffee bean|jollibee|raising cane'?s|in-n-out( burger)?|habit burger|the habit|wingstop|baskin[- ]robbins|cold stone|yogurtland|menchie'?s|pinkberry|boba guys|philz coffee|blue bottle( coffee)?|tartine|amc|regal|cinemark)$/i;
const CURATED_CULTURE_TOPICS = new Set(['market', 'bookstore', 'record store', 'viewpoint', 'beach', 'garden', 'nature preserve', 'art gallery', 'arts center', 'museum', 'theater', 'movie theater', 'zoo', 'aquarium']);
const HERITAGE = (tags) => !!(tags.wikidata || tags.heritage || tags['ref:nrhp'] || tags['heritage:operator'] || tags.wikipedia);

export const isChain = (place, tags = {}) => !!(tags.brand || tags['brand:wikidata']) || NATIONAL_CHAINS.test(place.name.trim());

export function curatedSkip(place, tags = {}) {
  const cat = place.categories[0];
  if (isChain(place, tags)) return 'chain branch';
  if (['private', 'members', 'no', 'customers'].includes(tags.access) || tags.membership === 'yes' || tags.club) return 'private or members-only';
  if (isPocketPark(place, tags)) return 'community garden or pocket park';
  if (PRACTICE_FIELD.test(place.name)) return 'numbered or generic practice field';
  if (cat === 'sports') return 'court or field';
  if (cat === 'airports') return 'airport';
  if (place.topic === 'mall' || place.topic === 'department store' || place.topic === 'art shop' || place.topic === 'antique shop') return 'shop';
  if (cat === 'history-culture' && !HERITAGE(tags) && place.topic !== 'lighthouse') return 'memorial or old building without a heritage listing';
  return null;
}

// A researched candidate (locate-candidates.mjs) carries its research tier
// as `_tier`: "acclaimed" (an award or critics' list, sourced) and
// "insider" (a sourced tech or founder link) go in as curated picks. The
// critics' list or the tech link is the evidence a chain name like
// Tartine is a local institution, so only the other skips apply to them.
const RESEARCHED_PICKS = new Set(['acclaimed', 'insider']);

// `bonus` adds to the place's OSM richness (its sourced web facts, selectCurated).
export function curatedTierOf(place, tags = {}, { overrides = {}, minCultureScore = 2, bonus = 0 } = {}) {
  if (overrides[place.id]?.include) return 'curated';
  if (RESEARCHED_PICKS.has(place._tier)) {
    const skip = curatedSkip(place, tags);
    return !skip || skip === 'chain branch' ? 'curated' : null;
  }
  if (curatedSkip(place, tags)) return null;
  if (place.wikidata) return 'landmark';
  const cat = place.categories[0];
  if (cat === 'art-museums' || cat === 'entertainment' || cat === 'stadiums' || CURATED_CULTURE_TOPICS.has(place.topic) || cat === 'history-culture')
    return richness(place, tags) + bonus >= minCultureScore ? 'culture' : null;
  if (NIGHTLIFE.has(place.topic)) return 'nightlife';
  return FILL_CATEGORIES.has(cat) ? 'fill' : null;
}

export const CURATED_TIERS = ['curated', 'landmark', 'culture', 'nightlife', 'fill'];

// Takes the highest-scored entries from each area in turns until `room` is
// used up: area A's best, area B's best, ..., then each area's second best.
export function roundRobin(entries, room, areaOf) {
  const byArea = new Map();
  for (const e of [...entries].sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id))) {
    const k = areaOf(e.p) || '';
    if (!byArea.has(k)) byArea.set(k, []);
    byArea.get(k).push(e);
  }
  const queues = [...byArea.keys()].sort().map((k) => byArea.get(k));
  const out = [];
  for (let i = 0; out.length < room && queues.some((q) => q.length > i); i++)
    for (const q of queues) if (q[i] && out.length < room) out.push(q[i]);
  return out;
}

// `webFactsOf(place)` counts the place's sourced web-research facts
// (web-facts.json). With `minWebFacts`, a place needs that many to be kept
// (curated picks one: their award or tech link), so nothing comes in with
// only generic lines; each fact also adds a point to its fill score.
export function selectCurated(places, { tagsById = new Map(), overrides = {}, target = 800, nightlifeShare = 0.15, minFillScore = 3, minCultureScore = 2, minWebFacts = 0, webFactsOf = () => 0, areaOf = () => '' } = {}) {
  const byTier = Object.fromEntries(CURATED_TIERS.map((t) => [t, []]));
  const notSelected = [];
  for (const p of places) {
    const tags = tagsById.get(p.id) || {};
    const facts = webFactsOf(p);
    const tier = curatedTierOf(p, tags, { overrides, minCultureScore, bonus: Math.min(facts, 4) });
    if (tier && minWebFacts && facts < (tier === 'curated' ? 1 : minWebFacts)) notSelected.push({ ...p, why: `fewer than ${tier === 'curated' ? 1 : minWebFacts} sourced facts` });
    else if (tier) byTier[tier].push({ p, score: richness(p, tags) + Math.min(facts, 4) });
    else notSelected.push({ ...p, why: curatedSkip(p, tags) || 'too few OSM details for its kind' });
  }
  const kept = [...byTier.curated, ...byTier.landmark, ...byTier.culture];
  const bars = roundRobin(byTier.nightlife.filter((x) => x.score >= minFillScore), Math.round(target * nightlifeShare), (p) => areaOf(p));
  const fill = roundRobin(byTier.fill.filter((x) => x.score >= minFillScore), Math.max(0, target - kept.length - bars.length), (p) => areaOf(p));
  const keep = new Set([...kept, ...bars, ...fill].map((x) => x.p.id));
  for (const t of ['nightlife', 'fill']) for (const x of byTier[t]) if (!keep.has(x.p.id)) notSelected.push({ ...x.p, why: x.score >= minFillScore ? 'past the target for its area' : 'too few OSM details for its kind' });
  const tiers = { curated: byTier.curated.length, landmark: byTier.landmark.length, culture: byTier.culture.length, nightlife: bars.length, fill: fill.length };
  return { selected: places.filter((p) => keep.has(p.id)), notSelected, tiers };
}

#!/usr/bin/env node
// Builds src/data/miamiNeighborhoods.json for the Landmarks tab's
// Neighborhoods subtab (owner, 2026-11-06).
//
// - The neighborhood list, its city groups and the tourist-traffic tiers are
//   the owner's, copied as given.
// - Coordinates come from OpenStreetMap (Nominatim), never typed by hand.
//   Each lookup is kept with its OSM id so it can be checked.
// - Photos are Wikimedia Commons files (freely licensed), picked by hand in
//   scripts/neighborhoods/photos.json with author, license and source page.
// - info, tags and every rating stay empty: a separate pipeline fills them.
//   Re-running keeps any info, tags or ratings already in the output file.
//
// Usage: node scripts/build-miami-neighborhoods.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'src/data/miamiNeighborhoods.json';
const PHOTOS = JSON.parse(readFileSync('scripts/neighborhoods/photos.json', 'utf8'));

const GROUPS = [
  [
    'City of Miami',
    ['Brickell', 'Downtown Miami', 'Edgewater', 'Wynwood', 'Design District', 'Little Havana', 'Little Haiti', 'Overtown', 'Allapattah', 'Coconut Grove', 'Coral Way', 'Flagami', 'Liberty City', 'Morningside', 'Shenandoah', 'Upper East Side', 'Midtown', 'Miami River District'],
  ],
  ['Miami Beach', ['South Beach', 'Mid-Beach', 'North Beach', 'South of Fifth', 'Sunset Harbour']],
  [
    'Other Miami-Dade cities',
    ['Coral Gables', 'Key Biscayne', 'Pinecrest', 'Hialeah', 'Doral', 'Aventura', 'Sunny Isles Beach', 'North Miami', 'North Miami Beach', 'Miami Gardens', 'Miami Lakes', 'Kendall', 'Homestead', 'Cutler Bay', 'Palmetto Bay', 'Surfside', 'Bal Harbour', 'Miami Shores', 'Miami Springs', 'Opa-locka', 'Westchester', 'Sweetwater', 'South Miami'],
  ],
  // Hallandale Beach is in Broward County; the owner's tier list includes it.
  ['Broward County', ['Hallandale Beach']],
];

// The owner's tourist-traffic tiers, in rank order (2026-11-06).
const TIERS = [
  {
    id: 'tier1',
    label: 'Tier 1',
    title: 'Very high tourist traffic',
    neighborhoods: ['South Beach', 'Downtown Miami', 'Brickell', 'Wynwood', 'Mid-Beach', 'Little Havana', 'Aventura', 'Coral Gables', 'Coconut Grove', 'Design District'],
  },
  {
    id: 'tier2',
    label: 'Tier 2',
    title: 'High tourist traffic',
    neighborhoods: ['Bal Harbour', 'South of Fifth', 'Key Biscayne', 'Sunny Isles Beach', 'North Beach', 'Doral', 'South Miami', 'Miami Gardens', 'Hialeah', 'Sunset Harbour'],
  },
  {
    id: 'tier3',
    label: 'Tier 3',
    title: 'Moderate tourist traffic',
    neighborhoods: ['Midtown', 'Surfside', 'Hallandale Beach', 'Homestead', 'Edgewater', 'Overtown', 'Little Haiti', 'Miami River District', 'North Miami', 'Miami Lakes'],
  },
];

// Nominatim query per name where "<name>, Miami-Dade County, Florida" misses
// or lands on the wrong place.
const QUERY = {
  'Downtown Miami': 'Downtown Miami',
  'Design District': 'Design District, Miami, Florida',
  'Mid-Beach': 'Mid Beach, Miami Beach, Florida',
  // The street's first hit is Miracle Mile in Coral Gables; the
  // neighborhood is the part inside the City of Miami (see PICK).
  'Coral Way': 'Coral Way, Miami, Florida',
  'North Beach': 'North Beach, Miami Beach, Florida',
  'South Beach': 'South Beach, Miami Beach, Florida',
  'South of Fifth': 'South of Fifth, Miami Beach, Florida',
  'Sunset Harbour': 'Sunset Harbour, Miami Beach, Florida',
  'Miami River District': 'Lummus Park, Miami, Florida',
  'Hallandale Beach': 'Hallandale Beach, Broward County, Florida',
  Midtown: 'Midtown, Miami, Florida',
  'Upper East Side': 'Upper Eastside, Miami, Florida',
};

// Among several hits, take the first whose address contains this text.
const PICK = { 'Coral Way': 'Miami, Miami-Dade County' };

const EMPTY_RATINGS = () => ({
  safety: null,
  walkability: null,
  restaurants: { quantity: null, price: null, diversity: null },
  nightlife: null,
  averagePropertyPrice: null,
  artAndCulture: null,
  shopping: null,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(name) {
  const q = QUERY[name] || `${name}, Miami-Dade County, Florida`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'LandmarkHunters-neighborhoods-build' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for ${name}`);
  const hits = await res.json();
  const hit = PICK[name] ? hits.find((h) => h.display_name.includes(PICK[name])) : hits[0];
  if (!hit) return null;
  return { lat: +(+hit.lat).toFixed(5), lng: +(+hit.lon).toFixed(5), osm: `${hit.osm_type}/${hit.osm_id}`, osmName: hit.display_name };
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const prevByName = new Map((previous?.neighborhoods || []).map((n) => [n.name, n]));

const neighborhoods = [];
for (const [cityGroup, names] of GROUPS) {
  for (const name of names) {
    const prev = prevByName.get(name);
    let geo = prev?.location || null;
    if (!geo) {
      geo = await geocode(name);
      await sleep(1100); // Nominatim's limit: one request a second.
      console.log(geo ? `${name}: ${geo.lat}, ${geo.lng}  (${geo.osmName})` : `${name}: NOT FOUND`);
    }
    const photo = PHOTOS[name];
    neighborhoods.push({
      name,
      cityGroup,
      info: prev?.info ?? '',
      photo: photo?.photo ?? '',
      photoCredit: photo?.photoCredit ?? null,
      tags: prev?.tags ?? [],
      location: geo,
      ratings: prev?.ratings ?? EMPTY_RATINGS(),
    });
  }
}

const out = {
  city: 'Miami',
  featured: ['South Beach', 'Wynwood', 'Downtown Miami', 'Little Havana'],
  tiers: TIERS,
  neighborhoods,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${neighborhoods.length} neighborhoods to ${OUT}`);

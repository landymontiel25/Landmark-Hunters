import { MIAMI_LANDMARKS } from './landmarks.miami.js';
import { MADRID_LANDMARKS } from './landmarks.madrid.js';
import { EL_ESCORIAL_LANDMARKS } from './landmarks.elescorial.js';
import { ARANJUEZ_LANDMARKS } from './landmarks.aranjuez.js';
import { MILAN_LANDMARKS } from './landmarks.milan.js';
import { LAKE_COMO_LANDMARKS } from './landmarks.lakecomo.js';
import { PHILLY_LANDMARKS } from './landmarks.philly.js';
import { VILLANOVA_LANDMARKS } from './landmarks.villanova.js';
import { FRANKFURT_LANDMARKS } from './landmarks.frankfurt.js';
import { NYC_LANDMARKS } from './landmarks.nyc.js';
import { CAPETOWN_LANDMARKS } from './landmarks.capetown.js';
import { KEYBISCAYNE_LANDMARKS } from './landmarks.keybiscayne.js';
import { CORALGABLES_LANDMARKS } from './landmarks.coralgables.js';
import { F1_LANDMARKS } from './landmarks.f1.js';
import { SANFRANCISCO_LANDMARKS } from './landmarks.sanfrancisco.js';
import { SILICONVALLEY_LANDMARKS } from './landmarks.siliconvalley.js';
import { SWITZERLAND_LANDMARKS } from './landmarks.switzerland.js';
import { PARIS_LANDMARKS } from './landmarks.paris.js';

export const REGIONS = [
  {
    id: 'miami',
    name: 'Miami',
    tagline: 'Beaches, Art Deco & Cuban culture',
    city: 'Miami',
    state: 'Florida',
    country: 'USA',
    center: { lat: 25.7743, lng: -80.1937 },
    viewbox: { minLat: 25.3, minLng: -80.6, maxLat: 25.95, maxLng: -80.05 },
    landmarks: MIAMI_LANDMARKS,
  },
  {
    id: 'key-biscayne',
    name: 'Key Biscayne',
    tagline: 'Island beaches, a historic lighthouse & bay views',
    city: 'Key Biscayne',
    state: 'Florida',
    country: 'USA',
    center: { lat: 25.6908, lng: -80.1625 },
    viewbox: { minLat: 25.63, minLng: -80.21, maxLat: 25.8, maxLng: -80.12 },
    landmarks: KEYBISCAYNE_LANDMARKS,
  },
  {
    id: 'coral-gables',
    name: 'Coral Gables',
    tagline: 'The City Beautiful — Mediterranean charm & Miracle Mile',
    city: 'Coral Gables',
    state: 'Florida',
    country: 'USA',
    center: { lat: 25.7519, lng: -80.2562 },
    viewbox: { minLat: 25.72, minLng: -80.28, maxLat: 25.77, maxLng: -80.24 },
    landmarks: CORALGABLES_LANDMARKS,
  },
  {
    id: 'san-francisco',
    name: 'San Francisco',
    tagline: 'Golden Gate icons, AI-era offices & founder cafés',
    city: 'San Francisco',
    state: 'California',
    country: 'USA',
    center: { lat: 37.7749, lng: -122.4194 },
    // Reaches Oakland (Block HQ) and Angel Island; the Peninsula south of
    // South San Francisco belongs to silicon-valley.
    viewbox: { minLat: 37.7, minLng: -122.55, maxLat: 37.9, maxLng: -122.25 },
    landmarks: SANFRANCISCO_LANDMARKS,
  },
  {
    id: 'silicon-valley',
    name: 'Silicon Valley',
    tagline: 'Founding garages, HQ campuses & Sand Hill Road',
    city: 'Silicon Valley',
    state: 'California',
    country: 'USA',
    center: { lat: 37.4419, lng: -122.143 },
    // South San Francisco down to San Jose, the coast at Moss Beach out to
    // Lick Observatory on Mount Hamilton.
    viewbox: { minLat: 37.15, minLng: -122.55, maxLat: 37.7, maxLng: -121.6 },
    landmarks: SILICONVALLEY_LANDMARKS,
  },
  {
    id: 'nyc',
    name: 'New York City',
    tagline: 'Icons, skyscrapers, museums & legendary eats',
    city: 'New York',
    state: 'New York',
    country: 'USA',
    center: { lat: 40.7549, lng: -73.984 },
    viewbox: { minLat: 40.49, minLng: -74.1, maxLat: 40.92, maxLng: -73.7 },
    landmarks: NYC_LANDMARKS,
  },
  {
    id: 'cape-town',
    name: 'Cape Town',
    tagline: 'Table Mountain, beaches, wine & Cape heritage',
    city: 'Cape Town',
    state: 'Western Cape',
    country: 'South Africa',
    center: { lat: -33.925, lng: 18.424 },
    viewbox: { minLat: -34.36, minLng: 18.3, maxLat: -33.8, maxLng: 18.58 },
    landmarks: CAPETOWN_LANDMARKS,
  },
  {
    id: 'madrid',
    name: 'Madrid',
    tagline: 'Royal palaces, world-class art & tapas',
    city: 'Madrid',
    state: 'Community of Madrid',
    country: 'Spain',
    center: { lat: 40.4168, lng: -3.7038 },
    viewbox: { minLat: 40.3, minLng: -3.85, maxLat: 40.55, maxLng: -3.55 },
    landmarks: MADRID_LANDMARKS,
  },
  {
    id: 'el-escorial',
    name: 'El Escorial',
    tagline: 'Royal monastery, mountains & Castilian feasts',
    city: 'San Lorenzo de El Escorial',
    state: 'Community of Madrid',
    country: 'Spain',
    center: { lat: 40.589, lng: -4.148 },
    viewbox: { minLat: 40.56, minLng: -4.2, maxLat: 40.66, maxLng: -4.1 },
    landmarks: EL_ESCORIAL_LANDMARKS,
  },
  {
    id: 'aranjuez',
    name: 'Aranjuez',
    tagline: 'Royal palace, riverside gardens & strawberries',
    city: 'Aranjuez',
    state: 'Community of Madrid',
    country: 'Spain',
    center: { lat: 40.0349, lng: -3.6087 },
    viewbox: { minLat: 39.99, minLng: -3.70, maxLat: 40.09, maxLng: -3.53 },
    landmarks: ARANJUEZ_LANDMARKS,
  },
  {
    id: 'milan',
    name: 'Milan / Monza',
    tagline: 'Fashion, cathedrals & canals',
    city: 'Milan / Monza',
    state: 'Lombardy',
    country: 'Italy',
    center: { lat: 45.4642, lng: 9.19 },
    viewbox: { minLat: 45.4, minLng: 9.0, maxLat: 45.65, maxLng: 9.35 },
    landmarks: MILAN_LANDMARKS,
  },
  {
    id: 'lake-como',
    name: 'Lake Como',
    tagline: 'Historic villas, lakeside villages & mountain views',
    city: 'Lake Como',
    state: 'Lombardy',
    country: 'Italy',
    center: { lat: 45.93, lng: 9.15 },
    viewbox: { minLat: 45.78, minLng: 9.0, maxLat: 46.05, maxLng: 9.35 },
    landmarks: LAKE_COMO_LANDMARKS,
  },
  {
    id: 'philly',
    name: 'Philadelphia',
    tagline: 'Colonial history, Main Line towns & cheesesteaks',
    city: 'Philadelphia',
    state: 'Pennsylvania',
    country: 'USA',
    center: { lat: 40.02, lng: -75.3 },
    viewbox: { minLat: 39.9, minLng: -75.55, maxLat: 40.15, maxLng: -75.05 },
    landmarks: PHILLY_LANDMARKS,
  },
  {
    id: 'villanova',
    name: 'Villanova University',
    tagline: 'Campus icons and Augustinian history',
    city: 'Villanova',
    state: 'Pennsylvania',
    country: 'USA',
    center: { lat: 40.037, lng: -75.342 },
    viewbox: { minLat: 40.025, minLng: -75.355, maxLat: 40.048, maxLng: -75.33 },
    landmarks: VILLANOVA_LANDMARKS,
  },
  {
    id: 'frankfurt',
    name: 'Frankfurt',
    tagline: 'Major European airport hub & gateway',
    city: 'Frankfurt',
    state: 'Hesse',
    country: 'Germany',
    center: { lat: 50.0379, lng: 8.5622 },
    viewbox: { minLat: 49.95, minLng: 8.45, maxLat: 50.12, maxLng: 8.72 },
    landmarks: FRANKFURT_LANDMARKS,
  },
  {
    id: 'paris',
    name: 'Paris',
    tagline: 'Icons, romance & the City of Light',
    city: 'Paris',
    state: 'Île-de-France',
    country: 'France',
    center: { lat: 48.8566, lng: 2.3522 },
    viewbox: { minLat: 48.81, minLng: 2.22, maxLat: 48.91, maxLng: 2.42 },
    landmarks: PARIS_LANDMARKS,
  },
  {
    id: 'switzerland',
    name: 'Switzerland',
    tagline: 'Alpine lakes, mountain villages & Bernese Oberland views',
    city: 'Kandersteg',
    state: 'Bern',
    country: 'Switzerland',
    center: { lat: 46.4998, lng: 7.7275 },
    viewbox: { minLat: 45.9, minLng: 6.0, maxLat: 47.65, maxLng: 8.7 },
    landmarks: SWITZERLAND_LANDMARKS,
  },
  {
    // Not a city: every Formula 1 circuit outside the cities above, spread
    // across the world. `worldwide` keeps it out of "which city is nearest"
    // (GPS auto-pick, filing a new landmark) so it never swallows a real city.
    id: 'f1-circuits',
    name: 'Formula 1 Circuits',
    tagline: 'Every Grand Prix track on the calendar, worldwide',
    city: 'Worldwide',
    state: '',
    country: '',
    worldwide: true,
    center: { lat: 52.0786, lng: -1.0169 }, // Silverstone, where it all started
    viewbox: { minLat: -60, minLng: -180, maxLat: 75, maxLng: 180 },
    landmarks: F1_LANDMARKS,
  },
];

// Regions a user can pick as a city. The Formula 1 catalog is worldwide,
// not a place, so it stays out of city pickers -- its circuits are still
// on the map, in search, and in "All cities" landmark lists.
export const PICKABLE_REGIONS = REGIONS.filter((r) => !r.worldwide);

export function getRegion(id) {
  return REGIONS.find((r) => r.id === id) || null;
}

export const ALL_LANDMARKS = REGIONS.flatMap((r) => r.landmarks.map((l) => ({ ...l, regionId: r.id })));

export const ALL_LANDMARKS_BOUNDS = ALL_LANDMARKS.reduce(
  (b, l) => [
    [Math.min(b[0][0], l.lat), Math.min(b[0][1], l.lng)],
    [Math.max(b[1][0], l.lat), Math.max(b[1][1], l.lng)],
  ],
  [
    [ALL_LANDMARKS[0].lat, ALL_LANDMARKS[0].lng],
    [ALL_LANDMARKS[0].lat, ALL_LANDMARKS[0].lng],
  ]
);

// Places loaded at runtime from public/places (src/lib/placePacks.js in the
// browser, api/_lib/placePacks.js on the server) join the catalog here, so
// every reader of ALL_LANDMARKS / getLandmark sees them once they arrive.
const packIndex = new Map();
let catalogVersion = 0;
const catalogListeners = new Set();

export const getCatalogVersion = () => catalogVersion;
export function subscribeCatalog(fn) {
  catalogListeners.add(fn);
  return () => catalogListeners.delete(fn);
}

export function registerPlaces(places) {
  let added = 0;
  const idsByRegion = new Map();
  const idsOf = (region) => {
    if (!idsByRegion.has(region.id)) idsByRegion.set(region.id, new Set(region.landmarks.map((l) => l.id)));
    return idsByRegion.get(region.id);
  };
  for (const p of places || []) {
    const region = getRegion(p?.region);
    const key = `${p?.region}/${p?.id}`;
    if (!region || !p.id || packIndex.has(key) || idsOf(region).has(p.id)) continue;
    idsOf(region).add(p.id);
    region.landmarks.push(p);
    const entry = { ...p, regionId: region.id };
    ALL_LANDMARKS.push(entry);
    packIndex.set(key, p);
    added += 1;
  }
  if (added) {
    catalogVersion += 1;
    for (const fn of catalogListeners) fn(catalogVersion);
  }
  return added;
}

export function getLandmark(regionId, landmarkId) {
  const packed = packIndex.get(`${regionId}/${landmarkId}`);
  if (packed) return packed;
  const region = getRegion(regionId);
  return region?.landmarks.find((l) => l.id === landmarkId) || null;
}

// `added` is the order each category was introduced to the app (1 = the
// original four), so lists can show the newest categories first.
export const INTERESTS = [
  { id: 'history-culture', label: 'History & Culture', icon: '\u{1F3DB}\u{FE0F}', added: 1 },
  { id: 'art-museums', label: 'Art & Museums', icon: '\u{1F5BC}\u{FE0F}', added: 2 },
  // Food is restaurants, cafés, bakeries, gelato, food markets. Local Life is
  // bars, clubs, live-music venues, neighborhoods, squares, shopping streets.
  { id: 'food', label: 'Food', icon: '\u{1F37D}\u{FE0F}', added: 8 },
  { id: 'local-life', label: 'Local Life', icon: '\u{1F378}', added: 9 },
  { id: 'parks-nature', label: 'Parks & Nature', icon: '\u{1F333}', added: 4 },
  // Entertainment is shows, zoos, aquariums, cruises, amusement parks.
  // Stadiums is every stadium, arena, ballpark and race track. Sports
  // Activities is things you do (courts, golf, go-karts, pools, kayaking).
  { id: 'entertainment', label: 'Entertainment', icon: '\u{1F39F}\u{FE0F}', added: 5 },
  { id: 'stadiums', label: 'Stadiums', icon: '\u{1F3DF}\u{FE0F}', added: 11 },
  { id: 'formula-1', label: 'Formula 1 Circuits', icon: '\u{1F3CE}\u{FE0F}', added: 12 },
  { id: 'sports', label: 'Sports Activities', icon: '\u{1F3C0}', added: 10 },
  { id: 'airports', label: 'Airports', icon: '\u{2708}\u{FE0F}', added: 7 },
  // Personal-favourite sitting spots with a view, like The 10/10 Bench.
  { id: 'benches', label: '10/10 Benches', icon: '\u{1FA91}', added: 13 },
  // Where tech happened and happens: founding garages, HQ campuses, labs,
  // founder hangouts, hacker houses. The Bay Area catalog is mostly this.
  { id: 'tech', label: 'Tech & Startups', icon: '\u{1F4BB}', added: 14 },
  { id: 'campus-life', label: 'Campus Life', icon: '\u{1F3EB}', added: 3 },
];

// Retired category ids and where their landmarks live now. Dorms folded
// into Campus Life; saved filters and older custom landmarks may still
// carry the old id.
export const CATEGORY_ALIASES = { dorms: 'campus-life' };
export const normalizeCategories = (cats) => [...new Set((cats || []).map((c) => CATEGORY_ALIASES[c] || c))];

export const INTEREST_ORDERS = [
  { id: 'abc', label: 'A–Z' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
];

export function sortInterests(list, orderId = 'abc') {
  const out = [...list];
  if (orderId === 'newest') return out.sort((a, b) => (b.added || 0) - (a.added || 0));
  if (orderId === 'oldest') return out.sort((a, b) => (a.added || 0) - (b.added || 0));
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// Interest ids that no longer exist, mapped to what replaced them. Saved
// interests (localStorage) and old review docs can still carry these.
const RETIRED_INTERESTS = {
  'food-local-life': ['food', 'local-life'],
};

// Landmark ids that were renamed because two cities shared one. Check-ins,
// reviews and saved itineraries written before the rename still carry the old
// id plus their region, so reads map (region, oldId) -> the current id.
const LEGACY_LANDMARK_IDS = {
  'san-francisco': {
    'washington-square-park': 'washington-square-park-sf',
    'the-battery': 'the-battery-sf',
  },
};

export function canonicalLandmarkId(id, region) {
  return LEGACY_LANDMARK_IDS[region]?.[id] || id;
}

export function migrateInterests(ids) {
  const out = [];
  for (const id of ids || []) {
    for (const next of RETIRED_INTERESTS[id] || [id]) {
      if (!out.includes(next)) out.push(next);
    }
  }
  return out;
}

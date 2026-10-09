// Finds researched candidates (a name plus a street address, from web
// research) in OpenStreetMap through Nominatim, for regions where Overpass
// can't be reached (San Francisco, Silicon Valley). Pure functions only:
// locate-candidates.mjs does the requests. A candidate counts as found only
// when an OSM object carries its name AND sits at its address; nothing here
// writes a coordinate that OSM didn't give.
import { normName } from '../../src/lib/placeMatch.js';
import { distanceMeters, insideShape } from './transform.js';

const STREET_WORD = {
  street: 'st', avenue: 'ave', av: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr', place: 'pl', lane: 'ln',
  court: 'ct', terrace: 'ter', alley: 'aly', highway: 'hwy', parkway: 'pkwy', square: 'sq', plaza: 'plz',
  north: 'n', south: 's', east: 'e', west: 'w', first: '1st', second: '2nd', third: '3rd', fourth: '4th',
  fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th', saint: 'st', mount: 'mt',
};

// "Market Street" and "Market St." are one street; "3rd Street" and "Third St" too.
export const streetKey = (s) =>
  normName(s)
    .split(' ')
    .filter(Boolean)
    .map((w) => STREET_WORD[w] || w)
    .join(' ');

// "1658 Market St, San Francisco, CA 94102" -> { number: '1658', street: 'Market St' }.
// A range ("1-3 Embarcadero Center") keeps its first number; a unit
// ("Suite 100", "#2") goes. No house number -> number null.
// Without a number, cross streets ("Vallejo St at Taylor St", "16th Ave
// between Kirkham St and Lawton St") come back as `cross`.
export function parseAddress(address) {
  const first = String(address || '').split(',')[0].replace(/\s+(suite|ste|unit|#|apt)\b.*$/i, '').replace(/#\S+$/, '').trim();
  const m = first.match(/^(\d+[a-z]?)(?:\s*-\s*\d+[a-z]?)?\s+(.+)$/i);
  if (m) return { number: m[1].toLowerCase(), street: m[2].trim() };
  if (!first || first === 'null') return { number: null, street: null };
  const [street, ...cross] = first.replace(/^off\s+/i, '').split(/\s+(?:at|and|&|between|near|off)\s+/i).map((x) => x.trim()).filter(Boolean);
  return cross.length ? { number: null, street, cross } : { number: null, street };
}

// Same name: equal after normalizing, or the shorter (6+ characters, whole
// words) inside the longer ("Tartine" / "Tartine Bakery").
// Words that only say what kind of place it is: "Roxie Theater" is OSM's
// "Roxie". The name's other words have to agree in full.
const KIND_WORDS = new Set(
  ('the theater theatre cinema cinemas books bookstore bookshop records bar restaurant cafe coffee bakery gallery park ' +
    'sf san francisco and co company club museum shop kitchen').split(' ')
);
const NEUTRAL = new Set(['the', 'sf', 'san', 'francisco', 'and', 'co', 'company']);
export const core = (s) => normName(s).split(' ').filter((w) => w && !KIND_WORDS.has(w)).join(' ');

export function sameName(a, b) {
  const strip = (s) => normName(s).replace(/^the /, '');
  const x = strip(a);
  const y = strip(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 6 && ` ${l} `.includes(` ${s} `)) return true;
  const cx = core(a);
  if (cx.length < 4 || cx !== core(b)) return false;
  // "Borderlands Books" and "Borderlands Cafe" are two businesses.
  const kinds = (n) => normName(n).split(' ').filter((w) => KIND_WORDS.has(w) && !NEUTRAL.has(w));
  const [ka, kb] = [kinds(a), kinds(b)];
  return !ka.length || !kb.length || ka.some((w) => kb.includes(w));
}

// A Nominatim result's names: name, alt_name, official_name, old names don't count.
export const resultNames = (r) =>
  [r.name, ...Object.entries(r.namedetails || {}).filter(([k]) => /^(name|alt_name|official_name|short_name|name:en)$/.test(k)).flatMap(([, v]) => String(v).split(';'))].filter(Boolean);

export const nameMatches = (candidateName, r) => resultNames(r).some((n) => sameName(candidateName, n));

// The OSM object's own address is the researched one: same house number and street.
// A park, stairway or viewpoint with no house number: the street OSM gives
// it is the researched street or one of its cross streets.
const AREA_KINDS = new Set(['leisure', 'natural', 'tourism', 'historic', 'highway', 'landuse', 'boundary']);
export function addressMatches(parsed, r) {
  const a = r.address || {};
  if (!parsed?.number && parsed?.street && a.road && AREA_KINDS.has(r.category))
    return [parsed.street, ...(parsed.cross || [])].some((st) => streetKey(st) === streetKey(a.road));
  if (!parsed?.number || !a.house_number || !a.road) return false;
  const nums = String(a.house_number).toLowerCase().split(/[;,]/).map((n) => n.trim().split('-')[0]);
  return nums.includes(parsed.number) && streetKey(a.road) === streetKey(parsed.street);
}

export const pointOf = (r) => ({ lat: Number(r.lat), lng: Number(r.lon) });

// Within `meters` of the geocoded address; for an area (a park, a campus)
// the address may also fall inside its bounding box grown by `meters`.
// The box only counts for an area up to 3 km across: a stream or a long
// road's box holds half a town.
export function nearAddress(r, geo, meters = 75) {
  if (!geo) return false;
  const p = pointOf(r);
  if (distanceMeters(p.lat, p.lng, geo.lat, geo.lng) <= meters) return true;
  if (r.osm_type === 'node' || !Array.isArray(r.boundingbox)) return false;
  const [s, n, w, e] = r.boundingbox.map(Number);
  if (distanceMeters(s, w, n, e) > 3000) return false;
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((geo.lat * Math.PI) / 180));
  return geo.lat >= s - dLat && geo.lat <= n + dLat && geo.lng >= w - dLng && geo.lng <= e + dLng;
}

// OSM tags rebuilt from a Nominatim result: its main tag (category=type),
// extratags (cuisine, website, wikidata, opening_hours...) and its name.
// The address tags are the researched address, which the match checked.
export function tagsOf(r, parsed, city) {
  const tags = { ...(r.extratags || {}), [r.category]: r.type, name: r.namedetails?.name || r.name };
  if (parsed?.number && parsed.street) {
    tags['addr:housenumber'] = parsed.number;
    tags['addr:street'] = r.address?.road && addressMatches(parsed, r) ? r.address.road : parsed.street;
  }
  if (city) tags['addr:city'] = city;
  return tags;
}

// Kinds the import's classify() doesn't list but a researched candidate can
// be (a coffee roaster mapped as a shop, a music venue). [key, value, kind]
const EXTRA_KINDS = [
  ['shop', 'coffee', { category: 'food', topic: 'café', typicalMinutes: 30 }],
  ['shop', 'tea', { category: 'food', topic: 'tea shop', typicalMinutes: 30 }],
  ['shop', 'pastry', { category: 'food', topic: 'bakery', typicalMinutes: 20 }],
  ['shop', 'confectionery', { category: 'food', topic: 'dessert shop', typicalMinutes: 20 }],
  ['shop', 'chocolate', { category: 'food', topic: 'chocolate shop', typicalMinutes: 20 }],
  ['shop', 'ice_cream', { category: 'food', topic: 'ice cream shop', typicalMinutes: 20 }],
  ['shop', 'deli', { category: 'food', topic: 'deli', typicalMinutes: 30 }],
  ['shop', 'butcher', { category: 'food', topic: 'butcher shop', typicalMinutes: 20 }],
  ['shop', 'wine', { category: 'local-life', topic: 'wine shop', typicalMinutes: 30 }],
  ['shop', 'records', { category: 'local-life', topic: 'record store', typicalMinutes: 30 }],
  // Independent counters only: chains stay out (select.js isChain).
  ['amenity', 'fast_food', { category: 'food', topic: 'counter-service spot', typicalMinutes: 20 }],
  ['amenity', 'place_of_worship', { category: 'history-culture', topic: 'historic house of worship', typicalMinutes: 30 }],
  ['amenity', 'food_court', { category: 'food', topic: 'food hall', typicalMinutes: 60, checkInRadiusMeters: 150 }],
  ['amenity', 'music_venue', { category: 'entertainment', topic: 'music venue', typicalMinutes: 150 }],
  ['amenity', 'events_venue', { category: 'entertainment', topic: 'event venue', typicalMinutes: 150 }],
  ['amenity', 'concert_hall', { category: 'entertainment', topic: 'concert hall', typicalMinutes: 150 }],
  ['amenity', 'library', { category: 'history-culture', topic: 'library', typicalMinutes: 45 }],
  ['craft', 'brewery', { category: 'local-life', topic: 'brewery', typicalMinutes: 90 }],
  ['craft', 'winery', { category: 'local-life', topic: 'winery', typicalMinutes: 90 }],
  ['tourism', 'artwork', { category: 'art-museums', topic: 'public art', typicalMinutes: 15 }],
  ['leisure', 'recreation_ground', { category: 'parks-nature', topic: 'park', typicalMinutes: 45, checkInRadiusMeters: 300 }],
];
export const extraKind = (tags) => EXTRA_KINDS.find(([k, v]) => tags[k] === v)?.[2] || null;

// Opinion words the research prompt rules out beyond okWebFact's
// (transform.js); a fact with one stays out of these regions' packs.
export const OPINION = /\b(legendary|renowned|acclaimed|celebrated|hidden gem|cozy|amazing|beautiful|charming|award-winning|world-class|vibrant|perfect|incredible|exceptional|unique|top-notch|cult|beloved|quintessential)\b/i;

// Several OSM objects can carry the name at the address (a restaurant node in
// its building way): the listed kind first, then the one Nominatim ranks higher.
const KIND_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic', 'natural', 'craft', 'man_made'];
const rankOf = (r) => (KIND_KEYS.includes(r.category) ? 0 : 1);

// Picks the result that is this candidate, or says why none is.
// `geo` is the geocoded researched address ({lat, lng}) or null; `inArea(r)`
// says whether a result lies in the region (and names its town).
// Only things a place can be: not a stream, road, rail line or town that
// shares the name ("Stevens Creek" for Stevens Creek County Park). A
// building counts when its tags say it is historic or a sight.
export const placeLike = (r) =>
  KIND_KEYS.includes(r.category) ||
  (r.category === 'boundary' && r.type === 'protected_area') ||
  (r.category === 'building' && !!(r.extratags?.historic || r.extratags?.tourism || r.extratags?.heritage));

export function pickMatch(candidate, results, { geo = null, inArea = () => true } = {}) {
  const parsed = parseAddress(candidate.address);
  const named = results.filter((r) => placeLike(r) && nameMatches(candidate.name, r));
  if (!named.length) return { status: 'NOT_FOUND', why: results.length ? 'no OSM object with this name' : 'no OSM result' };
  const placed = named.filter((r) => addressMatches(parsed, r) || nearAddress(r, geo));
  if (!placed.length) return { status: 'NOT_FOUND', why: geo ? 'named OSM object not at the researched address' : 'researched address not found and OSM address differs' };
  const inside = placed.filter((r) => inArea(r));
  if (!inside.length) return { status: 'NOT_FOUND', why: 'outside the region' };
  const best = [...inside].sort((a, b) => rankOf(a) - rankOf(b) || (b.importance || 0) - (a.importance || 0))[0];
  return { status: 'FOUND', result: best, how: addressMatches(parsed, best) ? 'osm address' : 'within 75 m of the address' };
}

// Region tests for a Nominatim result: San Francisco's mainland shape and
// city; Silicon Valley's towns (by the address Nominatim gives) and
// downtown San Jose's drawn shape.
export function areaOf(region, r) {
  const a = r.address || {};
  const city = a.city || a.town || a.village || a.hamlet || a.municipality || '';
  const p = pointOf(r);
  if (region.id === 'sf') return city === 'San Francisco' && insideShape(p.lat, p.lng, region.shape) ? 'San Francisco' : null;
  if (region.id === 'kb') return insideShape(p.lat, p.lng, region.shape) ? region.areaOf(p.lat, p.lng) : null;
  if (region.id === 'sv') {
    const town = region.parts.find((t) => t.town && t.town === city);
    if (town) return town.name;
    const dt = region.parts.find((t) => t.shape);
    if (city === 'San Jose' && dt && insideShape(p.lat, p.lng, dt.shape)) return dt.name;
    return null;
  }
  return null;
}

// Nominatim's viewbox for a region: the bounding box of its shape.
export function viewbox(shape) {
  const lats = shape.map(([a]) => a);
  const lngs = shape.map(([, b]) => b);
  return [Math.min(...lngs), Math.max(...lats), Math.max(...lngs), Math.min(...lats)].join(',');
}

// The Overpass-style element stage.mjs reads, from a matched result.
export function elementOf(r, { candidate, town, city }) {
  const parsed = parseAddress(candidate.address);
  const tags = tagsOf(r, parsed, city);
  const el = { type: r.osm_type, id: Number(r.osm_id), lat: Number(r.lat), lon: Number(r.lon), tags, town };
  const kind = extraKind(tags);
  if (kind) el.kind = kind;
  return el;
}

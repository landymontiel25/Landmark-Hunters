// Turns OpenStreetMap elements (Overpass JSON, `out center tags`) into places
// in the catalog's landmark format. Pure functions only: fetch-osm.mjs pulls
// the data, build-packs.mjs writes the chunks. Every fact comes from an OSM
// tag or a Wikidata claim; nothing is written that the data doesn't say.

// The import shape (docs/miami-import/shape.png), read off the owner's Google
// Earth measurement: NW, NE, SE (Cape Florida), SW.
export const MIAMI_SHAPE = [
  [25.8054, -80.3215],
  [25.8076, -80.1271],
  [25.666, -80.157],
  [25.658, -80.3299],
];

export function insideShape(lat, lng, shape = MIAMI_SHAPE) {
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const [yi, xi] = shape[i];
    const [yj, xj] = shape[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// ---- What to pull ----------------------------------------------------------

export const COURT_SPORTS = ['pickleball', 'basketball', 'tennis', 'soccer'];
const SHOPS_OF_INTEREST = ['mall', 'department_store', 'books', 'music', 'art', 'antiques'];
const HISTORIC_KINDS = ['monument', 'memorial', 'building', 'castle', 'fort', 'ruins', 'ship', 'lighthouse', 'archaeological_site', 'manor', 'church'];

// Overpass QL for everything in the shape. `out center tags` gives ways and
// relations a single point.
export function overpassQuery(shape = MIAMI_SHAPE) {
  const poly = `poly:"${shape.map(([a, b]) => `${a} ${b}`).join(' ')}"`;
  const sel = [
    'nwr["amenity"~"^(restaurant|cafe|ice_cream|bar|pub|biergarten|nightclub|cinema|theatre|arts_centre|marketplace)$"]',
    'nwr["shop"~"^(bakery|' + SHOPS_OF_INTEREST.join('|') + ')$"]',
    'nwr["leisure"~"^(stadium|park|nature_reserve|garden|water_park)$"]',
    'nwr["leisure"~"^(pitch|sports_centre)$"]["sport"~"(' + COURT_SPORTS.join('|') + ')"]',
    'nwr["natural"="beach"]',
    'nwr["tourism"~"^(museum|gallery|attraction|zoo|aquarium|theme_park|viewpoint)$"]',
    'nwr["historic"~"^(' + HISTORIC_KINDS.join('|') + ')$"]',
    'nwr["man_made"="lighthouse"]',
    'nwr["aeroway"="aerodrome"]["iata"]',
  ];
  return `[out:json][timeout:180];\n(\n${sel.map((s) => `  ${s}(${poly});`).join('\n')}\n);\nout center tags;`;
}

// ---- Category and Mapr tag -------------------------------------------------
// Mapr's tags are the category ids in src/data/regions.js INTERESTS, so the
// category below is also the tag Mapr scores.

const CUISINE_LABEL = {
  american: 'American', argentinian: 'Argentinian', asian: 'Asian', bagel: 'bagel', barbecue: 'barbecue', bbq: 'barbecue',
  brazilian: 'Brazilian', breakfast: 'breakfast', brunch: 'brunch', burger: 'burger', caribbean: 'Caribbean', chicken: 'chicken',
  chinese: 'Chinese', coffee_shop: 'coffee', colombian: 'Colombian', crepe: 'crêpe', cuban: 'Cuban', dessert: 'dessert',
  dominican: 'Dominican', donut: 'donut', french: 'French', frozen_yogurt: 'frozen yogurt', german: 'German', greek: 'Greek',
  haitian: 'Haitian', honduran: 'Honduran', ice_cream: 'ice cream', indian: 'Indian', italian: 'Italian', jamaican: 'Jamaican',
  japanese: 'Japanese', juice: 'juice', korean: 'Korean', latin_american: 'Latin American', lebanese: 'Lebanese',
  mediterranean: 'Mediterranean', mexican: 'Mexican', middle_eastern: 'Middle Eastern', nicaraguan: 'Nicaraguan',
  peruvian: 'Peruvian', pizza: 'pizza', poke: 'poke', puerto_rican: 'Puerto Rican', ramen: 'ramen', salvadoran: 'Salvadoran',
  sandwich: 'sandwich', seafood: 'seafood', spanish: 'Spanish', steak_house: 'steak', sushi: 'sushi', tapas: 'tapas',
  tea: 'tea', thai: 'Thai', turkish: 'Turkish', vegan: 'vegan', vegetarian: 'vegetarian', venezuelan: 'Venezuelan',
  vietnamese: 'Vietnamese', bubble_tea: 'bubble tea', wings: 'wings', tacos: 'taco', fish: 'fish', hot_dog: 'hot dog',
  portuguese: 'Portuguese', 'tex-mex': 'Tex-Mex', austrian: 'Austrian', irish: 'Irish', european: 'European',
  indonesian: 'Indonesian', guatemalan: 'Guatemalan', columbia: 'Colombian', uruguay: 'Uruguayan', latin: 'Latin American',
  south_american: 'South American', new_american: 'New American', 'french-indonesian': 'French-Indonesian',
  latin_fusion: 'Latin fusion', asian_fusion: 'Asian fusion', health_food: 'health food', healthy_food: 'health food',
  smoothies: 'smoothie', open_fire: 'open-fire', bar_and_grill: 'bar and grill', frozen_yoghurt: 'frozen yogurt',
};

// Dishes read as plurals in a fact line ("Serves burgers", "Serves tacos").
const DISH_PLURAL = {
  burger: 'burgers', sandwich: 'sandwiches', bagel: 'bagels', donut: 'donuts', 'crêpe': 'crêpes', taco: 'tacos',
  'hot dog': 'hot dogs', pancake: 'pancakes', empanada: 'empanadas', kebab: 'kebabs', calzone: 'calzones', cake: 'cakes',
  smoothie: 'smoothies', salad: 'salads', fries: 'fries',
};

const VAGUE_CUISINE = new Set(['international', 'regional', 'local', 'fusion', 'fine dining', 'casual', 'other', 'oriental', 'lunch', 'grill', 'pub', 'bar and grill', 'open-fire']);

export function cuisines(tags) {
  return String(tags.cuisine || '')
    .split(';')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .map((c) => CUISINE_LABEL[c] || c.replace(/_/g, ' '));
}

const sportsOf = (tags) =>
  String(tags.sport || '')
    .split(';')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const SPORT_LABEL = { soccer: 'soccer', tennis: 'tennis', basketball: 'basketball', pickleball: 'pickleball' };

// Returns { category, topic, typicalMinutes, checkInRadiusMeters } or null
// when the element isn't something the app lists.
export function classify(tags) {
  const t = tags || {};
  const a = t.amenity;
  const firstCuisine = cuisines(t)[0];
  const eat = (noun) => (firstCuisine && !['coffee', 'ice cream', 'dessert'].includes(firstCuisine) ? `${firstCuisine} ${noun}` : noun);
  if (a === 'restaurant') return { category: 'food', topic: eat('restaurant'), typicalMinutes: 75 };
  if (a === 'cafe') return { category: 'food', topic: firstCuisine === 'Cuban' ? 'Cuban café' : 'café', typicalMinutes: 30 };
  if (a === 'ice_cream') return { category: 'food', topic: 'ice cream shop', typicalMinutes: 20 };
  if (t.shop === 'bakery') return { category: 'food', topic: 'bakery', typicalMinutes: 20 };
  if (a === 'marketplace') return { category: 'local-life', topic: 'market', typicalMinutes: 60, checkInRadiusMeters: 200 };
  if (a === 'bar' || a === 'pub' || a === 'biergarten') return { category: 'local-life', topic: a === 'pub' ? 'pub' : a === 'biergarten' ? 'beer garden' : 'bar', typicalMinutes: 90 };
  if (a === 'nightclub') return { category: 'local-life', topic: 'nightclub', typicalMinutes: 180 };
  if (t.shop === 'mall' || t.shop === 'department_store')
    return { category: 'local-life', topic: t.shop === 'mall' ? 'mall' : 'department store', typicalMinutes: 120, checkInRadiusMeters: t.shop === 'mall' ? 400 : 150 };
  if (SHOPS_OF_INTEREST.includes(t.shop)) {
    const topic = { books: 'bookstore', music: 'record store', art: 'art shop', antiques: 'antique shop' }[t.shop];
    return { category: 'local-life', topic, typicalMinutes: 30 };
  }
  if (a === 'cinema') return { category: 'entertainment', topic: 'movie theater', typicalMinutes: 150 };
  if (a === 'theatre') return { category: 'entertainment', topic: 'theater', typicalMinutes: 150 };
  if (t.tourism === 'zoo' || t.tourism === 'aquarium' || t.tourism === 'theme_park' || t.leisure === 'water_park') {
    const topic = { zoo: 'zoo', aquarium: 'aquarium', theme_park: 'theme park' }[t.tourism] || 'water park';
    return { category: 'entertainment', topic, typicalMinutes: 180, checkInRadiusMeters: 500 };
  }
  if (t.leisure === 'stadium') return { category: 'stadiums', topic: 'stadium', typicalMinutes: 180, checkInRadiusMeters: 400 };
  if (t.aeroway === 'aerodrome') return { category: 'airports', topic: 'airport', typicalMinutes: 120, checkInRadiusMeters: 1500 };
  if (t.leisure === 'pitch' || t.leisure === 'sports_centre') {
    const sport = sportsOf(t).find((s) => COURT_SPORTS.includes(s));
    if (!sport) return null;
    const noun = sport === 'soccer' ? 'soccer field' : `${SPORT_LABEL[sport]} ${t.leisure === 'sports_centre' ? 'center' : 'court'}`;
    return { category: 'sports', topic: noun, typicalMinutes: 75, checkInRadiusMeters: 150 };
  }
  if (t.natural === 'beach') return { category: 'parks-nature', topic: 'beach', typicalMinutes: 120, checkInRadiusMeters: 500 };
  if (t.leisure === 'nature_reserve') return { category: 'parks-nature', topic: 'nature preserve', typicalMinutes: 90, checkInRadiusMeters: 800 };
  if (t.leisure === 'garden') return { category: 'parks-nature', topic: 'garden', typicalMinutes: 60, checkInRadiusMeters: 250 };
  if (t.leisure === 'park') return { category: 'parks-nature', topic: 'park', typicalMinutes: 45, checkInRadiusMeters: 300 };
  if (t.tourism === 'viewpoint') return { category: 'parks-nature', topic: 'viewpoint', typicalMinutes: 20 };
  if (t.tourism === 'museum') return { category: 'art-museums', topic: 'museum', typicalMinutes: 90, checkInRadiusMeters: 200 };
  if (t.tourism === 'gallery' || a === 'arts_centre') return { category: 'art-museums', topic: a === 'arts_centre' ? 'arts center' : 'art gallery', typicalMinutes: 45 };
  if (t.man_made === 'lighthouse' || t.historic === 'lighthouse') return { category: 'history-culture', topic: 'lighthouse', typicalMinutes: 45 };
  if (HISTORIC_KINDS.includes(t.historic)) {
    if (t.historic === 'memorial' && ['plaque', 'stolperstein', 'blue_plaque', 'bench'].includes(t.memorial) && !t.wikidata) return null;
    const topic = { monument: 'monument', memorial: t.memorial === 'statue' ? 'statue' : 'memorial', fort: 'fort', ruins: 'ruins', ship: 'historic ship', church: 'historic church', archaeological_site: 'archaeological site' }[t.historic] || 'historic site';
    return { category: 'history-culture', topic, typicalMinutes: 30 };
  }
  if (t.tourism === 'attraction') return { category: 'history-culture', topic: 'attraction', typicalMinutes: 45 };
  return null;
}

// ---- Drops -----------------------------------------------------------------

const LIFECYCLE = /^(disused|abandoned|was|demolished|removed|razed|destroyed|closed):/;

// True when the element's own tags say it no longer operates.
export function isClosed(tags, now = new Date()) {
  const t = tags || {};
  if (Object.keys(t).some((k) => LIFECYCLE.test(k))) return true;
  if (['yes'].includes(t.disused) || ['yes'].includes(t.abandoned)) return true;
  if (/^\s*closed\s*$/i.test(t.opening_hours || '') || /^off$/i.test(t.opening_hours || '')) return true;
  if (/\((permanently )?closed\)|permanently closed/i.test(t.name || '')) return true;
  if (t.shop === 'vacant') return true;
  const end = String(t.end_date || '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (end) {
    const endMs = Date.UTC(Number(end[1]), Number(end[2] || 12) - 1, Number(end[3] || 28));
    if (endMs < now.getTime()) return true;
  }
  return false;
}

export const cleanName = (s) =>
  String(s || '')
    .replace(/[«»]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—,.]+$/, '')
    .trim();

// A name that is only a generic word says nothing about which place it is.
export const GENERIC_NAME = /^(street art|auditorium|war|stadium court|viewpoint(?: p?\d+)?|park|playground|garden|museum|gallery|beach|monument|memorial|statue|fountain)$/i;

// Discount and big-box chains are not "shops of interest".
export const CHAIN_STORES = /^(ross|ross dress for less|burlington|marshalls|tj ?maxx|t\.j\. maxx|homegoods|target|walmart|sears|jcpenney|j\. ?c\. penney|kohl'?s|duty free americas|big lots|dollar tree|family dollar)$/i;

// ---- Hours -----------------------------------------------------------------
// The app's closed-now check (src/lib/nearbyPicks.js isClosedNow) reads
// "Mon–Fri 11am–10pm; Sat 10am–11pm; Sun closed". Simple OSM schedules are
// rewritten into that; anything with holidays, months, weeks, sunrise or
// comments is left out rather than risk marking an open place closed.

const DAYS = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };

function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === 24 && m === 0) return 'midnight';
  if (h > 24 || m > 59) return null;
  const hour = h % 24;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

export function osmHoursToApp(raw) {
  const oh = String(raw || '').trim();
  if (!oh) return null;
  if (oh === '24/7') return 'Open 24 hours';
  const out = [];
  for (const part of oh.split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(off|closed|\d{2}:\d{2}-\d{2}:\d{2}(?:,\d{2}:\d{2}-\d{2}:\d{2})*)$/);
    if (!m) return null;
    const days = m[1].split(',').map((d) => d.split('-').map((x) => DAYS[x]).join('–')).join(', ');
    if (/^(off|closed)$/.test(m[2])) {
      out.push(`${days} closed`);
      continue;
    }
    const ranges = m[2].split(',').map((r) => {
      const [a, b] = r.split('-');
      const ca = clock(a);
      const cb = clock(b);
      return ca && cb ? `${ca}–${cb}` : null;
    });
    if (ranges.some((r) => !r)) return null;
    // One range per segment: the app's parser reads the first range only.
    for (const r of ranges) out.push(`${days} ${r}`);
  }
  return out.length ? out.join('; ') : null;
}

// ---- Facts and summary ------------------------------------------------------

const yearOf = (v) => {
  const m = String(v || '').match(/^(?:~|before |after )?(\d{4})(?:-\d{2}(?:-\d{2})?)?$/);
  const y = m ? Number(m[1]) : NaN;
  return y >= 1500 && y <= new Date().getUTCFullYear() ? y : null;
};

const listJoin = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// One short line per fact the tags state outright.
export function factsFromTags(tags, category) {
  const t = tags || {};
  const f = [];
  if (category === 'food' || category === 'local-life') {
    // "Cuban" is a cuisine ("Serves Cuban food"); "pizza" is a dish ("Serves pizza").
    const cs = cuisines(t).filter((c) => !VAGUE_CUISINE.has(c)).slice(0, 3);
    const styles = cs.filter((c) => /^[A-Z]/.test(c));
    const dishes = cs.filter((c) => !/^[A-Z]/.test(c)).map((c) => DISH_PLURAL[c] || c);
    if (styles.length) f.push(`Serves ${listJoin(styles)} food${dishes.length ? `, plus ${listJoin(dishes)}` : ''}`);
    else if (dishes.length) f.push(`Serves ${listJoin(dishes)}`);
  }
  const year = yearOf(t.start_date) || yearOf(t.opening_date);
  if (year) f.push(category === 'parks-nature' ? `Established in ${year}` : category === 'history-culture' ? `Dates from ${year}` : `Opened in ${year}`);
  if (t.architect) f.push(`Designed by ${cleanName(t.architect)}`);
  if (t['heritage:operator'] === 'nrhp' || t['ref:nrhp']) f.push('Listed on the U.S. National Register of Historic Places');
  const capacity = Number(String(t.capacity || '').replace(/,/g, ''));
  if (category === 'stadiums' && capacity >= 100) f.push(`Seats ${capacity.toLocaleString('en-US')}`);
  if (t.amenity === 'cinema' && Number(t.screen) > 0) f.push(`Has ${Number(t.screen)} screen${Number(t.screen) === 1 ? '' : 's'}`);
  if (category === 'sports') {
    const sports = sportsOf(t).filter((s) => COURT_SPORTS.includes(s));
    if (sports.length > 1) f.push(`Set up for ${listJoin(sports)}`);
    if (t.surface) f.push(`${cap(t.surface.replace(/_/g, ' '))} surface`);
    if (t.lit === 'yes') f.push('Lit for night play');
  }
  if (t.brand) f.push(`Part of the ${cleanName(t.brand).replace(/^the\s+/i, '')} chain`);
  if (t.operator && !t.brand) f.push(`Run by ${cleanName(t.operator)}`);
  if (t.outdoor_seating === 'yes') f.push('Has outdoor seating');
  if (t['diet:vegan'] === 'only') f.push('Fully vegan menu');
  else if (t['diet:vegetarian'] === 'only') f.push('Fully vegetarian menu');
  else if (t['diet:vegan'] === 'yes') f.push('Has vegan options');
  else if (t['diet:vegetarian'] === 'yes') f.push('Has vegetarian options');
  if (t.takeaway === 'only') f.push('Takeout only');
  if (t.delivery === 'yes') f.push('Offers delivery');
  if (t.reservation === 'required') f.push('Reservations required');
  else if (t.reservation === 'yes' || t.reservation === 'recommended') f.push('Takes reservations');
  if (t.live_music === 'yes') f.push('Hosts live music');
  if (t.microbrewery === 'yes') f.push('Brews its own beer');
  if (t.drive_through === 'yes') f.push('Has a drive-through');
  if (t.internet_access === 'wlan' || t.internet_access === 'yes') f.push('Has Wi-Fi');
  if (t.dog === 'leashed') f.push('Dogs allowed on a leash');
  else if (t.dog === 'yes') f.push('Dogs allowed');
  else if (t.dog === 'no') f.push('No dogs allowed');
  if (t.wheelchair === 'yes') f.push('Wheelchair accessible');
  if (t.opening_hours === '24/7') f.push('Open 24 hours');
  return [...new Set(f)];
}

// Facts from Wikidata claims (entity JSON from wbgetentities, plus the labels
// of entities it points to). Only claims with a plain, checkable meaning.
export function factsFromWikidata(entity, labels = {}, category = null) {
  if (!entity?.claims) return [];
  const f = [];
  const vals = (p) => (entity.claims[p] || []).filter((c) => c.rank !== 'deprecated').map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
  const year = (p) => {
    const v = vals(p)[0];
    const m = String(v?.time || '').match(/^\+(\d{4})-/);
    return m && v.precision >= 9 ? Number(m[1]) : null;
  };
  const label = (v) => (v?.id && labels[v.id]) || null;
  const opened = year('P1619');
  const founded = year('P571');
  if (opened) f.push(`Opened in ${opened}`);
  else if (founded) f.push(category === 'parks-nature' ? `Established in ${founded}` : `Founded in ${founded}`);
  const architects = vals('P84').map(label).filter(Boolean);
  if (architects.length) f.push(`Designed by ${listJoin(architects.slice(0, 2))}`);
  const capacity = Number(vals('P1083')[0]?.amount);
  if (category === 'stadiums' && capacity >= 100) f.push(`Seats ${Math.round(capacity).toLocaleString('en-US')}`);
  const occupants = vals('P466').map(label).filter(Boolean);
  if (occupants.length) f.push(`Home of ${listJoin(occupants.slice(0, 3))}`);
  const named = vals('P138').map(label).filter(Boolean);
  if (named.length) f.push(`Named after ${named[0]}`);
  for (const v of vals('P1435').slice(0, 2)) {
    if (v.id === 'Q19558910') f.push('Listed on the U.S. National Register of Historic Places');
    else if (label(v)) f.push(`Designated: ${label(v)}`);
  }
  return f;
}

export function summaryFor(tags, topic) {
  const t = tags || {};
  const desc = cleanName(t.description);
  if (desc && desc.length >= 20 && desc.length <= 200 && /^[\x20-\x7E’–—éñáíóú]+$/.test(desc)) return /[.!?]$/.test(desc) ? desc : `${desc}.`;
  const street = cleanName(t['addr:street']);
  const city = cleanName(t['addr:city']);
  const where = street ? ` on ${street}` : city ? ` in ${city}` : '';
  return `${cap(topic)}${where}${street && city ? `, ${city}` : ''}.`;
}

// ---- Element -> place --------------------------------------------------------

const TYPE_LETTER = { node: 'n', way: 'w', relation: 'r' };

export function coordsOf(el) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null;
}

// `wikidataFacts` is the already-rendered list for this element (or []).
export function toPlace(el, { region = 'miami', wikidataFacts = [] } = {}) {
  const t = el.tags || {};
  const kind = classify(t);
  const pos = coordsOf(el);
  const name = cleanName(t.name);
  if (!kind || !pos || !name) return null;
  const fee = t.fee === 'no' ? true : t.fee === 'yes' ? false : null;
  const facts = [...new Set([...wikidataFacts, ...factsFromTags(t, kind.category)])].slice(0, 10);
  const place = {
    id: `osm-${TYPE_LETTER[el.type]}${el.id}`,
    popularity: (t.wikidata ? 2 : 0) + (t.wikipedia ? 1 : 0) + 1,
    name,
    region,
    lat: pos.lat,
    lng: pos.lng,
    categories: [kind.category],
    topic: kind.topic,
    summary: summaryFor(t, kind.topic),
    facts,
    images: [],
    free: fee,
    bookingUrl: null,
    typicalMinutes: kind.typicalMinutes,
    source: 'osm',
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
  if (kind.checkInRadiusMeters) place.checkInRadiusMeters = kind.checkInRadiusMeters;
  const hours = osmHoursToApp(t.opening_hours);
  if (hours) place.hours = hours;
  if (t.wikidata) place.wikidata = t.wikidata;
  if (t.website && /^https:\/\//.test(t.website)) place.website = t.website;
  return place;
}

// ---- Duplicates ----------------------------------------------------------------

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'on', 'de', 'la', 'le', 'el', 'los', 'las', 'miami']);
export const nameKey = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .join(' ');

function sameName(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "Versailles Restaurant" vs "Versailles": one wholly inside the other.
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 6 && ` ${l} `.includes(` ${s} `);
}

// Words that only say where or what kind of place it is. "Panther Coffee
// Wynwood" is the catalog's "Panther Coffee"; "Sha Wynwood" is not the
// catalog's "Wynwood" neighborhood.
const GENERIC = new Set(
  ('restaurant cafe coffee bar grill kitchen bakery park parks museum gardens garden center centre theater theatre ' +
    'stadium arena beach hammock historic state market marketplace building college dade university hotel ' +
    'coral gables key biscayne little havana coconut grove brickell wynwood downtown south north west east city ' +
    'shops shop mall bookstore books store').split(' ')
);

// Is this OSM place the catalog landmark `catalogName`? The catalog often
// names a place more fully ("Nu Stadium at Miami Freedom Park"), so an OSM
// name inside it counts. An OSM name that wraps a catalog name ("FPL Solar
// Amphitheater at Bayfront Park") counts only when the extra words are generic
// and both are the same kind of place ("Wynwood Kitchen & Bar" is a restaurant,
// not the Wynwood neighborhood).
export function isCatalogName(osmName, catalogName, sameKind = true) {
  const o = nameKey(osmName);
  const c = nameKey(catalogName);
  if (!o || !c) return false;
  if (o === c) return true;
  if (o.length >= 6 && ` ${c} `.includes(` ${o} `)) return true;
  const ct = c.split(' ');
  if (sameKind && ct.length >= 3 && ct.every((w) => ` ${o} `.includes(` ${w} `))) return true;
  if (sameKind && c.length >= 6 && ` ${o} `.includes(` ${c} `)) {
    const inside = new Set(c.split(' '));
    return o.split(' ').filter((w) => !inside.has(w)).every((w) => GENERIC.has(w));
  }
  return false;
}

// Catalog duplicates: the same place within 250 m (a big park's catalog pin
// can sit far from OSM's center), or exactly the same name within 400 m.
export function findCatalogDuplicate(place, catalog) {
  for (const l of catalog) {
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) continue;
    const d = distanceMeters(place.lat, place.lng, l.lat, l.lng);
    const sameKind = (l.categories || []).includes(place.categories?.[0]);
    if (d <= 250 && isCatalogName(place.name, l.name, sameKind)) return l;
    if (d <= 400 && nameKey(place.name) === nameKey(l.name)) return l;
  }
  return null;
}

// Within the import: the same place mapped twice (a node and a building way,
// or a pitch and its sports centre). Keeps the richer record.
export function dedupeImport(places) {
  const richness = (p) => p.facts.length + (p.wikidata ? 5 : 0) + (p.hours ? 1 : 0) + (p.osmUrl.includes('/node/') ? 0 : 0.5);
  const sorted = [...places].sort((a, b) => richness(b) - richness(a));
  const kept = [];
  const dropped = [];
  const grid = new Map();
  const cell = (lat, lng) => `${Math.round(lat * 200)}:${Math.round(lng * 200)}`;
  for (const p of sorted) {
    const [ci, cj] = cell(p.lat, p.lng).split(':').map(Number);
    let dup = null;
    for (let di = -1; di <= 1 && !dup; di++)
      for (let dj = -1; dj <= 1 && !dup; dj++)
        for (const q of grid.get(`${ci + di}:${cj + dj}`) || [])
          if (q.categories[0] === p.categories[0] && sameName(p.name, q.name) && distanceMeters(p.lat, p.lng, q.lat, q.lng) <= 150) {
            dup = q;
            break;
          }
    if (dup) {
      dropped.push({ place: p, keptId: dup.id });
      continue;
    }
    kept.push(p);
    const k = `${ci}:${cj}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return { kept, dropped };
}

// Runs the whole element list through the rules and says why each drop
// happened, for the final report.
export function importPlaces(elements, { catalog = [], region = 'miami', shape = MIAMI_SHAPE, wikidataFacts = {}, overrides = {}, now = new Date() } = {}) {
  const dropped = { noName: [], genericName: [], chainStore: [], closed: [], outside: [], notListed: [], reviewed: [], duplicateInImport: [], duplicateOfCatalog: [] };
  const candidates = [];
  for (const el of elements || []) {
    const t = el.tags || {};
    const pos = coordsOf(el);
    const label = `${el.type}/${el.id}`;
    if (!classify(t)) {
      dropped.notListed.push(label);
      continue;
    }
    if (!cleanName(t.name)) {
      dropped.noName.push({ id: label, kind: classify(t).topic });
      continue;
    }
    if (!pos || !insideShape(pos.lat, pos.lng, shape)) {
      dropped.outside.push({ id: label, name: t.name });
      continue;
    }
    if (isClosed(t, now)) {
      dropped.closed.push({ id: label, name: t.name });
      continue;
    }
    if (GENERIC_NAME.test(cleanName(t.name))) {
      dropped.genericName.push({ id: label, name: t.name });
      continue;
    }
    if (CHAIN_STORES.test(cleanName(t.brand || t.name)) && (t.shop === 'department_store' || t.shop === 'mall')) {
      dropped.chainStore.push({ id: label, name: t.name });
      continue;
    }
    const place = toPlace(el, { region, wikidataFacts: wikidataFacts[t.wikidata] || [] });
    if (!place) continue;
    const fix = overrides[place.id];
    if (fix?.drop) {
      dropped.reviewed.push({ id: label, name: place.name, why: fix.drop });
      continue;
    }
    if (fix?.category) place.categories = [fix.category];
    if (fix?.topic) {
      place.topic = fix.topic;
      place.summary = summaryFor(t, fix.topic);
    }
    candidates.push(place);
  }
  const { kept, dropped: dupes } = dedupeImport(candidates);
  dropped.duplicateInImport = dupes.map((d) => ({ id: d.place.id, name: d.place.name, keptId: d.keptId }));
  const places = [];
  for (const p of kept) {
    const existing = findCatalogDuplicate(p, catalog);
    if (existing) dropped.duplicateOfCatalog.push({ id: p.id, name: p.name, existing: `${existing.regionId || existing.region}/${existing.id}` });
    else places.push(p);
  }
  places.sort((a, b) => a.categories[0].localeCompare(b.categories[0]) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { places, dropped };
}

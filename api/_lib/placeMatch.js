// Finds the places a chat message names ("How do I get to Hillstone?"), so
// Mapr can answer with that place's card instead of plain text. Matching is
// by whole words: the full name, or the name without a leading "The" and
// trailing words like "Restaurant" or "Bar & Grill" when what's left is
// still distinctive.

const TRAILING = new Set([
  'restaurant', 'restaurants', 'cafe', 'coffee', 'bar', 'grill', 'kitchen', 'bistro', 'eatery', 'miami',
  'and', 'the', 'de', 'en', 'y', 'n', 'el', 'la',
]);
// Single words too ordinary to stand for one place ("a cuban place").
const COMMON = new Set([
  'corner', 'butcher', 'cuban', 'asian', 'madrid', 'sunrise', 'harbor', 'garden', 'gardens', 'island', 'market', 'social',
  'local', 'golden', 'little', 'havana', 'brickell', 'wynwood', 'downtown', 'midtown', 'gables', 'grove', 'coconut', 'doral',
  'kendall', 'design', 'district', 'biscayne', 'beach', 'south', 'north', 'square', 'station', 'central', 'garage',
  'chicken', 'counter', 'thank you', 'le petit', 'delicias',
]);

export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// The phrases a message has to contain for this place to count as named.
export function nameKeys(name) {
  const full = normName(name);
  const keys = full ? [full] : [];
  const words = full.split(' ');
  if (words[0] === 'the') words.shift();
  while (words.length > 1 && TRAILING.has(words[words.length - 1])) words.pop();
  const short = words.join(' ');
  // "Hillstone" from "Hillstone Restaurant"; never a short or everyday word.
  const distinctive = short.length >= 6 && !COMMON.has(short);
  if (short !== full && distinctive) keys.push(short);
  return keys;
}

const DIRECTIONS =
  /\b(how (do|can|would|should) (i|we) get (to|there)|directions?\b|take me to|navigate to|route to|how (far|long) (is it )?to|get me to|how to get to|where is|where's)\b/i;

export function asksForDirections(text) {
  return DIRECTIONS.test(String(text || ''));
}

function km(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Places whose name appears in `text`, best first: the longest matched
// phrase wins, then the nearest to `near` ({lat, lng}) when given.
function scored(text, places, near) {
  const hay = ` ${normName(text)} `;
  if (hay.trim().length < 3) return [];
  const hits = [];
  for (const l of places) {
    let key = '';
    for (const k of nameKeys(l.name)) if (k.length > key.length && hay.includes(` ${k} `)) key = k;
    if (!key) continue;
    const dist = near && Number.isFinite(l.lat) && Number.isFinite(l.lng) ? km(near.lat, near.lng, l.lat, l.lng) : Infinity;
    hits.push({ l, key, dist });
  }
  return hits.sort((a, b) => b.key.length - a.key.length || a.dist - b.dist);
}

export function placesNamedIn(text, places, { near = null, limit = 8 } = {}) {
  return scored(text, places, near)
    .slice(0, limit)
    .map((h) => h.l);
}

// The one place a directions question points at, or null when it's unclear:
// the message names two different places, the name it used also starts
// another place's name ("Biltmore" for the Biltmore Bar or Hotel), or a
// chain has several branches and there's no location to pick the nearest.
export function directionsTarget(text, places, near = null) {
  if (!asksForDirections(text)) return null;
  const hits = scored(text, places, near);
  if (!hits.length) return null;
  const top = normName(hits[0].l.name);
  const key = hits[0].key;
  const other = (l) => normName(l.name) !== top;
  if (hits.some((h) => other(h.l) && !` ${key} `.includes(` ${h.key} `))) return null;
  if (places.some((l) => other(l) && nameKeys(l.name).some((k) => k.startsWith(`${key} `)))) return null;
  const branches = hits.filter((h) => normName(h.l.name) === top);
  if (branches.length > 1 && !near) return null;
  return hits[0].l;
}

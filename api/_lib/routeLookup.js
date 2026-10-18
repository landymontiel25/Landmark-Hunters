import { timeoutSignal } from './upstream.js';

// Mapr chat's route_between tool (api/plan-ai.js): the REAL distance and
// travel time between two places, so Mapr never guesses one. Each place is
// found in the app's own catalog first, then with Google Places text search
// (biased to where the traveler is); the route comes from Google's Routes
// API (driving with live traffic, or walking). Any failure comes back as an
// error the model has to own up to, never a made-up number.

const ME = /^(me|my location|my current location|current location|here|where i am|where i'm at|my spot)$/i;
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const km = (a, b) => {
  const R = 6371;
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// A catalog place by name: an exact name first, then a name that contains
// the query (or the other way round), nearest to the traveler on ties.
export function findInCatalog(query, catalog = [], near = null) {
  const q = norm(query);
  if (q.length < 3) return null;
  const hits = catalog.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
  const exact = hits.filter((l) => norm(l.name) === q);
  const loose = exact.length ? exact : hits.filter((l) => {
    const n = norm(l.name);
    return n.length >= 4 && (n.includes(q) || q.includes(n));
  });
  if (!loose.length) return null;
  const best = near ? [...loose].sort((a, b) => km(near, a) - km(near, b))[0] : loose[0];
  return { name: best.name, lat: best.lat, lng: best.lng, address: best.address || '', source: 'catalog' };
}

async function googlePlace(query, near, fetchImpl) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const r = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
    body: JSON.stringify({
      textQuery: String(query).slice(0, 200),
      maxResultCount: 1,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {}),
    }),
  });
  if (!r.ok) return null;
  const p = (await r.json())?.places?.[0];
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name: p.displayName?.text || query, lat, lng, address: p.formattedAddress || '', source: 'google' };
}

export async function resolvePlace(query, { catalog = [], near = null, fetchImpl = fetch } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (ME.test(q)) return near ? { name: 'your location', lat: near.lat, lng: near.lng, address: '', source: 'gps' } : null;
  return findInCatalog(q, catalog, near) || (await googlePlace(q, near, fetchImpl));
}

export async function routeBetween({ from, to, mode = 'drive' } = {}, { catalog = [], near = null, fetchImpl = fetch } = {}) {
  const [a, b] = await Promise.all([resolvePlace(from, { catalog, near, fetchImpl }), resolvePlace(to, { catalog, near, fetchImpl })]);
  if (!a) return { error: ME.test(String(from || '').trim()) ? "The traveler's location isn't available." : `Couldn't find "${from}".` };
  if (!b) return { error: ME.test(String(to || '').trim()) ? "The traveler's location isn't available." : `Couldn't find "${to}".` };
  if (!process.env.GOOGLE_ROUTES_API_KEY) return { error: 'Route lookup is not set up.' };
  const travelMode = mode === 'walk' ? 'WALK' : 'DRIVE';
  const r = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode,
      ...(travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    }),
  });
  if (!r.ok) return { error: 'The route lookup failed.' };
  const route = (await r.json())?.routes?.[0];
  const meters = Number(route?.distanceMeters);
  const seconds = parseInt(route?.duration, 10);
  if (!Number.isFinite(meters) || !Number.isFinite(seconds)) return { error: 'No route found between those places.' };
  const noTraffic = parseInt(route?.staticDuration, 10);
  return {
    from: { name: a.name, address: a.address },
    to: { name: b.name, address: b.address },
    mode: travelMode === 'WALK' ? 'walking' : 'driving',
    miles: Math.round((meters / 1609.34) * 10) / 10,
    km: Math.round((meters / 1000) * 10) / 10,
    minutes: Math.max(1, Math.round(seconds / 60)),
    ...(travelMode === 'DRIVE' && Number.isFinite(noTraffic) ? { minutesWithoutTraffic: Math.max(1, Math.round(noTraffic / 60)) } : {}),
    source: 'Google Maps',
  };
}

// "How far / how long / how many minutes" questions: Mapr must look the
// route up before answering (plan-ai forces the tool for these). Tuned on
// mapr-synthetic-trainer/chat-facts: typos ("hw far") count, and "how long"
// only counts with a travel word, so "how long should I spend at the
// museum" or "how long does it take to set up a trip" don't.
const HOW = String.raw`(?:how|hw|hoe|hiw|hpw)`;
const TRAVEL_WORD = String.raw`(?:drive|driving|drives|walk|walking|ride|commute|by car|on foot|uber|lyft|taxi|cab|train|subway|bus|transit|bike|biking|from|get (?:to|there|from|back|home)|go (?:to|from)|head (?:to|over)|reach|eta)`;
const TRAVEL_PATTERNS = [
  new RegExp(String.raw`\b${HOW}\s+(?:far|close|near|farr|faar)\b`, 'i'),
  new RegExp(String.raw`\b${HOW}\s+(?:many|much)\s+(?:minutes?|mins?|miles?|mi|hours?|hrs?|km|kilometers?|time)\b[^?.!]*\b(?:to|from|away|between|get|drive|walk|until)\b`, 'i'),
  new RegExp(String.raw`\b${HOW}\s+(?:long|lng|lnog|logn)\b[^?.!]*\b${TRAVEL_WORD}\b`, 'i'),
  new RegExp(String.raw`\b${TRAVEL_WORD}\b[^?.!]*\b${HOW}\s+(?:long|far)\b`, 'i'),
  new RegExp(String.raw`\b\w[\w'&.-]*\s+to\s+[\w'&.-]+[^?.!]*\b${HOW}\s+long\b`, 'i'),
  new RegExp(String.raw`\b${HOW}\s+(?:quick|fast|soon)\s+can\s+(?:i|we|u|you)\s+(?:get|be|make it)\b`, 'i'),
  /\b(?:distance|drive time|driving time|travel time|walking time|walk time|commute|eta)\b/i,
  /\b(?:walkable|walking distance|can (?:i|we|u|you) walk|long walk|short walk|walk (?:to|from) )/i,
  /\b(?:minutes?|mins?|miles?|hours?|hrs?|km) (?:away|drive|walk|ride|from (?!now|today))/i,
  /\b(?:make it|get) (?:to|from|there)\b[^?.!]*\bin \d+\s*(?:min|mins|minutes|hours?|hrs?)\b/i,
  // "is X far", "is X close to Y", "is X nearby" -- not "is there a park nearby".
  /\b(?:is|are|isn'?t)\s+(?!there\b|any\b|anything\b|anywhere\b|something\b|somewhere\b)[^?!]{2,80}?\s(?:far|close|nearby|near me|close by|close to|far from|near)\b(?!\s+(?:me\s+)?(?:for|that|which|with)\b)/i,
];
export const asksDistanceOrTime = (text) => {
  const t = String(text || '');
  return TRAVEL_PATTERNS.some((re) => re.test(t));
};

// --- Mapr chat's place_hours tool: today's real hours from Google Places ----
const DAY_MS = 86400000;
function localClock(iso, offsetMin) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !Number.isFinite(offsetMin)) return null;
  const d = new Date(t + offsetMin * 60000);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

export async function placeHours({ place } = {}, { near = null, fetchImpl = fetch, now = Date.now() } = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const q = String(place || '').trim();
  if (!q) return { error: 'No place given.' };
  if (!key) return { error: 'Hours lookup is not set up.' };
  const r = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.currentOpeningHours,places.utcOffsetMinutes,places.businessStatus',
    },
    body: JSON.stringify({
      textQuery: q.slice(0, 200),
      maxResultCount: 1,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {}),
    }),
  });
  if (!r.ok) return { error: 'The hours lookup failed.' };
  const p = (await r.json())?.places?.[0];
  if (!p) return { error: `Couldn't find "${q}".` };
  const name = p.displayName?.text || q;
  const address = p.formattedAddress || '';
  if (p.businessStatus === 'CLOSED_PERMANENTLY') return { name, address, permanentlyClosed: true, source: 'Google Maps' };
  if (p.businessStatus === 'CLOSED_TEMPORARILY') return { name, address, temporarilyClosed: true, source: 'Google Maps' };
  const h = p.currentOpeningHours;
  if (!h) return { name, address, error: 'Google has no hours listed for this place.' };
  const off = Number(p.utcOffsetMinutes);
  // weekdayDescriptions starts on Monday.
  const dow = Number.isFinite(off) ? new Date(now + off * 60000).getUTCDay() : null;
  const today = dow == null ? null : h.weekdayDescriptions?.[(dow + 6) % 7] || null;
  return {
    name,
    address,
    openNow: h.openNow === true,
    today,
    ...(h.openNow && h.nextCloseTime ? { closesAt: localClock(h.nextCloseTime, off) } : {}),
    ...(!h.openNow && h.nextOpenTime ? { opensAt: localClock(h.nextOpenTime, off), opensAtIsToday: Date.parse(h.nextOpenTime) - now < DAY_MS && localClock(h.nextOpenTime, off) != null } : {}),
    source: 'Google Maps',
  };
}

// --- Mapr chat's best_order tool: the fastest order for a day's stops -------
// One Route Matrix call gets every leg's real time; with up to 7 stops every
// order is tried, so the answer is the true fastest, not a guess.
function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

export async function bestOrder({ stops = [], start = 'my location', end = '', mode = 'drive' } = {}, { catalog = [], near = null, fetchImpl = fetch } = {}) {
  const names = (Array.isArray(stops) ? stops : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 7);
  if (names.length < 2) return { error: 'Need at least two stops to order.' };
  const startQ = String(start || '').trim();
  const endQ = String(end || '').trim();
  const places = await Promise.all([startQ, ...names, ...(endQ ? [endQ] : [])].map((q) => (q ? resolvePlace(q, { catalog, near, fetchImpl }) : null)));
  const startP = startQ ? places[0] : null;
  if (startQ && !startP) return { error: ME.test(startQ) ? "The traveler's location isn't available." : `Couldn't find "${startQ}".` };
  const stopP = places.slice(1, 1 + names.length);
  const missing = names.filter((_, i) => !stopP[i]);
  if (missing.length) return { error: `Couldn't find ${missing.map((m) => `"${m}"`).join(', ')}.` };
  const endP = endQ ? places[places.length - 1] : null;
  if (endQ && !endP) return { error: `Couldn't find "${endQ}".` };
  if (!process.env.GOOGLE_ROUTES_API_KEY) return { error: 'Route lookup is not set up.' };

  const all = [...(startP ? [startP] : []), ...stopP, ...(endP ? [endP] : [])];
  const wp = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
  const travelMode = mode === 'walk' ? 'WALK' : 'DRIVE';
  const r = await fetchImpl('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    signal: timeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition' },
    body: JSON.stringify({
      origins: all.map(wp),
      destinations: all.map(wp),
      travelMode,
      ...(travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    }),
  });
  if (!r.ok) return { error: 'The route lookup failed.' };
  const rows = await r.json();
  const cell = {};
  for (const e of Array.isArray(rows) ? rows : []) {
    const sec = parseInt(e.duration, 10);
    if (e.condition && e.condition !== 'ROUTE_EXISTS') continue;
    if (Number.isFinite(sec) && Number.isFinite(Number(e.distanceMeters))) cell[`${e.originIndex}>${e.destinationIndex}`] = { sec, m: Number(e.distanceMeters) };
  }
  const offset = startP ? 1 : 0;
  const idx = stopP.map((_, i) => i + offset);
  const endIdx = endP ? all.length - 1 : null;
  let best = null;
  for (const order of permutations(idx)) {
    const seq = [...(startP ? [0] : []), ...order, ...(endIdx != null ? [endIdx] : [])];
    let sec = 0;
    let ok = true;
    for (let i = 1; i < seq.length && ok; i++) {
      const c = cell[`${seq[i - 1]}>${seq[i]}`];
      if (!c) ok = false;
      else sec += c.sec;
    }
    if (ok && (!best || sec < best.sec)) best = { seq, sec };
  }
  if (!best) return { error: 'No route found between those places.' };
  const leg = (a, b) => {
    const c = cell[`${a}>${b}`];
    return {
      from: { name: all[a].name, address: all[a].address || '' },
      to: { name: all[b].name, address: all[b].address || '' },
      mode: travelMode === 'WALK' ? 'walking' : 'driving',
      miles: Math.round((c.m / 1609.34) * 10) / 10,
      km: Math.round((c.m / 1000) * 10) / 10,
      minutes: Math.max(1, Math.round(c.sec / 60)),
    };
  };
  const legs = best.seq.slice(1).map((b, i) => leg(best.seq[i], b));
  const totalM = legs.reduce((s, l) => s + l.km * 1000, 0);
  return {
    order: best.seq.filter((i) => i >= offset && i < offset + stopP.length).map((i) => all[i].name),
    legs,
    totalMiles: Math.round((totalM / 1609.34) * 10) / 10,
    totalKm: Math.round((totalM / 1000) * 10) / 10,
    totalMinutes: legs.reduce((s, l) => s + l.minutes, 0),
    mode: travelMode === 'WALK' ? 'walking' : 'driving',
    source: 'Google Maps',
  };
}

// Every route-like result a reply can quote: single routes, a day's legs and
// its total.
export function routesFrom(results = []) {
  const out = [];
  for (const r of results) {
    if (!r || r.error) continue;
    if (Number.isFinite(r.miles)) out.push(r);
    if (Array.isArray(r.legs)) {
      out.push(...r.legs);
      out.push({ from: { name: 'Start' }, to: { name: 'last stop' }, mode: r.mode, miles: r.totalMiles, km: r.totalKm, minutes: r.totalMinutes });
    }
  }
  return out;
}

// "Is X open?", "what time does X close", "X hours today": Mapr must check
// Google's live hours first (plan-ai forces place_hours for these).
export const asksHours = (text) =>
  /\b(?:is|are|r)\b[^?.!]{1,80}\b(?:open|closed)\b(?!\s+(?:to|for|source|minded|up|mic)\b)|\bwhat time (?:does|do|is|will)\b[^?.!]*\b(?:open|close|closing|opening)\b|\bwhen (?:does|do|is|will)\b[^?.!]*\b(?:open|close|closing|opening)\b|\bhours\b(?![^?.!]*\b(?:to kill|away|drive|walk|ago)\b)(?<!\d\s*hours)|\bstill open\b|\bhow late\b|\bopen (?:now|today|tonight|tomorrow|late|right now)\b|\bclos(?:e|es|ing) (?:soon|at|today|tonight|early)\b/i.test(
    String(text || '')
  );

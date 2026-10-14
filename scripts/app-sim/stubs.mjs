// Canned answers for everything the app asks outside its own origin, so a
// simulated session runs offline and never reaches a real service or key:
//
// - /api/* (the Vercel functions; `vite preview` does not serve them).
//   Shapes follow the real handlers in api/. Server-only Firestore writes
//   (ensure-solo-streak) go to the emulator with the emulator's owner token.
// - Map tiles, Wikimedia photos, Nominatim, Google, fonts: tiny local
//   answers.
//
// Each stub draws from the session's seeded RNG, so a run repeats.
import { REGIONS } from '../../src/data/regions.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
// Served on the app's origin between sessions: wipes what the last
// simulated user left on this origin.
const RESET_PAGE = `<!doctype html><title>reset</title><script>
(async () => {
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  try {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); })));
  } catch (e) {}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
  window.name = '';
  document.title = 'reset-done';
})();
</script>`;
const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-lh/databases/(default)/documents';

export const CATALOG = REGIONS.flatMap((r) =>
  r.landmarks
    .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
    .map((l) => ({ region: r.id, id: l.id, name: l.name, lat: l.lat, lng: l.lng, categories: l.categories || [], images: (l.images || []).slice(0, 1) }))
);
const byRegion = new Map();
for (const p of CATALOG) {
  if (!byRegion.has(p.region)) byRegion.set(p.region, []);
  byRegion.get(p.region).push(p);
}

function uidFromAuth(req) {
  const h = req.headers()['authorization'] || '';
  const tok = h.replace(/^Bearer\s+/i, '');
  const part = tok.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return payload.user_id || payload.sub || null;
  } catch {
    return null;
  }
}

function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsValue(x)])) } };
}
export const toFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsValue(v)]));

// Admin (rules-bypassing) write to the Firestore emulator.
export async function adminSet(path, data, { onlyIfMissing = false } = {}) {
  const q = onlyIfMissing ? '?currentDocument.exists=false' : '';
  const r = await fetch(`${FIRESTORE}/${path}${q}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  return r.status;
}

async function adminGet(path) {
  const r = await fetch(`${FIRESTORE}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (!r.ok) return null;
  return r.json();
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function json(route, status, body, delayMs = 0) {
  const send = () => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  if (delayMs) return new Promise((r) => setTimeout(r, delayMs)).then(send);
  return send();
}

const pick1 = (rng, list) => list[Math.floor(rng() * list.length)];

function pickN(rng, list, n) {
  const out = [];
  const copy = [...list];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}

const QUICK_REPLIES = ['More like this', 'Something cheaper', 'Plan my whole day', 'Anything open late?', 'Closer to me'];

function planAi(rng, body) {
  const regions = (body.regionIds || []).filter((id) => byRegion.has(id));
  const pool = regions.length ? regions.flatMap((id) => byRegion.get(id)) : byRegion.get('miami');
  const last = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
  const text = String(last?.content || '').toLowerCase();
  if (/\brate\b/.test(text)) return { reply: 'Tap any place below to rate it.', ratePicks: true, stops: [], quickReplies: [], actions: [], rate: null, cost: 0 };
  if (/^(hi|hello|hey|thanks|ok)\b/.test(text) || rng() < 0.15)
    return { reply: 'Happy to help. What are you in the mood for: food, a walk, a museum?', ratePicks: false, stops: [], quickReplies: pickN(rng, QUICK_REPLIES, 3), actions: [], rate: null, cost: 0 };
  const n = 1 + Math.floor(rng() * 4);
  const stops = pickN(rng, pool, n).map((p) => ({ region: p.region, id: p.id, name: p.name, images: p.images, categories: p.categories, lat: p.lat, lng: p.lng, reason: `${p.name} fits what you asked for.` }));
  // Now and then an outside place (no catalog id), like a web-search answer.
  if (rng() < 0.2) stops.push({ external: true, name: 'Corner Coffee Bar', address: '123 Main St', lat: pool[0].lat + 0.001, lng: pool[0].lng + 0.001, reason: 'A cafe a short walk away.' });
  const actions = [];
  const roll = rng();
  if (roll < 0.08) actions.push({ type: 'add_stop', stop: `${stops[0].region}/${stops[0].id}`, itinerary: 'new', newName: 'Sim day out' });
  else if (roll < 0.12) actions.push({ type: 'create_itinerary', name: 'Weekend plan', city: stops[0].region, group: rng() < 0.3 });
  else if (roll < 0.14) actions.push({ type: 'rename_itinerary', itinerary: '1', name: 'Renamed by Mapr' });
  return { reply: `Here are ${stops.length} places for you.`, ratePicks: false, stops, quickReplies: pickN(rng, QUICK_REPLIES, 2), actions, rate: null, cost: 0.01 };
}

function directions(rng, body) {
  const o = body.origin || { lat: 25.77, lng: -80.19 };
  const d = body.destination || { lat: 25.78, lng: -80.13 };
  const points = [];
  for (let i = 0; i <= 10; i += 1) points.push([o.lat + ((d.lat - o.lat) * i) / 10, o.lng + ((d.lng - o.lng) * i) / 10]);
  const steps = [
    { instruction: 'Head north on Main St', distanceMeters: 400, durationSeconds: 60, end: { lat: points[3][0], lng: points[3][1] }, maneuver: 'DEPART' },
    { instruction: 'Turn right onto 5th Ave', distanceMeters: 900, durationSeconds: 150, end: { lat: points[7][0], lng: points[7][1] }, maneuver: 'TURN_RIGHT' },
    { instruction: 'Arrive at destination', distanceMeters: 300, durationSeconds: 50, end: { lat: d.lat, lng: d.lng }, maneuver: 'ARRIVE' },
  ];
  return { mode: 'DRIVE', distanceMeters: 1600, durationSeconds: 260 + Math.floor(rng() * 300), staticDurationSeconds: 240, points, steps };
}

async function ensureSoloStreak(req, body) {
  const uid = uidFromAuth(req);
  if (!uid) return [401, { error: 'Sign in first.' }];
  const path = `streaks/${uid}`;
  const existing = await adminGet(path);
  const now = new Date();
  const data = {
    mode: 'solo',
    memberIds: [uid],
    memberNames: { [uid]: String(body.userName || 'Explorer').slice(0, 40) },
    cityId: null,
    count: 0,
    best: 0,
    lastCompletedDay: null,
    freezesLeft: 2,
    freezeMonth: monthKey(now),
    frozenDays: [],
    createdAt: now,
    updatedAt: now,
  };
  if (!existing) await adminSet(path, data, { onlyIfMissing: true });
  return [200, { id: uid, ...data, createdAt: null, updatedAt: null }];
}

// Returns a handler for context.route('**/*'). `stats` counts API calls.
export function makeRouter({ rng, base, stats, failRate = 0.03 }) {
  const origin = new URL(base).origin;
  return async (route) => {
    const req = route.request();
    let url;
    try {
      url = new URL(req.url());
    } catch {
      return route.abort().catch(() => {});
    }
    if (url.origin === origin && url.pathname === '/__sim_reset') return route.fulfill({ status: 200, contentType: 'text/html', body: RESET_PAGE }).catch(() => {});
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5);
      stats.api[name] = (stats.api[name] || 0) + 1;
      let body = {};
      try {
        body = req.postData() ? JSON.parse(req.postData()) : {};
      } catch {
        body = {};
      }
      // A small share of AI calls fail or run slow, as the real ones do.
      const flaky = ['plan-ai', 'smart-search', 'classify-interest', 'pick-reasons', 'directions'].includes(name);
      if (flaky && rng() < failRate) return json(route, 503, { error: 'The AI is busy right now — try again in a moment.' });
      const slow = flaky && rng() < 0.05 ? 2500 : 0;
      switch (name) {
        case 'plan-ai':
          return json(route, 200, planAi(rng, body), 200 + slow);
        case 'pick-reasons': {
          const reasons = {};
          for (const p of body.picks || body.places || []) {
            const k = p.key || (p.region && p.id ? `${p.region}/${p.id}` : null);
            if (k) reasons[k] = 'Close to places you rated highly.';
          }
          return json(route, 200, { reasons }, slow);
        }
        case 'smart-search': {
          const items = Array.isArray(body.items) ? body.items : [];
          const ids = pickN(rng, items, Math.min(5, items.length)).map((it) => String(it.id));
          if (body.catalog && rng() < 0.5) ids.push(...pickN(rng, CATALOG, 3).map((p) => `${p.region}/${p.id}`));
          return json(route, 200, { ids }, slow);
        }
        case 'classify-interest': {
          const matches = pickN(rng, CATALOG, 5).map((p) => `${p.region}/${p.id}`);
          return json(route, 200, { matches, emoji: '✨' }, slow);
        }
        case 'places-autocomplete': {
          const q = String(body.input || body.query || '').trim();
          if (!q) return json(route, 200, { suggestions: [] });
          return json(route, 200, {
            suggestions: [0, 1, 2].map((i) => ({ placeId: `ChIJsim${i}${q.length}`, primary: `${q} ${['Cafe', 'Park', 'Hotel'][i]}`, secondary: 'Miami, FL, USA' })),
          });
        }
        case 'places-details':
          return json(route, 200, { primary: 'Sim Place', secondary: '1 Sim St, Miami, FL', lat: 25.77 + rng() * 0.02, lng: -80.19 + rng() * 0.02 });
        case 'places-nearby':
          return json(route, 200, rng() < 0.5 ? { name: null } : { name: 'Corner Coffee Bar', address: '123 Main St', lat: body.lat, lng: body.lng, placeId: 'ChIJsimNearby' });
        case 'directions':
          return json(route, 200, directions(rng, body), slow);
        case 'landmark-ratings':
          return json(route, 200, { landmarkId: url.searchParams.get('id') || '', detail: null, sources: [], googleNoRating: true });
        case 'place-photo':
          return json(route, 200, { url: null, attributions: [] });
        case 'feed':
          if (url.searchParams.has('gate') || !url.searchParams.get('region')) return json(route, 200, { open: {} });
          return json(route, 200, { gateOpen: false, items: [] });
        case 'community':
          return json(route, 200, { regions: {} });
        case 'tips':
          if (req.method() === 'GET') {
            // Half the places have a tip or two from other visitors, some
            // with a long pasted link, as real tips do.
            const region = url.searchParams.get('region') || 'miami';
            const landmarkId = url.searchParams.get('landmarkId') || '';
            const n = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 2);
            const tips = Array.from({ length: n }, (_, i) => ({
              id: `simtip${i}${landmarkId.length}`,
              authorUid: `simAuthor${i}`,
              authorName: pick1(rng, ['Maria', 'Jon', 'Priya', 'A very long display name for a visitor']),
              landmarkId,
              region,
              text: rng() < 0.3 ? `Parking info here: https://example.com/${'p'.repeat(150)}` : 'Go early on weekdays; the line is short before 10.',
              tags: rng() < 0.5 ? ['timing'] : [],
              photoURL: null,
              visitMonth: '2026-09',
              verified: rng() < 0.7,
              counts: { helpful: Math.floor(rng() * 5), saved: 0 },
              mine: false,
            }));
            return json(route, 200, { tips, reactions: {} });
          }
          return json(route, 200, { ok: true, recorded: 0 });
        case 'post-tip':
          return json(route, 403, { error: 'Verify your email to share tips.', code: 'email' });
        case 'follow':
          return json(route, 403, { error: 'Verify your email to follow people.', code: 'unverified' });
        case 'regional-leaderboard':
        case 'reputation-board':
          return json(route, 200, { entries: [] });
        case 'verify-checkin':
          return json(route, 200, { ok: true, verified: rng() < 0.8, reason: null });
        case 'verify-landmark':
          return json(route, 200, { ok: true, reason: '', summary: 'A place added in the sim.', facts: ['Added by a simulated user'], free: true }, 300);
        case 'ensure-solo-streak': {
          const [status, out] = await ensureSoloStreak(req, body).catch(() => [500, { error: 'Could not load your streak.' }]);
          return json(route, status, out);
        }
        case 'close-solo-streak-day':
        case 'close-streak-day':
          // The app only asks once its own count says the day is done.
          return json(route, 200, { ok: true, closed: true, count: 1, best: 1 });
        case 'use-solo-streak-freeze':
        case 'use-streak-freeze':
          return json(route, 200, { ok: false, error: 'No freezes left this month.' });
        case 'reset-dual-streak':
          return json(route, 200, { ok: true });
        case 'complete-recovery-mission':
          return json(route, 200, { ok: false, error: 'No recovery mission open for this streak right now.' });
        case 'push-test':
          return json(route, 200, { ok: false, error: 'Nothing was sent.' });
        default:
          stats.unknownApi[name] = (stats.unknownApi[name] || 0) + 1;
          return json(route, 404, { error: 'Not found' });
      }
    }
    // The app itself and the emulators.
    if (url.origin === origin || url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue().catch(() => {});
    // Nominatim (reverse geocode / search).
    if (url.hostname.includes('nominatim')) {
      if (url.pathname.includes('reverse'))
        return json(route, 200, { display_name: 'Brickell, Miami, Florida, USA', address: { city: 'Miami', suburb: 'Brickell', state: 'Florida', country: 'United States', country_code: 'us' } });
      return json(route, 200, []);
    }
    const type = req.resourceType();
    if (type === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }).catch(() => {});
    if (type === 'stylesheet') return route.fulfill({ status: 200, contentType: 'text/css', body: '' }).catch(() => {});
    if (type === 'font') return route.fulfill({ status: 404, body: '' }).catch(() => {});
    if (type === 'script') return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }).catch(() => {});
    stats.external[url.hostname] = (stats.external[url.hostname] || 0) + 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => {});
  };
}

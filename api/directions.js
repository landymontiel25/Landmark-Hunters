import { isRateLimited } from './_lib/rateLimit.js';
import { withCors } from './_lib/cors.js';
import { timeoutSignal } from './_lib/upstream.js';

// Real turn-by-turn directions for the Itinerary screen's in-app route view
// (replaces having to open Apple/Google Maps to see the way there). Calls
// Google's Routes API (computeRoutes) server-side so GOOGLE_ROUTES_API_KEY
// never reaches the browser -- same pattern as places-autocomplete.js.

// Decodes Google's polyline encoding (the same algorithm Google's own
// client libraries use) into [lat, lng] pairs, so the client can draw the
// real road-following route without pulling in a decoding library.
function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// Routes API instructions can carry basic HTML, and put extra hints ("Pass
// by ...", "Toll road") on their own line -- flattened to one plain line.
const stripHtml = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\n\s*/g, ' · ')
    .trim();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
// null/"" would coerce to 0 and route from (0,0); out-of-range values make
// Google reject the call as a 502 instead of the caller's 400.
const toNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
const coord = (o) => {
  if (!o || typeof o !== 'object') return null;
  const lat = toNum(o.lat);
  const lng = toNum(o.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

const endPoint = (loc) => {
  const lat = num(loc?.latLng?.latitude);
  const lng = num(loc?.latLng?.longitude);
  return lat != null && lng != null ? [lat, lng] : null;
};

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.GOOGLE_ROUTES_API_KEY) {
    res.status(503).json({ error: 'Directions are not set up yet. Add GOOGLE_ROUTES_API_KEY in Vercel.' });
    return;
  }
  if (isRateLimited(req, 'directions', { limit: 30, windowMs: 60 * 1000 })) {
    res.status(429).json({ error: 'Too many requests in a row — slow down a bit.' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    res.status(400).json({ error: 'Invalid request body.' });
    return;
  }
  const origin = coord(body.origin);
  const destination = coord(body.destination);
  if (!origin || !destination) {
    res.status(400).json({ error: 'Missing or invalid origin/destination.' });
    return;
  }
  // Matches the walk/drive threshold routing.js already estimates travel
  // time with, so the in-app route mode agrees with the itinerary's own legs.
  const straightLineMeters = Math.round(
    6371000 *
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin(((destination.lat - origin.lat) * Math.PI) / 360) ** 2 +
            Math.cos((origin.lat * Math.PI) / 180) *
              Math.cos((destination.lat * Math.PI) / 180) *
              Math.sin(((destination.lng - origin.lng) * Math.PI) / 360) ** 2
        )
      )
  );
  const travelMode = body.mode === 'WALK' || body.mode === 'DRIVE' ? body.mode : straightLineMeters <= 1200 ? 'WALK' : 'DRIVE';

  try {
    const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      signal: timeoutSignal(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_ROUTES_API_KEY,
        // TRAFFIC_AWARE only applies (and only bills the traffic-aware
        // tier) for driving -- walking has no traffic to account for.
        'X-Goog-FieldMask':
          'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,' +
          'routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,' +
          'routes.legs.steps.endLocation',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode,
        ...(travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
      }),
    });
    if (!r.ok) {
      res.status(502).json({ error: 'Could not get directions right now.' });
      return;
    }
    const data = await r.json();
    const route = data?.routes?.[0];
    if (!route?.polyline?.encodedPolyline) {
      res.status(502).json({ error: 'No route found.' });
      return;
    }

    const steps = (route.legs || []).flatMap((leg) =>
      (leg.steps || []).map((s) => ({
        instruction: stripHtml(s.navigationInstruction?.instructions).slice(0, 200),
        distanceMeters: num(s.distanceMeters) || 0,
        // staticDuration comes back as e.g. "42s" -- traffic isn't broken
        // out per step, only for the route total below.
        durationSeconds: parseInt(s.staticDuration, 10) || 0,
        // Where the step ends (its maneuver point) and what kind of turn it
        // is -- what live navigation uses to know which step you're on.
        end: endPoint(s.endLocation),
        maneuver: String(s.navigationInstruction?.maneuver || '').slice(0, 40),
      }))
    );

    res.status(200).json({
      mode: travelMode,
      distanceMeters: num(route.distanceMeters) || straightLineMeters,
      // duration includes live traffic when driving; staticDuration is the
      // same trip with no traffic, so the UI can say how much traffic adds.
      durationSeconds: parseInt(route.duration, 10) || 0,
      staticDurationSeconds: parseInt(route.staticDuration, 10) || 0,
      points: decodePolyline(route.polyline.encodedPolyline),
      steps,
    });
  } catch {
    res.status(502).json({ error: 'Could not get directions right now.' });
  }
}

export default withCors(handler);

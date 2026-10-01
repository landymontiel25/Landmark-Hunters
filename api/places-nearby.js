import { isRateLimited } from './_lib/rateLimit.js';
import { withCors } from './_lib/cors.js';
import { timeoutSignal } from './_lib/upstream.js';

// Names the business at a GPS point -- the one piece the "you keep going
// here" habit prompt (src/lib/habitTracking.js) needs but doesn't have on
// its own: a cluster of visits is just coordinates until this says what's
// actually there. Google Places API (New) Nearby Search, a small radius
// and rankPreference: DISTANCE so this returns the place AT that point, not
// just the closest thing to it. Same Essentials-tier field mask discipline
// as places-details.js, so this never bills a higher SKU.
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: 'Address search is not set up yet. Add GOOGLE_PLACES_API_KEY in Vercel.' });
    return;
  }
  // Called at most a few times per cluster (a repeat visit doesn't re-look
  // itself up -- see habitTracking.js), so a tight limit is plenty.
  if (isRateLimited(req, 'places-nearby', { limit: 20, windowMs: 10 * 60 * 1000 })) {
    res.status(429).json({ error: 'Too many requests in a row — slow down a bit.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ error: 'Missing or invalid coordinates.' });
      return;
    }

    const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      signal: timeoutSignal(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.id',
      },
      body: JSON.stringify({
        maxResultCount: 1,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 35 } },
      }),
    });
    if (!r.ok) {
      res.status(502).json({ error: 'Could not identify that place.' });
      return;
    }
    const data = await r.json();
    const place = data.places?.[0];
    if (!place?.displayName?.text) {
      res.status(200).json({ name: null });
      return;
    }
    res.status(200).json({
      name: place.displayName.text,
      address: place.formattedAddress || '',
      lat: place.location?.latitude ?? lat,
      lng: place.location?.longitude ?? lng,
      placeId: place.id || '',
    });
  } catch {
    res.status(502).json({ error: 'Could not identify that place.' });
  }
}

export default withCors(handler);

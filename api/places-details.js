import { isRateLimited } from './_lib/rateLimit.js';
import { withCors } from './_lib/cors.js';
import { timeoutSignal } from './_lib/upstream.js';

// Resolves an autocomplete suggestion's placeId into the final name,
// address, and coordinates, once the user actually picks it -- kept to the
// Places API (New) Essentials SKU field mask (id, displayName,
// formattedAddress, location) so this never bills a higher tier.
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: 'Address search is not set up yet. Add GOOGLE_PLACES_API_KEY in Vercel.' });
    return;
  }
  if (isRateLimited(req, 'places-details', { limit: 60, windowMs: 60 * 1000 })) {
    res.status(429).json({ error: 'Too many requests in a row — slow down a bit.' });
    return;
  }

  const placeId = String(req.query?.placeId || '').trim();
  if (!placeId || !/^[\w-]+$/.test(placeId)) {
    res.status(400).json({ error: 'Missing or invalid placeId.' });
    return;
  }
  const sessionToken = req.query?.sessionToken ? String(req.query.sessionToken).slice(0, 100) : '';

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

    const r = await fetch(url, {
      signal: timeoutSignal(),
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
      },
    });
    if (!r.ok) {
      res.status(502).json({ error: 'Could not look up that address.' });
      return;
    }
    const data = await r.json();
    if (!data?.location) {
      res.status(502).json({ error: 'Could not look up that address.' });
      return;
    }

    res.status(200).json({
      primary: data.displayName?.text || data.formattedAddress || '',
      secondary: data.formattedAddress || '',
      lat: data.location.latitude,
      lng: data.location.longitude,
    });
  } catch {
    res.status(502).json({ error: 'Could not look up that address.' });
  }
}

export default withCors(handler);

import { isRateLimited } from './_lib/rateLimit.js';
import { withCors } from './_lib/cors.js';
import { timeoutSignal } from './_lib/upstream.js';

// Search-as-you-type address suggestions for the Add Landmark / Trip Setup
// location box, backed by Google Places API (New) Autocomplete. Proxied
// through this server function so GOOGLE_PLACES_API_KEY never reaches the
// client bundle. Returns only what the dropdown needs to render a row and
// resolve it later via places-details -- no Place Details call happens here.
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: 'Address search is not set up yet. Add GOOGLE_PLACES_API_KEY in Vercel.' });
    return;
  }
  if (isRateLimited(req, 'places-autocomplete', { limit: 60, windowMs: 60 * 1000 })) {
    res.status(429).json({ error: 'Too many searches in a row — slow down a bit.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const input = String(body.input || '').trim().slice(0, 200);
    if (!input) {
      res.status(200).json({ suggestions: [] });
      return;
    }
    const sessionToken = String(body.sessionToken || '').slice(0, 100);

    const payload = { input };
    if (sessionToken) payload.sessionToken = sessionToken;
    // A soft nudge toward the trip's region, same viewbox already used for
    // the local landmark catalog -- never a hard filter, so a real address
    // elsewhere still comes back.
    const viewbox = body.viewbox;
    if (
      viewbox &&
      Number.isFinite(viewbox.minLat) &&
      Number.isFinite(viewbox.minLng) &&
      Number.isFinite(viewbox.maxLat) &&
      Number.isFinite(viewbox.maxLng)
    ) {
      payload.locationBias = {
        rectangle: {
          low: { latitude: viewbox.minLat, longitude: viewbox.minLng },
          high: { latitude: viewbox.maxLat, longitude: viewbox.maxLng },
        },
      };
    }

    const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      signal: timeoutSignal(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      res.status(502).json({ error: 'Address search failed.' });
      return;
    }

    const data = await r.json();
    const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text || p.text?.text || '',
        secondary: p.structuredFormat?.secondaryText?.text || '',
      }))
      .filter((s) => s.placeId && s.primary);

    res.status(200).json({ suggestions });
  } catch {
    res.status(502).json({ error: 'Address search failed.' });
  }
}

export default withCors(handler);

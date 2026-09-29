import { fetchJson } from './friendlyError';
import { authHeaders } from './apiAuth';
import { composeTasteIntro } from './tasteQuestions';
import { API_BASE } from './apiBase';

// Once habitTracking.js has already spotted a habit and named the place
// (e.g. "you keep going to Dunkin' Donuts"), this asks ONE narrow question
// of the same AI trip-planner that already backs Mapr chat (/api/plan-ai):
// given what this traveler is into, is there something worth a stop near
// there, or on the way? Reuses plan-ai's existing web_search + taste-profile
// reasoning instead of building a second recommendation engine -- the only
// new thing here is the prompt, and it's asked at most as often as the
// habit prompt itself fires (roughly once a day, see habitTracking.js).
export async function findRelatedStop({ coords, placeName, myProfile, savedInterests, regionId }) {
  const message =
    `I'm heading to ${placeName} right now. Based on what I'm into, is there one real place near there, or on ` +
    `the way, worth a stop? Only suggest a place if you genuinely have a good match for my taste -- otherwise ` +
    `say there's nothing right now and suggest no stops.`;
  let data;
  try {
    data = await fetchJson(`${API_BASE}/api/plan-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        regionIds: regionId ? [regionId] : [],
        interests: savedInterests || [],
        tasteIntro: composeTasteIntro(myProfile),
        location: coords ? { lat: coords.lat, lng: coords.lng, label: placeName } : null,
        locationStatus: coords ? 'ok' : 'unavailable',
      }),
    });
  } catch {
    return null;
  }
  const [stop] = Array.isArray(data?.stops) ? data.stops : [];
  return stop || null;
}

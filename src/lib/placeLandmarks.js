import { ALL_LANDMARKS, getLandmark } from '../data/regions';
import { addCustomLandmark, getCustomLandmarks } from './customLandmarks';
import { distanceMeters, nearestAttributableRegionId } from './geo';
import { searchPlaces, getPlaceDetails, makeSessionToken } from './places';
import { authErrorMessage } from './authErrors';
import { auth } from './firebase';
import { fetchJson } from './friendlyError';
import { API_BASE } from './apiBase';

// An Error whose message was written for travelers, not developers.
function userError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

/**
 * Turns a place Google knows about (Places details: { primary, lat, lng })
 * into a real custom landmark you can check into and rate. verify-landmark
 * researches real facts/a photo for it or leaves them blank -- nothing is
 * invented. Needs a verified email (firestore.rules).
 */
export async function createLandmarkFromPlace({ details, fallbackName, trustedName, user, resendVerification }) {
  // trustedName wins outright: when the caller already has a real, specific
  // name for this exact place (Mapr's own web research, not derived from
  // this geocode), that beats whatever Places resolved -- a Places text
  // search sometimes matches the road/address the place sits on instead of
  // the business itself (e.g. "Pike Lanes" -> the "Pike" road nearby), and
  // trusting `details.primary` there silently renamed the landmark to the
  // street. Without a trustedName, keep the original priority (a Places
  // suggestion resolved via Details is more reliable than the raw
  // autocomplete text a caller might pass as fallbackName).
  const finalName = trustedName || details.primary || fallbackName;
  // Forced refresh: right after verifying their email, a cached token
  // still says unverified for up to an hour, and firestore.rules checks
  // the token's email_verified before accepting the new landmark.
  const idToken = await (auth.currentUser || user).getIdToken(true);
  let verified;
  try {
    verified = await fetchJson(`${API_BASE}/api/verify-landmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        name: finalName,
        categories: [],
        lat: details.lat,
        lng: details.lng,
        imageDataUrl: '',
        userFacts: [],
      }),
    });
  } catch (e) {
    if (e.code !== 'email-not-verified') throw e;
    verified = { code: e.code };
  }
  if (verified?.code === 'email-not-verified') {
    // Same recovery as Add Landmark: try to fire off a fresh link rather
    // than ask them to go dig up the original one.
    let resent = false;
    let resendErr = null;
    try {
      await resendVerification();
      resent = true;
    } catch (e) {
      resendErr = e;
    }
    throw userError(
      resent
        ? 'Verify your email first — we just sent a fresh link to your inbox (check spam too), then try again.'
        : `Verify your email first — check your inbox for the verification link we already sent you (check spam too), then try again. (Couldn't send another one: ${authErrorMessage(resendErr)})`
    );
  }
  if (!verified.ok) throw userError(verified.reason || "That doesn't look like a real place — try a different search.");

  // Leave it unattributed (shows as "Custom pin") rather than filing it
  // under the nearest curated city when nothing is actually nearby.
  const region = nearestAttributableRegionId(details.lat, details.lng);
  // Google's address result is often just the street address, not the
  // business name -- if the AI's research identifies the real place there,
  // save it under that real name instead.
  const savedName = verified.resolvedName || finalName;
  const created = await addCustomLandmark({
    region,
    name: savedName,
    lat: details.lat,
    lng: details.lng,
    userId: user.uid,
    categories: verified.category ? [verified.category] : [],
    images: verified.imageUrl ? [verified.imageUrl] : [],
    summary: verified.summary,
    facts: verified.facts,
    free: verified.free,
    typicalMinutes: verified.typicalMinutes || undefined,
    hours: verified.hours || null,
  });
  return { ...created, regionId: created.region };
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SAME_SPOT_METERS = 60;
const SAME_NAME_NEARBY_METERS = 50_000;

/**
 * The landmark to rate for a place Mapr heard you were just at: a catalog
 * landmark, a place someone already added, or -- for somewhere the app has
 * never seen -- a new custom landmark made from Google Places, the same
 * way "Rate a Landmark" adds one. `place` is { region, id } for a catalog
 * match or { name, address } otherwise.
 */
export async function landmarkForRating(place, { near, user, resendVerification }) {
  if (place.region && place.id) {
    const lm = getLandmark(place.region, place.id);
    if (lm) return { ...lm, regionId: place.region };
  }
  const customs = (await getCustomLandmarks().catch(() => [])).map((l) => ({ ...l, regionId: l.region, categories: l.categories || [] }));
  const isNear = (l) => !near || distanceMeters(near.lat, near.lng, l.lat, l.lng) <= SAME_NAME_NEARBY_METERS;
  const byName = [...ALL_LANDMARKS, ...customs].find((l) => norm(l.name) === norm(place.name) && isNear(l));
  if (byName) return byName;

  const query = [place.name, place.address].filter(Boolean).join(', ');
  const viewbox = near
    ? { minLat: near.lat - 0.4, maxLat: near.lat + 0.4, minLng: near.lng - 0.5, maxLng: near.lng + 0.5 }
    : null;
  const token = makeSessionToken();
  const [top] = await searchPlaces(query, viewbox ? { viewbox } : null, token);
  if (!top) throw userError(`Couldn't find "${place.name}" on the map. Try rating it from Profile → Rate a Landmark.`);
  const details = await getPlaceDetails(top.placeId, token);
  const sameSpot = customs.find((l) => distanceMeters(l.lat, l.lng, details.lat, details.lng) <= SAME_SPOT_METERS);
  if (sameSpot) return sameSpot;
  // place.name is already a real, specific name here (Mapr's own web
  // research recommending it, or naming the place it heard you just left),
  // not something derived from this geocode -- trust it over whatever
  // Places resolved (see createLandmarkFromPlace's trustedName).
  return createLandmarkFromPlace({ details, fallbackName: top.primary, trustedName: place.name, user, resendVerification });
}

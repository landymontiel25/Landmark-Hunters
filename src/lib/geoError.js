// Turns a geolocation failure (browser GeolocationPositionError, or whatever
// the Capacitor plugin rejects with) into a sentence a traveler can act on.
// The raw messages are developer text ("User denied Geolocation", "Timeout
// expired", "Network location provider at 'https://www.googleapis.com/' :
// ERR_INTERNET_DISCONNECTED.") and must never reach the screen.
export const LOCATION_DENIED_MESSAGE = 'Location is turned off for this app. Allow it in your settings to see what is near you.';
export const LOCATION_TIMEOUT_MESSAGE = "We couldn't get a location fix in time. Try again, ideally somewhere with a clearer view of the sky.";
export const LOCATION_UNAVAILABLE_MESSAGE = "We can't find your location right now. Check that location services are on and try again.";

export function isLocationDenied(err) {
  const code = err?.code;
  const msg = String(err?.message || '');
  return code === 1 || code === 'PERMISSION_DENIED' || /denied|not authorized|permission/i.test(msg);
}

export function friendlyGeoError(err) {
  if (isLocationDenied(err)) return LOCATION_DENIED_MESSAGE;
  const msg = String(err?.message || '');
  if (err?.code === 3 || /time(d)? ?out/i.test(msg)) return LOCATION_TIMEOUT_MESSAGE;
  return LOCATION_UNAVAILABLE_MESSAGE;
}

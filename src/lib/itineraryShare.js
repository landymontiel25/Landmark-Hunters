import { googleMapsMultiStopLegs } from './routing';

export const APP_URL = 'https://landmarkhunters.com';

// The text the itinerary's Share button sends: readable by anyone, app or
// not. The stops in order, then Google Maps links for the whole route (no
// starting point, so it opens from wherever the reader is), then the app.
export function itineraryShareText({ name, regionName, stops = [], mode = 'driving' }) {
  const title = name && name !== regionName ? `${name} (${regionName})` : `My ${regionName} trip`;
  const lines = [`\u{1F5FA}\u{FE0F} ${title}`, ...stops.map((s, i) => `${i + 1}. ${s.name}`)];
  const links = googleMapsMultiStopLegs(stops, null, mode).filter(Boolean);
  if (links.length === 1) lines.push('', `Route in Google Maps: ${links[0]}`);
  else if (links.length > 1) lines.push('', ...links.map((l, i) => `Route part ${i + 1} of ${links.length}: ${l}`));
  lines.push('', `Planned with Landmark Hunters: ${APP_URL}`);
  return lines.join('\n');
}

// Opens the phone's share sheet (texts, WhatsApp, email...), or copies the
// text where there is none. Closing the sheet is not an error.
export async function shareItinerary({ title, text, toast }) {
  try {
    if (navigator.share) await navigator.share({ title, text });
    else {
      await navigator.clipboard.writeText(text);
      toast?.show('Copied. Paste it in a text, email or anywhere.', { tone: 'success' });
    }
  } catch (e) {
    if (e?.name !== 'AbortError') toast?.show("Couldn't share that. Try again.");
  }
}

// Walking when every leg is short, else driving (same rule as the itinerary's
// own Google Maps buttons).
export const routeMode = (stops) => (stops.every((s, i) => i === 0 || !(s.distanceFromPrevMeters > 1200)) ? 'walking' : 'driving');

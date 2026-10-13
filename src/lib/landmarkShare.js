import { getRegion } from '../data/regions';

// What a place's Share button sends: readable by anyone, app or not. The
// place and its city, a line about it, a Google Maps link to it, and its
// page in the app. In the iOS app the origin is capacitor://localhost, which
// nobody else can open, so links always use the public site there.
export function landmarkShareUrl(regionId, id) {
  const origin =
    typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) ? window.location.origin : 'https://landmarkhunters.com';
  return `${origin}/#/landmarks/${regionId}/${id}`;
}

export function landmarkShareText(landmark, regionId) {
  const city = getRegion(regionId)?.name;
  const lines = [`\u{1F4CD} ${landmark.name}${city ? `, ${city}` : ''}`];
  if (landmark.summary) lines.push(landmark.summary);
  if (Number.isFinite(landmark.lat) && Number.isFinite(landmark.lng)) {
    lines.push('', `On the map: https://www.google.com/maps/search/?api=1&query=${landmark.lat},${landmark.lng}`);
  }
  return lines.join('\n');
}

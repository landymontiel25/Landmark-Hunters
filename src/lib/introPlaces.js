import { ALL_LANDMARKS, REGIONS } from '../data/regions';
import { distanceMeters } from './geo';

// The three landmarks the 5 images intro shows (owner, 2026-11-03): New
// York's Statue of Liberty, Central Park and Times Square, for everyone.
// (The owner first asked for the top three where the user is, then for these.)
export const INTRO_IDS = ['statue-of-liberty', 'central-park', 'times-square'];
const INTRO_REGION = 'nyc';

// Hand-picked photos (owner: zoomed-out Statue, a wintry Central Park,
// vibrant), saved in public/intro and lightly color-boosted, with the
// credit their licenses require (Wikimedia Commons).
export const INTRO_PHOTOS = {
  'statue-of-liberty': {
    // Clear blue sky, no clouds (owner, 2026-11-05), cropped to landscape; a
    // new file name so no browser keeps the old photo.
    url: '/intro/nyc-statue-clear-sky.jpg',
    credit: 'LostplanetKD73, CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Statue_of_Liberty_-_October_2024.jpg',
  },
  'central-park': {
    url: '/intro/nyc-central-park.jpg',
    credit: 'Tomás Fano, CC BY-SA 2.0',
    page: 'https://commons.wikimedia.org/wiki/File:Central_Park_Wollman_Rink.jpg',
  },
  'times-square': {
    url: '/intro/nyc-times-square.jpg',
    credit: 'chensiyuan, CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:1_times_square_night_2013.jpg',
  },
};

export function introPlaces({ landmarks = ALL_LANDMARKS } = {}) {
  return INTRO_IDS.map((id) => landmarks.find((l) => l.id === id && (l.regionId || l.region) === INTRO_REGION))
    .filter(Boolean)
    .map((l) => ({ ...l, introPhoto: INTRO_PHOTOS[l.id] || null }));
}

// Visiting order for Plan Less: start at the stop closest to the user (the
// first one without a location), then always the closest one left.
export function routeOrder(places, coords = null) {
  const left = [...places];
  if (!left.length) return [];
  const from = coords && Number.isFinite(coords.lat) ? coords : null;
  const pick = (p) => left.splice(left.indexOf(p), 1)[0];
  const closest = (to) => left.reduce((best, p) => (distanceMeters(to.lat, to.lng, p.lat, p.lng) < distanceMeters(to.lat, to.lng, best.lat, best.lng) ? p : best));
  const out = [pick(from ? closest(from) : left[0])];
  while (left.length) out.push(pick(closest(out[out.length - 1])));
  return out;
}

// The city a landmark is in, for the "Philadelphia" line on its card.
export function cityOf(l) {
  const r = REGIONS.find((x) => x.id === (l.regionId || l.region));
  return l.city || r?.city || r?.name || '';
}

// Short map labels: "Art Deco Historic District and Ocean Drive" -> "Art Deco Historic District".
export function shortName(name, max = 22) {
  let n = String(name || '')
    .split(/ \(| and | & |, /)[0]
    .trim();
  if (n.length > max) n = `${n.slice(0, max - 1).trimEnd()}…`;
  return n;
}

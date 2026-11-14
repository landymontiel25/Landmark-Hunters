// Test tab "Official Onboarding", step 10: Hometown Transition (owner,
// 2026-11-14). After sign-up, Mapr turns the trip planner into a daily
// companion at home: the home city's map with every place not visited yet
// in grey, a count in their own numbers, 3 picks near them from the same
// taste and category picks, and the daily loop. Nothing is saved.
import { ALL_LANDMARKS, INTERESTS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { cityName, tasteLabel } from './officialOnboardingSteps';

// The Test tab has no check-ins to count, so "been to" is a sample: the
// city's most visited places, as many as this. A real run counts the
// user's own check-ins in the city.
export const SAMPLE_VISITED = 12;
export const SAMPLE_STREAK = 3;
export const HOMETOWN_PICKS = 3;

const regionOf = (l) => l.regionId || l.region;
const HIDE_KINDS = new Set(['airports', 'benches']);
const near = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);
const pop = (a, b) => (b.popularity || 0) - (a.popularity || 0);

export const cityPlaces = (city, landmarks = ALL_LANDMARKS) =>
  city ? landmarks.filter((l) => city.regions.includes(regionOf(l)) && Number.isFinite(l.lat) && Number.isFinite(l.lng)) : [];

// The places they've "been to" in Test: the most popular ones.
export const visitedSample = (places, n = SAMPLE_VISITED) =>
  [...places].filter((l) => !HIDE_KINDS.has(l.categories?.[0])).sort(pop).slice(0, n);

// Where "near you" is measured from: where they are when that's in the
// city, else the middle of the places they've been to.
export function homeAnchor(places, visited, coords) {
  if (coords && Number.isFinite(coords.lat) && places.some((l) => near(l, coords) < 40000)) return { lat: coords.lat, lng: coords.lng, here: true };
  const from = visited.length ? visited : places;
  if (!from.length) return null;
  return { lat: from.reduce((s, l) => s + l.lat, 0) / from.length, lng: from.reduce((s, l) => s + l.lng, 0) / from.length, here: false };
}

// 3 places they haven't been to, near them, one per picked kind in turn
// (the same picks Official Onboarding collected in steps 3 and 4). Among the
// 40 best known places of a kind, the closest wins. With no picks, the
// closest well known places.
export function hometownPicks(places, visited, cats = [], anchor = null) {
  const seen = new Set(visited.map((l) => l.id));
  const all = places.filter((l) => !seen.has(l.id) && !HIDE_KINDS.has(l.categories?.[0]));
  const withPhoto = all.filter((l) => l.images?.length);
  const pool = withPhoto.length >= HOMETOWN_PICKS ? withPhoto : all;
  const dist = (l) => (anchor ? near(l, anchor) : 0);
  const closestOf = (list) => [...list].sort(pop).slice(0, 40).sort((a, b) => dist(a) - dist(b));
  const kinds = cats.length ? cats : [null];
  const out = [];
  const used = new Set();
  for (let round = 0; out.length < HOMETOWN_PICKS && round < HOMETOWN_PICKS; round++) {
    for (const k of kinds) {
      if (out.length >= HOMETOWN_PICKS) break;
      const pick = closestOf(pool.filter((l) => !used.has(l.id) && (!k || (l.categories || []).includes(k))))[0];
      if (!pick) continue;
      used.add(pick.id);
      out.push({ place: pick, kind: k, meters: anchor ? dist(pick) : null });
    }
  }
  // Too few places of the picked kinds: fill up with the closest others.
  for (const pick of closestOf(pool.filter((l) => !used.has(l.id)))) {
    if (out.length >= HOMETOWN_PICKS) break;
    used.add(pick.id);
    out.push({ place: pick, kind: null, meters: anchor ? dist(pick) : null });
  }
  return out;
}

export const pickReason = (kind) => (kind ? `Because you picked ${tasteLabel(kind).toLowerCase()}` : "Close to you, and you haven't been");
export const kindIcon = (kind) => INTERESTS.find((i) => i.id === kind)?.icon || '\u{1F4CD}';

// "You've only been to 12 of 1,059 places in Miami. You live here."
export const shockStat = (city, visited, total) =>
  `You've only been to ${visited.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} places in ${cityName(city)}. You live here.`;

export const HOMETOWN_SAY = [
  'We already convinced you to use it for your trips. You might as well just use it in your city now because you haven\'t visited everywhere in your city. I already know what you like — let me guess 3 places near you you\'d love.',
];

// The two lists one tap saves the picks to.
export const saveLists = (city) => [
  { id: 'tomorrow', label: `Tomorrow in ${cityName(city)}` },
  { id: 'week', label: 'This week at home' },
];

// The daily companion loop. Mapr only sends one of these when it has a real pick.
export function dailyLoop(firstPick, points) {
  return [
    { id: 'morning', when: 'Morning', what: 'Mapr picks 1 place near you for today.', sample: firstPick ? `Today: ${firstPick.name}. It's close, and it's your kind of place.` : 'Today: 1 place near you.' },
    { id: 'after', when: 'After you go', what: `Check in, +${points} points, Mapr celebrates.`, sample: firstPick ? `Checked in at ${firstPick.name}. +${points}. That's one more of your city.` : `Checked in. +${points}.` },
    { id: 'skip', when: 'If you skip a day', what: 'One nudge, with a pick in it.', sample: `Your streak is at ${SAMPLE_STREAK} days, don't break it — I found a spot for tomorrow.` },
  ];
}

export const QUIET_RULE = 'Mapr only messages when he has a real pick. No pick, no message.';

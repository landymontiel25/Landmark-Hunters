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

// At home you want somewhere to eat or drink more than a landmark (owner,
// 2026-11-14), so the 3 picks lead with a restaurant and a bar, then one of
// the kinds they picked in steps 3 and 4. Each pick is a place they haven't
// been to; among the 40 best known places of its kind, the closest wins.
// 'bar' is a slot of its own: Nightlife places that are bars, pubs or clubs.
export const HOME_SLOTS = ['food', 'bar'];
export const HOMETOWN_TITLE = '3 amazing places for tomorrow';
const BAR_TOPICS = new Set(['bar', 'pub', 'nightclub', 'biergarten', 'cocktail bar', 'wine bar']);
export const isBar = (l) => BAR_TOPICS.has(String(l.topic || '').toLowerCase()) || (!l.topic && (l.categories || []).includes('local-life'));
// The restaurant slot wants a real restaurant: not a café, bakery or ice
// cream shop.
export const isRestaurant = (l) => (l.categories || []).includes('food') && (!l.topic || /restaurant|diner/i.test(l.topic));
const fits = (l, kind) => (kind === 'bar' ? isBar(l) : kind === 'food' ? isRestaurant(l) : (l.categories || []).includes(kind));
// Chains (a name 3 or more times in the city, like Starbucks) are never a
// hometown pick: there's nothing to discover there.
export const isChain = (l) => (l.facts || []).some((f) => /\bchain\b/i.test(f));
export const isAcclaimed = (l) => (l.facts || []).some((f) => /\b202[56]\b/.test(f));
export function chainNames(places) {
  const n = {};
  for (const l of places) n[l.name] = (n[l.name] || 0) + 1;
  return new Set(Object.keys(n).filter((k) => n[k] >= 3));
}

export function hometownPicks(places, visited, cats = [], anchor = null) {
  const seen = new Set(visited.map((l) => l.id));
  const chains = chainNames(places);
  const all = places.filter((l) => !seen.has(l.id) && !HIDE_KINDS.has(l.categories?.[0]) && !chains.has(l.name) && !isChain(l));
  const withPhoto = all.filter((l) => l.images?.length);
  const pool = withPhoto.length >= HOMETOWN_PICKS ? withPhoto : all;
  const dist = (l) => (anchor ? near(l, anchor) : 0);
  const closestOf = (list) => [...list].sort(pop).slice(0, 40).sort((a, b) => dist(a) - dist(b));
  // A restaurant, a bar, then their own kinds (a kind already used comes last).
  const theirs = cats.filter((k) => !HOME_SLOTS.includes(k));
  const slots = [...HOME_SLOTS, ...(theirs.length ? theirs : cats), null];
  const out = [];
  const used = new Set();
  const take = (pick, kind) => {
    used.add(pick.id);
    out.push({ place: pick, kind, meters: anchor ? dist(pick) : null });
  };
  // Acclaimed places (a 2025 or 2026 award or list in their facts) come
  // first when a kind has any, so a pick is worth the trip.
  const researched = (list) => (list.some(isAcclaimed) ? list.filter(isAcclaimed) : list);
  for (const k of slots) {
    if (out.length >= HOMETOWN_PICKS) break;
    const pick = closestOf(researched(pool.filter((l) => !used.has(l.id) && (!k || fits(l, k)))))[0];
    if (pick) take(pick, k);
  }
  // Too few places of those kinds: fill up with the closest others.
  for (const pick of closestOf(pool.filter((l) => !used.has(l.id)))) {
    if (out.length >= HOMETOWN_PICKS) break;
    take(pick, null);
  }
  return out;
}

export const pickReason = (kind, cats = []) => {
  if (kind === 'bar') return cats.includes('local-life') ? 'A bar near you, and you picked nightlife' : 'A bar near you for tonight or tomorrow';
  if (kind === 'food') return cats.includes('food') ? 'A place to eat near you, and you picked food' : 'A place to eat near you';
  return kind ? `Because you picked ${tasteLabel(kind).toLowerCase()}` : "Close to you, and you haven't been";
};
export const kindIcon = (kind) => (kind === 'bar' ? '\u{1F378}' : INTERESTS.find((i) => i.id === kind)?.icon || '\u{1F4CD}');

// "12 of 1,059 places in Miami": the headline number on the screen.
export const shockStat = (city, visited, total) => `${visited.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} places in ${cityName(city)}`;

// Mapr on the Hometown Transition screen (owner, 2026-11-14): their real
// city and numbers, never "I guessed" or "let me guess".
export const hometownSay = (city, visited, total) => [
  `You already trust me with your trips (and I know what you like from those trips). You live in ${cityName(city)} and you've only been to ${visited.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} places here. At home it's less about landmarks, so here's somewhere to eat, somewhere to drink, and one more from what you picked.`,
];

// The one notification after a trip, once they are back home (owner,
// 2026-11-14). Tapping it opens the Hometown Transition screen. Sent once.
export const hometownNotification = (city, visited, total) =>
  `You're back home in ${cityName(city)}. You've only been to ${visited.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} places here, and I already know what you like. Want me to pick 3 near you for tomorrow?`;

// The two lists one tap saves the picks to.
export const saveLists = (city) => [
  { id: 'tomorrow', label: `Tomorrow in ${cityName(city)}` },
  { id: 'week', label: 'This week at home' },
];

// The daily companion loop. Mapr only sends one of these when it has a real pick.
export function dailyLoop(firstPick, points) {
  return [
    { id: 'morning', when: 'Morning', what: 'I pick 1 place near you for today.', sample: firstPick ? `Today: ${firstPick.name}. It's close, and it's your kind of place.` : 'Today: 1 place near you.' },
    { id: 'after', when: 'After you go', what: `Check in, +${points} points, and I celebrate with you.`, sample: firstPick ? `Checked in at ${firstPick.name}. +${points}. That's one more of your city.` : `Checked in. +${points}.` },
    { id: 'skip', when: 'If you skip a day', what: 'One nudge, with a pick in it.', sample: `Your streak is at ${SAMPLE_STREAK} days, don't break it. I found a spot for tomorrow.` },
  ];
}

export const QUIET_RULE = "I only message you when I've got a real pick. No pick, no message.";

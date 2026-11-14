// Test tab "Official Onboarding" (owner, 2026-11-11): the words and the pure
// pieces of the Planner-first flow (OfficialOnboardingLab.jsx). Edit the
// words here. Nothing in the test is saved.
import { ALL_LANDMARKS, INTERESTS, PICKABLE_INTERESTS, PICKABLE_REGIONS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { SWIPE_DELTAS } from '../lib/onboardingCards';

// The 9 steps in the owner's order, three acts, then the Hometown
// Transition (owner, 2026-11-14; officialOnboardingHometown.js).
export const OO_STEPS = [
  { id: 'intro', label: 'Problem + solution', act: 1 },
  { id: 'city', label: 'City', act: 1 },
  { id: 'taste', label: 'Taste pick', act: 1 },
  { id: 'categories', label: 'Categories', act: 2 },
  { id: 'reflect', label: 'Reflection', act: 2 },
  { id: 'route', label: 'First Mapr pick', act: 2 },
  { id: 'checkin', label: 'First check-in', act: 2 },
  { id: 'commit', label: 'Summary', act: 3 },
  { id: 'signup', label: 'Sign up', act: 3 },
  { id: 'hometown', label: 'Hometown Transition', act: 4 },
];

export const CHECKIN_POINTS = 100;
export const MIN_TASTE = 3;
export const MAX_TASTE = 5;

// The three intro screens, three taps.
export const INTRO = [
  {
    hero: '\u{1F9E0}',
    say: 'Hi, I’m Mapr, your personal travel planner and guide. Together, we’ll create a trip built around you—your interests, your time, and your sense of adventure. Let\'s do it!',
    button: 'Next',
  },
  {
    hero: '\u{1F635}\u{200D}\u{1F4AB}',
    say: 'You land somewhere new and waste hours figuring out where to go — and still end up at the tourist traps.',
    button: 'Next',
  },
  {
    hero: '\u{1F5FA}\u{FE0F}',
    say: "Mapr builds your day from what you like. Tell me what you're into, I'll line up the places.",
    button: "Let's build my day",
  },
];

// The city picker. `regions` are the app cities a pick covers.
export const CITIES = [
  { id: 'miami', label: 'Miami', regions: ['miami'] },
  { id: 'philly', label: 'Villanova / Philly', regions: ['villanova', 'philly'] },
  { id: 'milan', label: 'Milan / Monza', regions: ['milan'] },
  { id: 'lake-como', label: 'Lake Como', regions: ['lake-como'] },
];
const LISTED = new Set(CITIES.flatMap((c) => c.regions));
export const OTHER_CITIES = PICKABLE_REGIONS.filter((r) => !LISTED.has(r.id)).map((r) => ({ id: r.id, label: r.city || r.name, regions: [r.id] }));
export const cityById = (id) => CITIES.find((c) => c.id === id) || OTHER_CITIES.find((c) => c.id === id) || null;
// What the real flow would save as the city every tab opens on: the Map,
// Landmarks, Mapr and Itinerary all read this one scope key (lib/cityScope.js).
export const cityScopeKey = (city) => (city ? `r:${city.regions[0]}` : 'all');
export const cityName = (city) => (city ? city.label.split(' / ').pop() : 'your city');

// The 8 kinds of places, in the owner's order.
export const TASTE_IDS = ['history-culture', 'food', 'local-life', 'parks-nature', 'sports', 'shopping', 'attractions', 'tech'];
export const TASTES = TASTE_IDS.map((id) => INTERESTS.find((i) => i.id === id)).filter(Boolean);
export const tasteLabel = (id) => INTERESTS.find((i) => i.id === id)?.label || id;

export const SAY = {
  city: ['Where are you exploring?'],
  taste: ["Pick 3 to 5 kinds of places you're into. I'll look for these first."],
  // Owner, 2026-11-12: categories instead of rating 10 places, because a
  // traveler in a new city doesn't know the places yet.
  categories: ["Categories you'd like to visit.", "Tap every one that sounds good. You don't need to know the city, I'll find the places for each."],
  notes: ["Anything else you love or hate that the cards didn't cover?"],
  // Always location (owner, 2026-11-11): Mapr needs to know where you are
  // all the time. iOS never offers Always on its first prompt, so the flow is
  // primer → While Using → iOS's own "Change to Always Allow" right after.
  primer: [
    'Allow location Always so I can verify you’re here, give you the points, and tell you when you pass a place worth a stop.',
  ],
  promptFirst: ["This is the iPhone's own question. Pick Allow While Using App. Always comes on the next screen."],
  promptAlways: ['Now pick Change to Always Allow, so I know where you are even with the app closed.'],
  checkinWin: [`First check-in! +${CHECKIN_POINTS}.`],
  review: ['Loving it so far? A quick rating helps other travelers find me.'],
  commitAsk: ['How committed are you to exploring like this?'],
  commitLow: [
    'No pressure. Exploring at your own pace counts too.',
    'Want a lighter day? I can rebuild it with 2 stops close together.',
  ],
  commitHigh: ["Love it. I'll keep lining up places like these."],
  signup: ['Save your 100 points + your day. It takes 20 seconds.'],
  verifyLater: ['I sent you a link to verify your email. Tap it any time. Nothing waits on it.'],
  hook: ['Come back tomorrow — 3 new places near you.'],
  done: ["That's your first day. See you tomorrow."],
};

export const COMMIT = [
  { id: 'extreme', label: 'Extremely committed', low: false },
  { id: 'very', label: 'Very committed', low: false },
  { id: 'somewhat', label: 'Somewhat', low: true },
  { id: 'not', label: 'Not really', low: true },
];

// Session 1's short tour: Map and Itinerary only.
export const OO_TABS = [
  { tab: 'Map', path: '/', live: true, tryIt: 'Try it: tap a pin.', icon: '\u{1F310}', say: "Tap a pin to see the place and check in when you're there." },
  { tab: 'Itinerary', path: '/itinerary', icon: '\u{1F5FA}\u{FE0F}', say: "Your day lives here. I can fill a day with places you'll like." },
];

// A sample for the social-proof line: the app counts no "days built" yet.
export const SAMPLE_BUILT_TODAY = 128;

const regionOf = (l) => l.regionId || l.region;
const inCity = (city) => (l) => city.regions.includes(regionOf(l));
const HIDE_KINDS = new Set(['airports', 'benches']);
// Each picked category counts as a "love it" on that kind of place (+10).
export const CATEGORY_DELTA = SWIPE_DELTAS.love;

// The categories the app has places for in this city, with how many, in the
// app's own order and with its own icons.
export function cityCategories(city, landmarks = ALL_LANDMARKS) {
  if (!city) return [];
  const counts = {};
  for (const l of landmarks.filter(inCity(city))) for (const c of new Set(l.categories || [])) counts[c] = (counts[c] || 0) + 1;
  return PICKABLE_INTERESTS.filter((i) => counts[i.id]).map((i) => ({ id: i.id, label: i.label, icon: i.icon, count: counts[i.id] }));
}

// The categories as "love it" answers, the shape the results screen and the
// tagScores math already read.
export const answersFromCats = (cats = []) =>
  cats.map((id) => ({
    card: { word: tasteLabel(id), icon: INTERESTS.find((i) => i.id === id)?.icon || '', tag: id, photos: [], photoPages: [] },
    answer: 'love',
  }));

const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

// Mapr repeats the picks back: "Okay — you want food, parks & nature and art
// & culture. Got it."
export function reflectLine(cats = []) {
  if (!cats.length) return "Okay — I'll start with the places most people love here. Got it.";
  return `Okay — you want ${joinAnd(cats.map((c) => tasteLabel(c).toLowerCase()))}. Got it.`;
}

const near = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);

// The first Mapr pick, a 1-day route of 3 stops from the ratings and taste
// picks: 1 the most popular place they loved (else the top place of a picked
// kind), 2 a food pick (else the next picked kind) close to it, 3 a hidden
// gem: a less-known place of a picked kind close to the last stop. Places
// rated "Don't like it" never go on it.
export function buildDay(city, chips = [], answers = [], landmarks = ALL_LANDMARKS) {
  if (!city) return [];
  const disliked = new Set(answers.filter((a) => a.answer === 'dislike').map((a) => a.card.place?.id));
  const all = landmarks.filter(inCity(city)).filter((l) => !disliked.has(l.id) && !HIDE_KINDS.has(l.categories?.[0]) && Number.isFinite(l.lat));
  // Stops with a photo, so every pin on the map has one, when the city has enough.
  const withPhoto = all.filter((l) => l.images?.length);
  const pool = withPhoto.length >= 3 ? withPhoto : all;
  if (!pool.length) return [];
  const kinds = chips.length ? chips : [...new Set(answers.filter((a) => a.answer === 'love').map((a) => a.card.tag).filter(Boolean))];
  const ofKind = (l, k) => (l.categories || []).includes(k);
  const pop = (a, b) => (b.popularity || 0) - (a.popularity || 0);
  const loved = answers.filter((a) => a.answer === 'love').map((a) => pool.find((l) => l.id === a.card.place?.id)).filter(Boolean);
  const first = [...loved].sort(pop)[0] || pool.filter((l) => kinds.some((k) => ofKind(l, k))).sort(pop)[0] || [...pool].sort(pop)[0];
  const used = new Set([first.id]);
  const closest = (list, to) => list.filter((l) => !used.has(l.id)).sort((a, b) => near(a, to) - near(b, to))[0];
  const secondKind = kinds.includes('food') || !kinds.length ? 'food' : kinds.find((k) => !ofKind(first, k)) || kinds[0];
  const second = closest(pool.filter((l) => ofKind(l, secondKind) && (l.popularity || 0) >= 5), first) || closest(pool.filter((l) => ofKind(l, secondKind)), first) || closest(pool, first);
  if (second) used.add(second.id);
  const last = second || first;
  const gemKinds = kinds.length ? kinds : [first.categories?.[0]];
  const gems = pool.filter((l) => gemKinds.some((k) => ofKind(l, k)) && (l.popularity || 0) <= 6);
  const third = closest(gems.filter((l) => near(l, last) < 8000), last) || closest(gems, last) || closest(pool, last);
  return [first, second, third].filter(Boolean).map((l) => ({ ...l, regionId: regionOf(l) }));
}

export function routeMeters(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += near(stops[i - 1], stops[i]);
  return total;
}

// "Your Miami day: 1. Wynwood Walls → 2. Joe's → 3. The Kampong."
export function dayLine(city, stops) {
  return `Your ${cityName(city)} day: ${stops.map((s, i) => `${i + 1}. ${s.name}`).join(' → ')}`;
}

// The stop on the route closest to where they are, with its distance.
export function nearestStop(stops, coords) {
  if (!stops.length) return null;
  if (!coords || !Number.isFinite(coords.lat)) return { place: stops[0], meters: null };
  return stops.map((place) => ({ place, meters: near(coords, place) })).sort((a, b) => a.meters - b.meters)[0];
}

// The lighter day for low commitment: the two stops closest together.
export function lighterDay(stops) {
  if (stops.length <= 2) return stops;
  let best = [stops[0], stops[1]];
  for (let i = 0; i < stops.length; i++)
    for (let j = i + 1; j < stops.length; j++) if (near(stops[i], stops[j]) < near(best[0], best[1])) best = [stops[i], stops[j]];
  return best;
}

export function summaryLines({ city, chips }) {
  const kinds = chips.length ? chips.map((c) => tasteLabel(c).toLowerCase()).join(' + ') : 'nothing yet (I guessed)';
  return [
    `You picked ${kinds}. Mapr built your ${cityName(city)} day. You'll finish it in one afternoon.`,
    `That's a day planned in 2 minutes — instead of hours of searching.`,
  ];
}

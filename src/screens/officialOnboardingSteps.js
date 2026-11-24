// Test tab "Official Onboarding" (owner, 2026-11-11): the words and the pure
// pieces of the Planner-first flow (OfficialOnboardingLab.jsx). Edit the
// words here. Nothing in the test is saved.
import { createElement } from 'react';
import { ALL_LANDMARKS, INTERESTS, PICKABLE_INTERESTS, PICKABLE_REGIONS } from '../data/regions';
import MaprTabIcon from '../components/MaprTabIcon';
import { distanceMeters } from '../lib/geo';
import { SWIPE_DELTAS } from '../lib/onboardingCards';

// The owner's steps in order, three acts, then the Hometown
// Transition (owner, 2026-11-14; officialOnboardingHometown.js).
export const OO_STEPS = [
  { id: 'intro', label: 'Problem + solution', act: 1 },
  { id: 'city', label: 'City', act: 1 },
  // Categories replaced the taste pick (owner, 2026-11-15).
  { id: 'categories', label: 'Categories', act: 1 },
  { id: 'reflect', label: 'Reflection', act: 2 },
  { id: 'route', label: 'First Mapr pick', act: 2 },
  { id: 'checkin', label: 'First check-in', act: 2 },
  { id: 'commit', label: 'Summary', act: 3 },
  { id: 'signup', label: 'Sign up', act: 3 },
  // Owner, 2026-11-14: onboarding only asks where home is. The hometown
  // pitch waits for the trip to end: one notification, then the screen.
  { id: 'home', label: 'Hometown', act: 3 },
  { id: 'notify', label: 'Back-home notification', act: 4 },
  { id: 'hometown', label: 'Hometown Transition', act: 4 },
];

export const CHECKIN_POINTS = 100;

// The three intro screens, three taps.
export const INTRO = [
  {
    // The owner's infographic (owner, 2026-11-14): no brain anywhere.
    image: '/onboarding/onboarding-infographic.png',
    alt: 'A trip built around you: your interests, your time and your adventure go into Mapr, which turns them into your personalized itinerary.',
    say: "Hi, I'm Mapr, your personal travel planner and guide. Together, we'll create a trip built around you, your interests, your time, and your sense of adventure. Let's do it!",
    button: 'Next',
  },
  {
    // The owner's photo of a young traveler lost in a city (owner, 2026-11-14).
    image: '/onboarding/onboarding-confused-traveler.jpg',
    alt: 'A young traveler in a city street, holding a paper map and a phone, unsure where to go.',
    photo: true,
    say: 'You land somewhere new and waste hours figuring out where to go, and still end up at the tourist traps.',
    button: 'Next',
  },
  {
    // The real Landmark Hunters map with a real route (owner, 2026-11-14).
    map: true,
    say: "I build your day from what you like. Tell me what you're into, I'll line up the places.",
    button: "Let's build my day",
  },
];

// The city picker. `regions` are the app cities a pick covers.
export const CITIES = [
  { id: 'miami', label: 'Miami', regions: ['miami'] },
  { id: 'philly', label: 'Villanova / Philly', regions: ['villanova', 'philly'] },
  { id: 'milan', label: 'Milan / Monza', regions: ['milan'] },
  { id: 'lake-como', label: 'Lake Como', regions: ['lake-como'] },
  { id: 'abacos', label: 'Abacos', regions: ['abacos'] },
];
const LISTED = new Set(CITIES.flatMap((c) => c.regions));
export const OTHER_CITIES = PICKABLE_REGIONS.filter((r) => !LISTED.has(r.id)).map((r) => ({ id: r.id, label: r.city || r.name, regions: [r.id] }));
export const cityById = (id) => CITIES.find((c) => c.id === id) || OTHER_CITIES.find((c) => c.id === id) || null;
// What the real flow would save as the city every tab opens on: the Map,
// Landmarks, Mapr and Itinerary all read this one scope key (lib/cityScope.js).
export const cityScopeKey = (city) => (city ? `r:${city.regions[0]}` : 'all');
export const cityName = (city) => (city ? city.label.split(' / ').pop() : 'your city');

export const tasteLabel = (id) => INTERESTS.find((i) => i.id === id)?.label || id;

export const SAY = {
  city: ['Where are you exploring?'],
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
  promptAlways: ["Now pick Change to Always Allow, so I can find you even with the app closed."],
  checkinWin: [`First check-in! +${CHECKIN_POINTS}.`],
  // The review ask at the peak, right after the first check-in (owner,
  // 2026-11-15). It never asks for five stars by name: App Store rules.
  review: ["You're on a roll. You just checked in for the first time and I've got your day planned. If you're loving it so far, would you leave us a review? It really helps other travelers find us."],
  reviewThanks: ['Thank you. That really helps.'],
  // Test only: on the web there's no system prompt to show.
  reviewPreviewNote: "On iPhone, this opens Apple's own review prompt right here. A preview can't show it, and Apple decides when it appears.",
  signup: ['Save your 100 points + your day. It takes 20 seconds.'],
  verifyLater: ['I sent you a link to verify your email. Tap it any time. Nothing waits on it.'],
  // Owner, 2026-11-14.
  hook: ["See you tomorrow, traveler. I'll have 3 new places near you."],
  home: ["One last thing. Where's home? I'll remember it, so when you get back from a trip I can help you there too."],
  done: ["That's your first day. See you tomorrow."],
};

// The summary's traveler question (owner, 2026-11-14): there's no
// commitment in traveling, so it asks about the trip instead. All four
// are in for now; the owner keeps one.
export const TRAVELER_QUESTIONS = [
  { id: 'kind', ask: 'What kind of traveler are you?', options: ['Explorer', 'Foodie', 'Chill', 'Adventurer'] },
  { id: 'day', ask: 'How do you like to spend a day in a new city?', options: ['Wander and see what happens', 'Plan every stop', 'Follow what locals do', 'A bit of both'] },
  { id: 'pace', ask: "What's your ideal pace?", options: ['Slow and relaxed', 'See as much as possible', 'A bit of both'] },
  { id: 'when', ask: 'When are you traveling?', options: ['This weekend', 'Next month', 'Just dreaming for now'] },
];

// The tab tour after sign-up: every tab in the bar (owner, 2026-11-14), in
// the app's order, with the app's emojis and Mapr's logo.
export const OO_TABS = [
  { tab: 'Map', path: '/', live: true, tryIt: 'Try it: tap a pin.', icon: '\u{1F310}', say: "Tap a pin to see the place and check in when you're there." },
  { tab: 'Landmarks', path: '/landmarks', icon: '\u{1F4CD}', say: "Every place in your city lives here. Add the ones you like to your day." },
  { tab: 'Mapr', path: '/mapr', icon: createElement(MaprTabIcon), say: "That's me. Ask me where to eat, what to see this afternoon, or how the app works." },
  { tab: 'Itinerary', path: '/itinerary', icon: '\u{1F5FA}\u{FE0F}', say: "Your day lives here. I can fill a day with places you'll like." },
  { tab: 'Profile', path: '/profile', icon: '\u{1F3C6}', say: "Your points, streaks and check-ins live here. You're at 100 already." },
];

// A sample for the social-proof line: the app counts no "days built" yet.
export const SAMPLE_BUILT_TODAY = 128;

// "Not yet" on the review ask holds for the whole browser session: no
// nagging, even after Restart (owner, 2026-11-15). Test only.
export const REVIEW_DECLINED_KEY = 'oo-review-declined';
export function reviewDeclined() {
  try {
    return sessionStorage.getItem(REVIEW_DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}
export function setReviewDeclined(on) {
  try {
    if (on) sessionStorage.setItem(REVIEW_DECLINED_KEY, '1');
    else sessionStorage.removeItem(REVIEW_DECLINED_KEY);
  } catch {
    // Private mode: the run's own state still stops the ask.
  }
}

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

// Mapr repeats the picks back: "Okay, you want food, parks & nature and art
// & culture. Got it."
export function reflectLine(cats = []) {
  if (!cats.length) return "Okay, I'll start with the places most people love here. Got it.";
  return `Okay, you want ${joinAnd(cats.map((c) => tasteLabel(c).toLowerCase()))}. Got it.`;
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

// "Food, Parks & Nature, and Art & Culture".
const listOf = (items) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`);

// The summary (owner, 2026-11-14): built from what they actually picked and
// loved. Never "you picked nothing", never "I guessed".
//   city: the trip's city; cats: their categories; loved: names of places
//   they loved; stops: the day Mapr built.
export function summaryLines({ city, chips = [], loved = [], stops = [] }) {
  const where = cityName(city);
  const n = stops.length || 3;
  const picked = chips.map(tasteLabel);
  const from = picked.length
    ? `Based on what you picked (${listOf(picked)})${loved.length ? ` and the places you loved (${listOf(loved)})` : ''}, I built your ${where} day around you.`
    : loved.length
      ? `Based on the places you loved (${listOf(loved)}), I built your ${where} day around you.`
      : `I built your ${where} day around the places travelers love most here.`;
  return [
    `${from} ${n} stops, picked for you, in one afternoon. ${picked.length || loved.length ? "This isn't a guess. It's built from your picks." : "Pick a few categories and I'll build the next one from your picks."}`,
    "That's a day planned in 2 minutes, instead of hours of searching.",
  ];
}

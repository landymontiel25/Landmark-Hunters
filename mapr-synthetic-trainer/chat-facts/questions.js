// What a traveler might ask Mapr chat, in many wordings, with typos and
// slang mixed in. Each question carries its intent and the places it names,
// so the grader knows the true answer.

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

// {A} {B} {C} are place names.
export const TEMPLATES = {
  dist_pair: [
    'how far is {A} from {B}',
    'how far is {A} from {B}?',
    'how many miles from {A} to {B}',
    'distance between {A} and {B}',
    'how long does it take to drive from {A} to {B}',
    'how long is the drive from {A} to {B}?',
    'is {A} far from {B}',
    'how many minutes from {A} to {B}',
    'how long to get from {A} to {B}',
    '{A} to {B} how long',
    'how close is {A} to {B}',
    'whats the drive time from {A} to {B}',
    'how long of a drive is {A} to {B}',
    'how far away is {B} from {A}',
    'how many mins between {A} and {B}',
    'is {B} close to {A}?',
    'how long would it take me to get from {A} to {B}',
    'can i get from {A} to {B} in 20 minutes',
    'travel time {A} to {B}',
    'how much time to drive {A} to {B}',
  ],
  dist_me: [
    'how far is {A}',
    'how far is {A} from me',
    'how far am i from {A}',
    'how long to get to {A}',
    'how long will it take me to get to {A}',
    'how many minutes to {A}',
    'how many miles to {A}',
    "what's my eta to {A}",
    'is {A} close',
    'is {A} far',
    'how long is the drive to {A}',
    'how far away is {A}',
    'can i make it to {A} in 15 min',
    'how quick can i get to {A}',
    'how long does it take to get to {A} from here',
    'is {A} nearby',
    'distance to {A}',
    'how far to {A}',
    'how long a ride to {A}',
    'whats the commute to {A}',
  ],
  walkable: [
    'can i walk to {A}',
    'is {A} walkable from here',
    'is {A} walking distance',
    'how long is the walk to {A}',
    'how long would it take to walk to {A}',
    'can i walk from {A} to {B}',
    'is it a long walk from {A} to {B}',
    'walking time to {A}?',
  ],
  hours: [
    'is {A} open right now',
    'is {A} open',
    'what time does {A} close',
    'when does {A} open',
    '{A} hours today',
    'is {A} still open',
    'what are the hours for {A}',
    'how late is {A} open',
    'is {A} open now?',
    'does {A} close soon',
    'until what time is {A} open tonight',
    'can i still go to {A} tonight',
  ],
  price: [
    'how much is {A}',
    'how much does {A} cost',
    'is {A} expensive',
    'whats the entry fee for {A}',
    'how much are tickets to {A}',
    'is {A} free',
    'price for {A}?',
  ],
  rating: [
    'is {A} any good',
    'what is {A} rated',
    'how many stars does {A} have',
    'is {A} worth it',
    'what are reviews like for {A}',
  ],
  plan: [
    'plan my afternoon: {A}, {B} and {C}',
    'what order should i do {A}, {B} and {C}',
    'i want to hit {A}, {B} and {C} today, best order?',
    'i have 3 hours, can i do {A} and {B}',
    'help me plan my day with {A}, {B}, {C}',
    'whats the fastest way to see {A}, {B} and {C}',
    'make me a route for {A} {B} and {C}',
    'i have until 6, fit in {A} and {B}?',
    'can i do {A} then {B} then {C} before dinner',
    'optimize my day: {A}, {B}, {C}',
  ],
  recs: [
    'food near me',
    'where should i eat tonight',
    'something fun to do near me',
    'coffee nearby',
    'best bar around here',
    'what should i do this afternoon',
    'a park close to me',
    'somewhere for dinner close by',
    'any good museums near me',
    'whats near me',
    'brunch spot near me',
    'i have 2 hours to kill, ideas?',
    'something to do tonight',
    'where can i get a quick lunch',
  ],
  directions: ['how do i get to {A}', 'directions to {A}', 'take me to {A}', 'where is {A}', 'whats the address of {A}'],
  app: [
    'how do i add a landmark',
    'what is a streak',
    'how do check-ins work',
    'how do i make an itinerary',
    'how do i invite a friend to my trip',
    'what does taste match mean',
    'how do i share my location',
    'can i save a place for later',
    'how do i rate a place',
    'how long does it take to set up a trip',
  ],
  // Time questions that are NOT about travel: the route lookup must stay out
  // of these, and "spend 2 hours there" must survive the guard.
  visit_length: [
    'how long should i spend at {A}',
    'how much time do i need at {A}',
    'how long is the tour at {A}',
    'how long has {A} been around',
    'how long do people usually stay at {A}',
    'is 2 hours enough for {A}',
  ],
};

export const INTENT_WEIGHTS = {
  dist_pair: 16,
  dist_me: 16,
  walkable: 7,
  hours: 12,
  price: 6,
  rating: 5,
  plan: 12,
  recs: 12,
  directions: 5,
  app: 4,
  visit_length: 5,
};
export const TRAVEL_INTENTS = new Set(['dist_pair', 'dist_me', 'walkable']);

// Typos and texting style.
function roughen(r, text) {
  let t = text;
  if (r() < 0.5) t = t.toLowerCase();
  if (r() < 0.3) t = t.replace(/[?]/g, '');
  if (r() < 0.12) t = t.replace(/\bhow\b/, 'hw');
  if (r() < 0.1) t = t.replace(/\byou\b/g, 'u').replace(/\bminutes\b/, 'mins');
  if (r() < 0.12) {
    // Swap two letters inside one non-name word.
    const words = t.split(' ');
    const i = Math.floor(r() * words.length);
    const w = words[i];
    if (w.length > 4 && /^[a-z]+$/.test(w)) {
      const j = 1 + Math.floor(r() * (w.length - 3));
      words[i] = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2);
      t = words.join(' ');
    }
  }
  if (r() < 0.1) t = t + ' pls';
  if (r() < 0.06) t = 'yo ' + t;
  return t;
}

function pickIntent(r) {
  const total = Object.values(INTENT_WEIGHTS).reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (const [k, w] of Object.entries(INTENT_WEIGHTS)) {
    x -= w;
    if (x < 0) return k;
  }
  return 'recs';
}

// One question for a traveler whose city's places are `places` (names).
export function makeQuestion(r, places) {
  const intent = pickIntent(r);
  const template = pick(r, TEMPLATES[intent]);
  const names = [];
  while (names.length < 3) {
    const n = pick(r, places);
    if (!names.includes(n)) names.push(n);
  }
  const used = ['A', 'B', 'C'].filter((k) => template.includes(`{${k}}`));
  const text = roughen(
    r,
    template.replace('{A}', names[0]).replace('{B}', names[1]).replace('{C}', names[2])
  );
  return { intent, template, text, places: used.map((_, i) => names[i]) };
}

import { INTERESTS } from '../data/regions';

// Same cap firestore.rules enforces on reviews.comment.
export const COMMENT_MAX = 500;

// Only these categories get the rating flow. A landmark that's ONLY
// campus-life or dorms (a residence hall, an admissions office) skips
// straight to "checked in" -- rating a dorm on Price/Atmosphere tells
// Mapr nothing.
// Order matters: a landmark tagged with several of these takes its chip
// and aspect sets from the first match here. Airports go first (an airport
// is an airport whatever else it's tagged); parks and entertainment sit
// ahead of history so a "historic beach park" rates as a park.
export const RATEABLE_CATEGORIES = [
  'airports',
  'formula-1',
  'sports',
  'stadiums',
  'benches',
  'parks-nature',
  'entertainment',
  'tech',
  'history-culture',
  'art-museums',
  'food',
  'local-life',
];

export function isRateable(landmark) {
  return (landmark?.categories || []).some((c) => RATEABLE_CATEGORIES.includes(c));
}

export function ratingCategory(landmark) {
  return RATEABLE_CATEGORIES.find((c) => (landmark?.categories || []).includes(c)) || null;
}

// `stars` is derived from the tier, never picked directly: landmark_ratings'
// running avg (and the Top Rated sort, every card's star display) is built on
// a 1-5 scale, so keeping a numeric value flowing into that aggregate means
// nothing downstream had to change when the 5-star picker went away.
// Labels are what shows; ids are the stable storage/lookup key everywhere
// else (Firestore reviews, Mapr's scoring, this file's own functions) --
// relabeling here never touches saved data.
export const TIERS = [
  { id: 'highly-recommend', label: 'I loved it', emoji: '\u{2764}\u{FE0F}', stars: 5 },
  { id: 'worth-trying', label: 'It was okay', emoji: '\u{1F610}', stars: 3 },
  { id: 'probably-skip', label: 'Not for me', emoji: '\u{1F44E}', stars: 1 },
];

export function tierById(id) {
  return TIERS.find((t) => t.id === id) || null;
}

// How often you come here -- optional, asked alongside the tier. Mapr moves
// its tag scores faster for "a lot" than for "not often" (see
// FREQUENCY_MULTIPLIER in tagScores.js): a place you keep going back to is
// stronger proof of taste than a place you rarely visit, good or bad.
export const FREQUENCIES = [
  { id: 'not-often', label: 'Not often' },
  { id: 'sometimes', label: 'Sometimes' },
  { id: 'a-lot', label: 'A lot' },
];

export function frequencyById(id) {
  return FREQUENCIES.find((f) => f.id === id) || null;
}

export function tierStars(id) {
  return tierById(id)?.stars ?? 0;
}

export const MAX_CHIPS = 3;
export const MAX_ASPECTS = 3;

// Chip copy per category x tier. Each chip's `id` is what gets saved in a
// review's `highlights` -- keep ids stable if the labels are ever reworded
// so old reviews keep meaning the same thing.
export const CHIPS = {
  food: {
    'highly-recommend': [
      { id: 'great-food', label: 'Great food' },
      { id: 'love-vibe', label: 'Love the vibe' },
      { id: 'worth-price', label: 'Worth the price' },
    ],
    'worth-trying': [
      { id: 'food-okay', label: 'Food was okay' },
      { id: 'nice-spot', label: 'Nice spot' },
      { id: 'decent-price', label: 'Decent price' },
    ],
    'probably-skip': [
      { id: 'bad-food', label: 'Bad food' },
      { id: 'mediocre-vibe', label: 'Mediocre vibe' },
      { id: 'too-expensive', label: 'Too expensive' },
    ],
  },
  'art-museums': {
    'highly-recommend': [
      { id: 'stunning-collection', label: 'Stunning collection' },
      { id: 'great-curation', label: 'Great curation' },
      { id: 'worth-visiting', label: 'Worth visiting' },
    ],
    'worth-trying': [
      { id: 'decent-exhibits', label: 'Decent exhibits' },
      { id: 'decent-curation', label: 'Decent curation' },
      { id: 'average-experience', label: 'Average experience' },
    ],
    'probably-skip': [
      { id: 'underwhelming-exhibits', label: 'Underwhelming exhibits' },
      { id: 'crowded', label: 'Crowded' },
      { id: 'not-worth-it', label: 'Not worth it' },
    ],
  },
  'history-culture': {
    'highly-recommend': [
      { id: 'amazing-history', label: 'Amazing history' },
      { id: 'great-storytelling', label: 'Great storytelling' },
      { id: 'beautiful-building', label: 'Beautiful building' },
    ],
    'worth-trying': [
      { id: 'okay-exhibits', label: 'Okay exhibits' },
      { id: 'decent-tour', label: 'Decent tour' },
      { id: 'fine-spot', label: 'Fine spot' },
    ],
    'probably-skip': [
      { id: 'boring', label: 'Boring' },
      { id: 'not-maintained', label: 'Not maintained' },
      { id: 'overpriced', label: 'Overpriced' },
    ],
  },
  'parks-nature': {
    'highly-recommend': [
      { id: 'beautiful-views', label: 'Beautiful views' },
      { id: 'peaceful', label: 'Peaceful' },
      { id: 'great-for-a-walk', label: 'Great for a walk' },
    ],
    'worth-trying': [
      { id: 'nice-enough', label: 'Nice enough' },
      { id: 'bit-of-a-trek', label: 'Bit of a trek' },
      { id: 'crowded', label: 'Crowded' },
    ],
    'probably-skip': [
      { id: 'nothing-special', label: 'Nothing special' },
      { id: 'poorly-kept', label: 'Poorly kept' },
      { id: 'hard-to-get-to', label: 'Hard to get to' },
    ],
  },
  entertainment: {
    'highly-recommend': [
      { id: 'so-much-fun', label: 'So much fun' },
      { id: 'worth-the-ticket', label: 'Worth the ticket' },
      { id: 'great-for-families', label: 'Great for families' },
    ],
    'worth-trying': [
      { id: 'fun-but-pricey', label: 'Fun but pricey' },
      { id: 'decent-show', label: 'Decent show' },
      { id: 'long-lines', label: 'Long lines' },
    ],
    'probably-skip': [
      { id: 'not-worth-it', label: 'Not worth it' },
      { id: 'overpriced', label: 'Overpriced' },
      { id: 'underwhelming', label: 'Underwhelming' },
    ],
  },
  'local-life': {
    'highly-recommend': [
      { id: 'great-vibe', label: 'Great vibe' },
      { id: 'fun-crowd', label: 'Fun crowd' },
      { id: 'good-drinks', label: 'Good drinks' },
    ],
    'worth-trying': [
      { id: 'decent-night', label: 'Decent night out' },
      { id: 'hit-or-miss', label: 'Hit or miss' },
      { id: 'pricey-drinks', label: 'Pricey drinks' },
    ],
    'probably-skip': [
      { id: 'dead', label: 'Dead' },
      { id: 'sketchy', label: 'Sketchy' },
      { id: 'overpriced', label: 'Overpriced' },
    ],
  },
  tech: {
    'highly-recommend': [
      { id: 'legendary-story', label: 'Legendary story' },
      { id: 'great-photo-op', label: 'Great photo op' },
      { id: 'felt-the-history', label: 'Felt the history' },
    ],
    'worth-trying': [
      { id: 'quick-stop', label: 'Quick stop' },
      { id: 'exterior-only', label: 'Exterior only' },
      { id: 'for-the-fans', label: 'One for the fans' },
    ],
    'probably-skip': [
      { id: 'just-an-office', label: 'Just an office' },
      { id: 'nothing-to-see', label: 'Nothing to see' },
      { id: 'hard-to-reach', label: 'Hard to reach' },
    ],
  },
  sports: {
    'highly-recommend': [
      { id: 'great-facilities', label: 'Great facilities' },
      { id: 'so-much-fun', label: 'So much fun' },
      { id: 'easy-to-book', label: 'Easy to book' },
    ],
    'worth-trying': [
      { id: 'decent-facilities', label: 'Decent facilities' },
      { id: 'busy', label: 'Busy' },
      { id: 'a-bit-pricey', label: 'A bit pricey' },
    ],
    'probably-skip': [
      { id: 'run-down', label: 'Run down' },
      { id: 'always-full', label: 'Always full' },
      { id: 'overpriced', label: 'Overpriced' },
    ],
  },
  stadiums: {
    'highly-recommend': [
      { id: 'electric-atmosphere', label: 'Electric atmosphere' },
      { id: 'great-seats', label: 'Great seats' },
      { id: 'easy-to-get-to', label: 'Easy to get to' },
    ],
    'worth-trying': [
      { id: 'decent-atmosphere', label: 'Decent atmosphere' },
      { id: 'far-seats', label: 'Far-away seats' },
      { id: 'long-lines', label: 'Long lines' },
    ],
    'probably-skip': [
      { id: 'dead-crowd', label: 'Dead crowd' },
      { id: 'bad-views', label: 'Bad views' },
      { id: 'overpriced', label: 'Overpriced' },
    ],
  },
  'formula-1': {
    'highly-recommend': [
      { id: 'iconic-track', label: 'Iconic track' },
      { id: 'electric-atmosphere', label: 'Electric atmosphere' },
      { id: 'great-viewing-spots', label: 'Great viewing spots' },
    ],
    'worth-trying': [
      { id: 'decent-views', label: 'Decent views' },
      { id: 'long-walks', label: 'Long walks' },
      { id: 'pricey-tickets', label: 'Pricey tickets' },
    ],
    'probably-skip': [
      { id: 'bad-views', label: 'Bad views' },
      { id: 'chaotic-access', label: 'Chaotic to get in and out' },
      { id: 'overpriced', label: 'Overpriced' },
    ],
  },
  benches: {
    'highly-recommend': [
      { id: 'perfect-view', label: 'Perfect view' },
      { id: 'peaceful', label: 'Peaceful' },
      { id: 'worth-the-walk', label: 'Worth the walk' },
    ],
    'worth-trying': [
      { id: 'nice-view', label: 'Nice view' },
      { id: 'a-bit-busy', label: 'A bit busy' },
      { id: 'hard-to-find', label: 'Hard to find' },
    ],
    'probably-skip': [
      { id: 'view-blocked', label: 'View blocked' },
      { id: 'uncomfortable', label: 'Uncomfortable' },
      { id: 'not-worth-it', label: 'Not worth it' },
    ],
  },
  airports: {
    'highly-recommend': [
      { id: 'smooth-experience', label: 'Smooth experience' },
      { id: 'easy-to-navigate', label: 'Easy to navigate' },
      { id: 'good-food-shops', label: 'Good food & shops' },
    ],
    'worth-trying': [
      { id: 'gets-the-job-done', label: 'Gets the job done' },
      { id: 'long-walks', label: 'Long walks between gates' },
      { id: 'slow-security', label: 'Slow security' },
    ],
    'probably-skip': [
      { id: 'chaotic', label: 'Chaotic' },
      { id: 'endless-lines', label: 'Endless lines' },
      { id: 'overpriced', label: 'Overpriced' },
    ],
  },
};

export function chipsFor(landmark, tierId) {
  const cat = ratingCategory(landmark);
  return (cat && CHIPS[cat]?.[tierId]) || [];
}

// Label for a saved chip id, for showing old reviews back to the user even
// after the copy changes.
export function chipLabel(id) {
  for (const cat of Object.values(CHIPS)) {
    for (const list of Object.values(cat)) {
      const hit = list.find((c) => c.id === id);
      if (hit) return hit.label;
    }
  }
  return id;
}

// Ranked-aspect options per category. Price and Location are shared; the
// other two are what actually varies between a restaurant, a museum, and a
// historic site. Saved by id in lovedOrder / dislikedOrder.
export const ASPECT_SETS = {
  food: [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'atmosphere', label: 'Atmosphere' },
    { id: 'food', label: 'Food' },
  ],
  'art-museums': [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'exhibits', label: 'Exhibits' },
    { id: 'crowd-level', label: 'Crowd level' },
  ],
  'history-culture': [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'storytelling', label: 'Storytelling' },
    { id: 'architecture', label: 'Architecture' },
  ],
  'parks-nature': [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'scenery', label: 'Scenery' },
    { id: 'upkeep', label: 'Upkeep' },
  ],
  entertainment: [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'fun-factor', label: 'Fun factor' },
    { id: 'crowd-level', label: 'Crowd level' },
  ],
  'local-life': [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'vibe', label: 'Vibe' },
    { id: 'crowd', label: 'Crowd' },
  ],
  tech: [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'storytelling', label: 'Storytelling' },
    { id: 'access', label: 'Access' },
  ],
  sports: [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'facilities', label: 'Facilities' },
    { id: 'availability', label: 'Availability' },
  ],
  stadiums: [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'atmosphere', label: 'Atmosphere' },
    { id: 'seating', label: 'Seating & views' },
  ],
  'formula-1': [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'atmosphere', label: 'Atmosphere' },
    { id: 'track-views', label: 'Track views' },
  ],
  benches: [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'view', label: 'View' },
    { id: 'comfort', label: 'Comfort' },
  ],
  airports: [
    { id: 'price', label: 'Price' },
    { id: 'location', label: 'Location' },
    { id: 'security-wait', label: 'Security wait' },
    { id: 'amenities', label: 'Food & shops' },
  ],
};

export function aspectsFor(landmark) {
  const cat = ratingCategory(landmark);
  return (cat && ASPECT_SETS[cat]) || [];
}

export function aspectLabel(id) {
  for (const list of Object.values(ASPECT_SETS)) {
    const hit = list.find((a) => a.id === id);
    if (hit) return hit.label;
  }
  return id;
}

// The question the tier picker answers, phrased around what this specific
// place is. Custom landmarks carry a `topic` (e.g. "Peruvian restaurant",
// "sports bar", "go-kart track") found by the web research in
// api/_lib/enrichLandmark.js when they were added; built-in catalog
// landmarks don't have one yet, so they fall back to a per-category phrasing
// below. Either way the answer is the same tier pick that feeds the
// per-category scoring in tagScores.js -- this only frames it as a question.
const TIER_QUESTION_FALLBACK = {
  airports: 'Do you like this airport?',
  'formula-1': 'Do you like the racing?',
  sports: 'Do you like playing here?',
  stadiums: 'Do you like this stadium?',
  benches: 'Do you like this bench?',
  'parks-nature': 'Do you like the outdoors here?',
  entertainment: 'Do you like this place?',
  tech: 'Do you like this piece of tech history?',
  'history-culture': 'Do you like the history here?',
  'art-museums': 'Do you like the art here?',
  food: 'Do you like the food here?',
  'local-life': 'Do you like this spot?',
};

// Places where the thing you like or don't is the food, not the building --
// "Peruvian restaurant" asks "Do you like Peruvian food?".
const EATERY_NOUNS = /\s+(restaurant|eatery|cafe|café|bistro|diner|kitchen|grill|cantina|trattoria|taqueria|steakhouse)$/i;
const RACING = /\b(racing|race ?track|raceway|speedway|karting|go-?kart|circuit|motorsports?|drag strip)\b/i;

export const TOPIC_MAX = 60;

export function cleanTopic(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(a|an|the|this)\s+/i, '')
    .trim();
  return t && t.length <= TOPIC_MAX ? t : null;
}

export function tierQuestion(landmark) {
  const cat = ratingCategory(landmark);
  if (!cat) return null;
  const topic = cleanTopic(landmark?.topic);
  if (!topic) return TIER_QUESTION_FALLBACK[cat] || `Do you like ${categoryLabel(cat)}?`;

  if (RACING.test(topic)) return 'Do you like the racing?';
  // Already the thing itself ("Peruvian food", "Thai cuisine").
  if (/\b(food|cuisine)$/i.test(topic)) return `Do you like ${topic}?`;
  // A cuisine named by a proper adjective ("Peruvian restaurant", "Thai
  // cafe") reads best as the food; a lowercase one ("sushi restaurant",
  // "seafood restaurant") reads better as the place itself.
  const eatery = topic.match(EATERY_NOUNS);
  if (eatery) {
    const cuisine = topic.slice(0, eatery.index).trim();
    if (/^[A-Z]/.test(cuisine) && !/\s/.test(cuisine)) return `Do you like ${cuisine} food?`;
  }
  return `Do you like this ${topic}?`;
}

// The free-text box under the rating. Asked the same way whether it's
// required or optional; a "Not for me" asks the flip side, since "what do
// you like" reads oddly for a place you didn't.
export function commentQuestion(tierId) {
  return tierId === 'probably-skip' ? "What didn't you like about this place?" : 'What do you like about this place?';
}

export function categoryLabel(id) {
  if (id === 'food-local-life') return 'Food & Local Life';
  return INTERESTS.find((i) => i.id === id)?.label || id;
}

// The number we say out loud: "Rate 10 places and Mapr gets noticeably
// better." A reasoned hypothesis, not a measured cliff -- see the feature
// doc. Swap this once real retention-by-ratings-count data is in.
export const RATING_GOAL = 10;
export const TASTE_CARD_MIN_RATINGS = 5;

// A handful of ratings all in the same category teaches Mapr almost
// nothing about how you feel about the other dozen-plus categories it
// picks from -- category SPREAD, not raw count, is what actually gets you
// to "Mapr gets me" fast. Nudges toward that spread while you're still
// building up your first RATING_GOAL ratings; goes quiet once you have
// enough of them, or once your ratings are reasonably spread already.
export function diversityHint(reviews) {
  const rated = (reviews || []).filter((r) => r.ratingTier);
  if (rated.length < 2 || rated.length >= RATING_GOAL) return null;

  const counts = {};
  const ratedCats = new Set();
  for (const r of rated) {
    for (const c of r.categories || []) {
      if (!RATEABLE_CATEGORIES.includes(c)) continue;
      counts[c] = (counts[c] || 0) + 1;
      ratedCats.add(c);
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const [topCat, topCount] = top;
  // Lopsided only once a category clearly dominates -- one loved museum
  // among five different-category ratings isn't a pattern worth flagging.
  if (topCount / rated.length < 0.6) return null;

  const unrated = RATEABLE_CATEGORIES.filter((c) => !ratedCats.has(c)).slice(0, 2);
  if (!unrated.length) return null;

  return `You've mostly rated ${categoryLabel(topCat)} so far — try a ${unrated
    .map(categoryLabel)
    .join(' or ')} spot next. Mapr learns faster from variety than from more of the same.`;
}

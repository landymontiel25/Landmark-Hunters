// What KIND of place something is, finer than its category: a steakhouse
// and a cookie shop are both "food", but liking one says nothing about the
// other. Read from the place's own words (name, topic, summary, facts), so
// it works for the hand-picked catalog and the imported places alike.

// [kind, pattern, group]. Order doesn't matter; a place can have several
// kinds. A kind only applies inside its group's categories, so a restaurant
// whose facts mention "history" isn't a history place.
const EAT = ['food', 'local-life'];
const OUT = ['local-life', 'entertainment', 'food'];
const SHOP = ['local-life'];
const SEE = null; // any category except the eating ones
const KINDS = [
  // Food
  // Explicit steakhouse words only: "steak" alone shows up in pho, sandwich
  // and cheesesteak descriptions.
  ['steakhouse', /steak ?house|steak restaurant|(serves|plus) steak\b|churrasc|chophouse|rodizio|prime steaks|dry-aged/, EAT],
  ['cheesesteak', /cheese ?steak|philly steak/, EAT],
  ['sushi', /sushi|omakase|sashimi|nigiri/, EAT],
  ['japanese', /japanese|ramen|izakaya|teriyaki|\budon\b|hibachi/, EAT],
  ['burgers', /burger/, EAT],
  ['pizza', /pizz/, EAT],
  ['mexican', /mexican|\btacos?\b|taqueria|burrito|cantina/, EAT],
  ['italian', /italian|trattoria|\bpasta\b|osteria|ristorante/, EAT],
  ['chinese', /chinese|dim sum|dumpling|szechuan|sichuan|cantonese/, EAT],
  ['thai', /\bthai\b/, EAT],
  ['indian', /\bindian\b|\bcurry\b|tandoor|masala/, EAT],
  ['vietnamese', /vietnamese|\bpho\b|banh mi/, EAT],
  ['korean', /korean|bibimbap/, EAT],
  ['spanish', /spanish|\btapas\b|paella|basque/, EAT],
  ['french', /french|brasserie|cr[eê]pe|patisserie/, EAT],
  ['caribbean', /caribbean|jamaican|haitian|trinidad|puerto rican/, EAT],
  ['poke', /\bpok[eé]\b|hawaiian/, EAT],
  ['mediterranean', /mediterranean|greek|gyro|falafel|middle eastern|lebanese|turkish|shawarma|kebab/, EAT],
  ['seafood', /seafood|oyster|lobster|\bcrabs?\b|raw bar|ceviche|fish market/, EAT],
  ['bbq', /barbecue|\bbbq\b|smokehouse|brisket/, EAT],
  ['cuban', /cuban|cafecito|croqueta/, EAT],
  ['latin', /venezuelan|colombian|peruvian|argentin|arepa|empanada|salvadoran|nicaraguan|latin american/, EAT],
  ['chicken', /fried chicken|chicken wings|\bwings\b|rotisserie chicken|hot chicken/, EAT],
  ['sandwiches', /sandwich|\bdeli\b|hoagie|sub shop|bagel/, EAT],
  ['breakfast', /breakfast|brunch|pancake|\bdiner\b/, EAT],
  // Not "Market Street" (San Francisco's main avenue) or "Italian Market area".
  ['food-hall', /food hall|public market|farmers'? market|fish market|\bmarket\b(?!\s+(street|st|area|district)\b)/, EAT],
  ['american', /american (restaurant|food|cuisine|grill|bistro|tavern|kitchen|comfort)|new american|gastropub|\bdiner\b/, EAT],
  ['bakery', /bakery|bakeries|pastr|croissant|patisserie|\bbread\b/, EAT],
  ['sweets', /cookie|donut|doughnut|cupcake|\bcakes?\b|dessert|candy|chocolate|cheesecake/, EAT],
  ['ice-cream', /ice cream|gelato|frozen yogurt|creamery|italian ice|water ice/, EAT],
  // "Café" in a restaurant's name doesn't make it a coffee shop; its topic does
  // (see describe()).
  ['coffee', /coffee|espresso|roaster|bubble tea|boba|tea house|cortadito|cafecito|\bcoffeehouse\b|\bcaf[eé] (topic)\b/, EAT],
  ['vegan', /vegan|vegetarian|plant-based/, EAT],
  // Drinks and nights out
  ['bar', /\bbar\b|\bpub\b|tavern|saloon/, OUT],
  ['brewery', /brewery|brewing|beer garden|biergarten|taproom|craft beer/, OUT],
  ['cocktails', /cocktail|speakeasy|\blounge\b/, OUT],
  ['wine', /\bwine\b/, OUT],
  ['nightclub', /nightclub|night club|dance club/, OUT],
  ['sports-bar', /sports bar/, OUT],
  ['live-music', /live music|\bjazz\b|concert venue/, OUT],
  // Shops
  ['bookstore', /book ?(store|shop|s\b)|librer[ií]a|\bbooks\b/, SHOP],
  ['shopping', /\bmall\b|shopping|\bshops\b|shoppes|department store|outlet/, SHOP],
  ['gallery', /\bgaller(y|ies)\b|art dealer|\bart\b/, SHOP],
  // Places to see: only the place's own type words, since landmark
  // descriptions mention everything around them ("Art Deco", "flower beds").
  ['art', /art museum|museum of (modern |contemporary )?art|\bgaller(y|ies)\b|sculpture garden|street art|murals\b/, SEE],
  ['history', /historic (site|district|house|landmark)|history museum|memorial|monument|\bfort\b|national historic/, SEE],
  ['science', /science (center|museum)|planetarium|natural history|\baquarium\b/, SEE],
  ['beach', /\bbeach\b(?! (house|club|hotel))/, SEE],
  ['dog-park', /dog park/, SEE],
  ['trails', /\btrails?\b|hiking|nature preserve|state park|national park/, SEE],
  ['garden', /botanical|arboretum|\bgardens?\b(?! court)/, SEE],
];

const KINDS_KEY = Symbol('kinds');
const WEIGHTS_KEY = Symbol('kindWeights');

const clean = (parts) =>
  parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    // "cheesesteak" is its own kind, never a steakhouse.
    .replace(/cheese ?steaks?/g, 'cheesesteak');
const factsOf = (l) => (Array.isArray(l?.facts) ? l.facts : []);

// Strong evidence of what a place IS: its name, topic, summary and the
// "Serves ..." line (from its map cuisine tag).
function describe(l) {
  // A topic of "café" (an imported coffee shop) is the one place "café" means
  // coffee; spelled out so the coffee pattern can tell it from a restaurant
  // that just has Café in its name.
  const topic = /^caf[eé]$/i.test(String(l?.topic || '')) ? 'café topic' : l?.topic;
  return clean([l?.name, l?.landmarkName, topic, l?.summary, ...factsOf(l).filter((f) => /^serves /i.test(f))]);
}

// Weak evidence: the other facts, which also mention side items and
// neighbors ("pho with eye round steak", "near the Italian Market").
// Amenity lines ("Has a bar", "Offers takeout") are left out entirely.
function textOf(l) {
  return clean(factsOf(l).filter((f) => !/^(serves |has a bar|has outdoor|offers |takeout|address:)/i.test(f)));
}

// The kinds a place is, as a Set of kind ids. Cached on the object.
export function placeKinds(l) {
  if (!l) return new Set();
  if (l[KINDS_KEY]) return l[KINDS_KEY];
  const cats = l.categories || [];
  const inGroup = (group) =>
    !cats.length || (group === SEE ? !cats.some((c) => EAT.includes(c)) : cats.some((c) => group.includes(c)));
  const match = (text) => new Set(KINDS.filter(([, re, group]) => inGroup(group) && re.test(text)).map(([k]) => k));
  const strong = match(describe(l));
  const weights = new Map([...match(textOf(l))].map((k) => [k, 1]));
  for (const k of strong) weights.set(k, 2);
  const kinds = new Set(weights.keys());
  try {
    Object.defineProperty(l, KINDS_KEY, { value: kinds, enumerable: false });
    Object.defineProperty(l, WEIGHTS_KEY, { value: weights, enumerable: false });
  } catch {
    /* frozen object: just don't cache */
  }
  return kinds;
}

// 2 for a kind in a place's own description, 1 for one only its other facts
// mention, 0 otherwise.
export function kindWeight(l, kind) {
  placeKinds(l);
  return l?.[WEIGHTS_KEY]?.get(kind) || (placeKinds(l).has(kind) ? 1 : 0);
}

export function sharedKinds(a, b) {
  const kb = placeKinds(b);
  return [...placeKinds(a)].filter((k) => kb.has(k));
}

// The kinds a place clearly is (its own description), or, when its
// description names none, whatever its facts mention.
export function mainKinds(l) {
  const all = [...placeKinds(l)];
  const strong = all.filter((k) => kindWeight(l, k) === 2);
  return strong.length ? strong : all;
}

// How alike two places are, liked first: for each kind the liked place
// clearly is, how clearly the other place is that too. A steakhouse scores
// 2 against another steakhouse and 1 against a place whose facts call it an
// "Italian steakhouse"; 0 means not the same kind at all.
const DRINK_KINDS = new Set(KINDS.filter(([, , g]) => g === OUT).map(([k]) => k));
export function kindSimilarity(liked, other) {
  // For a restaurant, what it serves decides; its cocktail list doesn't (an
  // Italian place with a bar is matched to Italian places, not bars).
  let kinds = mainKinds(liked);
  if ((liked?.categories || [])[0] === 'food') {
    const food = kinds.filter((k) => !DRINK_KINDS.has(k));
    if (food.length) kinds = food;
  }
  let score = 0;
  for (const k of kinds) score += kindWeight(other, k);
  return score;
}

// How much the traveler likes each kind, from their ratings: a loved place
// adds 3 to each of its kinds, "worth trying" 1, "didn't like" takes 3 away.
// findLandmark(review) returns the rated place (for its full words); without
// it the review's own name and categories are read.
const TIER_WEIGHT = { 'highly-recommend': 3, 'worth-trying': 1, 'probably-skip': -3 };
export function kindAffinity(myReviews, findLandmark = () => null) {
  const out = {};
  for (const r of Object.values(myReviews || {})) {
    const w = TIER_WEIGHT[r?.ratingTier];
    if (!w) continue;
    const place = findLandmark(r) || { name: r.landmarkName, categories: r.categories };
    for (const k of mainKinds(place)) out[k] = (out[k] || 0) + w;
  }
  return out;
}

// A pick's boost from the kinds it shares with what the traveler rated:
// each affinity point is worth KIND_POINTS tag-score points (one "Highly
// recommend" of a category is worth 10), so a loved steakhouse lifts other
// steakhouses by 6 and a disliked kind sinks its places by as much.
export const KIND_POINTS = 2;
export function kindBoost(place, affinity) {
  let sum = 0;
  for (const k of mainKinds(place)) sum += affinity?.[k] || 0;
  return sum * KIND_POINTS;
}

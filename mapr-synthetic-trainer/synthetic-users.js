import { seededRandom } from '../src/lib/maprRank/experiments.js';

// 112 traveler archetypes and the generator that turns them into synthetic
// users. An archetype's taste is a weight per place feature (see
// lib/catalog.js tasteFeatures): c:<category>, k:<kind>, cost:<tier>,
// pop:famous / pop:local. Positive weights pull a place's match up,
// dislikes push it down. Every feature named here exists in the real catalog.

// "k:italian=1 k:pizza=.8" -> { 'k:italian': 1, 'k:pizza': 0.8 }
function weights(spec = '') {
  const out = {};
  for (const part of spec.trim().split(/\s+/).filter(Boolean)) {
    const [f, w] = part.split('=');
    out[f] = Number(w);
  }
  return out;
}

const GROUP_DEFAULTS = {
  food: { budget_level: 'Medium', activity_level: 'Low', travel_style: 'Foodie' },
  night: { budget_level: 'Medium', activity_level: 'Medium', travel_style: 'Social' },
  culture: { budget_level: 'Medium', activity_level: 'Medium', travel_style: 'Cultural' },
  outdoors: { budget_level: 'Low', activity_level: 'High', travel_style: 'Active' },
  local: { budget_level: 'Medium', activity_level: 'Medium', travel_style: 'Local' },
  lifestyle: { budget_level: 'Medium', activity_level: 'Medium', travel_style: 'Mixed' },
  hybrid: { budget_level: 'Medium', activity_level: 'Medium', travel_style: 'Mixed' },
};

// [name, group, likes, dislikes, overrides]
// overrides: budget_level, activity_level, travel_style, interests,
// consistency, love_rate, skip_rate.
const RAW = [
  // --- Food --------------------------------------------------------------
  ['Italian Foodie', 'food', 'k:italian=1 k:pizza=.8 k:wine=.6 k:mediterranean=.4 k:french=.3', 'c:parks-nature=.6', { budget_level: 'High', travel_style: 'Luxury', interests: ['Cooking', 'Wine', 'Culture'] }],
  ['Pizza Purist', 'food', 'k:pizza=1 k:italian=.5 k:brewery=.3', 'k:vegan=.3', { budget_level: 'Low' }],
  ['Sushi Devotee', 'food', 'k:sushi=1 k:japanese=.8 k:seafood=.4', '', { budget_level: 'High' }],
  ['Ramen & Izakaya Fan', 'food', 'k:japanese=1 k:sushi=.5 k:korean=.5 k:cocktails=.3', ''],
  ['Taco Hunter', 'food', 'k:mexican=1 k:latin=.5 k:brewery=.3', '', { budget_level: 'Low' }],
  ['Dim Sum Regular', 'food', 'k:chinese=1 k:vietnamese=.4 k:thai=.3', ''],
  ['Spice Seeker', 'food', 'k:indian=1 k:thai=.9 k:korean=.5 k:mexican=.3', ''],
  ['Pho & Banh Mi Fan', 'food', 'k:vietnamese=1 k:thai=.5 k:sandwiches=.4 k:chinese=.3', '', { budget_level: 'Low' }],
  ['Tapas Crawler', 'food', 'k:spanish=1 k:wine=.7 k:mediterranean=.4 k:cocktails=.3', ''],
  ['French Bistro Lover', 'food', 'k:french=1 k:wine=.8 k:bakery=.5 cost:$$$=.3', '', { budget_level: 'High' }],
  ['Cuban Coffee Regular', 'food', 'k:cuban=1 k:coffee=.6 k:latin=.6 k:bakery=.3', ''],
  ['Latin Food Explorer', 'food', 'k:latin=1 k:cuban=.7 k:mexican=.5 k:spanish=.3', ''],
  ['Mediterranean Diet', 'food', 'k:mediterranean=1 k:vegan=.5 k:seafood=.5', 'k:burgers=.5'],
  ['Seafood Lover', 'food', 'k:seafood=1 k:sushi=.5 k:beach=.4', ''],
  ['Steakhouse Regular', 'food', 'k:steakhouse=1 k:wine=.6 k:cocktails=.4 cost:$$$=.4', 'k:vegan=.7', { budget_level: 'High' }],
  ['BBQ Pilgrim', 'food', 'k:bbq=1 k:burgers=.6 k:brewery=.5 k:chicken=.4', 'k:vegan=.5'],
  ['Burger Tracker', 'food', 'k:burgers=1 k:american=.6 k:chicken=.4 k:sports-bar=.3', '', { budget_level: 'Low' }],
  ['Cheesesteak Purist', 'food', 'k:cheesesteak=1 k:sandwiches=.7 k:sports-bar=.3', '', { budget_level: 'Low' }],
  ['Sandwich & Deli Fan', 'food', 'k:sandwiches=1 k:bakery=.4 k:breakfast=.4', '', { budget_level: 'Low' }],
  ['Brunch Enthusiast', 'food', 'k:breakfast=1 k:coffee=.6 k:bakery=.5 k:cocktails=.3', ''],
  ['Bakery Hunter', 'food', 'k:bakery=1 k:sweets=.6 k:coffee=.5 k:french=.3', ''],
  ['Sweet Tooth', 'food', 'k:sweets=1 k:ice-cream=.9 k:bakery=.5', ''],
  ['Ice Cream Chaser', 'food', 'k:ice-cream=1 k:sweets=.6 k:beach=.3', ''],
  ['Coffee Snob', 'food', 'k:coffee=1 k:bakery=.4 k:bookstore=.3', 'k:nightclub=.5'],
  ['Vegan Foodie', 'food', 'k:vegan=1 k:mediterranean=.4 k:coffee=.3', 'k:steakhouse=1 k:bbq=.8 k:seafood=.4'],
  ['Food Hall Grazer', 'food', 'k:food-hall=1 k:sandwiches=.3 k:sweets=.3 cost:$=.3', '', { budget_level: 'Low' }],
  ['Comfort Food American', 'food', 'k:american=1 k:burgers=.6 k:breakfast=.5 k:chicken=.5', ''],
  ['Fried Chicken Fan', 'food', 'k:chicken=1 k:burgers=.5 k:bbq=.4', '', { budget_level: 'Low' }],
  ['Caribbean Flavor', 'food', 'k:caribbean=1 k:cuban=.6 k:latin=.5 k:beach=.4', ''],
  ['Korean Food Fan', 'food', 'k:korean=1 k:japanese=.5 k:chinese=.4', ''],
  ['Fine Dining Collector', 'food', 'cost:$$$$=1 cost:$$$=.8 k:wine=.6 k:french=.5', 'cost:$=.5 k:food-hall=.4', { budget_level: 'High', travel_style: 'Luxury' }],
  ['Street Food Grazer', 'food', 'cost:$=.8 k:food-hall=.8 k:mexican=.5 k:sandwiches=.4', 'cost:$$$=.5', { budget_level: 'Low' }],
  ['Pasta & Gelato Romantic', 'food', 'k:italian=.9 k:ice-cream=.7 k:wine=.5', ''],
  ['Pizza & Beer Night', 'food', 'k:pizza=.9 k:brewery=.8 k:sports-bar=.5', '', { budget_level: 'Low' }],
  ['Thai Food Fan', 'food', 'k:thai=1 k:vietnamese=.5 k:indian=.4', ''],
  // --- Drinks and nights out --------------------------------------------
  ['Nightlife Person', 'night', 'k:nightclub=1 k:cocktails=.8 k:bar=.6 k:live-music=.5', 'c:history-culture=.5 k:garden=.4', { interests: ['Music', 'Dancing'] }],
  ['Craft Beer Nerd', 'night', 'k:brewery=1 k:bar=.5 k:bbq=.3', ''],
  ['Cocktail Connoisseur', 'night', 'k:cocktails=1 k:wine=.4 cost:$$$=.3', '', { budget_level: 'High' }],
  ['Wine Lover', 'night', 'k:wine=1 k:french=.5 k:italian=.4 k:cocktails=.3', '', { budget_level: 'High' }],
  ['Dive Bar Regular', 'night', 'k:bar=1 k:sports-bar=.5 cost:$=.4', 'cost:$$$=.6', { budget_level: 'Low' }],
  ['Sports Bar Fan', 'night', 'k:sports-bar=1 c:stadiums=.7 c:sports=.6 k:burgers=.4', ''],
  ['Live Music Junkie', 'night', 'k:live-music=1 k:bar=.5 c:entertainment=.4', ''],
  ['Jazz & Lounge Night', 'night', 'k:live-music=.9 k:cocktails=.8 k:wine=.4', ''],
  ['Club Hopper', 'night', 'k:nightclub=1 k:cocktails=.5', 'c:parks-nature=.6 c:history-culture=.5'],
  ['Pub Crawler', 'night', 'k:bar=.9 k:brewery=.7 k:sports-bar=.3', ''],
  ['Late-Night Eater', 'night', 'k:pizza=.6 k:bar=.6 k:burgers=.6 k:chicken=.5', '', { budget_level: 'Low' }],
  ['Theater Buff', 'night', 'c:entertainment=1 k:cocktails=.3 k:french=.3', ''],
  // --- Culture -----------------------------------------------------------
  ['NYC Art Person', 'culture', 'k:art=1 c:art-museums=.9 k:gallery=.7', '', { interests: ['Art', 'Design'] }],
  ['Museum Marathoner', 'culture', 'c:art-museums=1 k:science=.6 k:history=.5', ''],
  ['History Buff', 'culture', 'k:history=1 c:history-culture=.8 pop:famous=.3', '', { interests: ['History', 'Architecture'] }],
  ['Monument Collector', 'culture', 'k:history=.8 pop:famous=.8 c:history-culture=.5', ''],
  ['Architecture Fan', 'culture', 'c:history-culture=.8 pop:famous=.5 k:art=.3', ''],
  ['Science Nerd', 'culture', 'k:science=1 c:tech=.7 c:art-museums=.3', ''],
  ['Tech Pilgrim', 'culture', 'c:tech=1 k:science=.6 k:coffee=.3', ''],
  ['Bookworm', 'culture', 'k:bookstore=1 k:coffee=.6 c:history-culture=.3', '', { budget_level: 'Low' }],
  ['Gallery Hopper', 'culture', 'k:gallery=1 k:art=.8 k:wine=.3', ''],
  ['Street Art Hunter', 'culture', 'k:art=.9 c:local-life=.4 pop:local=.4', 'cost:$$$=.4', { budget_level: 'Low' }],
  ['Religious Heritage Traveler', 'culture', 'c:history-culture=1 k:history=.5 k:garden=.3', 'k:nightclub=.8 k:bar=.5'],
  ['Literary Tourist', 'culture', 'k:bookstore=.9 c:history-culture=.6 k:coffee=.4', ''],
  ['Film & Entertainment Fan', 'culture', 'c:entertainment=1 k:live-music=.3 k:burgers=.3', ''],
  ['Royal Palace Visitor', 'culture', 'pop:famous=.9 c:history-culture=.8 k:garden=.6', '', { budget_level: 'High' }],
  ['Culture Vulture', 'culture', 'c:art-museums=.8 c:history-culture=.8 c:entertainment=.6', ''],
  // --- Outdoors ----------------------------------------------------------
  ['Outdoor Enthusiast', 'outdoors', 'k:trails=1 c:parks-nature=.9 k:garden=.4', 'c:food=.5', { interests: ['Hiking', 'Nature'] }],
  ['Hiker', 'outdoors', 'k:trails=1 c:parks-nature=.6', 'k:nightclub=.6 k:cocktails=.4'],
  ['Beach Vacationer', 'outdoors', 'k:beach=1 k:seafood=.5 k:ice-cream=.4 c:parks-nature=.3', '', { activity_level: 'Low', travel_style: 'Relaxed' }],
  ['Garden Lover', 'outdoors', 'k:garden=1 c:parks-nature=.6 k:coffee=.3', '', { activity_level: 'Low' }],
  ['Dog Owner', 'outdoors', 'k:dog-park=1 c:parks-nature=.8 k:coffee=.3 k:brewery=.3', ''],
  ['Birdwatcher', 'outdoors', 'c:parks-nature=1 k:trails=.7', 'c:entertainment=.4 k:nightclub=.7'],
  ['Picnic Planner', 'outdoors', 'c:parks-nature=.9 k:bakery=.5 k:food-hall=.4 k:garden=.4', ''],
  ['Runner', 'outdoors', 'c:parks-nature=.9 k:trails=.7 k:coffee=.4 k:vegan=.3', 'k:bar=.3'],
  ['Sports Fan', 'outdoors', 'c:stadiums=1 c:sports=.9 k:sports-bar=.6', ''],
  ['Active Sports Player', 'outdoors', 'c:sports=1 c:parks-nature=.5', ''],
  // --- Local life and shopping -----------------------------------------
  ['Shopaholic', 'local', 'k:shopping=1 c:local-life=.5 cost:$$$=.3', '', { budget_level: 'High' }],
  ['Market Lover', 'local', 'k:food-hall=1 c:local-life=.6 pop:local=.3', ''],
  ['Vintage Hunter', 'local', 'c:local-life=.9 k:bookstore=.5 pop:local=.5', ''],
  ['Local Life Seeker', 'local', 'pop:local=1 c:local-life=.6 k:coffee=.3', 'pop:famous=.6'],
  ['Neighborhood Wanderer', 'local', 'c:local-life=.8 k:coffee=.5 k:bakery=.5 pop:local=.4', ''],
  // --- Travel style -----------------------------------------------------
  ['Luxury Traveler', 'lifestyle', 'cost:$$$$=1 cost:$$$=.9 k:wine=.5 k:cocktails=.4 k:shopping=.4', 'cost:$=.7 cost:free=.4', { budget_level: 'High', travel_style: 'Luxury' }],
  ['Budget Backpacker', 'lifestyle', 'cost:free=.8 cost:$=.7 k:food-hall=.5 k:bar=.4 pop:local=.3 k:trails=.3', 'cost:$$$=.8 cost:$$$$=1', { budget_level: 'Low', travel_style: 'Budget', consistency: 0.7 }],
  ['Photographer', 'lifestyle', 'k:beach=.7 pop:famous=.7 k:garden=.6 c:history-culture=.5 c:parks-nature=.5', '', { interests: ['Photography'] }],
  ['Family with Kids', 'lifestyle', 'k:ice-cream=.9 k:science=.8 c:parks-nature=.7 k:pizza=.5', 'k:bar=.9 k:nightclub=1 k:cocktails=.8', { travel_style: 'Family' }],
  ['First-Time Visitor', 'lifestyle', 'pop:famous=1 c:history-culture=.5 c:art-museums=.4', ''],
  ['Seasoned Local', 'lifestyle', 'pop:local=.9 k:bar=.4 k:coffee=.4', 'pop:famous=.8'],
  ['Retiree', 'lifestyle', 'c:history-culture=.7 k:garden=.7 c:art-museums=.6 k:breakfast=.3', 'k:nightclub=1', { activity_level: 'Low' }],
  ['Business Traveler', 'lifestyle', 'k:steakhouse=.7 k:cocktails=.6 k:coffee=.6 cost:$$$=.4', '', { budget_level: 'High' }],
  ['Digital Nomad', 'lifestyle', 'k:coffee=1 k:vegan=.4 k:food-hall=.4 c:tech=.3', ''],
  ['Student on a Budget', 'lifestyle', 'cost:$=.7 k:pizza=.7 k:bar=.6 cost:free=.5', 'cost:$$$=.6', { budget_level: 'Low', travel_style: 'Budget' }],
  ['Honeymooners', 'lifestyle', 'k:wine=.8 k:beach=.7 k:french=.6 cost:$$$=.5 k:garden=.4', '', { budget_level: 'High', travel_style: 'Romantic' }],
  ['Solo Wanderer', 'lifestyle', 'pop:local=.6 k:coffee=.5 k:bookstore=.5 c:parks-nature=.4', ''],
  ['Wellness Traveler', 'lifestyle', 'k:vegan=.9 k:trails=.6 k:garden=.6 k:coffee=.4', 'k:bar=.5 k:burgers=.5'],
  ['Accessibility-Minded Senior', 'lifestyle', 'c:art-museums=.7 k:garden=.6 k:breakfast=.5 pop:famous=.4', 'k:trails=.6', { activity_level: 'Low' }],
  ['Teen Traveler', 'lifestyle', 'k:ice-cream=.7 k:shopping=.7 k:burgers=.6 c:entertainment=.5', 'c:history-culture=.5'],
  ['Weekend Party Group', 'lifestyle', 'k:nightclub=.8 k:bar=.8 k:brewery=.5 k:chicken=.4', ''],
  ['Road Tripper', 'lifestyle', 'pop:famous=.6 k:burgers=.5 k:bbq=.5 k:trails=.4', ''],
  // --- Two loves at once -------------------------------------------------
  ['Foodie Historian', 'hybrid', 'k:italian=.6 k:history=.7 k:wine=.4 c:history-culture=.5', ''],
  ['Art & Wine', 'hybrid', 'k:art=.8 k:wine=.8 k:gallery=.5', ''],
  ['Beach & Cocktails', 'hybrid', 'k:beach=.9 k:cocktails=.8 k:seafood=.4', ''],
  ['Coffee & Books', 'hybrid', 'k:coffee=.9 k:bookstore=.9', ''],
  ['Brews & Trails', 'hybrid', 'k:brewery=.9 k:trails=.8', ''],
  ['Museum & Cafe', 'hybrid', 'c:art-museums=.8 k:coffee=.7 k:bakery=.4', ''],
  ['Park & Ice Cream', 'hybrid', 'c:parks-nature=.8 k:ice-cream=.8', ''],
  ['History & Pubs', 'hybrid', 'k:history=.8 k:bar=.7 k:brewery=.4', ''],
  ['Science & Sushi', 'hybrid', 'k:science=.8 k:sushi=.7 c:tech=.4', ''],
  ['Garden & Tea', 'hybrid', 'k:garden=.9 k:coffee=.5 k:bakery=.5', ''],
  ['Latin Night Out', 'hybrid', 'k:latin=.7 k:cuban=.7 k:nightclub=.6 k:live-music=.5', ''],
  ['Seafood & Sunsets', 'hybrid', 'k:seafood=.8 k:beach=.7 k:wine=.4', ''],
  ['Gallery & Brunch', 'hybrid', 'k:gallery=.8 k:art=.6 k:breakfast=.7', ''],
  ['Bakery & Bookshop Stroll', 'hybrid', 'k:bakery=.8 k:bookstore=.7 pop:local=.3', ''],
  ['Live Music & BBQ', 'hybrid', 'k:live-music=.8 k:bbq=.7 k:brewery=.4', ''],
  ['Generalist Explorer', 'hybrid', 'c:food=.35 c:history-culture=.35 c:parks-nature=.35 c:art-museums=.35 c:local-life=.35 c:entertainment=.35', '', { consistency: 0.65 }],
  ['Indecisive Tourist', 'hybrid', 'c:food=.25 c:parks-nature=.25 pop:famous=.3', '', { consistency: 0.55, love_rate: 0.1 }],
];

const CUISINE_KINDS = new Set(['italian', 'pizza', 'sushi', 'japanese', 'mexican', 'chinese', 'indian', 'thai', 'vietnamese', 'korean', 'spanish', 'french', 'cuban', 'latin', 'mediterranean', 'seafood', 'steakhouse', 'bbq', 'burgers', 'cheesesteak', 'sandwiches', 'american', 'chicken', 'caribbean', 'vegan', 'breakfast', 'bakery', 'sweets', 'ice-cream', 'coffee', 'food-hall']);
const pretty = (k) => k.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export const ARCHETYPES = RAW.map(([name, group, likes, dislikes, o = {}], id) => {
  const like = weights(likes);
  const dislike = weights(dislikes);
  const kinds = Object.keys(like).filter((f) => f.startsWith('k:')).map((f) => f.slice(2));
  return {
    id,
    name,
    group,
    likes: like,
    dislikes: dislike,
    meta: {
      cuisine_types: kinds.filter((k) => CUISINE_KINDS.has(k)).map(pretty),
      landmark_categories: [...new Set(Object.keys(like).filter((f) => f.startsWith('c:') || f.startsWith('k:')).map((f) => pretty(f.slice(2))))],
      budget_level: o.budget_level || GROUP_DEFAULTS[group].budget_level,
      activity_level: o.activity_level || GROUP_DEFAULTS[group].activity_level,
      travel_style: o.travel_style || GROUP_DEFAULTS[group].travel_style,
      interests: o.interests || kinds.slice(0, 3).map(pretty),
    },
    taste: {
      consistency: o.consistency ?? 0.85,
      love_rate: o.love_rate ?? 0.25,
      skip_rate: o.skip_rate ?? 0.15,
    },
  };
});

// Area mix of the synthetic population: the big imported regions get most
// users, the hand-picked cities the rest.
export const AREA_WEIGHTS = { miami: 0.24, philly: 0.24, 'san-francisco': 0.16, 'silicon-valley': 0.08, nyc: 0.1, madrid: 0.09, milan: 0.09 };

export function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function pickWeighted(entries, rng) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

// What changes between Monte Carlo simulations (see monte-carlo.js):
//   mixVariation   each archetype's share is scaled by 1 + U(-x, x)
//   prefVariance   sd of each user's own scaling of every archetype weight
//   noiseScale     multiplies the rating noise in the interaction simulator
export const DEFAULT_VARIATION = { mixVariation: 0.05, prefVariance: 0.25, noiseScale: 1 };

// The population plan for one simulation: archetype shares plus the
// variation knobs. Deterministic for a seed.
export function populationPlan(seed, variation = DEFAULT_VARIATION) {
  const rng = seededRandom(seed);
  const mix = ARCHETYPES.map((a) => [a.id, 1 + (rng() * 2 - 1) * variation.mixVariation]);
  return { seed, variation, mix };
}

// One synthetic user, the profile shape from the spec. Each user scales
// their archetype's weights by their own factor per feature and adds one or
// two personal likes (a "quirk") and sometimes a personal dislike, so two
// Italian Foodies are not identical and collaborative filtering has
// something per-user to learn.
export function generateUser(n, plan, featureList) {
  const rng = seededRandom(plan.seed * 1_000_003 + n);
  const archetype = ARCHETYPES[pickWeighted(plan.mix, rng)];
  const area = pickWeighted(Object.entries(AREA_WEIGHTS), rng);
  const sd = plan.variation.prefVariance;
  const jitter = (w) => Math.max(0, w * (1 + sd * gaussian(rng)));
  const likes = Object.fromEntries(Object.entries(archetype.likes).map(([f, w]) => [f, jitter(w)]));
  const dislikes = Object.fromEntries(Object.entries(archetype.dislikes).map(([f, w]) => [f, jitter(w)]));
  const quirks = 1 + (rng() < 0.5 ? 1 : 0);
  for (let q = 0; q < quirks; q++) {
    const f = featureList[Math.floor(rng() * featureList.length)];
    if (!(f in likes) && !(f in dislikes)) likes[f] = 0.4 + rng() * 0.4;
  }
  if (rng() < 0.3) {
    const f = featureList[Math.floor(rng() * featureList.length)];
    if (!(f in likes) && !(f in dislikes)) dislikes[f] = 0.3 + rng() * 0.4;
  }
  const t = archetype.taste;
  const clamp01 = (x) => Math.max(0.05, Math.min(0.99, x));
  return {
    user_id: `synthetic_${String(n + 1).padStart(5, '0')}`,
    n,
    archetype: archetype.name,
    archetype_id: archetype.id,
    preferences: { ...archetype.meta, feature_weights: { likes, dislikes } },
    taste_profile: {
      // Filled from the user's simulated ratings (interaction-simulator.js).
      rating_distribution: null,
      skip_rate: t.skip_rate,
      love_rate: clamp01(t.love_rate + 0.05 * gaussian(rng)),
      consistency: clamp01(t.consistency + 0.05 * gaussian(rng)),
    },
    city: area,
    interaction_history: [],
  };
}

export function generateUsers(count, plan, featureList, { offset = 0 } = {}) {
  const out = new Array(count);
  for (let k = 0; k < count; k++) out[k] = generateUser(offset + k, plan, featureList);
  return out;
}

// The Landmarks tab's Neighborhoods subtab (owner, 2026-11-06): scoring,
// colors, filter chips and the Popular / Nearby / All areas lists. The data
// lives in src/data/miamiNeighborhoods.json (built by
// scripts/build-miami-neighborhoods.mjs); every rating is null until a
// separate pipeline fills it, and null shows as "–".
import { distanceMeters } from './geo';

export const DASH = '–';

// The seven ratings, in the order the detail screen shows them.
export const RATING_ROWS = [
  { key: 'safety', label: 'Safety' },
  { key: 'walkability', label: 'Walkability' },
  { key: 'restaurants', label: 'Restaurants' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'averagePropertyPrice', label: 'Average Property Price' },
  { key: 'artAndCulture', label: 'Art and Culture' },
  { key: 'shopping', label: 'Shopping' },
];

// Restaurants opens into these. Price is not scored yet ("Coming soon").
export const RESTAURANT_ROWS = [
  { key: 'quantity', label: 'Quantity' },
  { key: 'price', label: 'Price', comingSoon: true },
  { key: 'diversity', label: 'Diversity' },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;

const mean = (values) => {
  const nums = values.filter(isNum);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

// Restaurants counts as the average of Quantity and Diversity; Price stays out.
export function restaurantsScore(restaurants) {
  if (isNum(restaurants)) return restaurants;
  if (!restaurants || typeof restaurants !== 'object') return null;
  return mean([restaurants.quantity, restaurants.diversity]);
}

// One rating's number, or null.
export function ratingValue(ratings, key) {
  if (!ratings) return null;
  if (key === 'restaurants') return restaurantsScore(ratings.restaurants);
  return isNum(ratings[key]) ? ratings[key] : null;
}

// Average of the seven ratings, nulls skipped, one decimal. All null: null.
export function overallScore(ratings) {
  const avg = mean(RATING_ROWS.map((r) => ratingValue(ratings, r.key)));
  return avg == null ? null : round1(avg);
}

// 0 to under 2 red, 2 to under 4 yellow, 4 to 5 green; null has no band.
export function scoreBand(score) {
  if (!isNum(score)) return 'none';
  if (score < 2) return 'red';
  if (score < 4) return 'yellow';
  return 'green';
}

export const formatScore = (score) => (isNum(score) ? score.toFixed(1) : DASH);

// Subtitle under a card: the tags joined with " · ".
export const tagLine = (n) => (n.tags || []).join(' · ');

// Order (owner, 2026-11-12): All areas, Popular, Nearby. Popular is still the
// tab the screen opens on.
export const TOP_TABS = [
  { id: 'all', label: 'All areas' },
  { id: 'popular', label: 'Popular' },
  { id: 'nearby', label: 'Nearby' },
];

// Single-select chips. Must-See is the featured list; the rest match a tag,
// and the tier chips use the owner's tourist-traffic tiers.
export function chipsFor(data) {
  return [
    { id: 'must-see', label: 'Must-See', featured: true },
    { id: 'art', label: 'Art & Culture', tag: 'Art & Culture' },
    { id: 'food', label: 'Food & Drinks', tag: 'Food & Drinks' },
    { id: 'beaches', label: 'Beaches', tag: 'Beaches' },
    { id: 'family', label: 'Family', tag: 'Family' },
    { id: 'hidden', label: 'Hidden Gems', tag: 'Hidden Gems' },
    ...(data.tiers || []).map((t) => ({ id: t.id, label: t.label, title: t.title, tier: t.neighborhoods })),
  ];
}

export const DEFAULT_CHIP = 'must-see';

const lower = (s) => String(s || '').toLowerCase();

export function chipMatches(n, chip, data) {
  if (!chip) return true;
  if (chip.featured) return (data.featured || []).includes(n.name);
  if (chip.tier) return chip.tier.includes(n.name);
  return (n.tags || []).some((t) => lower(t) === lower(chip.tag));
}

export const matchesSearch = (n, term) => !term.trim() || lower(n.name).includes(lower(term.trim()));

// The list for the chosen top tab, chip and search.
// Returns { items, groups, needsLocation }. `groups` is set for All areas
// (city header + its neighborhoods, in file order).
export function visibleNeighborhoods(data, { tab = 'popular', chipId = DEFAULT_CHIP, search = '', coords = null } = {}) {
  const all = data.neighborhoods || [];
  const chip = chipsFor(data).find((c) => c.id === chipId) || null;
  const keep = (n) => chipMatches(n, chip, data) && matchesSearch(n, search);

  if (tab === 'nearby') {
    if (!coords) return { items: [], groups: null, needsLocation: true };
    const dist = (n) => (n.location ? distanceMeters(coords.lat, coords.lng, n.location.lat, n.location.lng) : Infinity);
    const items = all.filter(keep).sort((a, b) => dist(a) - dist(b));
    return { items, groups: null, needsLocation: false };
  }

  if (tab === 'all') {
    const items = all.filter(keep);
    const groups = [];
    for (const n of items) {
      const last = groups[groups.length - 1];
      if (last && last.city === n.cityGroup) last.items.push(n);
      else groups.push({ city: n.cityGroup, items: [n] });
    }
    return { items, groups, needsLocation: false };
  }

  // Popular: only the featured neighborhoods, in the featured order.
  const byName = new Map(all.map((n) => [n.name, n]));
  const items = (data.featured || []).map((name) => byName.get(name)).filter(Boolean).filter(keep);
  return { items, groups: null, needsLocation: false };
}

// "4 neighborhoods · South Beach, Wynwood, Downtown Miami, Little Havana"
export function exploreSummary(items) {
  const n = items.length;
  return `${n} ${n === 1 ? 'neighborhood' : 'neighborhoods'} · ${items.map((i) => i.name).join(', ')}`;
}

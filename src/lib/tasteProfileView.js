import { PICKABLE_INTERESTS } from '../data/regions';
import { effectiveTagScores } from './tagScores';
import { tasteKindAffinity } from './placeKinds';

// The Taste Profile (Test tab), Vivino-style: what Mapr thinks you like, in
// two parts it already keeps: a score per category, the kinds of place you
// love or skip (from ratings and onboarding swipes).

// What the percentage is called. "Taste Match": how well Mapr matches your
// taste (the % of its recent guesses that were right).
export const SCORE_NAME = 'Taste Match';

const KIND_LABELS = {
  steakhouse: 'Steakhouses', cheesesteak: 'Cheesesteaks', sushi: 'Sushi', japanese: 'Japanese', burgers: 'Burgers', pizza: 'Pizza',
  mexican: 'Mexican', italian: 'Italian', chinese: 'Chinese', thai: 'Thai', indian: 'Indian', vietnamese: 'Vietnamese', korean: 'Korean',
  spanish: 'Spanish', french: 'French', caribbean: 'Caribbean', poke: 'Poke', mediterranean: 'Mediterranean', seafood: 'Seafood',
  bbq: 'BBQ', cuban: 'Cuban', latin: 'Latin', chicken: 'Chicken', sandwiches: 'Sandwiches', breakfast: 'Breakfast & brunch',
  'food-hall': 'Food halls', american: 'American', bakery: 'Bakeries', sweets: 'Desserts', 'ice-cream': 'Ice cream', coffee: 'Coffee',
  vegan: 'Vegan', bar: 'Bars', brewery: 'Breweries', cocktails: 'Cocktail bars', wine: 'Wine bars', nightclub: 'Nightclubs',
  'sports-bar': 'Sports bars', 'live-music': 'Live music', bookstore: 'Bookstores', shopping: 'Shopping', gallery: 'Galleries',
  art: 'Art', history: 'History', science: 'Science', beach: 'Beaches', 'dog-park': 'Dog parks', trails: 'Trails', garden: 'Gardens',
};
export const kindLabel = (k) => KIND_LABELS[k] || k;

// A category score (-100..100) in words.
export function tasteWord(score) {
  if (score >= 40) return 'Loves';
  if (score >= 10) return 'Likes';
  if (score > -10) return 'Neutral';
  if (score > -40) return 'Not really';
  return 'Not for you';
}

const listNames = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function buildTasteProfile({ profile, myReviews = {}, findLandmark = () => null, region = null, now = Date.now() }) {
  const scores = profile ? effectiveTagScores(profile, region, now) : {};
  const categories = PICKABLE_INTERESTS.map((i) => {
    const score = Math.round(Math.max(-100, Math.min(100, scores[i.id] || 0)));
    return { id: i.id, label: i.label, icon: i.icon, score, word: tasteWord(score) };
  }).sort((a, b) => b.score - a.score);
  const affinity = tasteKindAffinity(myReviews, findLandmark, profile);
  const kinds = Object.entries(affinity).filter(([, v]) => v);
  const loves = kinds.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const skips = kinds.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).map(([k]) => k);

  const top = categories.filter((c) => c.score >= 10).slice(0, 2).map((c) => c.label);
  const parts = [];
  if (top.length) parts.push(`You lean toward ${listNames(top)}`);
  if (loves.length) parts.push(`you love ${listNames(loves.slice(0, 3).map((k) => kindLabel(k).toLowerCase()))}`);
  if (skips.length) parts.push(`you skip ${listNames(skips.slice(0, 3).map((k) => kindLabel(k).toLowerCase()))}`);
  const summary = parts.length
    ? `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase())
    : 'Mapr is still learning your taste. Rate places and answer picks to fill this in.';
  return { categories, loves, skips, summary };
}

// ---- Comments ---------------------------------------------------------------
// "I actually like coffee now, but no more pizza" -> what Mapr would change.
const TERMS = [
  ...Object.keys(KIND_LABELS).map((k) => ({ type: 'kind', id: k, label: KIND_LABELS[k], words: [k.replace('-', ' '), KIND_LABELS[k].toLowerCase()] })),
  { type: 'kind', id: 'steakhouse', label: 'Steakhouses', words: ['steak', 'steaks'] },
  { type: 'kind', id: 'coffee', label: 'Coffee', words: ['coffee shops', 'cafes', 'cafe'] },
  { type: 'kind', id: 'bar', label: 'Bars', words: ['bar', 'dive bars'] },
  { type: 'kind', id: 'beach', label: 'Beaches', words: ['beach'] },
  ...PICKABLE_INTERESTS.map((i) => ({ type: 'category', id: i.id, label: i.label, words: [i.label.toLowerCase()] })),
  { type: 'category', id: 'history-culture', label: 'Art & Culture', words: ['museums', 'museum', 'history', 'culture', 'art'] },
  { type: 'category', id: 'parks-nature', label: 'Parks & Nature', words: ['parks', 'nature', 'outdoors', 'hiking'] },
  { type: 'category', id: 'local-life', label: 'Nightlife', words: ['nightlife', 'clubs', 'going out', 'shows'] },
  { type: 'category', id: 'food', label: 'Food', words: ['restaurants', 'eating out'] },
];
const NEG = /\b(don'?t|do not|not|no more|never|hate|dislike|stop|skip|less|tired of|over)\b/;
const POS = /\b(love|like|enjoy|into|more|want|obsessed|big fan)\b/;

export function parseTasteComment(text) {
  const out = [];
  const seen = new Set();
  const clauses = String(text || '').toLowerCase().split(/[.,;!?]|\bbut\b|\band\b|\balthough\b/);
  for (const raw of clauses) {
    const c = ` ${raw.trim()} `;
    if (!c.trim()) continue;
    const dir = NEG.test(c) ? -1 : POS.test(c) ? 1 : 0;
    if (!dir) continue;
    // Longest words first, so "coffee shops" wins over "coffee".
    const hits = TERMS.flatMap((t) => t.words.map((w) => ({ t, w }))).sort((a, b) => b.w.length - a.w.length);
    let rest = c;
    for (const { t, w } of hits) {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (!re.test(rest)) continue;
      rest = rest.replace(re, ' ');
      const key = `${t.type}:${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: t.type, id: t.id, label: t.label, direction: dir });
    }
  }
  return out;
}

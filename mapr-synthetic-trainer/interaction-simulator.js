import { seededRandom } from '../src/lib/maprRank/experiments.js';

// Turns a synthetic user and a real place into one interaction: a 1-5
// rating, a "love", or a skip. The thresholds are the spec's
// simulateInteraction; the noise is the spec's too, scaled per Monte Carlo
// simulation by noiseScale.

// Match of a place (its feature Set) for a user's feature weights, 0..1.
// A place that touches none of the user's features sits at BASE (a low
// match: rated 2-3). Likes pull it toward 1 with diminishing returns;
// dislikes push it toward 0 (a skip).
export const BASE = 0.3;
export function calculateMatch(featureWeights, features) {
  let like = 0;
  let dislike = 0;
  for (const f of features) {
    like += featureWeights.likes[f] || 0;
    dislike += featureWeights.dislikes[f] || 0;
  }
  const up = (1 - BASE) * (1 - Math.exp(-1.6 * like));
  const down = BASE * (1 - Math.exp(-2.5 * dislike)) + 0.35 * dislike * (like > 0 ? 1 : 0.5);
  return Math.max(0, Math.min(1, BASE + up - down));
}

export function simulateInteraction(user, features, rng, noiseScale = 1) {
  let matchScore = calculateMatch(user.preferences.feature_weights, features);
  const noise = (rng() - 0.5) * (1 - user.taste_profile.consistency) * noiseScale;
  matchScore = Math.max(0, Math.min(1, matchScore + noise));
  if (matchScore > 0.7) {
    const rating = Math.round(4 + rng());
    const love = rng() < user.taste_profile.love_rate;
    return { rating, love, skip: false, match: matchScore };
  }
  if (matchScore > 0.4) return { rating: Math.round(3 + rng()), love: false, skip: false, match: matchScore };
  if (matchScore > 0.2) return { rating: Math.round(2 + rng()), love: false, skip: false, match: matchScore };
  return { rating: null, love: false, skip: true, match: matchScore };
}

// The noise-free match, used only as the evaluation's ceiling (what a
// recommender that knew each user's true weights would score).
export const trueMatch = (user, features) => calculateMatch(user.preferences.feature_weights, features);

// A user's 50 interactions with 50 distinct random places from their area.
// Columns go straight into the dataset's typed arrays (lib/dataset.js).
export function simulateUser(user, catalog, { perUser = 50, seed, noiseScale = 1 }) {
  const rng = seededRandom(seed * 7_919 + user.n * 31 + 17);
  const pool = catalog.byArea[user.city];
  const k = Math.min(perUser, pool.length);
  // Partial Fisher-Yates over a copy of the area's place indexes.
  const idx = pool.slice();
  const out = [];
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, skip: 0 };
  for (let s = 0; s < k; s++) {
    const j = s + Math.floor(rng() * (idx.length - s));
    [idx[s], idx[j]] = [idx[j], idx[s]];
    const place = catalog.places[idx[s]];
    const r = simulateInteraction(user, place.features, rng, noiseScale);
    out.push({ item: place.idx, rating: r.rating, love: r.love, skip: r.skip, step: s });
    if (r.skip) counts.skip++;
    else counts[r.rating]++;
  }
  const rated = k - counts.skip;
  user.taste_profile.rating_distribution = Object.fromEntries([5, 4, 3, 2, 1].map((v) => [v, rated ? Math.round((counts[v] / rated) * 100) / 100 : 0]));
  return out;
}

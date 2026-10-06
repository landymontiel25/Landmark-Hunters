import { applyRating, applyVote } from '../src/lib/tagScores.js';
import { kindAffinity, kindBoost } from '../src/lib/placeKinds.js';

// Mapr's tag score, computed by the production functions: every rating moves
// the user's per-category score (tagScores.js applyRating, +10 / +2 / -15,
// half steps after 5 ratings, capped at +-100), a skip is a "not for me"
// vote (applyVote, -6), and kinds of place add kindBoost (placeKinds.js).
//   tag_score(place) = sum of the user's scores for its categories + kindBoost
// Synthetic ratings map to the app's three tiers: 4-5 stars "highly
// recommend", 3 "worth trying", 1-2 "probably skip".

export const tierOf = (rating) => (rating >= 4 ? 'highly-recommend' : rating === 3 ? 'worth-trying' : 'probably-skip');
const NOW = Date.UTC(2026, 9, 1); // one fixed time: no decay inside a simulation

// rows: [{ place, rating (0 = skip), love }]
export function userTagProfile(rows) {
  const state = { scores: {}, at: {}, counts: {} };
  const reviews = {};
  for (const { place, rating, love } of rows) {
    const tags = place.categories;
    let next;
    if (rating === 0) next = applyVote(state, tags, 'no', NOW);
    else {
      const tier = love ? 'highly-recommend' : tierOf(rating);
      next = applyRating(state, tags, tier, NOW);
      reviews[place.id] = { ratingTier: tier, landmarkId: place.id, _place: place.raw };
    }
    Object.assign(state.scores, next.scores);
    Object.assign(state.at, next.at);
    Object.assign(state.counts, next.counts || {});
  }
  const affinity = kindAffinity(reviews, (r) => r._place);
  return { scores: state.scores, counts: state.counts, affinity };
}

export function tagScore(profile, place) {
  let s = 0;
  for (const c of place.categories) s += profile.scores[c] || 0;
  return s + kindBoost(place.raw, profile.affinity);
}

// What the synthetic data says about each taste feature: how much more
// likely a place with it is to be loved / rated 4-5 than the average place,
// overall and per archetype. This is the "which tags are most predictive"
// table, and the per-archetype mean tag scores are the learned priors.
export function featureLift(ds, catalog, nUsers, isPositive) {
  const seen = new Map();
  const liked = new Map();
  let total = 0;
  let pos = 0;
  for (let r = 0; r < ds.start[nUsers]; r++) {
    const p = isPositive(ds, r) ? 1 : 0;
    total++;
    pos += p;
    for (const f of catalog.places[ds.item[r]].features) {
      seen.set(f, (seen.get(f) || 0) + 1);
      liked.set(f, (liked.get(f) || 0) + p);
    }
  }
  const base = pos / total;
  return [...seen]
    .filter(([, n]) => n >= 200)
    .map(([f, n]) => ({ feature: f, interactions: n, positive_rate: liked.get(f) / n, lift: liked.get(f) / n / base }))
    .sort((a, b) => b.lift - a.lift);
}

export function archetypeTagPriors(ds, catalog, nUsers) {
  const sums = new Map();
  for (let n = 0; n < nUsers; n++) {
    const rows = [];
    for (let r = ds.start[n]; r < ds.start[n + 1]; r++) rows.push({ place: catalog.places[ds.item[r]], rating: ds.rating[r], love: ds.love[r] === 1 });
    const prof = userTagProfile(rows);
    const a = ds.users[n].archetype;
    if (!sums.has(a)) sums.set(a, { users: 0, scores: {} });
    const s = sums.get(a);
    s.users++;
    for (const [t, v] of Object.entries(prof.scores)) s.scores[t] = (s.scores[t] || 0) + v;
  }
  const out = {};
  for (const [a, s] of sums) out[a] = { users: s.users, mean_tag_scores: Object.fromEntries(Object.entries(s.scores).map(([t, v]) => [t, Math.round((v / s.users) * 10) / 10]).sort((x, y) => y[1] - x[1])) };
  return out;
}

// Every number behind Mapr's Phase 1 ranking (distance decay, item-item
// similarity, the NCF model, epsilon-greedy exploration) and its daily
// metrics. Nothing in src/lib/maprRank or the nightly job hardcodes a value:
// change it here. Plain .js imports: api/mapr-nightly.js runs this under Node.

// --- Feature flags ----------------------------------------------------------
// Each component can be switched off on its own. `rollout` is the share of
// users (0-100, by a stable hash of the uid, see experiments.js) who get it,
// so a component can go to a small group before everyone.
// The NCF and exploration rollouts ARE the A/B tests: users inside the
// rollout are 'treatment', everyone else 'control'.
export const FEATURES = {
  distanceDecay: { enabled: true, rollout: 100 },
  itemSimilarity: { enabled: true, rollout: 100 },
  ncf: { enabled: true, rollout: 20 },
  exploration: { enabled: true, rollout: 20 },
};

// Salts, so the two A/B tests split users independently of each other and
// of the rollouts (one person can be NCF treatment and exploration control).
export const EXPERIMENT_SALTS = {
  distanceDecay: 'mapr-p1-decay',
  itemSimilarity: 'mapr-p1-collab',
  ncf: 'mapr-p1-ncf',
  exploration: 'mapr-p1-explore',
};

// --- Week 1: distance decay ---------------------------------------------------
// multiplier = 1 / (1 + distance_km / DECAY_DISTANCE_KM). 1.0 at the place
// itself, 0.5 at DECAY_DISTANCE_KM, 0.33 at twice that.
export const DECAY_DISTANCE_KM = 1.5;
// Negative or unknown distances are treated as 0 (multiplier 1).
export const DECAY_MIN_DISTANCE_KM = 0;

// --- Week 2: item-item collaborative filtering --------------------------------
// final_similarity = JACCARD_WEIGHT * jaccard + COSINE_WEIGHT * cosine
export const JACCARD_WEIGHT = 0.6;
export const COSINE_WEIGHT = 0.4;
// Neighbors kept per landmark (the sparse matrix).
export const SIMILAR_TOP_K = 20;
// Check-ins older than this are left out of the co-visit counts.
export const SIMILARITY_WINDOW_DAYS = 90;
// boost += similarity * COLLAB_BOOST_PER_SIMILARITY per liked landmark,
// total capped at COLLAB_MAX_BOOST (+20%).
export const COLLAB_BOOST_PER_SIMILARITY = 0.2;
export const COLLAB_MAX_BOOST = 0.2;
// A liked landmark = a rating at or above this many stars ("I loved it" is 5).
export const COLLAB_LIKED_MIN_STARS = 4;
// Pairs under this blended similarity are not stored.
export const SIMILARITY_MIN = 0.01;
// Firestore caps a document at 1 MiB; a region's matrix that would pass this
// many characters is trimmed (fewest neighbors first) before writing.
export const SIMILARITY_DOC_MAX_CHARS = 900_000;

// --- Week 3: neural collaborative filtering -----------------------------------
export const NCF = {
  embeddingDim: 32,
  hidden: [64, 32],
  dropout: 0.2,
  learningRate: 0.001,
  batchSize: 32,
  epochs: 50,
  patience: 5,
  // L2 regularization on the embeddings and weights touched by a batch.
  l2: 1e-5,
  // Negatives sampled per positive.
  negativesPerPositive: 5,
  // Rolling training window and the temporal split inside it.
  windowDays: 90,
  split: { train: 0.7, val: 0.15, test: 0.15 },
  // A new checkpoint whose holdout accuracy is this much (relative) below the
  // previous one is not promoted.
  maxTestDrop: 0.05,
  // A live model whose accuracy has drifted this far below the one it was
  // promoted with is rolled back to the previous checkpoint.
  maxDriftDrop: 0.1,
  // Serving blend: final = BASE_WEIGHT * normalized_base + NCF_WEIGHT * ncf.
  baseWeight: 0.4,
  ncfWeight: 0.6,
  // Inference over budget for one request: fall back to the base score.
  maxInferenceMs: 10,
  // Most landmark embeddings shipped to the phone (most-visited first).
  maxLandmarks: 2500,
  // Weights are rounded to this many decimals before they are stored.
  storeDecimals: 4,
  // Implicit positives: real check-ins, plus "I loved it" ratings.
  positiveTiers: ['highly-recommend'],
  seed: 1337,
  // Wall-clock budget for one weekly training (split run + refit), so the
  // nightly function finishes inside Vercel's 60 s limit. Training stops at
  // the best epoch so far when it runs out.
  trainBudgetMs: 30_000,
  // User embeddings kept per user (this version and the one before, so a
  // rollback still finds them).
  keepVersions: 2,
};

// --- Week 4: epsilon-greedy exploration --------------------------------------
export const EXPLORATION = {
  baseEpsilon: 0.2,
  newUserDays: 7,
  newUserEpsilon: 0.4,
  lowRating: 3.5,
  lowRatingEpsilon: 0.15,
  highSkipRate: 0.3,
  highSkipEpsilon: 0.25,
  highRating: 4.2,
  highRatingMinRatings: 10,
  highRatingEpsilon: 0.15,
  stagnantRatings7d: 3,
  stagnationBoost: 0.2,
  maxEpsilon: 0.5,
  // Exploitation pool size and exploration set size.
  exploitTop: 50,
  exploreSetSize: 20,
  // Exploration never repeats the places that would fill the exploitation
  // slots of this set.
  exploreExcludeTopExploit: 8,
  // Exploration buckets (shares of the exploration set).
  buckets: { neverSeen: 0.5, atypical: 0.3, trending: 0.2 },
  // novelty_score weights.
  weights: { novelty: 0.5, unexpectedness: 0.3, quality: 0.2 },
  // novelty by times seen: 0 -> 1.0, 1 -> 0.7, 2+ -> 0.2
  noveltyBySeen: [1.0, 0.7, 0.2],
  // unexpectedness by contradiction (1 - cosine): >0.5 -> 1.0, >0.3 -> 0.6, else 0.3
  unexpectedHigh: 0.5,
  unexpectedMid: 0.3,
  unexpectedValues: [1.0, 0.6, 0.3],
  // quality = 0.7 * avg/5 + 0.3 * min(count / reviewCap, 1)
  qualityRatingWeight: 0.7,
  qualityCountWeight: 0.3,
  qualityReviewCap: 100,
  // A place with no public ratings yet is read as this average (neutral).
  qualityPriorRating: 3.0,
  // Places with a public average below this are never explored.
  minQualityRating: 3.0,
  // Places remembered per user for times_seen (device only).
  seenMemoryLimit: 500,
  // Skip rate (for epsilon) is read over this many days of shown picks.
  skipWindowDays: 30,
  // Stagnation: under this many ratings AND under this many distinct places
  // visited in the last 7 days.
  stagnantVisits7d: 5,
};

// --- Monitoring -------------------------------------------------------------
export const METRICS = {
  // A reaction counts toward a shown pick within this many days of it.
  reactionWindowDays: 7,
  // Distance buckets for the distribution.
  nearKm: 1.5,
  midKm: 3,
  // Boost distribution buckets (fractions).
  boostBuckets: [0.05, 0.1],
  // Days of trend shown in the dashboard and the Slack message.
  trendDays: 7,
};

export const TARGETS = {
  matchRate: 0.75,
  skipRate: 0.2,
  repeatRate: 0.3,
  avgRating: 3.8,
  novelty: 0.2,
  near1_5km: 0.5,
  near3km: 0.8,
  latencyP99Ms: 100,
};

export const ALERTS = {
  latencyP99Ms: 150,
  skipRate: 0.35,
  exploreSkipRate: 0.4,
  repeatRate: 0.3,
  stagnatingShare: 0.2,
  // The weekly model job counts as missed after this many days.
  trainingMaxAgeDays: 8,
};

// A/B test decision: two-sided test on CTR at this significance.
export const AB = {
  alpha: 0.05,
  minDays: 7,
  maxDays: 14,
};

// --- Storage ----------------------------------------------------------------
// Firestore paths written by api/mapr-nightly.js (Admin SDK) and read by the
// app (see firestore.rules).
export const MODEL_COLLECTION = 'mapr_models'; // ncf, ncf_prev, signals, status
export const SIMILARITY_COLLECTION = 'mapr_similarity'; // one doc per region
export const USER_MODEL_COLLECTION = 'mapr_user_models'; // one doc per uid, owner-only
export const METRICS_COLLECTION = 'mapr_metrics'; // one doc per UTC day, server-only
// The phone keeps the model docs this long before reading them again.
export const MODEL_CACHE_MS = 12 * 60 * 60 * 1000;
// The weekly retrain runs on this UTC weekday (1 = Monday).
export const RETRAIN_WEEKDAY = 1;
// Most trending places stored in mapr_models/signals.
export const TRENDING_LIMIT = 500;

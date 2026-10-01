import {
  DISAGREEMENT_FULL_REASONS,
  DISAGREEMENT_LEVEL_GAP,
  DISAGREEMENT_PLACE_ONLY_REASONS,
  DISAGREEMENT_REASONS,
} from './maprConstants.js';
import { commentHits } from './commentSignals.js';

// Pure helpers for "your answer changed a lot" (docs/rerating.md). No Firebase.
// Plain .js import paths: kept free of anything browser-only.

const LEVEL_INDEX = { negative: 0, neutral: 1, positive: 2 };
const LEVEL_OF_TIER = { 'highly-recommend': 'positive', 'worth-trying': 'neutral', 'probably-skip': 'negative' };

export const isDisagreementReason = (r) => DISAGREEMENT_REASONS.includes(r);

// 'place-only' | 'full' | 'one-off' | 'blend' for a reason (null for none).
export function reasonKind(reason) {
  if (!reason) return null;
  if (DISAGREEMENT_PLACE_ONLY_REASONS.includes(reason)) return 'place-only';
  if (DISAGREEMENT_FULL_REASONS.includes(reason)) return 'full';
  if (reason === 'one-off') return 'one-off';
  return 'blend'; // 'skip', 'other'
}

export function levelGap(a, b) {
  if (!(a in LEVEL_INDEX) || !(b in LEVEL_INDEX)) return 0;
  return Math.abs(LEVEL_INDEX[a] - LEVEL_INDEX[b]);
}

// Is the new rating two levels from an earlier answer of the SAME user on the
// same place? The earlier answer is their last rating if they have one, else
// their tap (so tap -> rating counts, but a rating then a stale tap does not
// ask again). A one-level change never asks, and Mapr's own guess is not an
// answer, so a miss with only one answer from the user never asks.
//   prev   the existing review doc (or null)
//   place  the existing place_scores doc (or null)
export function disagreementCheck({ prev = null, place = null, newTier }) {
  const newLevel = LEVEL_OF_TIER[newTier] || null;
  let old = null;
  if (prev?.ratingTier && LEVEL_OF_TIER[prev.ratingTier]) old = { kind: 'rating', level: LEVEL_OF_TIER[prev.ratingTier] };
  else if (place?.tap) old = { kind: 'tap', level: place.tap };
  const needed = !!(old && newLevel && levelGap(old.level, newLevel) >= DISAGREEMENT_LEVEL_GAP);
  return { needed, oldLevel: old?.level || null, oldKind: old?.kind || null, newLevel };
}

// Which answer a comment already gives, read with the existing lexicon
// (commentSignals.js): complaints about loudness or crowds, price, food and
// service. A negated complaint ("not loud") says nothing. Returns a reason or
// null when the comment gives no usable signal.
const COMMENT_REASON = {
  loud: 'noise-crowd',
  crowded: 'noise-crowd',
  pricey: 'price',
  'bad-food': 'food',
  'great-food': 'food',
  'slow-service': 'service',
};
export function reasonFromComment(text) {
  for (const h of commentHits(text)) {
    const reason = COMMENT_REASON[h.id];
    if (!reason) continue;
    if (h.negated && h.valence < 0) continue;
    return reason;
  }
  return null;
}

// Shown in the "What happened?" modal, in this order.
export const DISAGREEMENT_OPTIONS = [
  { reason: 'food', label: 'Food' },
  { reason: 'service', label: 'Service' },
  { reason: 'price', label: 'Price' },
  { reason: 'noise-crowd', label: 'Noise or crowd' },
  { reason: 'changed-mind', label: 'I changed my mind' },
  { reason: 'one-off', label: 'First visit was a one-off' },
  { reason: 'wrong-type', label: 'I was wrong about this type of place' },
  { reason: 'other', label: 'Other' },
];

// A review's "rated at" in ms: ratedAt, else the old updatedAt (docs written
// before ratedAt existed are never backfilled).
export function ratedAtMs(review) {
  if (!review) return null;
  if (typeof review.ratedAt === 'number') return review.ratedAt;
  const u = review.updatedAt;
  if (typeof u === 'number') return u || null;
  if (u?.toMillis) return u.toMillis();
  if (typeof u?.seconds === 'number') return u.seconds * 1000;
  return null;
}

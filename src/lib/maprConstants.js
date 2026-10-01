// Every number, threshold, window and cutoff behind Mapr's measurement
// lives here, with what it means, so nothing is a magic value in a component.
// Later measurement items add to this file.

// --- Where a pick was shown (recommendation_log.surface) ---------------
export const SURFACES = ['map-sheet', 'mapr-tab', 'chat'];

// --- Hidden prediction (src/lib/maprPrediction.js) ---------------------
// Saved with each shown pick as `predicted`. Never rendered or returned to
// the UI: it exists only so we can later compare it with the real answer.
export const PREDICTION_LEVELS = ['positive', 'neutral', 'negative'];

// A tag counts as evidence only once this many ratings sit behind it
// (profile.tagCounts, summed over every region). One rating is a guess.
export const PREDICTION_MIN_TAG_RATINGS = 2;
// A place needs at least this many evidence tags, or the prediction is null.
export const PREDICTION_MIN_EVIDENCE_TAGS = 1;
// The user needs at least this many ratings in all (sum of tagCounts) before
// we predict anything for them.
export const PREDICTION_MIN_TOTAL_RATINGS = 5;
// The place's average tag score is divided by the user's own score range:
// their largest absolute tag score in the region view, but never less than
// this (one "highly recommend" is 10 points), so a user whose scores are all
// tiny does not have every tag blown up to look extreme.
export const PREDICTION_MIN_SCALE = 10;
// Normalized average (-1..1) at or above this predicts 'positive'.
export const PREDICTION_POSITIVE_CUTOFF = 0.25;
// At or below this predicts 'negative'. Between the two is 'neutral'.
export const PREDICTION_NEGATIVE_CUTOFF = -0.25;

// --- Match-rate counting (src/lib/matchRate.js) -------------------------
// A place counts once per user per this many days, however many times it was
// shown, so a place re-shown every refresh does not inflate the denominator.
export const MATCH_WEEK_DAYS = 7;
export const MATCH_WEEK_MS = MATCH_WEEK_DAYS * 24 * 60 * 60 * 1000;

// --- Shown-pick logging ---------------------------------------------------
// How much of a chat/Mapr-tab card must be on screen to count as seen.
export const SHOWN_VISIBLE_RATIO = 0.5;
// How many already-logged (setId, place) pairs are remembered on the device,
// so reopening the app on the same cached set does not log it twice.
export const SHOWN_MEMORY_LIMIT = 300;

// --- Marking taps and ratings that came from a pick (src/lib/pickMarks.js) --
// A tap or rating counts as "from a Mapr pick" only if the place was shown as
// a pick to this user within this window before the reaction.
export const PICK_MARK_WINDOW_DAYS = 7;
export const PICK_MARK_WINDOW_MS = PICK_MARK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
// Most places remembered per user on the device (oldest dropped first).
export const PICK_MARK_LIMIT = 200;

// --- Match rate (computeMatchRate in src/lib/matchRate.js) ---------------
// match rate = weighted positive reactions / weighted all reactions, on
// Mapr picks only. A check-in rating says more than a pre-visit tap.
export const MATCH_WEIGHT_RATING = 2;
export const MATCH_WEIGHT_TAP = 1;
// The match-rate target applies to a user once they have this many ratings.
export const MATCH_ELIGIBLE_MIN_RATINGS = 10;

// --- How Mapr learns (src/lib/maprLearning.js, docs/how-mapr-learns.md) ----
// Mapr learns from three signals only: ratings, taps (pick_feedback) and
// comments. Levels: positive = "I'd go" tap / "I loved it" rating; neutral =
// "Not sure" / "It was ok"; negative = "Not for me" / "Didn't like it".
//
// TYPE score (the existing per-region tag scores, users/{uid}.tagScores):
// points added to each of the place's tags. A tap is lighter than a rating.
export const RATING_TAG_DELTA = { positive: 10, neutral: 2, negative: -15 };
export const TAP_TAG_DELTA = { positive: 4, neutral: 0, negative: -6 };

// Comment text (src/data/commentLexicon.js): points per matched phrase on the
// tag it maps to, the most one rating's comment can move any one tag, and how
// many different tags it may touch. A negated praise ("not good") counts this
// fraction of a normal complaint; a negated complaint ("not loud") does nothing.
export const COMMENT_PRAISE_DELTA = 2;
export const COMMENT_COMPLAINT_DELTA = -3;
export const COMMENT_CAP_PER_TAG = 4;
export const COMMENT_MAX_TAGS = 4;
export const COMMENT_NEGATED_PRAISE_FACTOR = 0.5;

// PLACE score (per user, per landmark: users/{uid}/place_scores/{landmarkId}).
// Separate from the type score so one bad restaurant does not condemn food.
export const PLACE_TAP_DELTA = { positive: 4, neutral: 0, negative: -6 };
export const PLACE_RATING_DELTA = { positive: 20, neutral: 2, negative: -30 };
// A place's comment moves its score by the sum of its tag deltas times this,
// never beyond +/- PLACE_COMMENT_CAP.
export const PLACE_COMMENT_MULT = 1;
export const PLACE_COMMENT_CAP = 6;
export const PLACE_SCORE_CAP = 100;

// "I'd go" tap, then a "Didn't like it" rating: Mapr was wrong about this
// place. The place drops a lot (extra, on top of the rating itself), the type
// drops a little (the rating's tag effect is scaled by MISS_TYPE_FACTOR), and
// a half miss is recorded (missWeight on the place_scores doc) for the later
// taste-score item. Keys are `${tap level}>${rating level}`.
export const PLACE_MISS_DELTA = -20;
export const MISS_TYPE_FACTOR = 0.5;
export const MISS_WEIGHTS = { 'positive>negative': 0.5 };

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

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

// --- Changed answers on one place (src/lib/rerating.js, docs/rerating.md) ---
// Two of the user's OWN answers on the same place this many levels apart
// (levels run negative=0, neutral=1, positive=2) trigger "What happened?".
export const DISAGREEMENT_LEVEL_GAP = 2;
// Reasons the user can give (and what is stored in review.disagreement.reason).
export const DISAGREEMENT_REASONS = ['food', 'service', 'price', 'noise-crowd', 'changed-mind', 'one-off', 'wrong-type', 'other', 'skip'];
// Food / service / price / noise-or-crowd: the drop stays on that one place;
// the place score moves, the type (tag) scores do not.
export const DISAGREEMENT_PLACE_ONLY_REASONS = ['food', 'service', 'price', 'noise-crowd'];
// "I changed my mind" and "I was wrong about this type of place": the newest
// answer counts fully, on the place and on the type (the old answer is taken out).
export const DISAGREEMENT_FULL_REASONS = ['changed-mind', 'wrong-type'];
// "First visit was a one-off": the two answers are averaged to the middle
// level, neutral, for scoring.
export const DISAGREEMENT_ONE_OFF_LEVEL = 'neutral';
// Skip (and "Other", which gives Mapr no usable cause): the newest answer
// counts this much and the older one the rest.
export const DISAGREEMENT_NEW_WEIGHT = 0.7;
export const DISAGREEMENT_OLD_WEIGHT = 0.3;

// --- Taste score (src/lib/tasteScore.js, docs/taste-score.md) -------------
// The user-facing "how well does Mapr know you" number: credit-weighted hits
// over the user's last TASTE_WINDOW predictions. A prediction is the hidden
// guess saved with a shown pick, paired with the user's NEWEST answer on that
// place (a rating or a tap) given after the pick was shown.
export const TASTE_WINDOW = 20;
// "Learning..." until this many predictions have been answered.
export const TASTE_MIN_GUESSES = 5;
// The display never goes above 99% ...
export const TASTE_DISPLAY_CAP = 99;
// ... except 100% when the last this-many predictions were all full hits.
export const TASTE_PERFECT_WINDOW = 100;
// Credit per prediction: same level = hit, one level off = small miss, two
// levels off = big miss.
export const TASTE_HIT_CREDIT = 1;
export const TASTE_SMALL_MISS_CREDIT = 0.5;
export const TASTE_BIG_MISS_CREDIT = 0;
// "Place wrong, type right" (missWeight on the place_scores doc, from an "I'd
// go" tap then a "Didn't like it" rating) counts as half a miss: the
// prediction earns this much, which is 1 minus the recorded miss weight.
export const TASTE_HALF_MISS_CREDIT = 1 - MISS_WEIGHTS['positive>negative'];
// Estimate from past ratings (src/lib/tasteEstimate.js), shown only until the
// live score has TASTE_MIN_GUESSES guesses: replay starts once the user has
// this many earlier ratings (same floor predictLevel itself needs).
export const TASTE_ESTIMATE_MIN_HISTORY = PREDICTION_MIN_TOTAL_RATINGS;
// Score history (users/{uid}/taste_history): a new snapshot is written after
// an answer at most once per this long, or sooner once this many more ratings
// sit behind the score than at the last snapshot.
export const TASTE_SNAPSHOT_MIN_MS = 24 * 60 * 60 * 1000;
export const TASTE_SNAPSHOT_EVERY_ANSWERS = 5;
// Bumped when the scoring rules change, so old snapshots stay comparable.
export const TASTE_HISTORY_VERSION = 1;
// After an answer, the score is recomputed once things go quiet for this long.
export const TASTE_RECOMPUTE_DELAY_MS = 2000;

// --- Who a Mapr request is for (src/lib/requestFor.js) --------------------
// Asked before every Mapr request. 'group' requests never use the user's own
// taste to choose places.
export const REQUEST_FOR_VALUES = ['solo', 'group'];

// --- Check-in location rule (src/lib/checkinRules.js, docs/onboarding.md) ---
// ONE switch for the GPS rule. OFF (default) keeps today's behavior: any
// check-in goes through wherever you are, and is saved tagged 'unverified'.
// ON: a real check-in (not a rating-only claim) needs a GPS fix within the
// place's radius, with accuracy no worse than CHECKIN_MAX_ACCURACY_METERS;
// those are saved tagged 'verified'. Everything the rule needs is client side
// (the Firestore rules cannot see the user's position), so 'verified' is a
// client-reported tag, not server-proven.
export const REQUIRE_GPS_CHECKIN = false;
// How close you must be (meters) to a place that has no radius of its own.
// Big venues (parks, malls, beaches, national parks) keep their own larger
// `checkInRadiusMeters` in src/data/landmarks.*.js, which replaces this number
// for that place only.
export const CHECKIN_RULE_METERS = 30;
// A fix whose reported accuracy is worse than this (meters) cannot verify a
// check-in; it is too coarse to say whether you are at the place.
export const CHECKIN_MAX_ACCURACY_METERS = 50;
// The two values saved on every real check-in's `verification` field.
export const CHECKIN_VERIFICATIONS = ['unverified', 'verified'];

// --- Onboarding first check-in (src/components/OnboardingCheckinStep.jsx) --
// After the 10 onboarding ratings, new accounts with no check-in yet are
// offered ONE skippable first check-in, only at a place they are actually
// near. Set to false to remove the step; nothing else depends on it.
export const ONBOARDING_FIRST_CHECKIN = true;

// --- Saving a pick tap (src/lib/pickFeedback.js, docs/pick-buttons.md) -----
// A tap on I'd go / Not sure / Not for me is written to Firestore
// pick_feedback FIRST; the screen and the device copy update only after that
// write lands. A failed write is retried this many attempts in all (the first
// try included), waiting PICK_VOTE_RETRY_BASE_MS before the second try and
// doubling each time (600 ms, then 1200 ms). Still failing: the card shows an
// error with a Try again button.
export const PICK_VOTE_SAVE_ATTEMPTS = 3;
export const PICK_VOTE_RETRY_BASE_MS = 600;
// While the phone is offline a tap is held as a pending retry (not a saved
// vote) and flushed when it is back online. Most pending taps kept per user
// on the device (oldest dropped first).
export const PICK_VOTE_PENDING_LIMIT = 50;

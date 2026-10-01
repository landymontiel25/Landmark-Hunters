// Which Claude model each AI feature runs on -- change a feature's model
// here, in one line. Keep plan-ai's per-token prices (api/plan-ai.js
// PRICE_PER_TOKEN) in step with its model.

// Plan Your Trip's "Anything specific?" box and custom interests: a small,
// cheap model is plenty for matching a phrase to catalog landmarks.
export const INTEREST_CLASSIFIER_MODEL = 'claude-haiku-4-5';

// Mapr's chat replies, including the one call that builds a planned trip.
export const PLAN_AI_MODEL = 'claude-haiku-4-5';

// Mapr Picks ranking (api/mapr-picks.js): reads a shortlist and returns a
// ranked JSON list.
export const MAPR_PICKS_MODEL = 'claude-haiku-4-5';

// One-line reasons for an already-ranked set of nearby picks ("Picked for
// you right now" on the Map tab). Writing a short line per place
// is small work; the ranking itself is done in code.
export const PICK_REASONS_MODEL = 'claude-haiku-4-5';

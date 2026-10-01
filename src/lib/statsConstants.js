// Every number behind the owner-only admin stats page (api/admin-stats.js,
// src/screens/AdminStats.jsx) and the daily study summary
// (api/study-summary.js). Nothing here is shown to normal users and nothing
// here is known to Mapr (api/_lib/appHelp.js stays free of it).

const DAY_MS = 24 * 60 * 60 * 1000;
export const STATS_DAY_MS = DAY_MS;
export const STATS_WEEK_MS = 7 * DAY_MS;

// --- The app's life -----------------------------------------------------
// Date (YYYY-MM-DD, UTC) of the FIRST user's createdAt. Week 1 of the app's
// life starts here. Not known from the code: set it once the first account's
// createdAt is read from the stats page. Until then the server uses the
// earliest createdAt it finds among users.
export const APP_COHORT_START = null;

// --- Goals (what green means) ----------------------------------------------
export const GOAL_MATCH_RATE_PCT = 70; // above, among users with 10+ ratings
export const GOAL_RETENTION_D30_PCT = 60; // above
export const GOAL_RETENTION_D1_PCT = 40; // above
export const GOAL_RATINGS_PER_SESSION = { min: 3, max: 5 }; // inside this range
export const GOAL_CHECKINS_PER_DAILY_USER = 1.5; // at least
export const GOAL_FIRST_CHECKIN_HOURS = 2; // under (median)
export const GOAL_REFERRAL_COEFFICIENT = 1.0; // above
export const GOAL_VIRAL_SIGNUP_PCT = 40; // above
// Not set by the owner's brief; the study asks about 80% and 90%, so 80 is
// the goal line shown for the average taste score.
export const GOAL_TASTE_SCORE_AVG = 80;
// Week-over-week new-user growth goal by week of the app's life (the week
// being measured). "20-30%" in the brief: met once it reaches the low end.
export const GROWTH_GOALS = [
  { fromWeek: 1, toWeek: 4, minPct: 100, label: '100%+' },
  { fromWeek: 5, toWeek: 8, minPct: 50, label: '50%' },
  { fromWeek: 9, toWeek: Infinity, minPct: 20, label: '20-30%' },
];

// --- Definitions ----------------------------------------------------------
// A "session" is one day the app was opened (an open_days doc). Ratings per
// session = ratings given on open days / open days.
// New users who count toward "10 ratings by Day 2".
export const RATINGS_BY_DAY2 = { ratings: 10, days: 2 };
// "New users" for the viral signup rate = accounts created in this window.
export const VIRAL_WINDOW_DAYS = 30;
// Smallest group a breakdown shows (fewer are folded away so a row can never
// point at one person).
export const STATS_MIN_GROUP = 3;
// Fewest users/rows before a metric is shown instead of "Can't measure yet".
export const STATS_MIN_SAMPLE = 1;

// --- Page + route ----------------------------------------------------------
export const ADMIN_STATS_POLL_MS = 30 * 1000; // page refresh while visible
export const STATS_CACHE_MS = 60 * 1000; // server keeps a summary this long
export const STATS_PAGE_SIZE = 500; // docs per Firestore read batch
export const STATS_MAX_DOCS = 100000; // per collection, then it is marked truncated
export const BACKFILL_MAX_USERS = 400; // users per backfill call

// --- The long study (daily summary) ---------------------------------------
export const STUDY_THRESHOLDS = [80, 90]; // taste scores to reach
export const STUDY_ACCURACY_AT = [5, 10, 20, 50, 100]; // ratings counts
export const STUDY_ACCURACY_AT_TOLERANCE = 0.25; // snapshot within +/-25% of N (at least +/-2)
export const STUDY_SERIES_DAYS = 120; // daily Mapr-vs-baseline points kept
export const STUDY_FLAT_SNAPSHOTS = 4; // last N snapshots ...
export const STUDY_FLAT_MAX_GAIN = 1; // ... gained no more than this many points = stopped rising
export const STUDY_RETURN_DAYS = [7, 30]; // score vs coming back
export const STUDY_MIN_CORRELATION_USERS = 5;
export const STUDY_COLLECTION = 'study_summaries';

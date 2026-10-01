// Daily check-in streak + milestone badges (item i1) -- both derived
// entirely from the same check-in history Profile already fetches, so
// there's nothing new to store or keep in sync.
import { isRealCheckin } from './leaderboard';

// Local calendar day, not UTC -- a streak day has to mean "today" on the
// traveler's own clock. Using getUTCFullYear/Month/Date here previously
// meant the day boundary landed at UTC midnight (7-8pm in US timezones),
// which read as an arbitrary, inconsistent cutoff rather than "resets at
// midnight" the way every other daily-streak app works.
// Exported for pairStreaks.js -- a pair's daily entries are keyed by the
// same local calendar day.
export const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Exported for pairStreaks.js -- shared freezes and the recovery mission
// both reset monthly, on the 1st, local time.
export const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

// Minimum distinct landmarks engaged with (voting or a 0-point "Rate a
// Landmark" claim) for a day to count toward the daily quota -- solo streaks
// used this to stay alive without a real visit; the dual-streak system (see
// the streaks/ Firestore collection) reuses the same number and the same
// "distinct landmarks today" counting for its own per-person daily 3.
export const PICKS_STREAK_THRESHOLD = 3;

/**
 * Distinct landmarks engaged with today (local time) toward the daily quota
 * -- votes and 0-point ratings combined. For a "2/3 rated today" counter.
 */
export function todaysActionCount(checkins, pickFeedback = [], now = new Date()) {
  const today = dayKey(now);
  const ids = new Set();
  for (const f of pickFeedback || []) {
    if (!f.at || !f.landmarkId || dayKey(new Date(f.at)) !== today) continue;
    ids.add(f.landmarkId);
  }
  for (const c of checkins || []) {
    if (isRealCheckin(c) || !c.createdAt?.seconds || !c.landmarkId) continue;
    if (dayKey(new Date(c.createdAt.seconds * 1000)) !== today) continue;
    ids.add(c.landmarkId);
  }
  return ids.size;
}

/**
 * Whether a stored (server-authority) streak doc is still alive right now.
 * count/lastCompletedDay only change when a day is closed, so a streak whose
 * last completed day is older than yesterday (and isn't bridged by a freeze)
 * is already broken even though the doc still holds its old count -- the
 * next close resets it to 1, but until then the UI must not keep showing it.
 */
export function isStoredStreakLive(streak, now = new Date()) {
  if (!streak || !(streak.count > 0)) return false;
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return (
    streak.lastCompletedDay === today ||
    streak.lastCompletedDay === yesterday ||
    (streak.frozenDays || []).includes(yesterday) ||
    // A freeze spent today holds the streak across today's gap too (the next
    // close bridges it), so it must not read as lapsed until the day ends.
    (streak.frozenDays || []).includes(today)
  );
}

/**
 * Whether `today` (a dayKey) is already taken care of for this streak: the
 * day was closed, or a freeze was spent on it. Every "at risk / secured"
 * indicator (header badges, warning banner, Profile) shares this so none of
 * them tells someone who just used a freeze that their streak is still
 * about to lapse.
 */
export function isDayHeld(streak, today) {
  return !!streak && (streak.lastCompletedDay === today || (streak.frozenDays || []).includes(today));
}

/** The count to DISPLAY for a stored streak doc: 0 once it has lapsed. */
export function displayStreakCount(streak, now = new Date()) {
  return isStoredStreakLive(streak, now) ? streak.count : 0;
}

/**
 * Milliseconds until the current LOCAL day ends. Used by the dual-streak
 * countdown (per-pair deadline is the latest local midnight among members --
 * see the streaks/ day-close design), the solo streak-lapse countdown
 * below, and anywhere else a "resets at midnight" countdown is needed.
 */
export function msUntilStreakLapse(now = new Date()) {
  const nextLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return nextLocalMidnight.getTime() - now.getTime();
}

/** Whether a real (points-earning) check-in happened today (local time) -- used to warn when an active solo streak is about to lapse. */
export function hasCheckedInToday(checkins, now = new Date()) {
  const today = dayKey(now);
  return checkins.some((c) => isRealCheckin(c) && c.createdAt?.seconds && dayKey(new Date(c.createdAt.seconds * 1000)) === today);
}

// Day-keys (local time) with at least `minActions` distinct landmarks engaged
// with, combining pick_feedback votes (voted landmarkId + `at` epoch ms)
// and 0-point "Rate a Landmark" claims (ratingOnly checkins, by their
// createdAt).
function dailyActionDayKeys(checkins, pickFeedback, minActions = PICKS_STREAK_THRESHOLD) {
  const idsByDay = new Map();
  const add = (key, id) => {
    if (!key || !id) return;
    if (!idsByDay.has(key)) idsByDay.set(key, new Set());
    idsByDay.get(key).add(id);
  };
  for (const f of pickFeedback || []) {
    if (!f.at || !f.landmarkId) continue;
    add(dayKey(new Date(f.at)), f.landmarkId);
  }
  for (const c of checkins || []) {
    if (isRealCheckin(c) || !c.createdAt?.seconds || !c.landmarkId) continue;
    add(dayKey(new Date(c.createdAt.seconds * 1000)), c.landmarkId);
  }
  const days = new Set();
  for (const [key, ids] of idsByDay) {
    if (ids.size >= minActions) days.add(key);
  }
  return days;
}

/**
 * Whether today's SOLO streak is already secured -- a real check-in, or
 * PICKS_STREAK_THRESHOLD distinct landmarks voted/rated. Supersedes
 * hasCheckedInToday wherever "is the streak safe today" (not "did you
 * literally check in") is the actual question -- the streak-risk banner
 * and Profile's streak messaging both want this one. Separate from (and
 * independent of) the dual streak's own per-pair daily quota.
 */
export function hasSecuredStreakToday(checkins, pickFeedback = [], now = new Date()) {
  return hasCheckedInToday(checkins, now) || dailyActionDayKeys(checkins, pickFeedback).has(dayKey(now));
}

/**
 * Consecutive days (local time) with at least one real check-in -- or a
 * qualifying votes/ratings day, see hasSecuredStreakToday -- counting back
 * from today. A day with neither yet doesn't break the streak until
 * tomorrow -- so "yesterday, but not yet today" still counts. This is the
 * SOLO streak (one 🔥 in the header/Profile); the dual streak (🔥🔥) is a
 * separate, pair-scoped count from pairStreaks.js and doesn't feed this.
 */
export function computeStreakDays(checkins, now = new Date(), pickFeedback = []) {
  const days = new Set();
  for (const c of checkins) {
    if (!isRealCheckin(c)) continue;
    const sec = c.createdAt?.seconds;
    if (!sec) continue;
    days.add(dayKey(new Date(sec * 1000)));
  }
  for (const key of dailyActionDayKeys(checkins, pickFeedback)) days.add(key);
  if (days.size === 0) return 0;

  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Rarity is a fixed design-time tier, not something measured across real
// users -- the app has no population-level stats on who holds which badge.
// It only exists to give the Full Stats page a "show the impressive ones
// first" sort; common < uncommon < rare < legendary.
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

// Threshold for "Regional Master" -- deliberately steep ("make it a ton" per
// request): most of the smaller regions (Frankfurt, Coral Gables, Key
// Biscayne) don't even have this many landmarks total, so it's only
// reachable in the larger cities. That's intentional, not an oversight.
export const REGIONAL_MASTER_THRESHOLD = 20;

// The full catalog of every badge that can ever be earned -- Full Stats
// renders all of these (earned ones in color, the rest grayed out),
// while computeBadges below just filters it down to what you've earned.
// `kind` keys into the `counts` map computeBadges/closestUnearnedBadge
// build -- checkins/cities/streak/milestone come from this file's own
// stats; everything past `welcome` is fed in via the `extra` param, computed
// in BadgesContext (src/lib/badgeStats.js + leaderboard.js have the actual
// derivations -- this file only holds the catalog + the threshold check).
export const ALL_BADGES = [
  { id: 'checkins-1', kind: 'checkins', n: 1, label: 'First Steps', icon: '\u{1F463}', description: 'Your first check-in', rarity: 'common' },
  { id: 'checkins-5', kind: 'checkins', n: 5, label: 'Explorer', icon: '\u{1F9ED}', description: '5 check-ins', rarity: 'common' },
  { id: 'checkins-10', kind: 'checkins', n: 10, label: 'Adventurer', icon: '\u{26F0}\u{FE0F}', description: '10 check-ins', rarity: 'uncommon' },
  { id: 'checkins-25', kind: 'checkins', n: 25, label: 'Legend', icon: '\u{1F3C6}', description: '25 check-ins', rarity: 'rare' },
  { id: 'expedition', kind: 'checkins', n: 50, label: 'Expedition', icon: '\u{1F392}', description: '50 check-ins', rarity: 'rare' },
  { id: 'cartographer', kind: 'checkins', n: 100, label: 'Cartographer', icon: '\u{1F5FA}\u{FE0F}', description: '100 check-ins', rarity: 'legendary' },
  { id: 'cities-2', kind: 'cities', n: 2, label: 'City Hopper', icon: '\u{1F306}', description: 'Checked in across 2 cities', rarity: 'common' },
  { id: 'cities-3', kind: 'cities', n: 3, label: 'Globetrotter', icon: '\u{1F30D}', description: 'Checked in across 3 cities', rarity: 'uncommon' },
  { id: 'streak-3', kind: 'streak', n: 3, label: '3-Day Streak', icon: '\u{1F525}', description: 'Checked in 3 days in a row', rarity: 'common' },
  { id: 'streak-7', kind: 'streak', n: 7, label: '7-Day Streak', icon: '\u{1F525}', description: 'Checked in 7 days in a row', rarity: 'uncommon' },
  { id: 'streak-30', kind: 'streak', n: 30, label: '30-Day Streak', icon: '\u{1F525}', description: 'Checked in 30 days in a row', rarity: 'legendary' },
  { id: 'welcome', kind: 'milestone', n: 1, label: 'Welcome', icon: '\u{1F389}', description: 'Completed onboarding', rarity: 'common' },

  // Check-In Depth
  { id: 'photo-contributor', kind: 'photoCheckins', n: 10, label: 'Photo Contributor', icon: '\u{1F4F8}', description: '10 check-ins with a photo', rarity: 'uncommon' },
  { id: 'reviewer', kind: 'fiveStarReview', n: 1, label: 'Reviewer', icon: '\u{2B50}', description: 'Loved a place you visited and said so in a review', rarity: 'common' },
  { id: 'describer', kind: 'factLandmarks', n: 3, label: 'Describer', icon: '\u{1F4DD}', description: 'Added facts to 3 landmarks', rarity: 'uncommon' },

  // Social
  { id: 'friend-finder', kind: 'friends', n: 5, label: 'Friend Finder', icon: '\u{1F465}', description: 'Added 5 friends', rarity: 'common' },
  { id: 'competitor', kind: 'top10', n: 1, label: 'Competitor', icon: '\u{1F3C5}', description: 'Reached the top 10 leaderboard', rarity: 'rare' },
  { id: 'tag-team', kind: 'tagTeam', n: 1, label: 'Tag Team', icon: '\u{1F91D}', description: 'Checked in with a friend within 24 hours', rarity: 'uncommon' },

  // Geographic Coverage
  { id: 'regional-master', kind: 'regionMax', n: REGIONAL_MASTER_THRESHOLD, label: 'Regional Master', icon: '\u{1F4CD}', description: `Checked into ${REGIONAL_MASTER_THRESHOLD} landmarks in one region`, rarity: 'rare' },
  { id: 'cross-country', kind: 'states', n: 5, label: 'Cross-Country', icon: '\u{1F6E3}\u{FE0F}', description: 'Checked in across 5 states', rarity: 'rare' },
  { id: 'continent-hopper', kind: 'countries', n: 3, label: 'Continent Hopper', icon: '\u{2708}\u{FE0F}', description: 'Checked in across 3 countries', rarity: 'legendary' },

  // Trip Planning
  { id: 'planner', kind: 'tripLandmarks', n: 1, label: 'Planner', icon: '\u{1F5D2}\u{FE0F}', description: 'Created an itinerary', rarity: 'common' },
  { id: 'route-optimizer', kind: 'tripLandmarks', n: 5, label: 'Route Optimizer', icon: '\u{1F9ED}', description: 'Planned a 5+ landmark trip', rarity: 'uncommon' },

  // Variety Challenges
  { id: 'all-star', kind: 'allStarWeek', n: 1, label: 'All-Star', icon: '\u{1F31F}', description: 'Checked into a museum, restaurant, historic site, and nature spot in one week', rarity: 'rare' },
  { id: 'cuisine-explorer', kind: 'cuisineTypes', n: 5, label: 'Cuisine Explorer', icon: '\u{1F37D}\u{FE0F}', description: '5 different food spots', rarity: 'uncommon' },

  // Rare/Timed
  { id: 'night-owl', kind: 'nightOwl', n: 1, label: 'Night Owl', icon: '\u{1F989}', description: 'Checked in between midnight and 6am', rarity: 'rare' },
  { id: 'golden-hour', kind: 'goldenHour', n: 1, label: 'Golden Hour', icon: '\u{1F307}', description: 'Checked in during sunset (6-7pm)', rarity: 'uncommon' },
];

export function computeBadges({ checkinsCount, citiesCount, streakDays, onboardingCompleted = false, extra = {} }) {
  const counts = {
    checkins: checkinsCount,
    cities: citiesCount,
    streak: streakDays,
    milestone: onboardingCompleted ? 1 : 0,
    ...extra,
  };
  return ALL_BADGES.filter((b) => counts[b.kind] >= b.n);
}

/** The unearned badge you're numerically closest to completing (smallest remaining gap), or null once every badge is earned. */
export function closestUnearnedBadge({ checkinsCount, citiesCount, streakDays, onboardingCompleted = false, extra = {} }) {
  const counts = {
    checkins: checkinsCount,
    cities: citiesCount,
    streak: streakDays,
    milestone: onboardingCompleted ? 1 : 0,
    ...extra,
  };
  const unearned = ALL_BADGES.filter((b) => counts[b.kind] < b.n);
  if (unearned.length === 0) return null;
  return unearned.reduce((closest, b) => (b.n - counts[b.kind] < closest.n - counts[closest.kind] ? b : closest));
}

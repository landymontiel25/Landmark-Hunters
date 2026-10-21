// First-run tutorial state (owner's "First-Run Tutorial Build Guide",
// 2026-10-21). One pure reducer, so tests call it without rendering. The Test
// tab's Tutorial 2 (screens/FirstRunLab.jsx) runs it; nothing real uses it yet.
//
// Steps, in order: welcome -> taste -> swipe (with one rating on the first
// "Interested" card) -> checkin -> progress -> done. "skipped" ends the flow
// from any step. The sign-up prompt is not a step: it opens only from its
// triggers (save streak, add friend, keep my ratings).
import { CHECKIN_RULE_METERS } from './maprConstants';

// Ratings goal for the progress ring. The guide asks to test 10 against 15.
export const PROGRESS_GOAL = 10;
export const SWIPES = 3;
// Check in turns on inside this distance, unless the place sets its own.
export const CHECKIN_METERS = CHECKIN_RULE_METERS;
export const SIGNUP_TRIGGERS = ['save_streak', 'add_friend', 'keep_ratings'];

export const FLOW = ['welcome', 'taste', 'swipe', 'rate', 'checkin', 'progress'];
const FINISHED = new Set(['done', 'skipped']);

export function initialFirstRun(now = Date.now()) {
  return {
    step: 'welcome',
    swipesDone: 0,
    ratingsCount: 0,
    checkinsCount: 0,
    tasteChips: [],
    skippedSteps: [],
    startedAt: now,
    completedAt: null,
    outcome: null,
    // The place the one first-run rating is for, set by an "Interested" swipe.
    ratePlace: null,
    hintsShown: {},
    signupDismissals: 0,
  };
}

const addOnce = (list, item) => (list.includes(item) ? list : [...list, item]);

// Where the flow goes after the swipe step's work: back to the cards while
// any are left, else on to check-in.
const afterCard = (s) => (s.swipesDone >= SWIPES ? 'checkin' : 'swipe');

function nextStep(s) {
  switch (s.step) {
    case 'welcome':
      return 'taste';
    case 'taste':
      return 'swipe';
    case 'swipe':
    case 'rate':
      return 'checkin';
    case 'checkin':
      return 'progress';
    case 'progress':
      return 'done';
    default:
      return s.step;
  }
}

function finish(s, step, now) {
  return { ...s, step, completedAt: now, outcome: step === 'skipped' ? 'skipped' : 'done', ratePlace: null };
}

function goTo(s, step, now) {
  return step === 'done' ? finish(s, 'done', now) : { ...s, step };
}

export function firstRunReducer(state, action) {
  const now = action.now ?? Date.now();
  const s = state;
  const ended = FINISHED.has(s.step);
  switch (action.type) {
    case 'NEXT': {
      if (ended) return s;
      const withChips = s.step === 'taste' && action.chips ? { ...s, tasteChips: [...action.chips] } : s;
      return goTo(withChips, nextStep(s), now);
    }
    case 'SKIP_STEP': {
      if (ended) return s;
      const skipped = { ...s, skippedSteps: addOnce(s.skippedSteps, s.step) };
      // Skipping the rating hides it for this place only and goes back to
      // the cards. Skipping the cards ends them and keeps the default feed.
      if (s.step === 'rate') return { ...skipped, step: afterCard(s), ratePlace: null };
      return goTo(skipped, nextStep(s), now);
    }
    case 'SKIP_ALL':
      return ended ? s : finish(s, 'skipped', now);
    case 'SWIPE': {
      if (s.step !== 'swipe' || s.swipesDone >= SWIPES) return s;
      const swiped = { ...s, swipesDone: s.swipesDone + 1 };
      // The first "Interested" asks for one rating, once per run.
      const askRating = action.dir === 'interested' && s.ratingsCount === 0 && !s.skippedSteps.includes('rate') && action.place;
      if (askRating) return { ...swiped, step: 'rate', ratePlace: action.place };
      return { ...swiped, step: afterCard(swiped) };
    }
    case 'RATE':
      if (s.step !== 'rate') return s;
      return { ...s, ratingsCount: s.ratingsCount + 1, ratePlace: null, step: afterCard(s) };
    case 'CHECKIN_OK':
      if (s.step !== 'checkin') return s;
      return { ...s, checkinsCount: s.checkinsCount + 1, step: 'progress' };
    case 'DISMISS_HINT':
      return s.hintsShown[action.key] ? s : { ...s, hintsShown: { ...s.hintsShown, [action.key]: true } };
    case 'SIGNUP_NOT_NOW':
      return { ...s, signupDismissals: s.signupDismissals + 1 };
    case 'RESET':
      // Profile replay: a fresh run. Hints seen stay seen.
      return { ...initialFirstRun(now), hintsShown: s.hintsShown };
    default:
      return s;
  }
}

// Saved per account (or a guest id), so one account's progress and hints
// never show for another.
export const firstRunKey = (uid) => `lh.firstRunLab.${uid || 'guest'}`;

export function loadFirstRun(uid, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(firstRunKey(uid));
    if (raw) return { ...initialFirstRun(), ...JSON.parse(raw) };
  } catch {
    /* private mode or bad JSON: start fresh */
  }
  return initialFirstRun();
}

export function saveFirstRun(uid, state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(firstRunKey(uid), JSON.stringify(state));
  } catch {
    /* storage full or blocked: the run still works, it just won't resume */
  }
}

// Guest state into the account on sign-in: the higher count wins, so a merge
// never lowers one. Steps skipped and hints seen add up.
export function mergeFirstRun(account, guest) {
  if (!guest) return account;
  if (!account) return guest;
  return {
    ...account,
    swipesDone: Math.max(account.swipesDone, guest.swipesDone),
    ratingsCount: Math.max(account.ratingsCount, guest.ratingsCount),
    checkinsCount: Math.max(account.checkinsCount, guest.checkinsCount),
    skippedSteps: [...new Set([...account.skippedSteps, ...guest.skippedSteps])],
    hintsShown: { ...guest.hintsShown, ...account.hintsShown },
    tasteChips: account.tasteChips.length ? account.tasteChips : guest.tasteChips,
  };
}

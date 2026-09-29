// The version of the onboarding flow (swipe cards + notes). Bump this number
// whenever the flow changes enough that everyone should redo it: every
// account whose users/{uid}.onboardingVersion is missing or lower gets the
// "Onboarding has been updated" notification, plus a banner on the Map
// and Mapr tabs that can't be dismissed, until they finish the flow again. Nothing locks the
// app. The Test tab (OnboardingLab) ignores this number.
export const ONBOARDING_VERSION = 1;

export const ONBOARDING_NOTICE_MESSAGE = 'Onboarding has been updated. Finish it to get better picks from Mapr.';

// 'complete': finished this version (or a later one).
// 'new': created the account through sign-up and has never finished
//        onboarding. The flow starts on its own, right after email
//        verification.
// 'update': an account from before onboarding existed (no version), one that
//        finished an older version, or a new account that went through the
//        flow without finishing the cards (onboardingSource becomes
//        'signup-skipped'). Gets the notification and banner, and is never
//        dropped into the flow uninvited.
export function onboardingStatus(profile, current = ONBOARDING_VERSION) {
  const done = Number(profile?.onboardingVersion) || 0;
  if (done >= current) return 'complete';
  if (done === 0 && profile?.onboardingSource === 'signup') return 'new';
  return 'update';
}

// One notification doc per version, so bumping the version notifies everyone
// again while a repeat load never sends a second copy.
export const onboardingNoticeId = (version = ONBOARDING_VERSION) => `onboarding-v${version}`;

export function needsOnboardingNotice(profile, current = ONBOARDING_VERSION) {
  return onboardingStatus(profile, current) === 'update' && (Number(profile?.onboardingNoticeVersion) || 0) < current;
}

// What to do about the notification this session. 'send': never sent for this
// version, so create it. 'resurface': already sent, but onboarding still isn't
// finished, so make it unread again, so it keeps showing up (and keeps
// counting in the red badge) until they finish. null: nothing to do.
export function noticeAction(profile, current = ONBOARDING_VERSION) {
  if (onboardingStatus(profile, current) !== 'update') return null;
  return needsOnboardingNotice(profile, current) ? 'send' : 'resurface';
}

// Onboarding counts as done only once every card has an answer (answers from
// an earlier run count). Skipping the cards, or leaving some unanswered, still
// saves what was answered, but leaves the notification and banner up until the
// rest is done. The notes step is optional and doesn't matter here.
export const isDeckComplete = (answeredCount, deckSize) => deckSize > 0 && answeredCount >= deckSize;

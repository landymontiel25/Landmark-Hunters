// Discovery alerts (docs/discovery-network-plan.md, Phase 5): the groups,
// their words for Settings, and the limits the server keeps. Each group is
// on unless its switch in users/{uid}/private/main.notificationPrefs is
// false.
export const ALERT_GROUPS = {
  tipWent: { label: 'People went because of your tip', help: 'Push, at most once a day.' },
  tipHelpful: { label: 'Helpful marks on your tips', help: 'In the app only.' },
  levelUp: { label: 'A new level in a city', help: 'Push.' },
  newFollower: { label: 'New followers', help: 'In the app; a push for your first 10.' },
  followTip: { label: 'Tips from people you follow', help: 'Push, at most 2 a day, in cities you have been to.' },
  nearbyFind: { label: 'Trusted finds near you', help: 'Push, at most once a week, within a mile.' },
};
export const ALERT_GROUP_IDS = Object.keys(ALERT_GROUPS);
export const FOLLOW_TIP_DAILY_MAX = 2;
export const FOLLOWER_PUSH_FIRST = 10;
export const NEARBY_FIND_MILES = 1;

export const alertOn = (prefs, group) => !prefs || prefs[group] !== false;

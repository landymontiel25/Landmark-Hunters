// The Test tab's "Planner launch" list (owner, 2026-11-02): every feature turned
// off so far, found in the git history and the code. Add an entry whenever
// something is switched off (or remove it when it comes back). `file` and
// `check` name the switch; plannerList.test.js fails if the switch isn't
// there anymore, so the list can't go stale. Dates are when it was turned
// off.
export const TURNED_OFF = [
  {
    name: 'Check-in radius (everyone)',
    hides: 'The rule that you have to be at a place to check in. Anyone can check in from anywhere, and the check-in is verified and pays like a visit; offline check-ins count wherever they were made; mission photos skip the "taken here" check.',
    keeps: 'The photo checks still judge what a photo shows, check-in points still pay once per account, and the radius code stays: switching it back on restores the 30 m rule and each place\'s own area.',
    since: '2026-11-24',
    // Merged straight to main, no PR: the commit that switched it off.
    commit: 'fc63852c6969d3684ff00e7cd401bf9e5998f624',
    file: 'src/lib/maprConstants.js',
    check: 'CHECKIN_RADIUS_ON = false',
  },
  {
    name: '"From people who went" (landmark page)',
    hides: 'The "From people who went" tips section on a landmark\'s page, opened from the Landmarks tab or the Map. Nothing shows in its place.',
    keeps: 'Tips are still shared after a verified check-in and still saved; the Feed still shows them.',
    since: '2026-11-18',
    pr: 887,
    file: 'src/screens/LandmarkDetail.jsx',
    check: 'SHOW_TIPS_SECTION = false',
  },
  {
    name: 'For Me sort (Landmarks tab)',
    hides: 'The "✨ For Me" sort button on the Landmarks tab. The list now sorts by Popular Landmarks or Near Me there.',
    keeps: 'For Me still works under Planner launch on the Test tab: the same list, Mapr ranking for you, with check-in and rating.',
    since: '2026-11-06',
    pr: 802,
    file: 'src/screens/LandmarkSelection.jsx',
    check: 'SHOW_FOR_ME_SORT = false',
  },
  {
    name: 'Badges',
    hides: 'All Badges on Full Stats, the "Badge Earned" popup and the badges on the Discoverer card.',
    keeps: 'Badges are still earned and saved, so turning it back on shows everything.',
    since: '2026-10-20',
    pr: 713,
    file: 'src/lib/featureFlags.js',
    check: 'SHOW_BADGES = false',
  },
  {
    name: 'Time saved card',
    hides: 'The "time saved" stat card on Profile and Mapr.',
    keeps: 'Time saved is still tracked from Mapr chats.',
    since: '2026-10-18',
    pr: 702,
    file: 'src/components/DiscoveryStatsCard.jsx',
    check: 'SHOW_TIME_SAVED_CARD = false',
  },
  {
    name: 'Discoverer and Follows cards',
    hides: 'The Discoverer and Follows cards on Profile.',
    keeps: 'Follows still work behind the scenes.',
    since: '2026-10-26',
    pr: 741,
    file: 'src/screens/Profile.jsx',
    check: 'SHOW_DISCOVERER_AND_FOLLOWS = false',
  },
  {
    name: 'Add a Landmark (Landmarks tab)',
    hides: 'The "Add a Landmark" button under the search box on the Landmarks tab.',
    keeps: 'The Add Landmark page still exists.',
    since: '2026-10-26',
    pr: 741,
    file: 'src/screens/LandmarkSelection.jsx',
    check: 'SHOW_ADD_LANDMARK = false',
  },
  {
    name: 'Add a landmark (Map)',
    hides: 'Long-press (or right-click) on the Map to drop a pin and add a landmark there.',
    keeps: 'Places people already added still show.',
    since: '2026-10-29',
    pr: 756,
    file: 'src/screens/MapExplore.jsx',
    check: 'SHOW_ADD_LANDMARK = false',
  },
  {
    name: 'Hidden categories',
    hides: 'Formula 1 Circuits, 10/10 Benches, Stadiums, Campus Life and Airports in every category picker and the Map filter.',
    keeps: 'Their places still show everywhere.',
    since: '2026-10-08 to 2026-10-12',
    pr: 638,
    file: 'src/data/regions.js',
    check: "HIDDEN_INTEREST_IDS = new Set(['formula-1', 'benches', 'stadiums', 'campus-life', 'airports'])",
  },
  {
    name: '"Tell Mapr what to change" box',
    hides: 'The box under Taste Profile (Test tab) for telling Mapr in your own words what to change.',
    keeps: 'The parsing behind it stays.',
    since: '2026-10-21',
    pr: 727,
    file: 'src/screens/TasteProfileLab.jsx',
    check: 'SHOW_CHANGE_BOX = false',
  },
];

// Taken out of the app, not behind a switch: bringing these back means
// building them in again.
export const REMOVED = [
  {
    name: 'Travel Picks',
    what: 'The Travel Picks carousel in Settings, Streaks and Mapr chat.',
    since: '2026-10-26',
    pr: 741,
  },
];

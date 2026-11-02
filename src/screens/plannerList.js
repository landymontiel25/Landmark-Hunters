// The Test tab's "Planner" list (owner, 2026-11-02): every feature turned
// off so far, found in the git history and the code. Add an entry whenever
// something is switched off (or remove it when it comes back). `file` and
// `check` name the switch; plannerList.test.js fails if the switch isn't
// there anymore, so the list can't go stale. Dates are when it was turned
// off.
export const TURNED_OFF = [
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
    name: 'Places people added in Miami',
    hides: "User-added places in Miami, off every list, map and pick, so Miami shows only the owner's top 100.",
    keeps: 'They are hidden, not deleted, and their own page still opens.',
    since: '2026-10-27',
    pr: 743,
    file: 'src/lib/customLandmarks.js',
    check: "CLOSED_TO_CUSTOM = new Set(['miami'])",
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
  {
    name: 'No points near home',
    hides: 'Zeroing the points for check-ins within half a mile of your home.',
    keeps: 'Every check-in still records whether it was near home.',
    since: '2026-09-24',
    pr: 283,
    file: 'src/lib/leaderboard.js',
    check: 'HOME_RADIUS_EXCLUSION_ENABLED = false',
  },
  {
    name: 'GPS required to check in',
    hides: 'The rule that a check-in needs your phone to be within the place’s radius.',
    keeps: 'Check-ins go through anywhere and are saved as unverified; the server still verifies presence when it can.',
    since: '2026-10-01',
    pr: 494,
    file: 'src/lib/maprConstants.js',
    check: 'REQUIRE_GPS_CHECKIN = false',
  },
  {
    name: 'Tripadvisor ratings',
    hides: 'Tripadvisor ratings next to Google’s on Landmarks and each landmark’s page.',
    keeps: 'Built and ready; it turns on once a Tripadvisor API key is added.',
    since: '2026-10-13',
    pr: 655,
    file: 'api/_lib/ratingSources.js',
    check: 'process.env.TRIPADVISOR_API_KEY',
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

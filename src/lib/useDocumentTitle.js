import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Tab / screen-reader title per route, so moving between screens announces
// something other than "Landmark Hunters" every time.
const TITLES = [
  [/^\/$/, 'Map'],
  [/^\/add-landmark/, 'Add a landmark'],
  [/^\/landmarks\/[^/]+\/[^/]+/, 'Landmark'],
  [/^\/landmarks/, 'Landmarks'],
  [/^\/itinerary/, 'Trip'],
  [/^\/leaderboard\/full/, 'Leaderboard'],
  [/^\/(profile|leaderboard|account)/, 'Profile'],
  [/^\/legal/, 'Legal'],
  [/^\/group\//, 'Group trip'],
  [/^\/settings/, 'Settings'],
  [/^\/stats/, 'Stats'],
  [/^\/checkins/, 'Check-ins'],
  [/^\/mapr-ratings/, 'My ratings'],
  [/^\/cities/, 'Cities'],
  [/^\/streaks/, 'Streaks'],
  [/^\/friend\/[^/]+\/checkins/, 'Friend check-ins'],
  [/^\/friend\/[^/]+\/cities/, 'Friend cities'],
  [/^\/notifications/, 'Notifications'],
  [/^\/request-feature/, 'Request a feature'],
  [/^\/report-bug/, 'Report a bug'],
  [/^\/mapr/, 'Mapr'],
  [/^\/onboarding/, 'Welcome'],
];

export function titleForPath(pathname) {
  const hit = TITLES.find(([re]) => re.test(pathname));
  return hit ? `${hit[1]} · Landmark Hunters` : 'Landmark Hunters';
}

export function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
}

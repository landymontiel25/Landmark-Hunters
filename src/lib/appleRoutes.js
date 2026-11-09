// The four tabs in the Apple Maps look. Mapr (/mapr) is never on this list:
// its screen keeps its own design (owner, 2026-11-09).
const SCREENS = [
  ['/landmarks', 'landmarks'],
  ['/itinerary', 'itinerary'],
  ['/profile', 'profile'],
  ['/leaderboard', 'profile'],
  ['/account', 'profile'],
];

// The Apple screen a hash-router path belongs to, or null.
export function appleScreenFor(pathname) {
  const path = pathname || '/';
  if (path === '/') return 'map';
  const hit = SCREENS.find(([base]) => path === base || path.startsWith(`${base}/`));
  // The full leaderboard and a landmark's page keep the app's own look.
  if (!hit || path === '/leaderboard/full' || path.startsWith('/landmarks/')) return null;
  return hit[1];
}

// Main tabs that should open at the top when navigated to (not via Back).
const MAIN_TABS = new Set(['/', '/landmarks', '/itinerary', '/profile', '/mapr']);

export function shouldResetScroll(pathname, navigationType) {
  return navigationType !== 'POP' && MAIN_TABS.has(pathname);
}

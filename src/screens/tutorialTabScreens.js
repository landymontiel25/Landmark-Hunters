import { lazy } from 'react';

// The real tab screens, shown live (scaled down, not clickable) in the
// Tutorial's "Your tabs" step. Same modules App.jsx lazy-loads, so they share
// its chunks. Keyed by TABS' `path` in signupTutorialSteps.js.
export const TAB_SCREENS = {
  '/': lazy(() => import('./MapExplore')),
  '/landmarks': lazy(() => import('./LandmarkSelection')),
  '/mapr': lazy(() => import('./Mapr')),
  '/itinerary': lazy(() => import('./Itinerary')),
  '/profile': lazy(() => import('./Profile')),
};

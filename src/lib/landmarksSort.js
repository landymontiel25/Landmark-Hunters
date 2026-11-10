import { setSessionValue } from './usePersistentState';

// The Landmarks tab's sort, held for as long as the app is open (session
// state). The tab opens on Popular (owner, 2026-11-10); tapping Popular again
// turns it off and the list goes A to Z.
export const LANDMARKS_SORT_KEY = 'landmarks.sort';
export const TOP_LANDMARKS_SORT = 'rated';

// Opens the Landmarks tab on Popular Landmarks (Play, and the Popular
// Landmarks chip on Create New Trip).
export const showTopLandmarks = () => setSessionValue(LANDMARKS_SORT_KEY, TOP_LANDMARKS_SORT);

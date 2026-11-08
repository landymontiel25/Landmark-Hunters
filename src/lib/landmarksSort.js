import { setSessionValue } from './usePersistentState';

// The Landmarks tab's sort, held for as long as the app is open (session
// state). The app opens with none picked (owner, 2026-11-08), so Google's
// ratings can load before someone taps Popular.
export const LANDMARKS_SORT_KEY = 'landmarks.sort';
export const TOP_LANDMARKS_SORT = 'rated';

// Opens the Landmarks tab on Popular Landmarks (Play, and the Popular
// Landmarks chip on Create New Trip).
export const showTopLandmarks = () => setSessionValue(LANDMARKS_SORT_KEY, TOP_LANDMARKS_SORT);

import { writePersisted } from './usePersistentState';

// The Landmarks tab's saved sort. A new key makes everyone land on Top
// Landmarks (the first button, formerly Top Rated) once, since it replaced
// For Me as the default (owner, 2026-10-27).
export const LANDMARKS_SORT_KEY = 'landmarks.sort.v3';
export const TOP_LANDMARKS_SORT = 'rated';

// Opens the Landmarks tab on Top Landmarks (Play, and the Top Landmarks chip
// on Create New Trip).
export const showTopLandmarks = () => writePersisted(LANDMARKS_SORT_KEY, TOP_LANDMARKS_SORT);
